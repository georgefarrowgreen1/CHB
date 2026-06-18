-- ============================================================
--  migration-messages-thread-index.sql — index the message-fetch hot path.
--  messages.php reads "WHERE thread_id = ?" on every thread open, but thread_id
--  (added by migration-messaging-threads.sql) had no index — a full scan per open.
--  migrate.php swallows "duplicate key name" so this is safe to re-run.
-- ============================================================
ALTER TABLE messages ADD INDEX idx_thread (thread_id, id);
