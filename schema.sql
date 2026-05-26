CREATE TABLE IF NOT EXISTS assignees (
    lecture_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    masked TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
