-- Damage-deposit returns + refund reasons. A 'damages_return' is a refund of the
-- HELD refundable deposit after a stay; it is tracked separately so it never
-- changes a booking's rental payment status. 'note' captures a refund reason.
-- Applied by migrate.php (MODIFY is safe to re-run).
ALTER TABLE payments ADD COLUMN note VARCHAR(255) NULL;
ALTER TABLE payments MODIFY COLUMN kind ENUM('deposit','balance','refund','damages_return') NOT NULL DEFAULT 'deposit';
