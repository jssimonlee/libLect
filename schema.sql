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
