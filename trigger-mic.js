const https = require('https');

const action = process.argv[2];
const baseUrl = process.argv[3];

if (!action || !baseUrl || !['start', 'stop'].includes(action)) {
    console.log('【使用说明】node trigger-mic.js start https://192.168.1.5:3000');
    console.log('【使用说明】node trigger-mic.js stop https://192.168.1.5:3000');
    process.exit(1);
}

const url = new URL(`/api/mic/${action}`, baseUrl);

const req = https.request(
    url,
    {
        method: 'POST',
        rejectUnauthorized: false
    },
    (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
            console.log(`【待机控制】请求完成: ${res.statusCode} ${data}`);
        });
    }
);

req.on('error', (err) => {
    console.log(`【待机控制】请求失败: ${err.message}`);
});

req.end();
