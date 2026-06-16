-- ============================================================
--  migration-square-payments2.sql  (runs after migration-square-payments.sql)
--  Store the Square processing fee per transaction so the Money page can show
--  gross / fee / net reconciliation. Square computes the fee after settlement,
--  so it's back-filled by the payment.updated webhook (square-webhook.php).
--  If the line errors with "duplicate column", that part is already done.
-- ============================================================
ALTER TABLE payments ADD COLUMN fee DECIMAL(10,2) NULL AFTER amount;
