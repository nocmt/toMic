/**
 * ToMic - 一键启动脚本
 * 
 * 负责自动检测环境、启动后端服务，并根据平台启动对应的麦克风监听器。
 * 支持 macOS (Swift) 和 Windows (Python)。
 */

const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER_URL = 'https://127.0.0.1:23336';
const macListenerRoot = path.join(__dirname, 'native', 'macos-listener');
const winListenerRoot = path.join(__dirname, 'native', 'windows-listener');

let serverProcess = null;
let listenerProcess = null;
let lastState = null;
let pendingAction = null;
let retryTimer = null;
let stdoutBuffer = '';

function log(message) {
    console.log(`【一键启动】${message}`);
}

function requestAction(action) {
    if (pendingAction === action) return;
    pendingAction = action;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    const doRequest = () => {
        const url = new URL(`/api/mic/${action}`, SERVER_URL);
        const req = https.request(
            url,
            {
                method: 'POST',
                rejectUnauthorized: false
            },
            (res) => {
                res.on('data', () => {});
                res.on('end', () => {
                    log(`触发完成: ${action}`);
                    pendingAction = null;
                });
            }
        );
        req.on('error', (err) => {
            log(`触发失败，准备重试: ${err.message}`);
            retryTimer = setTimeout(doRequest, 1000);
        });
        req.end();
    };

    doRequest();
}

function startServer() {
    serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: __dirname,
        stdio: 'inherit'
    });
    serverProcess.on('exit', (code) => {
        log(`服务进程退出: ${code ?? 'unknown'}`);
    });
}

function findMacListenerBinary() {
    // 优先检查 dist 目录
    const distPath = path.join(macListenerRoot, 'dist', 'mac-input-listener');
    if (fs.existsSync(distPath)) return distPath;
    return null;
}

function buildMacListenerIfNeeded() {
    const found = findMacListenerBinary();
    if (found) return Promise.resolve({ binPath: found, useSwiftRun: false });

    return new Promise((resolve) => {
        log('未检测到 dist/mac-input-listener，正在构建 CoreAudio 监听器...');
        
        // 确保 dist 目录存在
        const distDir = path.join(macListenerRoot, 'dist');
        if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

        const build = spawn('swift', ['build', '-c', 'release', '--disable-sandbox'], {
            cwd: macListenerRoot,
            stdio: 'inherit'
        });
        
        build.on('exit', (code) => {
            if (code === 0) {
                // 构建成功后，查找构建产物并移动到 dist
                // Swift build output 通常在 .build/release/mac-input-listener 或 .build/x86_64-apple-macosx/release/mac-input-listener
                const buildRoot = path.join(macListenerRoot, '.build');
                let builtBin = path.join(buildRoot, 'release', 'mac-input-listener');
                
                if (!fs.existsSync(builtBin)) {
                    // 尝试查找架构特定的目录
                    const entries = fs.readdirSync(buildRoot);
                    for (const entry of entries) {
                         if (entry.includes('apple-macosx')) {
                             const candidate = path.join(buildRoot, entry, 'release', 'mac-input-listener');
                             if (fs.existsSync(candidate)) {
                                 builtBin = candidate;
                                 break;
                             }
                         }
                    }
                }

                if (fs.existsSync(builtBin)) {
                     const targetPath = path.join(distDir, 'mac-input-listener');
                     fs.copyFileSync(builtBin, targetPath);
                     log(`构建成功，已归档二进制文件到: ${targetPath}`);
                     return resolve({ binPath: targetPath, useSwiftRun: false });
                } else {
                    log('构建显示成功但未找到产物，将尝试使用 swift run');
                }
            } else {
                log('构建失败');
            }
            resolve({ binPath: null, useSwiftRun: true });
        });
    });
}

function handleListenerLine(line) {
    // 忽略空行
    if (!line) return;
    
    if (line.includes('STATE_RUNNING')) {
        if (lastState !== 'running') {
            lastState = 'running';
            requestAction('start');
        }
        return;
    }
    if (line.includes('STATE_STOPPED')) {
        if (lastState !== 'stopped') {
            lastState = 'stopped';
            requestAction('stop');
        }
        return;
    }
}

function startMacListener(binPath, useSwiftRun) {
    if (useSwiftRun) {
        log('未检测到监听器二进制，改用 swift run');
        listenerProcess = spawn('swift', ['run', '-c', 'release', '--disable-sandbox'], { cwd: macListenerRoot });
    } else {
        log(`监听器路径: ${binPath}`);
        listenerProcess = spawn(binPath, [], { cwd: macListenerRoot });
    }
    setupListenerProcess(listenerProcess);
}

function startWindowsListener() {
    // 检查 dist 下的 exe 是否存在
    const exePath = path.join(winListenerRoot, 'dist', 'mic_listener.exe');
    if (fs.existsSync(exePath)) {
        log(`监听器路径: ${exePath}`);
        listenerProcess = spawn(exePath, [], { cwd: winListenerRoot });
        setupListenerProcess(listenerProcess);
        return;
    }

    // 不存在则提示构建
    log('❌ 未检测到 Windows 监听器可执行文件 (native/windows-listener/dist/mic_listener.exe)');
    log('⚠️  请按以下步骤进行构建：');
    log('   1. 确保已安装 Python 3 和 pip');
    log('   2. cd native/windows-listener');
    log('   3. pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple');
    log('   4. pyinstaller --onefile --noconsole --distpath dist --name mic_listener mic_listener.py');
    log('   5. 完成后重新运行此脚本');
    
    // 仅启动 Server，不启动 Listener
    log('将在无监听器模式下运行 (无法自动响应系统静音状态)...');
}

function setupListenerProcess(proc) {
    proc.stdout.on('data', (data) => {
        const text = data.toString();
        process.stdout.write(text);
        stdoutBuffer += text;
        let index = stdoutBuffer.indexOf('\n');
        while (index >= 0) {
            const line = stdoutBuffer.slice(0, index).trim();
            stdoutBuffer = stdoutBuffer.slice(index + 1);
            if (line) handleListenerLine(line);
            index = stdoutBuffer.indexOf('\n');
        }
    });
    proc.stderr.on('data', (data) => {
        process.stderr.write(data.toString());
    });
    proc.on('exit', (code) => {
        log(`监听器退出: ${code ?? 'unknown'}`);
    });
}

function attachSignals() {
    const cleanup = () => {
        if (listenerProcess) listenerProcess.kill('SIGTERM');
        if (serverProcess) serverProcess.kill('SIGTERM');
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

function checkMacDependencies() {
    return new Promise((resolve) => {
        const check = spawn('sox', ['--version']);
        check.on('error', () => {
             log('未检测到 sox，正在尝试通过 brew 安装...');
             const install = spawn('brew', ['install', 'sox'], { stdio: 'inherit' });
             install.on('exit', (code) => {
                 if (code === 0) log('sox 安装成功！');
                 else log('sox 安装失败，建议手动运行 "brew install sox"');
                 resolve();
             });
             install.on('error', () => {
                 log('未找到 brew，请手动安装 sox 以支持定向音频输出');
                 resolve();
             });
        });
        check.on('exit', (code) => {
             resolve();
        });
    });
}

async function main() {
    attachSignals();
    
    // 启动核心服务
    startServer();

    if (os.platform() === 'darwin') {
        await checkMacDependencies();
        const buildResult = await buildMacListenerIfNeeded();
        if (!buildResult.binPath && !buildResult.useSwiftRun) {
            log('监听器构建失败，请手动进入 native/macos-listener 运行 swift build');
            // 这里不退出，因为 Server 依然可用
        } else {
            startMacListener(buildResult.binPath, buildResult.useSwiftRun);
        }
    } else if (os.platform() === 'win32') {
        startWindowsListener();
    } else {
        log('当前系统不支持原生监听器功能，仅启动 Web 服务');
    }
    
    log('一键启动完成');
}

main();
