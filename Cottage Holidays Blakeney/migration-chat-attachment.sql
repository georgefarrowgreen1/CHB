-- ============================================================
--  migration-chat-attachment.sql — image attachments in owner↔guest chat.
--  Each message may carry one uploaded image (path under uploads/), saved via the
--  shared, content-validated, EXIF-stripped image pipeline (image-save.php). Plain
--  ADD COLUMN (idempotent via migrate.php's duplicate-column skip).
-- ============================================================
ALTER TABLE messages ADD COLUMN attachment VARCHAR(255) NULL;
