const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');
const Speaker = require('speaker');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');

// 配置
const PORT = 3000;
const CERT_DIR = path.join(__dirname, 'certs');
const OUTPUT_HINT = `
【输出设备提示】
请将系统“声音->输出设备”切换为虚拟设备：
  - macOS 请选择 BlackHole 2ch（推荐“无监听”版本避免本机扬声器播放）
  - Windows 请选择 VB-CABLE（CABLE Input）
如果输出仍为内置扬声器，将产生本机回放与回声。
`;

// 确保证书目录存在
if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR);
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
(async () => {
    try {
        const app = express();
        const options = await getCertificates();
        const server = https.createServer(options, app);
        const io = new Server(server);

        app.use(express.json());
        app.use(express.static('public'));

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
            let desiredStreaming = false;
            let pipelineState = 'idle';

            // 初始化 FFmpeg 转换流 (WebM -> PCM -> Speaker)
            function startAudioPipeline() {
                if (ffmpegCommand) return;
                pipelineState = 'running';

                console.log(`【音频管道】正在为客户端 ${socket.id} 初始化音频管道...`);
                
                // 初始化扬声器 (PCM 16bit, 48k, Mono)
                speaker = new Speaker({
                    channels: 1,
                    bitDepth: 16,
                    sampleRate: 48000
                });

                speaker.on('close', () => {
                    // console.log(`【音频管道】Speaker 已关闭 (${socket.id})`);
                });

                // 配置 FFmpeg
                // 输入: WebM (来自浏览器)
                // 输出: Raw PCM (送给 Speaker)
                ffmpegCommand = ffmpeg(audioStream)
                    .inputFormat('webm')
                    .audioCodec('pcm_s16le')
                    .audioChannels(1)
                    .audioFrequency(48000)
                    .format('s16le')
                    .on('error', (err) => {
                        if (!err.message.includes('Output stream closed') && !err.message.includes('write after end') && !err.message.includes('signal SIG')) {
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

                // 将 FFmpeg 的输出管道连接到 Speaker
                ffmpegCommand.pipe(speaker, { end: true });
            }

            function cleanupPipeline() {
                if (speaker) {
                    speaker.close();
                    speaker = null;
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
            console.log(`【服务启动】HTTPS 服务器运行在 https://0.0.0.0:${PORT}`);
            console.log(`【重要提示】`);
            console.log(`1. 请确保已安装 ffmpeg (brew install ffmpeg)`);
            console.log(`2. 请将系统默认音频输出设置为 'BlackHole' 或 'VB-Cable'`);
            console.log(`3. 手机需连接同一 Wi-Fi，访问上面的 IP 地址`);
            console.log(OUTPUT_HINT);
            console.log(`-----------------------------------------------------`);
        });

    } catch (err) {
        console.error('【系统启动失败】', err);
    }
})();
