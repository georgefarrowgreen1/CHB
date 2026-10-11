-- NEWSLETTER SIGN-UPS ARE CONFIRMED BY EMAIL (double opt-in). The footer form put
-- any address it was given on the list at once, and re-subscribing an address that
-- had unsubscribed simply switched it back on: anyone could sign a stranger up, or
-- undo their unsubscribe. A sign-up now waits until the link emailed to the address
-- is opened (confirmed_at), and the broadcast goes only to confirmed addresses.
-- confirm_sent_at notes the last confirmation email, for the Newsletter page.
ALTER TABLE newsletter_subscribers ADD COLUMN confirmed_at DATETIME NULL;
ALTER TABLE newsletter_subscribers ADD COLUMN confirm_sent_at DATETIME NULL;
-- Everyone already on the list stays on it: they joined under the old rules, and
-- asking them to confirm again would quietly empty the list.
UPDATE newsletter_subscribers SET confirmed_at = created_at WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL;
