-- ============================================================
--  migration-142-chat-team.sql — the guest chat says who answers.
--
--  messages.admin_id    who wrote an owner-side message (NULL: from before this,
--                       or written by no one's sign-in). The guest sees the name
--                       and photo only while that person is shown in the chat.
--  messages.kind        '' a message someone typed, 'auto' the away reply, 'event'
--                       a note that something was emailed from the chat (a pay
--                       link, the arrival details). The guest's chat draws each
--                       differently.
--  chat_threads.admin_typing_by   who is typing, so the guest reads "Sophia is
--                       typing" rather than a bare "typing".
--  admins.chat_show     whether this person's first name and photo are shown to
--                       guests in the chat. On for everyone: someone switched off
--                       still answers, signed with the crown.
--  admins.chat_line     the short line under their name in the chat ("Host",
--                       "Bookings & Website"). Empty: the host is "Host", anyone
--                       else no line.
--
--  Plain ALTERs: migrate.php reads a duplicate column as already applied.
-- ============================================================
ALTER TABLE messages ADD COLUMN admin_id INT NULL;
ALTER TABLE messages ADD COLUMN kind VARCHAR(12) NOT NULL DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN admin_typing_by INT NULL;
ALTER TABLE admins ADD COLUMN chat_show TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE admins ADD COLUMN chat_line VARCHAR(40) NOT NULL DEFAULT '';
