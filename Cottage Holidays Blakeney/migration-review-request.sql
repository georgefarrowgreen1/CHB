-- Post-checkout review-request email: remember when we asked each guest for a
-- review so the daily cron asks once. Applied by migrate.php. Safe to re-run.
ALTER TABLE bookings ADD COLUMN review_request_sent DATETIME NULL;
