-- ============================================================
--  migration-expenses2.sql  (runs after migration-expenses.sql)
--  Expenses 2.0: attach a receipt photo and flag recurring costs.
--  If a line errors with "duplicate column", that part is already done.
-- ============================================================
ALTER TABLE expenses ADD COLUMN receipt_url VARCHAR(255) NULL AFTER prop_key;
ALTER TABLE expenses ADD COLUMN recurring   TINYINT NOT NULL DEFAULT 0 AFTER receipt_url;
