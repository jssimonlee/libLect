/**
 * Cloudflare Worker — 화성시 도서관 API 프록시
 *
 * [배포 방법]
 * 1. https://dash.cloudflare.com 에서 Workers & Pages > Create Worker
 * 2. 이 파일의 내용을 붙여넣고 저장
 * 3. Worker URL (예: https://liblect-proxy.YOUR-SUBDOMAIN.workers.dev) 을 복사
 * 4. index.html 의 WORKER_BASE 값을 해당 URL 로 교체
 *
 * [요청 흐름]
 * 브라우저  →  https://<worker>/api/apiLectureList.do?...
 *          →  https://yeyak.hscity.go.kr/api/apiLectureList.do?...
 *          ←  XML 응답 (CORS 헤더 추가하여 반환)
 */

const TARGET_ORIGIN = 'https://yeyak.hscity.go.kr';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request) {
        const url = new URL(request.url);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        // /api/* 경로만 프록시 처리
        if (!url.pathname.startsWith('/api/')) {
            return new Response('Not Found', { status: 404 });
        }

        const targetUrl = TARGET_ORIGIN + url.pathname + url.search;

        try {
            const proxyRes = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'User-Agent': 'libLect-proxy/1.0' },
            });

            const body = await proxyRes.arrayBuffer();

            return new Response(body, {
                status: proxyRes.status,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': proxyRes.headers.get('Content-Type') || 'application/xml; charset=utf-8',
                    'Cache-Control': 'public, max-age=300',
                },
            });
        } catch (err) {
            return new Response('Proxy Error: ' + err.message, {
                status: 502,
                headers: CORS_HEADERS,
            });
        }
    },
};
