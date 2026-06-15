-- First-party, cookie-free page-view analytics.
-- One row per counted page view. No raw IPs or user agents are stored — only a
-- salted one-way hash (ip_hash) so we can estimate unique visitors without
-- holding personal data. Referrer is stored as a bare host only.
CREATE TABLE IF NOT EXISTS pageviews (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    prop_key      VARCHAR(32)  NULL,
    path          VARCHAR(255) NOT NULL,
    referrer_host VARCHAR(190) NULL,
    ip_hash       CHAR(64)     NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (created_at),
    INDEX idx_prop_date (prop_key, created_at),
    INDEX idx_iphash_date (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
