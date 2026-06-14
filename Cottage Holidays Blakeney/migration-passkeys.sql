-- ============================================================
--  migration-passkeys.sql
--  Run ONCE in phpMyAdmin to enable passkey (Face ID / Touch ID / Windows
--  Hello) logins for guests. Stores the public-key credentials registered
--  by guests; the private key never leaves the guest's device.
-- ============================================================

CREATE TABLE IF NOT EXISTS guest_passkeys (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    guest_id      INT          NOT NULL,
    credential_id VARCHAR(512) NOT NULL,            -- base64url credential id
    public_key    TEXT         NOT NULL,            -- PEM public key
    label         VARCHAR(120) NULL,                -- friendly device label
    sign_count    INT          NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at  DATETIME     NULL,
    UNIQUE KEY uq_cred (credential_id(191)),
    INDEX idx_guest (guest_id),
    CONSTRAINT fk_passkey_guest FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
