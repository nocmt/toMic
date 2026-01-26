import winreg
import time
import sys
import io

# 强制 stdout 使用 UTF-8 编码，防止 Windows 下乱码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def get_microphone_state():
    base_path = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"
    is_running = False
    
    try:
        # 1. Check NonPackaged (Desktop Apps)
        try:
            non_packaged_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, base_path + r"\NonPackaged")
            i = 0
            while True:
                try:
                    app_name = winreg.EnumKey(non_packaged_key, i)
                    app_key = winreg.OpenKey(non_packaged_key, app_name)
                    try:
                        stop_time, _ = winreg.QueryValueEx(app_key, "LastUsedTimeStop")
                        if stop_time == 0:
                            is_running = True
                            break
                    except FileNotFoundError:
                        pass
                    finally:
                        winreg.CloseKey(app_key)
                    i += 1
                except OSError:
                    break
            winreg.CloseKey(non_packaged_key)
        except FileNotFoundError:
            pass

        if is_running:
            return True

        # 2. Check Packaged (UWP Apps)
        base_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, base_path)
        i = 0
        while True:
            try:
                sub_key_name = winreg.EnumKey(base_key, i)
                if sub_key_name != "NonPackaged":
                    # This is likely a UWP app
                    app_key = winreg.OpenKey(base_key, sub_key_name)
                    try:
                        stop_time, _ = winreg.QueryValueEx(app_key, "LastUsedTimeStop")
                        if stop_time == 0:
                            is_running = True
                            break
                    except FileNotFoundError:
                        pass
                    finally:
                        winreg.CloseKey(app_key)
                i += 1
            except OSError:
                break
        winreg.CloseKey(base_key)

    except Exception as e:
        pass
        
    return is_running

def main():
    print("【Windows监听】监听器已启动，正在监控麦克风状态...")
    sys.stdout.flush()
    
    last_state = None
    
    while True:
        current_state = get_microphone_state()
        
        if current_state != last_state:
            # First run, initialize state without triggering if possible?
            # macos version triggers on start if running.
            
            if last_state is None:
                # Initial state log
                if current_state:
                    print("STATE_RUNNING")
                    print("【Windows监听】初始状态: 正在使用")
                else:
                    print("STATE_STOPPED")
                    print("【Windows监听】初始状态: 空闲")
            else:
                # State change log
                if current_state:
                    print("STATE_RUNNING")
                    print("【Windows监听】检测到麦克风开始使用")
                else:
                    print("STATE_STOPPED")
                    print("【Windows监听】检测到麦克风停止使用")
            
            sys.stdout.flush()
            last_state = current_state
            
        time.sleep(1)

if __name__ == "__main__":
    main()
