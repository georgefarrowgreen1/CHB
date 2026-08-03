-- migration-105-autopay-consent.sql — the guest's RECORDED PERMISSION to take
-- the balance automatically.
--
-- The whole point of these columns is that a stored card is NOT permission.
-- Square can hold a card from the deposit payment; that says the guest paid
-- once, not that they agreed to be charged again. So consent is recorded as a
-- fact with a date, and — crucially — WITH THE TERMS IT WAS GIVEN FOR:
--
--   autopay_consent_at   when the guest ticked the box (NULL = never agreed,
--                        and that is the only state the whole feature defaults
--                        to; no consent means the app behaves exactly as it did
--                        before this migration existed)
--   autopay_card_id      the Square card-on-file id the guest agreed may be
--                        charged. A different card is a different agreement.
--   autopay_amount       the figure shown to them at the moment they agreed
--   autopay_due          the date shown to them at the moment they agreed
--   autopay_revoked_at   when they turned it off (or the owner did). Kept
--                        rather than nulling the consent, so "they agreed and
--                        then changed their mind" stays distinguishable from
--                        "they never agreed" — an auditable trail on money.
--   autopay_last_error   the most recent decline/failure, in the guest's own
--                        words, so a failed collection can be shown and chased
--                        rather than silently retried.
--
-- amount + due are what make this safe. If the owner later edits the payment
-- plan, or the price changes, the stored terms no longer match what would be
-- charged — and booking_autopay_state() reports `stale`, which never charges.
-- Permission is for a SUM on a DATE, not a standing licence.
--
-- Guarded ADD COLUMNs: migrate.php treats a duplicate-column error as
-- already-applied (do NOT wrap these in information_schema + PREPARE — the
-- no-op branch leaves an open cursor that kills the next migration).
ALTER TABLE bookings ADD COLUMN autopay_consent_at DATETIME NULL;
ALTER TABLE bookings ADD COLUMN autopay_card_id VARCHAR(191) NULL;
ALTER TABLE bookings ADD COLUMN autopay_amount DECIMAL(10,2) NULL;
ALTER TABLE bookings ADD COLUMN autopay_due DATE NULL;
ALTER TABLE bookings ADD COLUMN autopay_revoked_at DATETIME NULL;
ALTER TABLE bookings ADD COLUMN autopay_last_error VARCHAR(255) NULL;
