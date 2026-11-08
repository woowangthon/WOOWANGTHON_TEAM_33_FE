ALTER TABLE complaints ADD COLUMN IF NOT EXISTS coverage_review TEXT;
CREATE TABLE IF NOT EXISTS complaint_reports (
 id TEXT PRIMARY KEY,
 complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
 owner TEXT NOT NULL,
 source_digest TEXT NOT NULL,
 masked_data TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS complaint_reports_parent ON complaint_reports(complaint_id,created_at);
