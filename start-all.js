/**
 * ToMic - 一键启动脚本
 * 
 * 负责自动检测环境、安装依赖 (sox)、构建原生监听器并启动所有服务。
 * 仅支持 macOS 环境。
 */

const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER_URL = 'https://127.0.0.1:3000';
const listenerRoot = path.join(__dirname, 'native', 'macos-listener');

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

function findListenerBinary() {
    const buildRoot = path.join(listenerRoot, '.build');
    const direct = path.join(buildRoot, 'release', 'mac-input-listener');
    if (fs.existsSync(direct)) return direct;
    if (!fs.existsSync(buildRoot)) return null;
    const entries = fs.readdirSync(buildRoot, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(buildRoot, entry.name, 'release', 'mac-input-listener');
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function buildListenerIfNeeded() {
    const found = findListenerBinary();
    if (found) return Promise.resolve({ binPath: found, useSwiftRun: false });
    return new Promise((resolve) => {
        log('正在构建 CoreAudio 监听器...');
        const build = spawn('swift', ['build', '-c', 'release', '--disable-sandbox'], {
            cwd: listenerRoot,
            stdio: 'inherit'
        });
        build.on('exit', (code) => {
            if (code === 0) {
                const after = findListenerBinary();
                if (after) return resolve({ binPath: after, useSwiftRun: false });
            }
            resolve({ binPath: null, useSwiftRun: true });
        });
    });
}

function handleListenerLine(line) {
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

function startListener(binPath, useSwiftRun) {
    if (useSwiftRun) {
        log('未检测到监听器二进制，改用 swift run');
        listenerProcess = spawn('swift', ['run', '-c', 'release', '--disable-sandbox'], { cwd: listenerRoot });
    } else {
        log(`监听器路径: ${binPath}`);
        listenerProcess = spawn(binPath, [], { cwd: listenerRoot });
    }
    listenerProcess.stdout.on('data', (data) => {
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
    listenerProcess.stderr.on('data', (data) => {
        process.stderr.write(data.toString());
    });
    listenerProcess.on('exit', (code) => {
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

function checkDependencies() {
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
    if (os.platform() !== 'darwin') {
        log('仅支持 macOS 一键启动');
        process.exit(1);
    }
    await checkDependencies();
    attachSignals();
    startServer();
    const buildResult = await buildListenerIfNeeded();
    if (!buildResult.binPath && !buildResult.useSwiftRun) {
        log('监听器构建失败，请手动进入 native/macos-listener 运行 swift build');
        process.exit(1);
    }
    startListener(buildResult.binPath, buildResult.useSwiftRun);
    log('一键启动完成');
}

main();
