-- Damage-deposit returns + refund reasons. A 'damages_return' is a refund of the
-- HELD refundable deposit after a stay; it is tracked separately so it never
-- changes a booking's rental payment status. 'note' captures a refund reason.
-- Applied by migrate.php (MODIFY is safe to re-run).
-- NB the ENUM must be the SUPERSET incl. 'damages' — migrate.php applies files in
-- sorted name order, so on a full/fresh run this file runs AFTER
-- migration-zz8-payment-damages-kind.sql (which added 'damages' so keep_deposit /
-- hold_capture can book kept-deposit income). A narrower ENUM here would drop
-- 'damages' again and silently corrupt those ledger rows under MySQL strict mode.
ALTER TABLE payments ADD COLUMN note VARCHAR(255) NULL;
ALTER TABLE payments MODIFY COLUMN kind ENUM('deposit','balance','refund','damages_return','damages') NOT NULL DEFAULT 'deposit';
