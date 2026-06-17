-- ============================================================
--  migration-damage-hold.sql — refundable damage deposit as a Square card HOLD.
--
--  Instead of charging the damages deposit and refunding it after the stay, we
--  AUTHORISE it on the guest's card near arrival (funds held, not taken) and then
--  CAPTURE it (if there's damage) or RELEASE it after checkout. These columns track
--  that hold per booking. Plain ADD COLUMN (idempotent via migrate.php's
--  "duplicate column" skip — MySQL 8 has no ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- Square payment id of the authorisation (the held, uncaptured payment).
ALTER TABLE bookings ADD COLUMN hold_payment_id VARCHAR(64) NULL;
-- none | authorized | captured | released | expired
ALTER TABLE bookings ADD COLUMN hold_status VARCHAR(16) NOT NULL DEFAULT 'none';
-- The amount held (snapshot of the damages deposit at hold time).
ALTER TABLE bookings ADD COLUMN hold_amount DECIMAL(10,2) NULL;
-- When the hold was authorised, and when it was settled (captured or released).
ALTER TABLE bookings ADD COLUMN hold_authorized_at DATETIME NULL;
ALTER TABLE bookings ADD COLUMN hold_settled_at DATETIME NULL;
-- When the "place your card hold" request was last emailed to the guest (so the
-- daily cron doesn't nag — and so the owner can see it was sent).
ALTER TABLE bookings ADD COLUMN hold_requested_at DATETIME NULL;
