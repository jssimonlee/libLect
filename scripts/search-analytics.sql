-- Cloudflare Dashboard > D1 > liblect-db > Console에서 실행합니다.

-- 최근 30일 인기 검색어
SELECT
    CASE search_type WHEN 'lecture' THEN '강좌' ELSE '규정·이용안내' END AS search_area,
    query,
    COUNT(*) AS search_count,
    ROUND(AVG(result_count), 1) AS average_results
FROM search_logs
WHERE searched_at >= datetime('now', '-30 days')
GROUP BY search_type, query
ORDER BY search_count DESC, query
LIMIT 100;

-- 최근 30일 동안 결과가 없었던 검색어
SELECT
    CASE search_type WHEN 'lecture' THEN '강좌' ELSE '규정·이용안내' END AS search_area,
    query,
    COUNT(*) AS search_count,
    MAX(searched_at) AS last_searched_at
FROM search_logs
WHERE result_count = 0
  AND searched_at >= datetime('now', '-30 days')
GROUP BY search_type, query
ORDER BY search_count DESC, last_searched_at DESC
LIMIT 100;

-- 날짜별 검색량과 결과 없음 비율
SELECT
    date(searched_at, '+9 hours') AS korea_date,
    COUNT(*) AS searches,
    SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS no_result_searches,
    ROUND(100.0 * SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS no_result_percent
FROM search_logs
WHERE searched_at >= datetime('now', '-30 days')
GROUP BY korea_date
ORDER BY korea_date DESC;
