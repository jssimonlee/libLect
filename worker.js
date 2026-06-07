/**
 * Cloudflare Worker - 화성시 도서관 강좌 API 프록시 + 캐시
 *
 * /api/libraryLectures
 *   최근 6개월 접수 데이터 중 "도서관" 관련 강좌만 JSON으로 정리하고 캐시합니다.
 *
 * /api/*
 *   기존 화성시 OpenAPI XML 프록시를 유지합니다.
 */

const TARGET_ORIGIN = 'https://yeyak.hscity.go.kr';
const SOURCE_API_PATH = '/api/apiLectureList.do';

const INITIAL_API_PER_PAGE = 1000;
const NEXT_API_PER_PAGE = 500;
const RECENT_MONTHS = 6;
const CACHE_TTL_SECONDS = 30 * 60; // 30분 CDN 엣지 캐시 (만료 시 SWR 백그라운드 갱신 자동 기동)
const SWR_WINDOW_SECONDS = 24 * 60 * 60; // 24시간 SWR 허용

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (url.pathname === '/api/libraryLectures') {
            if (request.method !== 'GET') {
                return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
            }
            return handleLibraryLectures(request, ctx);
        }

        if (url.pathname === '/api/assignees') {
            if (request.method !== 'GET') {
                return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
            }
            return handleGetAssignees(env);
        }

        if (url.pathname === '/api/assignee') {
            if (request.method === 'POST') {
                return handlePostAssignee(request, env);
            } else if (request.method === 'DELETE') {
                return handleDeleteAssignee(request, env);
            } else {
                return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
            }
        }

        if (url.pathname.startsWith('/api/')) {
            if (request.method !== 'GET') {
                return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
            }
            return proxyXmlApi(url);
        }

        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(triggerScheduledSync());
    }
};

async function handleGetAssignees(env) {
    try {
        if (!env.DB) {
            throw new Error("D1 Database binding 'DB' is not set.");
        }
        const { results } = await env.DB.prepare("SELECT * FROM assignees").all();
        const mapping = {};
        if (results) {
            results.forEach(row => {
                mapping[row.lecture_key] = {
                    name: row.name,
                    masked: row.masked,
                    color: row.color || '#8b5a2b',
                    updated_at: row.updated_at
                };
            });
        }
        return jsonResponse(mapping);
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    }
}

async function handlePostAssignee(request, env) {
    try {
        if (!env.DB) {
            throw new Error("D1 Database binding 'DB' is not set.");
        }
        const body = await request.json();
        const { lectureKey, name, masked, color } = body;
        if (!lectureKey || !name || !masked) {
            return new Response(JSON.stringify({ error: 'Missing parameters' }), {
                status: 400,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': 'application/json; charset=utf-8',
                },
            });
        }
        const resolvedColor = color || '#8b5a2b';
        await env.DB.prepare(
            "INSERT INTO assignees (lecture_key, name, masked, color, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lecture_key) DO UPDATE SET name=excluded.name, masked=excluded.masked, color=excluded.color, updated_at=excluded.updated_at"
        ).bind(lectureKey, name, masked, resolvedColor, Date.now()).run();

        return jsonResponse({ success: true });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    }
}

async function handleDeleteAssignee(request, env) {
    try {
        if (!env.DB) {
            throw new Error("D1 Database binding 'DB' is not set.");
        }
        const body = await request.json();
        const { lectureKey } = body;
        if (!lectureKey) {
            return new Response(JSON.stringify({ error: 'Missing lectureKey' }), {
                status: 400,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': 'application/json; charset=utf-8',
                },
            });
        }
        await env.DB.prepare("DELETE FROM assignees WHERE lecture_key = ?").bind(lectureKey).run();

        return jsonResponse({ success: true });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    }
}

function jsonResponse(data, headers = {}) {
    return new Response(JSON.stringify(data), {
        headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            ...headers,
        },
    });
}

function withCorsHeaders(response, xCache) {
    const newHeaders = new Headers(response.headers);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => newHeaders.set(k, v));
    if (xCache) newHeaders.set('X-Cache', xCache);
    return new Response(response.body, { status: response.status, headers: newHeaders });
}

async function handleLibraryLectures(request, ctx) {
    const cache = caches.default;
    const url = new URL(request.url);
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit'), 10) : null;
    const isForceRefresh = url.searchParams.has('_t');

    const cacheUrl = new URL(request.url);
    if (limit) {
        cacheUrl.search = `?limit=${limit}`;
    } else {
        cacheUrl.search = '';
    }
    const cacheKey = new Request(cacheUrl.toString(), request);

    if (!isForceRefresh) {
        const cached = await cache.match(cacheKey);
        if (cached) {
            const now = Date.now();
            const dateHeader = cached.headers.get('Date');
            let shouldRevalidate = false;
            let isStale = false;

            if (dateHeader) {
                const cacheTime = new Date(dateHeader).getTime();
                const ageMs = now - cacheTime;

                if (ageMs > CACHE_TTL_SECONDS * 1000) {
                    shouldRevalidate = true;
                    if (ageMs < (CACHE_TTL_SECONDS + SWR_WINDOW_SECONDS) * 1000) {
                        isStale = true;
                    }
                }
            } else {
                shouldRevalidate = true;
            }

            if (shouldRevalidate && isStale) {
                // SWR: Serve stale content immediately, revalidate in background
                ctx.waitUntil((async () => {
                    try {
                        const result = await buildLibraryLectureDataset(limit);
                        const response = jsonResponse(result, {
                            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
                            'X-Cache': 'MISS',
                        });
                        await cache.put(cacheKey, response.clone());
                    } catch (err) {
                        console.error('Background SWR sync failed:', err);
                    }
                })());
                return withCorsHeaders(cached, 'STALE');
            } else if (!shouldRevalidate) {
                return withCorsHeaders(cached, 'HIT');
            }
        }
    }

    try {
        const result = await buildLibraryLectureDataset(limit);
        const response = jsonResponse(result, {
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
            'X-Cache': 'MISS',
        });

        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 502,
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            },
        });
    }
}

async function triggerScheduledSync() {
    // 1. 현재 한국 표준시(KST) 기준 시간 정보 획득
    const nowKst = getKoreaNow();
    const day = nowKst.getDay(); // 0: 일요일, 6: 토요일
    const hour = nowKst.getHours();
    const minute = nowKst.getMinutes();

    const isWeekend = (day === 0 || day === 6);
    
    // 평일은 밤 10시(22시)까지, 주말은 저녁 6시(18시)까지 30분 단위 고빈도 동기화 작동
    const maxActiveHour = isWeekend ? 18 : 22;
    const isOffHours = (hour >= maxActiveHour || hour < 8);

    // 업무 외 시간(저녁/밤 및 주말 일부) 판정
    if (isOffHours) {
        // 업무 외 시간에는 30분 대신 '6시간마다 한 번(0시, 6시, 12시, 18시 등)'의 정각 대역(minute < 30)에만 실행하고 스킵
        const is6HourInterval = (hour % 6 === 0 && minute < 30);
        if (!is6HourInterval) {
            console.log(`[Scheduled Sync] Off-hours skip: 요일 ${day}, 시간 ${hour}:${minute}`);
            return;
        }
        console.log(`[Scheduled Sync] Off-hours sync running (6-hour interval): ${hour}시`);
    } else {
        console.log(`[Scheduled Sync] Work-hours sync running (30-min interval): 요일 ${day}, 시간 ${hour}:${minute}`);
    }

    const targetUrls = [
        'https://liblect-proxy.jssimonlee.workers.dev/api/libraryLectures',
        'https://liblect-proxy.jssimonlee.workers.dev/api/libraryLectures?limit=100',
        'https://liblect-proxy.jssimonlee.workers.dev/api/libraryLectures?limit=500'
    ];

    const timestamp = Date.now();
    for (const urlStr of targetUrls) {
        try {
            // Scheduled Event(크론) 컨텍스트에서는 Cache API(caches.default.put)를 직접 호출하면 에러가 납니다.
            // 대신, 자기 자신의 HTTP API를 _t(강제 새로고침 파라미터)를 붙여 fetch 요청을 보냅니다.
            // 이렇게 하면 fetch 핸들러가 구동되어, 안전하게 외부 데이터를 긁어와 캐시를 갱신 및 저장하게 됩니다.
            const freshUrl = urlStr + (urlStr.includes('?') ? '&' : '?') + `_t=${timestamp}`;
            console.log(`[Scheduled Sync] Fetching: ${freshUrl}`);
            const res = await fetch(freshUrl);
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            console.log(`[Scheduled Sync] Successfully warmed up cache for: ${urlStr}`);
        } catch (err) {
            console.error(`Cron warm-up failed for: ${urlStr}`, err);
        }
    }
}

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
            .filter(lecture => !isWholeSetLoan(lecture))
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
            cacheTtlSeconds: CACHE_TTL_SECONDS,
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
        headers: { 'User-Agent': 'libLect-worker/2.0' },
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

async function proxyXmlApi(url) {
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

function isWholeSetLoan(d) {
    if (!d) return false;
    return Object.values(d).some(value => 
        typeof value === 'string' && (value.includes('전질 대출') || value.includes('전질대출'))
    );
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
    const kstMs = Date.now() + (9 * 60 * 60 * 1000);
    const kstDate = new Date(kstMs);
    return new Date(Date.UTC(kstDate.getUTCFullYear(), kstDate.getUTCMonth(), kstDate.getUTCDate()));
}

function getKoreaNow() {
    const kstMs = Date.now() + (9 * 60 * 60 * 1000);
    const kstDate = new Date(kstMs);
    return {
        getDay: () => kstDate.getUTCDay(),
        getHours: () => kstDate.getUTCHours(),
        getMinutes: () => kstDate.getUTCMinutes()
    };
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


