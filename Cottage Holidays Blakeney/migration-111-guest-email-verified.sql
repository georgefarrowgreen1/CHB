-- ============================================================
--  migration-111 — prove the email before the account gets the stay.
--
--  my_bookings_payload matches a guest's stays on `LOWER(b.email) = LOWER(?)`,
--  and NOTHING verified that address: guest_register created the account and
--  signed the person in on the spot. So registering with a guest's email handed
--  over their booking — dates, party, money, the arrival details, and the door
--  code once inside its reveal window — to anyone who guessed it.
--
--  email_verified_at records that the address was actually proven, which only
--  the magic link can do (it is emailed TO that address).
--
--  EVERY EXISTING ROW IS BACKFILLED AS VERIFIED, deliberately. This is a live
--  site: an account created before this migration may well be a real guest who
--  would otherwise be locked out of their own stay with no warning. The trade is
--  that an address squatted before today stays squatted — which is the state we
--  are already in, so the backfill loses nothing that is not already lost, while
--  refusing it would break real people.
--
--  Guarded/idempotent per the house rule: a duplicate-column error is treated by
--  migrate.php as already-applied, and the UPDATE is a no-op on re-run because
--  new rows are stamped at registration.
-- ============================================================

ALTER TABLE guests ADD COLUMN email_verified_at DATETIME NULL;

UPDATE guests SET email_verified_at = NOW() WHERE email_verified_at IS NULL;
