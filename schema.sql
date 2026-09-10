CREATE TABLE IF NOT EXISTS assignees (
    lecture_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    masked TEXT NOT NULL,
    color TEXT DEFAULT '#8b5a2b',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS global_cache (
    cache_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    search_type TEXT NOT NULL CHECK (search_type IN ('lecture', 'rules')),
    result_count INTEGER NOT NULL DEFAULT 0,
    searched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_logs_searched_at
    ON search_logs(searched_at);

CREATE INDEX IF NOT EXISTS idx_search_logs_type_query
    ON search_logs(search_type, query);
