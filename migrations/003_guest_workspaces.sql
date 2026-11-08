CREATE TABLE IF NOT EXISTS guest_sessions (
 token_hash TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_sessions_expiry ON guest_sessions(expires_at);
CREATE TABLE IF NOT EXISTS guest_transfers (
 token_hash TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 source_origin TEXT NOT NULL,
 target_origin TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_transfers_expiry ON guest_transfers(expires_at);
