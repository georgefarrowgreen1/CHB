-- migration-136 — whose money is whose (split.php).
-- A bank payment out to a host who is paid out (their cottages' money reaching
-- them) records who it was paid to; a platform payout matched to a stay records
-- which cottage it was for, so it counts as that cottage's money.
ALTER TABLE bank_lines ADD COLUMN admin_id INT NULL;
ALTER TABLE bank_lines ADD COLUMN prop_key VARCHAR(32) NULL;
