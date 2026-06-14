-- ============================================================
--  migration-price-override.sql
--  Run ONCE in phpMyAdmin if you already have a live database.
--  Adds a column that lets the back office set a manual TOTAL price
--  on a booking, overriding the auto-calculated figure. Customer-facing
--  enquiry pricing is unaffected (it still uses Settings & Fees).
-- ============================================================

ALTER TABLE bookings
    ADD COLUMN price_override DECIMAL(10,2) NULL AFTER agreed_on;
