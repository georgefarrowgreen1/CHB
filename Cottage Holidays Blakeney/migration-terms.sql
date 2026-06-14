-- ============================================================
--  migration-terms.sql
--  Run this ONCE in phpMyAdmin if you already created your database
--  with the earlier schema (so you don't have to rebuild it).
--  It adds the columns that record Terms & Conditions acceptance.
--  Safe to run once; running it twice will error on duplicate columns
--  (that's harmless — it just means the columns already exist).
-- ============================================================

ALTER TABLE enquiries
    ADD COLUMN terms_accepted_at DATETIME NULL,
    ADD COLUMN terms_version VARCHAR(20) NULL;

ALTER TABLE bookings
    ADD COLUMN terms_accepted_at DATETIME NULL,
    ADD COLUMN terms_version VARCHAR(20) NULL;
