-- ============================================================
--  migration-guest-postcode.sql
--  Run ONCE in phpMyAdmin if you already have a live database.
--  Adds a separate postcode column (alongside the existing address)
--  to guest accounts, enquiries and bookings.
--  If a line errors with "duplicate column", that part is already done.
-- ============================================================

ALTER TABLE guests    ADD COLUMN postcode VARCHAR(12) NULL AFTER address;
ALTER TABLE enquiries ADD COLUMN postcode VARCHAR(12) NULL AFTER address;
ALTER TABLE bookings  ADD COLUMN postcode VARCHAR(12) NULL AFTER address;
