-- ============================================================
--  migration-analytics-v4.sql — time-on-page (dwell) per page view.
--    • dwell_ms = how long a page view was visible, sent by a lightweight
--      beacon on page-hide / view-change, so the owner can see which pages
--      hold attention. Still no personal data — just a duration on the row.
--  Plain ADD COLUMN (idempotent via migrate.php's "duplicate column" skip).
-- ============================================================

-- Milliseconds the page view was visible (NULL until the beacon updates it).
ALTER TABLE pageviews ADD COLUMN dwell_ms INT NULL;
