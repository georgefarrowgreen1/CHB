-- Payment schedule: remember when the balance request was auto-sent, so the
-- scheduled job (payments-due.php) chases each booking's balance only once.
-- Applied automatically by migrate.php. Safe to re-run (idempotent column add).
ALTER TABLE bookings ADD COLUMN balance_requested_at DATETIME NULL;
