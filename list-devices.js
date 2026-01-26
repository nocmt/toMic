const { exec } = require('child_process');
const os = require('os');

console.log('正在扫描音频设备...');

let command = '';

if (os.platform() === 'darwin') {
    // macOS
    command = 'ffmpeg -f avfoundation -list_devices true -i ""';
} else if (os.platform() === 'win32') {
    // Windows
    command = 'ffmpeg -f dshow -list_devices true -i dummy';
} else {
    console.log('暂不支持此系统自动扫描，请手动查询 ffmpeg 设备列表。');
    process.exit(0);
}

exec(command, (error, stdout, stderr) => {
    // ffmpeg 将设备列表输出到 stderr
    const output = stderr || stdout;
    
    console.log('\n========================================');
    console.log('可用音频设备列表 (请寻找 BlackHole 或 Virtual Cable):');
    console.log('========================================\n');
    console.log(output);
    console.log('\n========================================');
    console.log('提示: 如果你在列表中看到了 "BlackHole" 或 "VB-Cable"，说明驱动安装成功。');
    console.log('服务端默认输出到系统默认设备。请在系统设置中将输出设备设为该虚拟设备。');
});
