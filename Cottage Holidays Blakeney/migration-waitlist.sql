-- "Notify me" waitlist: guests register interest in a cottage (optionally for
-- specific dates) and are emailed if those dates free up.
CREATE TABLE IF NOT EXISTS waitlist (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    prop_key    VARCHAR(32)  NOT NULL,
    name        VARCHAR(120) NULL,
    email       VARCHAR(190) NOT NULL,
    check_in    DATE         NULL,
    check_out   DATE         NULL,
    note        VARCHAR(500) NULL,
    notified_at DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_prop (prop_key, notified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
