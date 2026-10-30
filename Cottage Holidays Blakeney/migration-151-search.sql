-- Search stays instant at five years (search.php's quick path; CLAUDE.md "Search stays
-- instant at five years"). The palette's server search ran a LIKE '%…%' over every row
-- of each source on every pause in typing: 33,000 rows for a word nobody wrote, on five
-- years. A full-text index answers a word, or the start of one, from the words it holds.
-- One index per statement (adding several at once is refused by some engines); an
-- index that is already there is treated as applied by migrate.php.
--
-- CORRECTED after it failed on the live database. The first version also indexed the
-- email column of enquiries, bookings and guests, and a FULLTEXT index needs ONE
-- collation across its columns: migration-112 states email's (utf8mb4_general_ci) while
-- every other text column takes its table's default, which on MySQL 8 is
-- utf8mb4_0900_ai_ci (error 1283, "Column 'email' cannot be part of FULLTEXT index").
-- This file stopped at the first of the three on every run and was never recorded, so
-- live ran it again each night and failed each night. Those three indexes are
-- migration-152's now, without the email column; everything left here works whatever
-- the server's default collation is.
ALTER TABLE messages ADD FULLTEXT INDEX ft_messages_body (body);
ALTER TABLE mail_sent ADD FULLTEXT INDEX ft_mail_sent (subject, to_email, body);
ALTER TABLE activity_log ADD FULLTEXT INDEX ft_activity_summary (summary);
ALTER TABLE guest_reviews ADD FULLTEXT INDEX ft_reviews_text (review_text);
ALTER TABLE expenses ADD FULLTEXT INDEX ft_expenses (category, description);
ALTER TABLE waitlist ADD FULLTEXT INDEX ft_waitlist (name, email, note);
-- A payment is found by its amount: the exact figure, read from an index.
ALTER TABLE payments ADD INDEX idx_amount (amount);
