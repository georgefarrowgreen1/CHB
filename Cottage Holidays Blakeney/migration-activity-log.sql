-- migration-activity-log.sql — audit trail of owner/admin actions + site changes.
-- Applied idempotently by migrate.php. Read by activity-log.php (the back-office
-- Activity log page); written via db.php's log_activity().
CREATE TABLE IF NOT EXISTS activity_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor VARCHAR(120) NOT NULL DEFAULT 'system',   -- 'owner' | 'system' | 'cron' | 'guest:<id>'
    category VARCHAR(32) NOT NULL DEFAULT 'other',   -- content|rates|booking|payment|moderation|enquiry|settings|account|system
    action VARCHAR(64) NOT NULL DEFAULT '',          -- machine tag, e.g. 'content.save'
    summary VARCHAR(255) NOT NULL DEFAULT '',         -- human one-liner
    prop_key VARCHAR(40) NULL,
    entity VARCHAR(40) NULL,
    entity_id VARCHAR(64) NULL,
    meta TEXT NULL,                                  -- optional JSON detail
    ip VARCHAR(45) NULL,
    INDEX idx_activity_created (created_at),
    INDEX idx_activity_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
