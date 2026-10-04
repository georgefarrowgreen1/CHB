-- ============================================================
--  migration-124 — remember WHAT an imported calendar event is.
--
--  Airbnb/Vrbo feeds mix guest bookings and the host's own blocked dates, and the
--  sync kept only the dates, so a block read as a stay everywhere (occupancy, the
--  day sheet, changeover prompts). `kind` is ical_classify()'s verdict —
--  'booking' | 'blocked' | 'unknown' — and `label` the feed's own title. 'unknown'
--  is the default and behaves as every imported event did before. Existing rows
--  fill in on the next sync.
-- ============================================================
ALTER TABLE ical_blocks ADD COLUMN kind VARCHAR(12) NOT NULL DEFAULT 'unknown';
ALTER TABLE ical_blocks ADD COLUMN label VARCHAR(80) NULL;
