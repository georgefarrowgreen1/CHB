-- ============================================================
--  migration-chat-typing.sql — live "typing…" indicators for owner↔guest chat.
--  Two "last typed at" stamps per thread: each side pings its column while
--  composing a message, and the other side's poll shows a typing bubble when the
--  stamp is within the last few seconds. Plain ADD COLUMN (idempotent via
--  migrate.php's duplicate-column skip — MySQL 8 has no ADD COLUMN IF NOT EXISTS).
-- ============================================================
ALTER TABLE chat_threads ADD COLUMN guest_typing_at DATETIME NULL;
ALTER TABLE chat_threads ADD COLUMN admin_typing_at DATETIME NULL;
