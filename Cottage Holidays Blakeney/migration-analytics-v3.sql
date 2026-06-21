-- ============================================================
--  migration-analytics-v3.sql — device class on each page view.
--    • device (mobile | tablet | desktop) classified from the User-Agent
--      at insert time, so the owner can see how guests browse.
--  No personal data: the raw UA is never stored, only the coarse class.
--  Plain ADD COLUMN (idempotent via migrate.php's "duplicate column" skip).
-- ============================================================

-- Coarse device class for a page view (NULL on intent-event rows).
ALTER TABLE pageviews ADD COLUMN device VARCHAR(10) NULL;
