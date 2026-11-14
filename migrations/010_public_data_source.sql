-- Provenance for licensed public-data demonstrations. Existing complaints stay unchanged.
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS source_data TEXT;
