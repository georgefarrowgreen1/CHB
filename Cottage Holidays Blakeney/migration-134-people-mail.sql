-- migration-134 — who gets which emails, per person.
-- Each person's choices (JSON of the email kinds in people-lib.php's PEOPLE_MAILS).
-- NULL = the defaults: everything for someone with full access (how it worked
-- before people existed), the guest-facing emails for anyone else.
ALTER TABLE admins ADD COLUMN mail_prefs TEXT NULL;
