const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const DIST_DIR = path.join(__dirname, 'release');
// 根据系统不同打包输出文件夹不同
const platform = os.platform();
let TARGET_DIR = path.join(DIST_DIR, 'ToMic');

const NATIVE_DIR = path.join(TARGET_DIR, 'native');

// Clean up
if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.mkdirSync(NATIVE_DIR, { recursive: true });

console.log('正在使用 pkg 打包 Node.js 主程序...');
// Determine target based on current arch
const arch = os.arch(); // x64 or arm64
const target = `node18-${arch}`;
console.log(`Target: ${target}`);

try {
    execSync(`npx pkg . -t ${target} --out-path "${TARGET_DIR}"`, { stdio: 'inherit' });
} catch (e) {
    console.error('打包失败');
    process.exit(1);
}

// Rename executable to 'toMic'
const builtName = 'tomic'; 
const finalName = 'toMic';

if (fs.existsSync(path.join(TARGET_DIR, builtName))) {
    fs.renameSync(path.join(TARGET_DIR, builtName), path.join(TARGET_DIR, finalName));
}

console.log('正在处理 Native 依赖...');

// 1. 复制 mac-input-listener
const listenerSrc = path.join(__dirname, 'native', 'macos-listener', 'dist', 'mac-input-listener');
const listenerDest = path.join(NATIVE_DIR, 'mac-input-listener');

if (fs.existsSync(listenerSrc)) {
    fs.copyFileSync(listenerSrc, listenerDest);
    fs.chmodSync(listenerDest, '755');
    console.log('✅ mac-input-listener 已复制到 native 目录');
} else {
    console.warn('⚠️  警告: 未找到构建好的 mac-input-listener，请手动放入 release/ToMic/native 目录');
}

// 2. 处理 ffmpeg - 优先使用本地构建的版本
const ffmpegDest = path.join(__dirname, 'native', 'macos-listener', 'ffmpeg');

if (fs.existsSync(ffmpegDest)) {
    // 复制到打包后的 native 目录
    fs.copyFileSync(ffmpegDest, path.join(NATIVE_DIR, 'ffmpeg'));
    console.log('✅ ffmpeg 已从本地复制');
} else {
    console.warn(`⚠️  未找到本地 ffmpeg，请手动下载并放入 ${path.join('native', 'macos-listener')} 目录`);
    console.log('   下载地址: https://evermeet.cx/ffmpeg/');
}

// 3. 下载/复制 sox
// sox 没有方便的 direct link，我们假设它已经存在于 project root 或者提示用户
// 但为了自动化，我们可以尝试复制系统中的 sox 如果是静态链接的（通常不是）。
// 或者我们可以提供一个下载脚本。
// 这里为了演示，我们检查本地是否有 native/macos-listener/sox (开发环境可能放了)
// 如果没有，我们尝试从系统复制（不太安全但可行），或者留空并打印提示。

const soxDest = path.join(NATIVE_DIR, 'sox');
    // 尝试寻找系统 sox
    try {
        const systemSoxPath = execSync('which sox').toString().trim();
        if (systemSoxPath) {
            console.log(`ℹ️  检测到系统 sox (${systemSoxPath})，正在复制...`);
            // 注意：复制系统二进制文件可能会导致动态库缺失问题
            // 但对于 brew 安装的 sox，通常依赖较多。
            // 更好的做法是下载静态构建，但 macOS sox 静态构建很难找。
            // 这里我们做一个简单的复制，并警告用户可能需要 brew install sox
            fs.copyFileSync(systemSoxPath, soxDest);
            fs.chmodSync(soxDest, '755');
            console.log('✅ 系统 sox 已复制 (注意：可能依赖系统库)');
        } else {
             console.warn('⚠️  未找到 sox，正在使用brew安装sox');
             execSync('brew install sox', { stdio: 'inherit' });
             // 退出让其重新打包
            onsole.info('✅ sox安装完成，请重新打包');
            process.exit(1);
        }
    } catch (e) {
        onsole.warn('⚠️  未找到 sox，正在使用brew安装sox');
        execSync('brew install sox', { stdio: 'inherit' });
        // 退出让其重新打包
        onsole.info('✅ sox安装完成，请重新打包');
        process.exit(1);
    }




// 4. 处理 BlackHole 安装包
// 假设用户将其放在项目根目录或指定位置，我们将其复制到 release
const pkgName = 'BlackHole2ch-0.6.1.pkg';
// 它在在 native/macos-listener 下
const pkgSrc = path.join(__dirname, 'native', 'macos-listener', pkgName);
const pkgDest = path.join(TARGET_DIR, pkgName);

if (fs.existsSync(pkgSrc)) {
    fs.copyFileSync(pkgSrc, pkgDest);
    console.log(`✅ ${pkgName} 已包含`);
} else {
    console.warn(`⚠️  未找到 ${pkgName}，请确保将其放入 ${path.join('native','macos-listener')} 目录`);

}

console.log('正在复制文档和静态文件...');
if (fs.existsSync(path.join(__dirname, 'README.md'))) {
    fs.copyFileSync(path.join(__dirname, 'README.md'), path.join(TARGET_DIR, 'README.md'));
    // 复制截图
    fs.copyFileSync(path.join(__dirname, 'Screenshot.png'), path.join(TARGET_DIR, 'Screenshot.png'));
}

// 复制 public 目录（前端页面）
const publicSrc = path.join(__dirname, 'public');
const publicDest = path.join(TARGET_DIR, 'public');
if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, publicDest, { recursive: true });
    console.log('✅ public 目录已复制');

    // 额外复制 socket.io-client 到 public/socket.io
    // 这是为了解决 pkg 打包后无法自动 serve 客户端文件的问题
    try {
        // 从 socket.io 包中获取客户端文件 (client-dist)
        // 注意：由于 exports 限制，不能直接 require.resolve 子路径，改用 path 拼接
        const socketIoBase = path.dirname(require.resolve('socket.io/package.json'));
        const socketIoSrc = path.join(socketIoBase, 'client-dist', 'socket.io.js');
        const socketIoMapSrc = path.join(socketIoBase, 'client-dist', 'socket.io.js.map');

        // 改为放到 public/lib 下，避免与 socket.io 默认拦截路径冲突
        const socketIoDestDir = path.join(publicDest, 'lib');
        if (!fs.existsSync(socketIoDestDir)) {
            fs.mkdirSync(socketIoDestDir, { recursive: true });
        }
        
        if (fs.existsSync(socketIoSrc)) {
            fs.copyFileSync(socketIoSrc, path.join(socketIoDestDir, 'socket.io.js'));
            if (fs.existsSync(socketIoMapSrc)) {
                fs.copyFileSync(socketIoMapSrc, path.join(socketIoDestDir, 'socket.io.js.map'));
            }
            console.log('✅ socket.io-client 已注入到 public/lib 目录');
        } else {
             console.warn('⚠️  未找到 socket.io 客户端文件:', socketIoSrc);
        }
    } catch (e) {
        console.warn('⚠️  无法复制 socket.io-client，客户端可能无法连接:', e.message);
    }

} else {
    console.warn('⚠️  未找到 public 目录，前端页面将无法访问');
}

console.log(`
✅ 打包流程结束！
输出目录: ${TARGET_DIR}
请检查 native 目录下的依赖是否完整。
`);

