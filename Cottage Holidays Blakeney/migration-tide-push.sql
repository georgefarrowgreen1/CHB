-- Tide-timed in-stay push: remember the date we last pushed today's tide window
-- to a booking's guest, so the daily cron sends at most one per day per stay.
-- Applied by migrate.php. Safe to re-run ("duplicate column" is skipped).
ALTER TABLE bookings ADD COLUMN tide_push_sent DATE NULL;
