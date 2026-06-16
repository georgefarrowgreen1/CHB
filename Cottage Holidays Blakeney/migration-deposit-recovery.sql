-- Abandoned-payment recovery: when a deposit request is sent on approval but the
-- guest never pays, the daily cron (payments-due.php) sends ONE gentle reminder a
-- few days later. We track when the deposit was requested and when we reminded, so
-- the recovery email fires once. Applied by migrate.php. Safe to re-run.
-- If a line errors with "duplicate column", that part is already done.
ALTER TABLE bookings ADD COLUMN deposit_requested_at DATETIME NULL;
ALTER TABLE bookings ADD COLUMN deposit_reminded_at DATETIME NULL;
