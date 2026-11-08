CREATE TABLE IF NOT EXISTS complaints (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL,
 location TEXT NOT NULL, occurred_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','reviewing','waiting','resolved')),
 analysis TEXT, evidence TEXT, draft TEXT NOT NULL DEFAULT '', published TEXT NOT NULL DEFAULT '', tasks TEXT NOT NULL DEFAULT '[]',
 is_sample INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS complaints_owner_date ON complaints(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_queue ON complaints(created_at DESC);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY,owner TEXT NOT NULL,source_id TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,jurisdiction TEXT NOT NULL,effective_date TEXT NOT NULL,source_url TEXT NOT NULL,articles TEXT NOT NULL,imported_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,owner TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_complaint ON events(complaint_id,owner);
CREATE TABLE IF NOT EXISTS settings(owner TEXT PRIMARY KEY,encrypted TEXT NOT NULL,model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-lite',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0);
