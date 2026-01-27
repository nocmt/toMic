/**
 * ToMic - Server
 * 
 * 核心服务端代码，负责：
 * 1. 启动 HTTPS 服务和 WebSocket 服务
 * 2. 接收客户端音频流
 * 3. 使用 FFmpeg 进行音频转码 (WebM -> PCM)
 * 4. 通过 SoX (推荐) 或 Speaker 将音频输出到虚拟声卡 (BlackHole)
 * 
 * @author Your Name
 * @license MIT
 */

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const Speaker = require('speaker');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const os = require('os');

// 平台检测
const IS_MAC = os.platform() === 'darwin';
const IS_WIN = os.platform() === 'win32';

// 路径配置
const isPkg = typeof process.pkg !== 'undefined';
const BASE_DIR = isPkg ? path.dirname(process.execPath) : __dirname;

// 统一 Native 目录查找逻辑
// Windows: native/windows-listener
// macOS: native
const NATIVE_DIR = path.join(BASE_DIR, 'native');
const LOCAL_WIN_LISTENER_DIR = path.join(NATIVE_DIR, 'windows-listener');

// Windows 路径
const WIN_SOX_PATH = path.join(LOCAL_WIN_LISTENER_DIR, 'sox.exe');
const WIN_FFMPEG_PATH = path.join(LOCAL_WIN_LISTENER_DIR, 'ffmpeg.exe');

// macOS 路径 (独立打包后位于 native/ffmpeg, native/sox)
const MAC_SOX_PATH = path.join(NATIVE_DIR, 'sox');
const MAC_FFMPEG_PATH = path.join(NATIVE_DIR, 'ffmpeg');

// 二进制文件路径和状态
let soxPath = 'sox'; // 默认系统命令
let ffmpegPath = 'ffmpeg'; // 默认系统命令
let hasSox = false;
let hasFfmpeg = false;
let soxUseDefaultDevice = false; // Windows 下 sox 需要 -d 参数

// 1. 检测 FFmpeg
if (IS_WIN && fs.existsSync(WIN_FFMPEG_PATH)) {
    ffmpegPath = WIN_FFMPEG_PATH;
    console.log(`【系统初始化】检测到本地 FFmpeg: ${ffmpegPath}`);
} else if (IS_MAC && fs.existsSync(MAC_FFMPEG_PATH)) {
    ffmpegPath = MAC_FFMPEG_PATH;
    console.log(`【系统初始化】检测到本地 FFmpeg: ${ffmpegPath}`);
}

// 设置 ffmpeg 路径
try {
    ffmpeg.setFfmpegPath(ffmpegPath);
    hasFfmpeg = true; 
} catch (e) {
    console.error('【系统初始化】FFmpeg 配置异常:', e.message);
    hasFfmpeg = false;
}

// 2. 检测 SoX
if (IS_WIN) {
    if (fs.existsSync(WIN_SOX_PATH)) {
        soxPath = WIN_SOX_PATH;
        hasSox = true;
        soxUseDefaultDevice = true; 
        console.log(`【系统初始化】检测到本地 SoX: ${soxPath}`);
    } else {
        // 尝试系统路径
        const checkSox = require('child_process').spawnSync('sox', ['--version']);
        if (checkSox.status === 0) {
            hasSox = true;
            soxUseDefaultDevice = true;
            console.log('【系统初始化】检测到系统 SoX');
        }
    }
} else {
    // macOS / Linux
    if (IS_MAC && fs.existsSync(MAC_SOX_PATH)) {
        soxPath = MAC_SOX_PATH;
        hasSox = true;
        console.log(`【系统初始化】检测到本地 SoX: ${soxPath}`);
    } else {
        const checkSox = require('child_process').spawnSync('sox', ['--version']);
        if (checkSox.status === 0) {
            hasSox = true;
            console.log('【系统初始化】检测到 SoX 音频工具');
        }
    }
}


if (hasSox) {
    console.log('【系统初始化】SoX 就绪，将启用定向音频路由 (BlackHole/VB-CABLE)');
} else {
    console.log('【系统初始化】未检测到 SoX，将使用默认音频输出设备 (Speaker)');
    if (IS_MAC) {
        console.log('【建议】运行 "brew install sox" 以支持定向输出到 BlackHole');
    } else if (IS_WIN) {
        console.log('【建议】请确保 native/windows-listener/sox.exe 存在');
        console.log('【下载地址】https://github.com/turbulentie/sox-dsd-win/blob/main/sox-dsd-win32_64.zip');
    }
}

// 检查 FFmpeg 是否可用，如果不可用给提示
// 注意：fluent-ffmpeg 只有在实际运行命令时才会报错，所以这里最好预检一下
// 但上面已经设置了路径，我们相信用户
if (!fs.existsSync(ffmpegPath) && IS_WIN) {
     console.log('【警告】未找到 ffmpeg.exe。');
     console.log('【建议】请下载 ffmpeg.exe 并放置于 native/windows-listener/ffmpeg.exe');
     console.log('【下载地址】https://github.com/GyanD/codexffmpeg/releases');
}


// 配置
const PORT = 23336;
// 证书目录必须在可执行文件外部（因为 pkg 内部只读）
const CERT_DIR = path.join(BASE_DIR, 'certs');
const OUTPUT_HINT = IS_MAC ? `
【输出设备提示】
请将系统“声音->输出设备”切换为虚拟设备：
  - macOS 请选择 BlackHole 2ch（推荐“无监听”版本避免本机扬声器播放）
  - Windows 请选择 VB-CABLE（CABLE Input）
如果输出仍为内置扬声器，将产生本机回放与回声。
` : IS_WIN ? `
【输出设备提示】
请将系统“声音->输出设备”切换为虚拟设备：
  - Windows 请选择 VB-CABLE（CABLE Input）
如果输出仍为内置扬声器，将产生本机回放与回声。
` : '';

// 确保证书目录存在
if (!fs.existsSync(CERT_DIR)) {
    try {
        fs.mkdirSync(CERT_DIR, { recursive: true });
    } catch (e) {
        console.error(`【系统初始化】无法创建证书目录: ${CERT_DIR}`, e);
    }
}

// 获取或生成证书
async function getCertificates() {
    const keyPath = path.join(CERT_DIR, 'private.key');
    const certPath = path.join(CERT_DIR, 'certificate.crt');

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        console.log('【系统初始化】检测到现有证书，正在加载...');
        return {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
    }

    console.log('【系统初始化】正在生成新的自签名证书 (这可能需要几秒钟)...');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    
    // selfsigned.generate 在新版本中返回 Promise
    const pems = await selfsigned.generate(attrs, { days: 365 });

    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
    console.log('【系统初始化】证书生成完毕');

    return {
        key: pems.private,
        cert: pems.cert
    };
}

// 主初始化流程
async function startServer() {
    try {
        const app = express();
        const options = await getCertificates();
        const server = https.createServer(options, app);
        const io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            },
            serveClient: false // 统一禁用自动 serve，改用静态文件/手动路由
        });

        app.use(express.json());
        // public 目录在 pkg 中会被自动打包到 snapshot 中，__dirname 可用
        app.use(express.static(path.join(BASE_DIR, 'public')));

        // 开发环境：手动路由 lib/socket.io.js 到 node_modules
        if (!isPkg) {
            app.get('/lib/socket.io.js', (req, res) => {
                 // 尝试查找 node_modules 中的 socket.io 客户端文件
                 try {
                     const socketIoBase = path.dirname(require.resolve('socket.io/package.json'));
                     res.sendFile(path.join(socketIoBase, 'client-dist', 'socket.io.js'));
                 } catch (e) {
                     res.status(404).send('socket.io client file not found');
                 }
            });
            app.get('/lib/socket.io.js.map', (req, res) => {
                 try {
                     const socketIoBase = path.dirname(require.resolve('socket.io/package.json'));
                     res.sendFile(path.join(socketIoBase, 'client-dist', 'socket.io.js.map'));
                 } catch (e) {
                     res.status(404).send('map file not found');
                 }
            });
        }

        let demandState = false;

        app.post('/api/mic/start', (req, res) => {
            demandState = true;
            io.emit('server-start');
            console.log('【待机控制】已向所有客户端广播：开始拾音');
            res.json({ ok: true });
        });

        app.post('/api/mic/stop', (req, res) => {
            demandState = false;
            io.emit('server-stop');
            console.log('【待机控制】已向所有客户端广播：停止拾音');
            res.json({ ok: true });
        });

        io.on('connection', (socket) => {
            console.log(`【连接管理】客户端已连接 ID: ${socket.id}`);
            // 新连接同步期望状态
            if (demandState) {
                socket.emit('server-start');
            } else {
                socket.emit('server-stop');
            }

            // 每个连接创建一个音频处理管道
            let audioStream = new PassThrough();
            let ffmpegCommand = null;
            let speaker = null;
            let soxProcess = null;
            let desiredStreaming = false;
            let pipelineState = 'idle';

            // 初始化 FFmpeg 转换流 (WebM -> PCM -> Speaker/SoX)
            function startAudioPipeline() {
                if (ffmpegCommand) return;
                pipelineState = 'running';

                console.log(`【音频管道】正在为客户端 ${socket.id} 初始化音频管道...`);
                
                let outputStream;

                if (hasSox) {
                    // 使用 SoX 定向输出
                    // macOS: play -t raw ... (play 实际上是 sox 的别名，默认输出到 default device)
                    // Windows: sox -t raw ... -d (显式指定 -d 输出到 default device)
                    
                    const args = [
                        '-t', 'raw',      // 输入格式 raw
                        '-b', '16',       // 16 bit
                        '-e', 'signed',   // signed integer
                        '-c', '1',        // 1 channel
                        '-r', '48000',    // 48k sample rate
                        '-'               // 从 stdin 读取
                    ];

                    // Windows 下如果直接使用 sox.exe，需要添加 -d 参数来指定默认输出设备
                    if (soxUseDefaultDevice) {
                        // args.push('-d');
                        // 显式指定 waveaudio default，解决部分系统 "no default audio device configured" 问题
                        // 优先尝试输出到 VB-CABLE，如果找不到则回退到 default
                        // 注意：SoX 的 waveaudio 驱动使用设备名称匹配
                        // 我们尝试直接指定 "CABLE Input (VB-Audio Virtual Cable)"
                        
                        // 由于 SoX 对设备名称的支持可能受限于版本和编译选项，
                        // 以及名称中空格的处理，这里使用 env.AUDIODEV 可能更稳妥，或者尝试直接传参
                        
                        // 策略：如果是在 Windows，我们尝试通过环境变量设置 AUDIODEV
                        // 或者直接在参数里写。SoX 14.4.2+ on Windows usually supports -t waveaudio "Device Name"
                        
                        args.push('-t', 'waveaudio');
                        // 使用 default 作为回退，但为了定向输出，我们尝试指定设备名
                        // 如果用户没有改名，通常是 "CABLE Input (VB-Audio Virtual Cable)"
                        // 但为了保险，我们先用 default，并提示用户设置 default device
                        // 如果要强制路由，需要知道准确的设备名。
                        // 从之前的 ffmpeg output 看到的名字是 "CABLE Input (VB-Audio Virtual Cable)"
                        // 尝试直接使用该名称
                        args.push('CABLE Input (VB-Audio Virtual Cable)'); 
                    }

                    const env = { ...process.env };
                    if (IS_MAC) {
                         env.AUDIODEV = 'BlackHole 2ch';
                    } else if (IS_WIN) {
                        // Windows 下也可以尝试设置 AUDIODEV，但命令行参数优先级更高
                        // env.AUDIODEV = 'CABLE Input (VB-Audio Virtual Cable)';
                    }
                    
                    try {
                        // 在 Windows 下使用 spawn 时，如果路径包含空格可能会有问题，但这里是直接执行
                        soxProcess = spawn(soxPath, args, { env });
                        
                        soxProcess.on('error', (err) => {
                            console.error(`【SoX错误】启动失败: ${err.message}`);
                            // Windows 下可能 spawn 失败，回退到 Speaker?
                            // 这里不做自动回退，让用户看到错误
                        });

                        // 忽略 stderr 输出，除非调试需要
                        soxProcess.stderr.on('data', (data) => {
                            const msg = data.toString();
                            // 仅在出错或 Windows 下打印，方便调试
                            // 屏蔽常规进度信息: "In:0.00%"
                            if (msg.includes('In:') && msg.includes('Out:')) {
                                return;
                            }
                            // 屏蔽文件头信息
                            if (msg.includes('Encoding:') || msg.includes('Channels:') || msg.includes('Samplerate:') || msg.includes('File Size:')) {
                                return;
                            }

                            if (IS_WIN || msg.includes('FAIL') || msg.includes('WARN')) {
                                // 过滤掉一些非关键信息，只保留可能的错误
                                if (msg.trim().length > 0) {
                                    // console.log(`【SoX底层】${msg.trim()}`);
                                }
                            }
                        }); 

                        outputStream = soxProcess.stdin;
                        const deviceName = IS_MAC ? 'BlackHole 2ch' : 'Default Audio Device (VB-CABLE)';
                        console.log(`【音频管道】已启动 SoX 进程，定向输出到 ${deviceName}`);
                    } catch (e) {
                        console.error(`【SoX异常】${e.message}`);
                        hasSox = false; 
                    }
                }
                
                if (!outputStream) {
                    // 初始化扬声器 (PCM 16bit, 48k, Mono) - 回退方案
                    speaker = new Speaker({
                        channels: 1,
                        bitDepth: 16,
                        sampleRate: 48000
                    });

                    speaker.on('close', () => {
                        // console.log(`【音频管道】Speaker 已关闭 (${socket.id})`);
                    });
                    outputStream = speaker;
                    console.log('【音频管道】使用默认 Speaker 输出 (未启用定向路由)');
                }

                // 配置 FFmpeg
                // 输入: WebM (来自浏览器)
                // 输出: Raw PCM (送给 Speaker/SoX)
                ffmpegCommand = ffmpeg(audioStream)
                    .inputFormat('webm')
                    .audioCodec('pcm_s16le')
                    .audioChannels(1)
                    .audioFrequency(48000)
                    .format('s16le')
                    .on('error', (err) => {
                        if (!err.message.includes('Output stream closed') && 
                            !err.message.includes('write after end') && 
                            !err.message.includes('signal SIG') &&
                            !err.message.includes('ffmpeg exited with code 255')) {
                            console.error(`【FFmpeg错误】: ${err.message}`);
                        }
                        cleanupPipeline();
                    })
                    .on('start', () => {
                        console.log(`【FFmpeg】转码进程启动 (${socket.id})`);
                    })
                    .on('end', () => {
                        cleanupPipeline();
                    })
                    .on('close', () => {
                        cleanupPipeline();
                    });

                // 将 FFmpeg 的输出管道连接到 Speaker/SoX
                ffmpegCommand.pipe(outputStream, { end: true });
            }

            function cleanupPipeline() {
                if (speaker) {
                    if (typeof speaker.close === 'function') {
                         speaker.close();
                    } else if (typeof speaker.end === 'function') {
                         speaker.end();
                    }
                    speaker = null;
                }
                if (soxProcess) {
                    soxProcess.kill();
                    soxProcess = null;
                }
                ffmpegCommand = null;
                if (pipelineState !== 'idle') {
                    pipelineState = 'idle';
                }
                audioStream = new PassThrough();
            }

            function stopAudioPipeline() {
                if (pipelineState === 'idle') return;
                pipelineState = 'stopping';
                console.log(`【音频管道】正在停止 (${socket.id})...`);
                if (audioStream && !audioStream.destroyed) {
                    audioStream.end();
                }
                if (ffmpegCommand) {
                    ffmpegCommand.kill('SIGTERM');
                } else {
                    cleanupPipeline();
                }
            }

            socket.on('start-stream', () => {
                console.log(`【指令】收到开始推流请求 (${socket.id})`);
                desiredStreaming = true;
                if (pipelineState === 'idle') {
                    pipelineState = 'starting';
                    audioStream = new PassThrough();
                }
            });

            socket.on('audio-chunk', (data) => {
                // data 是 ArrayBuffer 或 Buffer
                if (audioStream && !audioStream.destroyed) {
                    if (desiredStreaming && pipelineState === 'starting' && !ffmpegCommand) {
                        startAudioPipeline();
                    }
                    if (desiredStreaming) {
                        audioStream.write(data);
                    }
                }
            });

            socket.on('stop-stream', () => {
                console.log(`【指令】收到停止推流请求 (${socket.id})`);
                desiredStreaming = false;
                stopAudioPipeline();
            });

            socket.on('disconnect', () => {
                console.log(`【连接管理】客户端断开 ID: ${socket.id}`);
                stopAudioPipeline();
            });
        });

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`-----------------------------------------------------`);
            console.log(`【服务启动】HTTPS 服务器运行在 https://${getLocalIP()}:${PORT}`);
            console.log(`【重要提示】`);
            if (IS_MAC) {
                console.log(`1. 请确保已安装 ffmpeg (brew install ffmpeg)`);
                console.log(`2. 请将系统默认音频输出设置为 'BlackHole'`);
            } else if (IS_WIN) {
                if (!hasFfmpeg) console.log(`1. 未检测到 ffmpeg，请参考上文警告进行配置`);
                console.log(`2. 请将系统默认音频输出设置为 'VB-CABLE'`);
            }
            console.log(`3. 手机需连接同一 Wi-Fi，访问上面的 IP 地址`);
            console.log(OUTPUT_HINT);
            console.log(`-----------------------------------------------------`);
        });

    } catch (err) {
        console.error('【系统启动失败】', err);
    }
}

if (require.main === module) {
    startServer();
}

// 获取局域网Ip
function getLocalIP() {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    for (const interfaceName in networkInterfaces) {
        const interfaceInfo = networkInterfaces[interfaceName];
        for (const addressInfo of interfaceInfo) {
            if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
                return addressInfo.address;
            }
        }
    }
    return '0.0.0.0';
}

module.exports = { startServer };
