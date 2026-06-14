-- ============================================================
--  migration-damages-deposit.sql
--  Run ONCE in phpMyAdmin if you already have a live database.
--  The "booking_fee" column is now used as the standard REFUNDABLE
--  DAMAGES DEPOSIT (held, not income). This sets a £75 standard on
--  your existing properties — adjust afterwards in Settings & Fees,
--  or per booking in the back office.
--  No structural change is needed; the columns already exist.
-- ============================================================

UPDATE properties SET booking_fee = 75 WHERE prop_key IN ('21a','jollyboat','pimpernel');

-- Note: existing bookings keep their original snapshot in agreed_booking_fee.
-- New/edited bookings will use the new damages-deposit model automatically.
