-- ============================================================
--  migration-zz8-payment-damages-kind.sql — allow the 'damages' ledger kind.
--  Prefixed zz8 so it sorts AFTER migration-square-payments.sql (creates the
--  `payments` table); the old name ran before it and failed on a fresh DB.
--  A captured legacy hold (hold_capture) and a kept charge-upfront deposit
--  (keep_deposit) record retained damage income as kind='damages'. That value
--  wasn't in the ENUM, so under MySQL strict mode the INSERT silently failed and
--  the income was lost from the ledger. Add it. Idempotent (re-running MODIFYs to
--  the same definition is a no-op).
-- ============================================================
ALTER TABLE payments
    MODIFY COLUMN kind ENUM('deposit','balance','refund','damages_return','damages') NOT NULL DEFAULT 'deposit';
