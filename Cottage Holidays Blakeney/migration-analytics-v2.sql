-- ============================================================
--  migration-analytics-v2.sql — richer first-party, cookie-free analytics:
--    • event-based funnel (book_click / enquiry_open / enquiry_submit / pay_start)
--    • campaign attribution (utm_source) on each page view
--    • search-demand log (what guests search for + whether it found anything)
--  No personal data: events/views carry only a salted IP hash; the search log
--  stores party size / nights / month and a yes/no "found", never who searched.
--  Plain ADD COLUMN (idempotent via migrate.php's "duplicate column" skip).
-- ============================================================

-- A named intent event on a pageviews row (NULL = an ordinary page view).
ALTER TABLE pageviews ADD COLUMN event VARCHAR(40) NULL;
-- utm_source from the landing URL (newsletter / instagram / etc.), if any.
ALTER TABLE pageviews ADD COLUMN source VARCHAR(60) NULL;

-- One row per homepage availability search (exact or flexible).
CREATE TABLE IF NOT EXISTS search_log (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    mode       VARCHAR(10) NOT NULL DEFAULT 'exact',   -- exact | flex
    adults     INT         NOT NULL DEFAULT 2,
    children   INT         NOT NULL DEFAULT 0,
    nights     INT         NULL,
    month      CHAR(7)     NULL,                        -- YYYY-MM (flexible search)
    check_in   DATE        NULL,                        -- exact search
    results    INT         NOT NULL DEFAULT 0,          -- cottages with availability
    found      TINYINT     NOT NULL DEFAULT 0,          -- 1 if any cottage was free
    ip_hash    CHAR(64)    NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (created_at),
    INDEX idx_found_date (found, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
