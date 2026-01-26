# macOS CoreAudio 最简监听模块

这是一个最简的 Swift 命令行工具，用于监听：
- 默认输入设备（麦克风）是否正在被某应用使用（`kAudioDevicePropertyDeviceIsRunningSomewhere`）
- 默认输入设备的切换（`kAudioHardwarePropertyDefaultInputDevice`）

## 构建与运行

```bash
cd native/macos-listener
swift build -c release
./.build/release/mac-input-listener
```

运行后将看到类似输出：
```
【CoreAudio监听】默认输入设备监听已启用，当前状态: 已停止
【CoreAudio监听】监听器已启动，保持进程运行中
```
当有应用开始录音时会输出：
```
【CoreAudio监听】输入设备运行状态变化: 正在被使用
```
停止录音时输出：
```
【CoreAudio监听】输入设备运行状态变化: 已停止
```

## 集成建议

- 作为独立进程运行，监听到“正在被使用”时，可通过 HTTP 请求主动调用你的 Node 服务：
  - `POST https://<server>:3000/api/mic/start` 开始拾音
  - `POST https://<server>:3000/api/mic/stop` 结束拾音
- 如果需要更严格的“按应用识别”，需要使用更深入的 API 或私有接口来枚举具体进程与流路，由于安全与兼容性限制，这里提供的是稳定且通用的运行状态监听。

## 注意

- 需要在 macOS 上运行（Swift 5.9，macOS 12+）
- 如果你启用了系统安全策略，需要为终端或此二进制授予“麦克风”与“完整磁盘访问”等权限，以保证监听正常。
