-- Pre-arrival email tracking: when the automatic "arrival info" email was sent.
-- Run ONCE in phpMyAdmin. If it errors with "duplicate column", it's already done.
ALTER TABLE bookings ADD COLUMN pre_arrival_sent DATETIME NULL DEFAULT NULL;
