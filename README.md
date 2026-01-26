# 一键启动

```bash
npm run start:all
```

启动后将同时运行：
- Node 服务端
- macOS CoreAudio 监听器

监听器检测到“麦克风被使用”时会自动触发：
- `POST /api/mic/start`
检测到“停止使用”时会自动触发：
- `POST /api/mic/stop`

## 手动启动（可选）

```bash
node server.js
```

```bash
cd native/macos-listener
swift build -c release --disable-sandbox
./.build/release/mac-input-listener
```
