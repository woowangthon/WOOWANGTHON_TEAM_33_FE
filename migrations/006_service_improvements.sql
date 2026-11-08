ALTER TABLE complaints ADD COLUMN IF NOT EXISTS supplements TEXT NOT NULL DEFAULT '[]';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS published_citations TEXT NOT NULL DEFAULT '[]';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS analysis_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS analysis_checkpoint TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS workflow_run TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS valid_from TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS valid_to TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version_mst TEXT;
CREATE TABLE IF NOT EXISTS complaint_attachments (
 id TEXT PRIMARY KEY, complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
 owner TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BYTEA NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS complaint_attachments_parent ON complaint_attachments(complaint_id);
