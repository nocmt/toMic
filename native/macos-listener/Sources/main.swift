import Foundation
import CoreAudio

var currentDeviceID = AudioDeviceID(0)
var runningListener: AudioObjectPropertyListenerBlock?
var runningQueue = DispatchQueue(label: "coreaudio.running.listener")
var defaultQueue = DispatchQueue(label: "coreaudio.default.device.listener")
var runningAddress = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
var currentRunningState: Bool?

/// 输出统一格式日志
func log(_ message: String) {
    print("【CoreAudio监听】\(message)")
}

/// 获取系统默认输入设备 ID
func getDefaultInputDevice() -> AudioDeviceID {
    var deviceID = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size,
        &deviceID
    )
    if status != noErr {
        log("获取默认输入设备失败，状态码: \(status)")
    }
    return deviceID
}

/// 查询输入设备是否正在被某应用使用
func isDeviceRunning(_ deviceID: AudioDeviceID) -> Bool {
    var running: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    let status = AudioObjectGetPropertyData(
        deviceID,
        &address,
        0,
        nil,
        &size,
        &running
    )
    if status != noErr {
        log("读取设备运行状态失败，状态码: \(status)")
    }
    return running != 0
}

/// 监听设备运行状态变化
func attachRunningListener(deviceID: AudioDeviceID) {
    detachRunningListener()
    currentDeviceID = deviceID
    let listener: AudioObjectPropertyListenerBlock = { _, _ in
        let running = isDeviceRunning(currentDeviceID)
        if currentRunningState == running { return }
        currentRunningState = running
        log("输入设备运行状态变化: \(running ? "正在被使用" : "已停止")")
        print(running ? "STATE_RUNNING" : "STATE_STOPPED")
    }
    AudioObjectAddPropertyListenerBlock(deviceID, &runningAddress, runningQueue, listener)
    runningListener = listener
    let initial = isDeviceRunning(deviceID)
    currentRunningState = initial
    log("默认输入设备监听已启用，当前状态: \(initial ? "正在被使用" : "已停止")")
    print(initial ? "STATE_RUNNING" : "STATE_STOPPED")
}

/// 移除当前设备运行状态监听
func detachRunningListener() {
    guard currentDeviceID != 0, let listener = runningListener else { return }
    AudioObjectRemovePropertyListenerBlock(currentDeviceID, &runningAddress, runningQueue, listener)
    runningListener = nil
}

/// 监听默认输入设备切换
func attachDefaultDeviceListener(onChange: @escaping (AudioDeviceID) -> Void) {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    let listener: AudioObjectPropertyListenerBlock = { _, _ in
        let newDevice = getDefaultInputDevice()
        log("默认输入设备已切换，新的设备 ID: \(newDevice)")
        onChange(newDevice)
    }
    AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, defaultQueue, listener)
}

/// 主流程入口
func run() {
    let deviceID = getDefaultInputDevice()
    if deviceID == 0 {
        log("未能获取默认输入设备，退出")
        return
    }
    attachRunningListener(deviceID: deviceID)
    attachDefaultDeviceListener { newDevice in
        attachRunningListener(deviceID: newDevice)
    }
    log("监听器已启动，保持进程运行中")
    RunLoop.main.run()
}

run()
