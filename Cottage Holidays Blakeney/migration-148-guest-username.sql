-- ============================================================
--  migration-148-guest-username.sql — a guest may choose a username and sign in
--  with it instead of their email.
--
--  guests.username   lower case, 3 to 40 characters (username-lib.php), NULL until
--                    chosen. UNIQUE, so two guests saving the same name at the same
--                    moment cannot both get it; a NULL is no name, and any number
--                    of guests may have none. The collation is stated so a lookup
--                    is case-insensitive whatever the server's default.
--                    Unique against the back office's usernames too, which live in
--                    another table: auth.php and people.php check both under one
--                    named lock (username_locked, db.php).
--
--  Plain ALTER: migrate.php reads a duplicate column or key as already applied.
-- ============================================================
ALTER TABLE guests ADD COLUMN username VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL;
ALTER TABLE guests ADD UNIQUE KEY uq_guests_username (username);
