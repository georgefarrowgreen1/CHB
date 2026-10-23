-- Search stays instant at five years (search.php's quick path; CLAUDE.md "Search stays
-- instant at five years"). The palette's server search ran a LIKE '%…%' over every row
-- of each source on every pause in typing: 33,000 rows for a word nobody wrote, on five
-- years. A full-text index answers a word, or the start of one, from the words it holds.
-- One index per statement (adding several at once is refused by some engines); an
-- index that is already there is treated as applied by migrate.php.
ALTER TABLE messages ADD FULLTEXT INDEX ft_messages_body (body);
ALTER TABLE mail_sent ADD FULLTEXT INDEX ft_mail_sent (subject, to_email, body);
ALTER TABLE activity_log ADD FULLTEXT INDEX ft_activity_summary (summary);
ALTER TABLE enquiries ADD FULLTEXT INDEX ft_enquiries (name, email, message);
ALTER TABLE guest_reviews ADD FULLTEXT INDEX ft_reviews_text (review_text);
ALTER TABLE bookings ADD FULLTEXT INDEX ft_bookings (name, email, address, notes);
ALTER TABLE guests ADD FULLTEXT INDEX ft_guests (name, email);
ALTER TABLE expenses ADD FULLTEXT INDEX ft_expenses (category, description);
ALTER TABLE waitlist ADD FULLTEXT INDEX ft_waitlist (name, email, note);
-- A payment is found by its amount: the exact figure, read from an index.
ALTER TABLE payments ADD INDEX idx_amount (amount);
