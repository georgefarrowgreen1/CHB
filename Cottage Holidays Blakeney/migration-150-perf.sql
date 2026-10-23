-- How fast the site is for the people using it (perf-lib.php). Each row is one page
-- view's figures as the visitor's own browser measured them, or one later visible
-- stretch of that page (the taps and layout only). Nothing personal: no address, no
-- browser string, no page beyond a coarse kind; kept 30 days (PERF_KEEP_DAYS).
-- Times are milliseconds; layout shift is stored x1000.
CREATE TABLE IF NOT EXISTS perf_samples (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kind       CHAR(1)           NOT NULL,
    device     CHAR(1)           NOT NULL,
    browser    CHAR(1)           NOT NULL,
    land       CHAR(1)           NOT NULL DEFAULT 'o',
    early      TINYINT(1)        NOT NULL DEFAULT 0,
    pwa        TINYINT(1)        NOT NULL DEFAULT 0,
    ttfb       INT UNSIGNED      NULL,
    fcp        INT UNSIGNED      NULL,
    lcp        INT UNSIGNED      NULL,
    shown      INT UNSIGNED      NULL,
    ready      INT UNSIGNED      NULL,
    inp        INT UNSIGNED      NULL,
    cls        INT UNSIGNED      NULL,
    INDEX idx_perf_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The nightly roll-up: one row per finished day, per group the Status page shows
-- (site phones, site computers, the back office), per figure. Kept a year and a bit
-- (PERF_DAY_KEEP_DAYS), so a change shows against the weeks before it.
CREATE TABLE IF NOT EXISTS perf_day (
    id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    day    DATE              NOT NULL,
    grp    CHAR(2)           NOT NULL,
    metric VARCHAR(8)        NOT NULL,
    n      INT UNSIGNED      NOT NULL DEFAULT 0,
    p50    INT UNSIGNED      NOT NULL DEFAULT 0,
    p75    INT UNSIGNED      NOT NULL DEFAULT 0,
    p90    INT UNSIGNED      NOT NULL DEFAULT 0,
    good   INT UNSIGNED      NOT NULL DEFAULT 0,
    poor   INT UNSIGNED      NOT NULL DEFAULT 0,
    UNIQUE KEY uq_perfday (day, grp, metric)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
