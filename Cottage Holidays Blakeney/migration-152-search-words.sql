-- The word indexes for bookings, enquiries and guests, without the email column
-- (CLAUDE.md "One collation per full-text index"). migration-151 first put email in
-- them, and a FULLTEXT index needs one collation across its columns: email states
-- utf8mb4_general_ci (migration-112) while name, address, notes and message take their
-- table's default, utf8mb4_0900_ai_ci on MySQL 8. Only columns that state no collation
-- of their own are indexed together here, so they share their table's whatever the
-- server. search.php finds an email through its own index (email LIKE 'start%').
--
-- The DROPs undo the first version of 151 wherever it did apply (a server whose
-- default is utf8mb4_general_ci, as MariaDB's is); where it never did they find no
-- index, which migrate.php reads as already done.
ALTER TABLE bookings DROP INDEX ft_bookings;
ALTER TABLE enquiries DROP INDEX ft_enquiries;
ALTER TABLE guests DROP INDEX ft_guests;
ALTER TABLE bookings ADD FULLTEXT INDEX ft_bookings_words (name, address, notes);
ALTER TABLE enquiries ADD FULLTEXT INDEX ft_enquiries_words (name, message);
ALTER TABLE guests ADD FULLTEXT INDEX ft_guests_words (name);
