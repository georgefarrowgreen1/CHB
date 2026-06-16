-- ============================================================
--  migration-messaging-threads2.sql  (runs after migration-messaging-threads.sql)
--  Let the owner archive guest-message conversations (kept, hidden from the
--  main inbox). Deleting a thread removes it outright in messages.php.
--  If the line errors with "duplicate column", that part is already done.
-- ============================================================
ALTER TABLE chat_threads ADD COLUMN archived TINYINT NOT NULL DEFAULT 0;
