ALTER TABLE complaints ADD COLUMN IF NOT EXISTS auto_state TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS auto_message TEXT NOT NULL DEFAULT '';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS auto_started_at TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS auto_token TEXT;
CREATE INDEX IF NOT EXISTS complaints_auto_queue ON complaints(auto_state,created_at);
