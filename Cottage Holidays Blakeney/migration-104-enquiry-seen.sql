-- When the owner OPENED this enquiry. An enquiry stays pending until it is
-- approved or declined, so the red count went on nagging about one that had been
-- read — reported: the pips still said 1 with the enquiry on screen. Opening it
-- stamps this, and the NOTIFICATION counts (dock pips, folder chip, app badge)
-- drop; the duty survives, because reading an enquiry is not answering it.
-- Guarded like every other migration: safe to run twice.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enquiries' AND COLUMN_NAME = 'seen_at');
SET @s := IF(@c = 0, 'ALTER TABLE enquiries ADD COLUMN seen_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
