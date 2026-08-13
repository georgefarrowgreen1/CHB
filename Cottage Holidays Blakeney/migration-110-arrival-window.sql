-- The guest's own answer to "when will you arrive?" — asked on My Stays, read
-- by the owner's booking hub (and changeover timing). A short window CODE
-- ('16-18' hour band, 'late', 'unsure'), never free text; NULL = not answered.
-- Guarded migration: migrate.php treats a duplicate-column error as applied.
ALTER TABLE bookings ADD COLUMN arrival_window VARCHAR(20) NULL;
