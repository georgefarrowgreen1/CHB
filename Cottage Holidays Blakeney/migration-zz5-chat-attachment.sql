-- ============================================================
--  migration-zz5-chat-attachment.sql — image attachments in owner↔guest chat.
--  Each message may carry one uploaded image (path under uploads/), saved via the
--  shared, content-validated, EXIF-stripped image pipeline (image-save.php). Plain
--  ADD COLUMN (idempotent via migrate.php's duplicate-column skip).
--  Prefixed zz5 so it sorts AFTER migration-messages.sql — this ALTER needs the
--  `messages` table to exist, and on a fresh DB "Table doesn't exist" is NOT an
--  idempotent-skip error, so the old name failed the whole migrate run.
-- ============================================================
ALTER TABLE messages ADD COLUMN attachment VARCHAR(255) NULL;
