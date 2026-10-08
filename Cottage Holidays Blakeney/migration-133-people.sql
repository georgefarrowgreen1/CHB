-- migration-133 — people: each person who signs in to the back office.
-- The admins table held a username and a password and nothing else, so a second
-- sign-in would have been a full owner nobody could tell apart. Each person now
-- has their own name, email (where their sign-in codes and reset links go),
-- photo and two-step setting, and a full-access flag with the areas a limited
-- person may use. Rows that exist today are the owner: full_access defaults to 1.
ALTER TABLE admins ADD COLUMN name VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN email VARCHAR(190) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN full_access TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE admins ADD COLUMN caps VARCHAR(255) NOT NULL DEFAULT '';
-- NULL = follow the old shared two-step setting (content key admin-2fa-enabled),
-- so the owner's choice carries over without reading an encrypted value in SQL.
ALTER TABLE admins ADD COLUMN twofa TINYINT(1) NULL;
ALTER TABLE admins ADD COLUMN photo VARCHAR(40) NOT NULL DEFAULT '';
-- Bumped to sign a person out everywhere (removed, or a password reset).
ALTER TABLE admins ADD COLUMN auth_epoch INT NOT NULL DEFAULT 0;
-- An invite or a reset is a link with a random token; only its hash is kept.
ALTER TABLE admins ADD COLUMN invited_at DATETIME NULL;
ALTER TABLE admins ADD COLUMN invite_hash CHAR(64) NULL;
ALTER TABLE admins ADD COLUMN invite_expires DATETIME NULL;
ALTER TABLE admins ADD COLUMN reset_hash CHAR(64) NULL;
ALTER TABLE admins ADD COLUMN reset_expires DATETIME NULL;
-- Removing someone keeps the row, so the activity log can still name them.
ALTER TABLE admins ADD COLUMN removed_at DATETIME NULL;
ALTER TABLE admins ADD COLUMN created_at DATETIME NULL;
ALTER TABLE admins ADD COLUMN last_seen_at DATETIME NULL;
ALTER TABLE admins ADD COLUMN last_login_fp VARCHAR(255) NOT NULL DEFAULT '';
-- Each person's own alert settings (what buzzes, quiet hours). NULL = the first
-- owner's old shared ones (content notify-prefs), or the defaults for anyone else.
ALTER TABLE admins ADD COLUMN notify_prefs TEXT NULL;
-- A trusted device and a phone's alerts belong to whoever set them up. NULL is a
-- row from before people existed: it belonged to the owner.
ALTER TABLE admin_devices ADD COLUMN admin_id INT NULL;
ALTER TABLE push_subscriptions ADD COLUMN admin_id INT NULL;
