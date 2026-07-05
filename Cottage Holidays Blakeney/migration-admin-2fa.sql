-- ============================================================
--  migration-admin-2fa.sql — remembered "trusted devices" for admin 2FA.
--  When the owner enters the emailed sign-in code and ticks "remember this
--  device", a random token's hash is stored here (the token itself lives only in
--  an HttpOnly cookie), so that device skips the code next time. Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_devices (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    token_hash  CHAR(64)     NOT NULL,
    user_agent  VARCHAR(255) NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen   DATETIME     NULL,
    UNIQUE KEY uniq_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
