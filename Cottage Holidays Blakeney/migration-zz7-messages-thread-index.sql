-- ============================================================
--  migration-zz7-messages-thread-index.sql — index the message-fetch hot path.
--  messages.php reads "WHERE thread_id = ?" on every thread open, but thread_id
--  (added by migration-messaging-threads.sql) had no index — a full scan per open.
--  migrate.php swallows "duplicate key name" so this is safe to re-run.
--  Prefixed zz7 so it sorts AFTER both migration-messages.sql (the `messages`
--  table) and migration-messaging-threads.sql (the `thread_id` column); the old
--  name sorted before migration-messages.sql and failed on a fresh DB.
-- ============================================================
ALTER TABLE messages ADD INDEX idx_thread (thread_id, id);
