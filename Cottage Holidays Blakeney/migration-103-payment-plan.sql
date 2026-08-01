-- migration-103-payment-plan.sql — a per-booking PAYMENT PLAN.
--
-- The deposit percentage (square-deposit-pct, default 25%) and the balance
-- window (PAYMENT_BALANCE_DAYS, 30 days before check-in) were site-wide
-- constants: every guest was asked for the same share at the same relative
-- moment. These three nullable columns make them per-booking decisions,
-- set from the booking hub's "Edit payment plan" dialog:
--
--   deposit_pct_override     this booking's deposit as a percentage (0–100]
--   deposit_amount_override  …or as a fixed £ amount (wins over the pct;
--                            capped at the rental total when read)
--   balance_due_date         the date the balance falls due — the nightly
--                            chaser waits for it, and a pay link opened on
--                            or after it asks for everything still owed
--
-- NULL means "site standard", which is every booking that predates this and
-- every booking whose owner never opens the dialog — behaviour is unchanged
-- until a plan is deliberately set. Derivations live in pricing.php
-- (booking_deposit_amount / booking_balance_due_date), never inline.
--
-- Idempotent the way the others are: plain ADD COLUMN, with migrate.php
-- treating a duplicate-column error as already-applied (MySQL 8 has no
-- ADD COLUMN IF NOT EXISTS, so we must NOT use it here).
ALTER TABLE bookings ADD COLUMN deposit_pct_override DECIMAL(5,2) NULL;
ALTER TABLE bookings ADD COLUMN deposit_amount_override DECIMAL(10,2) NULL;
ALTER TABLE bookings ADD COLUMN balance_due_date DATE NULL;
