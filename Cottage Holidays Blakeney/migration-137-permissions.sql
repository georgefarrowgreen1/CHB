-- migration-137 — permissions: what each Host can do, one switch at a time.
-- Holds only how a Host differs from a plain Host, as JSON ({} = a plain Host).
-- NULL = someone set up before permissions: their old five switches (`caps`)
-- decide until the first change is saved. A Super User (full_access = 1) has
-- everything and this column is not read for them.
ALTER TABLE admins ADD COLUMN perms TEXT NULL;
