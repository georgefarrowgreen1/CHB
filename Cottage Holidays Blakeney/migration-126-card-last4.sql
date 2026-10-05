-- ============================================================
--  migration-126 — remember WHICH card a booking was paid with.
--
--  The deposit-return screens say "Visa ending 4471" instead of "the card you
--  paid with". Square reports brand + last four on the payment; pay.php stores
--  them at charge time and bookings.php fetches them once, on demand, for older
--  bookings. Two harmless display facts: no full number, no expiry.
-- ============================================================
ALTER TABLE bookings ADD COLUMN card_last4 CHAR(4) NULL, ADD COLUMN card_brand VARCHAR(24) NULL;
