# ToMic - Turn Your Phone into a PC Microphone 🎙️

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-green.svg)](https://nodejs.org/)

**ToMic** 是一个基于 Web 技术的局域网虚拟麦克风工具。它允许你使用手机浏览器作为电脑的麦克风输入源，通过 Wi-Fi 传输音频，并利用虚拟声卡（如 BlackHole）将其注入到系统音频输入中。

适用于 Zoom、Teams、Discord 或任何需要高质量麦克风输入的场景，尤其是当你只有台式机而没有麦克风，或者笔记本麦克风损坏时。

## ✨ 特性

- **零 App 安装**：手机端无需安装 App，通过浏览器（Chrome/Safari）即可使用。
- **低延迟传输**：基于 WebSocket 和 Opus 编码，提供低延迟音频流。
- **安全连接**：自动生成自签名 SSL 证书，支持 HTTPS，满足浏览器对录音权限的安全要求。
- **智能路由**：集成 **SoX**，支持将音频定向输出到虚拟声卡（BlackHole），不占用系统扬声器。
- **原生集成**：包含 macOS 原生监听器，支持通过键盘快捷键或系统状态控制。

## 🛠️ 前置要求

在使用本项目之前，请确保你的 macOS 环境已安装以下工具：

1. **Node.js** (v16+)
2. **BlackHole 2ch** (虚拟声卡)
   - [下载并安装 BlackHole 2ch](https://existential.audio/blackhole/)
   - 安装后，你的系统会出现一个名为 "BlackHole 2ch" 的音频设备。
3. **Homebrew** (可选，但推荐)
   - 用于自动安装音频处理工具 `sox`。

## 🚀 快速开始

### 1. 安装依赖

```bash
git clone https://github.com/yourusername/tomic.git
cd tomic
npm install
```

### 2. 启动服务

我们提供了一键启动脚本，会自动检测环境、安装缺失依赖（如 `sox`）并启动服务：

```bash
npm run start:all
# 或者
node start-all.js
```

### 3. 连接手机

1. 启动后，终端会显示 HTTPS 地址（例如 `https://192.168.1.5:3000`）。
2. 确保手机和电脑连接在**同一 Wi-Fi** 下。
3. 打开手机浏览器（推荐 Safari 或 Chrome），输入上述地址。
4. 由于使用自签名证书，浏览器会提示“连接不安全”：
   - 点击“高级” -> “继续访问” (Proceed to...)。
5. 点击页面上的 **“授权”** 按钮。

### 4. 配置应用

现在，你的手机声音已经传输到了电脑的 **BlackHole 2ch** 设备。

- 打开会议软件（Zoom/Teams/腾讯会议等）。
- 在 **设置 -> 音频 -> 麦克风** 中，选择 **BlackHole 2ch**。
- 说话测试，你应该能看到音量条在跳动。

> **注意**：请勿将“扬声器”也设置为 BlackHole，否则你听不到对方的声音。扬声器保持为系统默认（耳机/内置扬声器）即可。

## ⚙️ 常见问题

**Q: 为什么浏览器提示不安全？**
A: 因为我们在局域网内使用自签名的 SSL 证书以启用 HTTPS（麦克风权限必须）。这是正常现象，请放心继续访问。

**Q: 为什么会有回声？**
A: 请确保电脑端的音频输出（扬声器）**不要**选 BlackHole，同时确保手机不要离电脑扬声器太近，或者戴上耳机。

**Q: 报错 `ffmpeg exited with code 255`**
A: 这是正常的进程退出日志，表示音频流已正常断开，请忽略。

## 📂 项目结构

```
.
├── certs/              # 自动生成的 SSL 证书 (已忽略)
├── native/             # macOS 原生监听器 (Swift)
├── public/             # 前端页面
├── server.js           # 核心音频服务 (Node.js + FFmpeg)
├── start-all.js        # 启动脚本
└── ...
```

## 📄 License

本项目采用 MIT 许可证。详见 LICENSE 文件。

## 🔮 Windows 兼容性 (Roadmap)

目前本项目仅针对 macOS 进行了适配。如果要在 Windows 上运行，需要进行以下改造：

1.  **虚拟声卡替换**
    *   macOS 使用 BlackHole，Windows 需替换为 [VB-CABLE](https://vb-audio.com/Cable/)。
    *   需修改 `server.js` 中的 `AUDIODEV` 环境变量设置。

2.  **音频路由工具**
    *   目前使用 `sox` (play) 进行音频定向输出。
    *   Windows 上需要安装 Windows 版 SoX 并配置 PATH，或者改用 FFmpeg 的 `dshow` 输出设备。

3.  **启动脚本改造**
    *   `start-all.js` 包含大量 macOS 特有的检测逻辑（如 `os.platform() !== 'darwin'`）。
    *   需要移除对 `brew` 和 `swift` 的依赖。
    *   需要为 Windows 编写对应的依赖检测逻辑（如检测 VB-CABLE 是否安装）。

4.  **原生监听器**
    *   `native/macos-listener` 是用 Swift 编写的，用于监听全局快捷键和系统状态。
    *   Windows 上需要使用 C# (.NET) 或 C++ 重新实现相同功能的监听器，并通过 IPC 与 Node.js 通信。

