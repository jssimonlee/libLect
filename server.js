const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);

    // API 프록시: /api/* -> yeyak.hscity.go.kr/api/*
    if (parsed.pathname.startsWith('/api/')) {
        const targetUrl = `https://yeyak.hscity.go.kr${parsed.path}`;

        https.get(targetUrl, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => data += chunk);
            proxyRes.on('end', () => {
                res.writeHead(200, {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(data);
            });
        }).on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Proxy error: ' + err.message);
        });
        return;
    }

    // 정적 파일 서빙
    let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
    filePath = path.join(__dirname, filePath);

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`\n  화성시 도서관 강좌 검색 서버 실행 중`);
    console.log(`  http://localhost:${PORT}\n`);
});
