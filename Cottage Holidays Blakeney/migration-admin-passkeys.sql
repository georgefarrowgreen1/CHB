-- ============================================================
--  migration-admin-passkeys.sql
--  Run ONCE in phpMyAdmin to enable passkey logins for the BACK OFFICE
--  (admin). The admin password still works as a fallback — passkeys are
--  an additional, faster way in, never a replacement.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_passkeys (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    admin_id      INT          NOT NULL,
    credential_id VARCHAR(512) NOT NULL,
    public_key    TEXT         NOT NULL,
    label         VARCHAR(120) NULL,
    sign_count    INT          NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at  DATETIME     NULL,
    UNIQUE KEY uq_admin_cred (credential_id(191)),
    INDEX idx_admin (admin_id),
    CONSTRAINT fk_passkey_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
