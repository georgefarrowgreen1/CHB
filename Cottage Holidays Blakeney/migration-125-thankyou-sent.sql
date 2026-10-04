-- ============================================================
--  migration-125 — remember that the day-after-checkout thank-you went.
--
--  The thank-you email (mailer.php thank_you_body) is sent once per booking by
--  pre-arrival.php, and ONLY when the owner has switched it on (content key
--  'thankyou-email', default off). `thankyou_sent` is the claim-first stamp the
--  other crons use: set before the send, cleared on a clean failure, so two
--  overlapping runs cannot thank the same guest twice.
-- ============================================================
ALTER TABLE bookings ADD COLUMN thankyou_sent DATETIME NULL;
