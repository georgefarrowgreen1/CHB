-- A guest's own profile photo (Account page). The FILE lives under
-- uploads/avatars/ with a random name; this column holds that name, NULL = none.
ALTER TABLE guests ADD COLUMN avatar VARCHAR(40) NULL;
