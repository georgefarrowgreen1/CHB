-- ============================================================
--  migration-guest-address.sql
--  Run ONCE in phpMyAdmin if you already have a live database.
--  Adds a full UK address to guest accounts, enquiries and bookings.
--  If any line errors with "duplicate column", that part is already done —
--  just run the remaining lines.
-- ============================================================

ALTER TABLE guests    ADD COLUMN address TEXT NULL AFTER phone;
ALTER TABLE enquiries ADD COLUMN address TEXT NULL AFTER phone;
ALTER TABLE bookings  ADD COLUMN address TEXT NULL AFTER phone;
