-- Daily totals for the Analytics page (analytics-data.php analytics_rollup). A finished
-- day's page views are summed once; a window reads those days plus the raw rows of the
-- days it cuts through. Values are kept byte for byte (VARBINARY) and grouped at read
-- time, so the summed days group exactly as the raw rows do. No index carries a page or
-- a source, which keeps every key short.
CREATE TABLE IF NOT EXISTS pv_day (
    id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    day       DATE            NOT NULL,
    dim       CHAR(1)         NOT NULL,
    k         VARBINARY(1020) NOT NULL DEFAULT '',
    n         INT UNSIGNED    NOT NULL DEFAULT 0,
    dwell_sum BIGINT          NOT NULL DEFAULT 0,
    dwell_n   INT UNSIGNED    NOT NULL DEFAULT 0,
    INDEX idx_pvday_dim_day (dim, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per visitor per day: their page views and the time of their last one.
CREATE TABLE IF NOT EXISTS pv_visit (
    id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    day     DATE           NOT NULL,
    ip_hash VARBINARY(64)  NOT NULL,
    views   INT UNSIGNED   NOT NULL DEFAULT 0,
    last_at DATETIME       NOT NULL,
    INDEX idx_pvvisit_day (day),
    INDEX idx_pvvisit_hash (ip_hash, day, views)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The pages each visitor opened in the last second of the latest day they were seen
-- (where they left); an earlier day's rows go when they come back.
CREATE TABLE IF NOT EXISTS pv_exit (
    id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    day     DATE            NOT NULL,
    ip_hash VARBINARY(64)   NOT NULL,
    k       VARBINARY(1020) NOT NULL,
    n       INT UNSIGNED    NOT NULL DEFAULT 0,
    INDEX idx_pvexit_day (day, ip_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- How far the days are summed, and in which shape (ANALYTICS_ROLLUP_VERSION).
CREATE TABLE IF NOT EXISTS pv_rollup (
    id          TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    through_day DATE             NULL,
    version     SMALLINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
