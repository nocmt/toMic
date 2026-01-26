/**
 * ToMic - Client
 * 
 * 运行在浏览器端的音频采集逻辑。
 * 使用 Web Audio API 和 WebSocket 传输音频数据。
 */

const socket = io();
const statusEl = document.getElementById('status');
const micBtn = document.getElementById('micBtn');
const btnText = document.getElementById('btnText');

let mediaRecorder = null;
let mediaStream = null;
let isReady = false;
let pendingServerStart = false;
let desiredSending = false;

// 检查浏览器兼容性
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = '错误: 您的浏览器不支持 getUserMedia API (请尝试使用 Chrome 或 Safari)';
    statusEl.classList.add('error');
}

socket.on('connect', () => {
    statusEl.textContent = '✅ 已连接到服务器，请点击授权进入待机';
    statusEl.classList.add('active');
    micBtn.disabled = false;
    updateUI(false);
});

socket.on('disconnect', () => {
    statusEl.textContent = '❌ 与服务器断开连接';
    statusEl.classList.remove('active');
    statusEl.classList.add('error');
    micBtn.disabled = true;
    isSending = false;
    stopCapture();
});

micBtn.addEventListener('click', () => {
    if (!isReady) {
        prepareStream();
        return;
    }
    if (desiredSending) setSending(false);
    else setSending(true);
});

socket.on('server-start', () => {
    if (!isReady) {
        pendingServerStart = true;
        statusEl.textContent = '⚠️ 收到开始指令，请先点击授权';
        statusEl.classList.add('error');
        return;
    }
    setSending(true);
});

socket.on('server-stop', () => {
    pendingServerStart = false;
    setSending(false);
});

async function prepareStream() {
    try {
        statusEl.textContent = '正在申请麦克风权限...';
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            } 
        });
        mediaStream = stream;
        isReady = true;
        statusEl.textContent = '✅ 已授权，待机中';
        statusEl.classList.add('active');
        updateUI(false);
        if (pendingServerStart) {
            pendingServerStart = false;
            setSending(true);
        }
    } catch (err) {
        console.error('麦克风获取失败:', err);
        statusEl.textContent = `无法访问麦克风: ${err.message}`;
        statusEl.classList.add('error');
    }
}

function startRecorder() {
    try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';

        mediaRecorder = new MediaRecorder(mediaStream, {
            mimeType: mimeType,
            audioBitsPerSecond: 128000 // 128kbps
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.connected && desiredSending) {
                socket.emit('audio-chunk', event.data);
            }
        };

        mediaRecorder.onstart = () => {
            socket.emit('start-stream');
            updateUI(true);
            statusEl.textContent = '🎙️ 正在传输音频...';
        };

        mediaRecorder.onstop = () => {
            socket.emit('stop-stream');
            updateUI(false);
            statusEl.textContent = '✅ 已连接 (待机)';
        };

        mediaRecorder.start(100);

    } catch (err) {
        console.error('麦克风获取失败:', err);
        statusEl.textContent = `无法访问麦克风: ${err.message}`;
        statusEl.classList.add('error');
    }
}

function stopRecorder() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

function updateUI(recording) {
    if (!isReady) {
        micBtn.classList.remove('recording');
        btnText.textContent = '授权并待机';
        return;
    }
    if (recording) {
        micBtn.classList.add('recording');
        btnText.textContent = '停止传输';
    } else {
        micBtn.classList.remove('recording');
        btnText.textContent = '开始传输';
    }
}

function setSending(next) {
    if (next === desiredSending) return;
    desiredSending = next;
    if (!mediaStream) {
        prepareStream();
        return;
    }
    if (desiredSending) {
        startRecorder();
    } else {
        stopRecorder();
    }
}
