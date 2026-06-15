-- Balance reminders: remember when we last reminded a guest about an unpaid
-- balance, so the daily cron (payments-due.php) chases at most every ~3 days
-- and never spams. Applied automatically by migrate.php. Safe to re-run.
ALTER TABLE bookings ADD COLUMN balance_reminded_at DATETIME NULL;
