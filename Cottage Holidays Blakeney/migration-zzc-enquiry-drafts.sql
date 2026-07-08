-- Abandoned-enquiry rescue: when a visitor types a valid email into the enquiry
-- form but never sends it, the form quietly saves a server-side draft. A daily
-- cron emails ONE "pick up where you left off" nudge (never repeated — nudged_at)
-- if they still haven't enquired a few hours later. Only what that email needs is
-- stored (no address/postcode/message); one row per email; rows are purged after
-- 30 days by the same cron.
CREATE TABLE IF NOT EXISTS enquiry_drafts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    email      VARCHAR(190) NOT NULL,
    prop_key   VARCHAR(32)  NOT NULL,
    name       VARCHAR(120) NULL,
    check_in   DATE         NULL,
    check_out  DATE         NULL,
    adults     TINYINT      NOT NULL DEFAULT 2,
    children   TINYINT      NOT NULL DEFAULT 0,
    nudged_at  DATETIME     NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
