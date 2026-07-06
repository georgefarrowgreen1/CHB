-- ============================================================
--  migration-sms-optin.sql — per-guest consent to receive transactional
--  booking SMS (balance reminders + pre-arrival info). Threaded enquiry →
--  booking. OFF by default; only guests who tick the box are ever texted, and
--  only when the owner has configured a provider (SMS_ENABLED + TWILIO_* in
--  config.php). Plain ADD COLUMN (idempotent via migrate.php's duplicate-column
--  skip). Both tables exist in schema.sql, so ordering is not a concern.
-- ============================================================
ALTER TABLE enquiries ADD COLUMN sms_opt_in TINYINT NOT NULL DEFAULT 0;
ALTER TABLE bookings  ADD COLUMN sms_opt_in TINYINT NOT NULL DEFAULT 0;
