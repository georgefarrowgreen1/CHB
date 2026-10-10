-- ============================================================
--  migration-143-devices.sql — Devices: every sign-in to the back office is a
--  row, so one device can be signed out without signing out the rest.
--
--  admin_sessions   one row per device a person is signed in on. The session
--                   carries its row's id, and every request checks the row is
--                   still open (admin_session_check), so ending the row signs
--                   that device out the next time it is used.
--     device_hash   sha256 of this browser's chb_dk cookie: the same browser
--                   signing in again is not a "new device".
--     trust_hash    sha256 of the two-step trust cookie it had when it signed
--                   in, so signing it out also forgets it for two-step.
--     how           how it signed in: passkey, password, password_code, code,
--                   invite, reset, staging — or 'earlier' for a session from
--                   before this list began, recorded on its next request.
--     ended_why     logout, device, all, password, reset, removed, expired,
--                   replaced or guest; ended_by is who signed it out.
--  push_subscriptions.admin_session_id   which signed-in device turned alerts
--                   on, so signing that device out stops its alerts.
--
--  Plain ALTER: migrate.php reads a duplicate column as already applied.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_sessions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    admin_id    INT          NOT NULL,
    device_hash CHAR(64)     NOT NULL DEFAULT '',
    trust_hash  CHAR(64)     NOT NULL DEFAULT '',
    label       VARCHAR(60)  NOT NULL DEFAULT '',
    kind        VARCHAR(10)  NOT NULL DEFAULT '',
    how         VARCHAR(16)  NOT NULL DEFAULT '',
    user_agent  VARCHAR(255) NULL,
    created_at  DATETIME     NOT NULL,
    last_seen   DATETIME     NULL,
    ended_at    DATETIME     NULL,
    ended_by    INT          NULL,
    ended_why   VARCHAR(12)  NOT NULL DEFAULT '',
    KEY idx_admin (admin_id, ended_at),
    KEY idx_device (admin_id, device_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE push_subscriptions ADD COLUMN admin_session_id INT NULL;
