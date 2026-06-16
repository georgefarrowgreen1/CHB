-- Cache for tide-extremes API responses (keyed by start date + day-span), so the
-- tide widget doesn't hammer the third-party API or its free quota. Applied by
-- migrate.php. Safe to re-run (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS tide_cache (
    cache_key  VARCHAR(40) PRIMARY KEY,
    payload    MEDIUMTEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
