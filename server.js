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

    // API 프록시: /api/libraryLectures (로컬 캐시 및 최적화 구현체)
    if (parsed.pathname === '/api/libraryLectures') {
        const limit = parsed.query.limit ? parseInt(parsed.query.limit, 10) : null;
        buildLibraryLectureDataset(limit)
            .then(result => {
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify(result));
            })
            .catch(err => {
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: err.message }));
            });
        return;
    }

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

// ── 로컬 백엔드 최적화 구현체 ───────────────────────────────────
const TARGET_ORIGIN = 'https://yeyak.hscity.go.kr';
const SOURCE_API_PATH = '/api/apiLectureList.do';
const INITIAL_API_PER_PAGE = 1000;
const NEXT_API_PER_PAGE = 500;
const RECENT_MONTHS = 6;

async function buildLibraryLectureDataset(limit) {
    const cutoffDate = addMonths(getKoreaTodayDateOnly(), -RECENT_MONTHS);
    const startedAt = new Date().toISOString();

    let fetchedCount = 0;
    let totalCount = Infinity;
    let shouldContinue = true;
    const lectures = [];
    const institutions = new Set();
    let oldestFetchedReceiptDate = null;

    while (shouldContinue && fetchedCount < totalCount) {
        let perPage = fetchedCount === 0 ? INITIAL_API_PER_PAGE : NEXT_API_PER_PAGE;
        if (limit) {
            perPage = Math.min(limit - fetchedCount, perPage);
            if (perPage <= 0) break;
        }

        const pageNo = Math.floor(fetchedCount / perPage) + 1;
        const { items, totalCnt } = await fetchSourcePage(perPage, pageNo);

        if (Number.isFinite(totalCnt)) totalCount = totalCnt;
        if (items.length === 0) break;

        const parsedItems = items.map(parseItemXml);
        parsedItems
            .filter(lecture => isRecentLecture(lecture, cutoffDate))
            .filter(isLibraryLecture)
            .forEach(lecture => {
                lectures.push(lecture);
                if (lecture.institution) institutions.add(lecture.institution);
            });

        fetchedCount += items.length;

        if (limit && fetchedCount >= limit) {
            break;
        }

        oldestFetchedReceiptDate = getOldestReceiptDate(parsedItems);
        shouldContinue = !!oldestFetchedReceiptDate && oldestFetchedReceiptDate > cutoffDate;
    }

    const oldestStoredReceiptDate = getOldestReceiptDate(lectures);

    return {
        meta: {
            generatedAt: startedAt,
            recentMonths: RECENT_MONTHS,
            fetchedCount,
            limit: limit || null,
            lectureCount: lectures.length,
            institutionCount: institutions.size,
            cutoffDate: formatDateOnly(cutoffDate),
            oldestFetchedReceiptDate: oldestFetchedReceiptDate ? formatDateOnly(oldestFetchedReceiptDate) : null,
            oldestStoredReceiptDate: oldestStoredReceiptDate ? formatDateOnly(oldestStoredReceiptDate) : null,
        },
        institutions: [...institutions].sort((a, b) => a.localeCompare(b, 'ko')),
        lectures,
    };
}

async function fetchSourcePage(perPage, pageNo) {
    const url = new URL(TARGET_ORIGIN + SOURCE_API_PATH);
    url.searchParams.set('recordCountPerPage', String(perPage));
    url.searchParams.set('currentPageNo', String(pageNo));

    const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'User-Agent': 'libLect-local-proxy/2.0' },
    });

    if (!res.ok) {
        throw new Error(`Source API failed: ${res.status}`);
    }

    const xml = await res.text();
    const totalCnt = parseInt(extractTag(xml, 'total_cnt') || '0', 10);
    return {
        items: extractItemXmlList(xml),
        totalCnt: Number.isFinite(totalCnt) ? totalCnt : Infinity,
    };
}

function parseItemXml(itemXml) {
    const lecture = {
        institution: get('INSTITUTION_NM'),
        institutionIdx: get('INSTITUTION_IDX'),
        lectureIdx: get('LECTURE_IDX'),
        name: get('LECTURE_NM'),
        targetCd: get('TARGET_CD'),
        targetNm: get('TARGET_NM'),
        targetDetail: get('TARGET_DETAIL'),
        beginDate: get('LECTURE_BEGIN_YMD'),
        endDate: get('LECTURE_END_YMD'),
        beginTime: get('LECTURE_BEGIN_HM'),
        endTime: get('LECTURE_END_HM'),
        dayOfWeek: get('LECTURE_DAY_OF_WEEK'),
        applyBegin: get('LECTURE_APPLY_BEGIN_DT'),
        applyEnd: get('LECTURE_APPLY_END_DT'),
        price: parseInt(get('LECTURE_PRICE') || '0', 10),
        place: get('LECTURE_PLACE'),
        classCd: get('CLASS_CD'),
        classNm: get('CLASS_NM'),
        freeNm: get('FREE_NM'),
        status: get('STATUS_NM'),
        applyUserNum: get('APPLY_USER_NUM'),
        applyLimitNum: get('APPLY_LIMIT_NUM'),
        waitUserNum: get('WAIT_USER_NUM'),
        waitLimitNum: get('WAIT_LIMIT_NUM'),
        detailUrl: get('DETAIL_URL'),
        receiptMethod: get('RECEIPT_METHOD_NM'),
        reference: get('REFERENCE'),
    };

    lecture.isToday = isTodayLecture(lecture);
    return lecture;

    function get(tag) {
        return decodeXml(extractTag(itemXml, tag));
    }
}

function extractItemXmlList(xml) {
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1]);
}

function extractTag(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return match ? match[1].trim() : '';
}

function decodeXml(value) {
    if (!value) return '';
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function isLibraryLecture(d) {
    return Object.values(d).some(value => typeof value === 'string' && value.includes('도서관'));
}

function isRecentLecture(d, cutoffDate) {
    const receiptDate = getReceiptDate(d);
    return !!receiptDate && receiptDate >= cutoffDate;
}

function isTodayLecture(d) {
    const today = getKoreaTodayDateOnly();
    const begin = parseDateOnly(d.beginDate);
    const end = parseDateOnly(d.endDate);
    if (!today || !begin || !end) return false;
    if (today < begin || today > end) return false;

    const dayCodes = parseDayCodes(d.dayOfWeek);
    if (dayCodes.length === 0) {
        return begin.getTime() === end.getTime() && today.getTime() === begin.getTime();
    }

    return dayCodes.includes(getApiDayCode(today));
}

function parseDateOnly(value) {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 8) return null;
    const year = parseInt(digits.slice(0, 4), 10);
    const month = parseInt(digits.slice(4, 6), 10) - 1;
    const day = parseInt(digits.slice(6, 8), 10);
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    return date;
}

function getKoreaTodayDateOnly() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

function addMonths(date, months) {
    const result = new Date(date);
    const originalDay = result.getUTCDate();
    result.setUTCMonth(result.getUTCMonth() + months);
    if (result.getUTCDate() !== originalDay) {
        result.setUTCDate(0);
    }
    return new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate()));
}

function getReceiptDate(d) {
    if (!d) return null;
    return parseDateOnly(d.applyBegin) || parseDateOnly(d.applyEnd) || parseDateOnly(d.beginDate);
}

function getOldestReceiptDate(items) {
    return items
        .map(getReceiptDate)
        .filter(Boolean)
        .sort((a, b) => a - b)[0] || null;
}

function formatDateOnly(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getApiDayCode(date) {
    const jsDay = date.getUTCDay();
    return jsDay === 0 ? '7' : String(jsDay);
}

function parseDayCodes(dayStr) {
    if (!dayStr) return [];
    const koreanMap = { '월': '1', '화': '2', '수': '3', '목': '4', '금': '5', '토': '6', '일': '7' };
    return String(dayStr)
        .split(/[,/|·\s]+/)
        .map(v => v.trim())
        .filter(Boolean)
        .map(v => v.replace(/요일$/, ''))
        .map(v => koreanMap[v] || v)
        .filter(v => /^[1-7]$/.test(v));
}

server.listen(PORT, () => {
    console.log(`\n  화성시 도서관 강좌 검색 서버 실행 중`);
    console.log(`  http://localhost:${PORT}\n`);
});
