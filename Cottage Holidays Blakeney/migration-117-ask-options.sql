-- migration-117-ask-options.sql
--
--  THE INTENT ASK carries a list: the site's own canonical questions, so the
--  Mac's model can only ever CHOOSE one (byte-exact) or say none — never
--  write an answer of its own. The list is composed by the client that knows
--  the answer families, travels with the ask, and is validated again when
--  the answer comes back. A plain guarded ADD COLUMN, per the house rule —
--  migrate.php treats a duplicate-column error as already-applied.
ALTER TABLE night_asks ADD COLUMN options TEXT NULL;
