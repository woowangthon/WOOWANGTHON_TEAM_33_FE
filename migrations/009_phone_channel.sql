ALTER TABLE complaints ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web' CHECK(channel IN ('web','phone'));
UPDATE complaints SET channel='phone' WHERE channel='web' AND EXISTS (
  SELECT 1 FROM events WHERE events.complaint_id=complaints.id AND events.label IN ('전화 민원 접수','음성 민원 접수','가상 음성 민원 접수')
);
