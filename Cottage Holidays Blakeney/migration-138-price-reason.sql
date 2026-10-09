-- Why a booking's price is custom (Returning guest, Friends & family, Longer stay,
-- Last minute). Owner-only: never in a guest payload or email. NULL = no reason.
ALTER TABLE bookings ADD COLUMN price_reason VARCHAR(40) NULL;
