-- ============================================================
--  migration-ical.sql
--  Run ONCE in phpMyAdmin to enable iCal calendar sync (importing
--  blocked dates from Airbnb / Vrbo into your site).
--  Stores date ranges pulled from external platform calendars so the
--  public booking form can treat them as unavailable.
-- ============================================================

CREATE TABLE IF NOT EXISTS ical_blocks (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    prop_key    VARCHAR(32)  NOT NULL,
    source      VARCHAR(40)  NOT NULL,        -- e.g. 'airbnb', 'vrbo'
    uid         VARCHAR(190) NULL,            -- event UID from the feed (for de-dupe)
    check_in    DATE         NOT NULL,
    check_out   DATE         NOT NULL,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_prop (prop_key),
    INDEX idx_dates (prop_key, check_in, check_out)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
