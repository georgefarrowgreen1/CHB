-- ============================================================
--  migration-expenses3.sql  (runs after migration-expenses2.sql)
--  Store the structured data read from a receipt photo (supplier, date, line
--  items, amount) as JSON — the photo itself is never uploaded or stored.
--  If the line errors with "duplicate column", that part is already done.
-- ============================================================
ALTER TABLE expenses ADD COLUMN receipt_data TEXT NULL AFTER recurring;
