-- THE NAME ON A NEW EMAIL IS KEPT. The Inbox's New email writes to someone the app
-- may not know yet, and the owner types their name beside the address; the Sent
-- record kept only the address, so once the email went the Inbox named that person
-- by their address until they wrote back. NULL for every email sent before this
-- and for replies, whose person already has a name.
ALTER TABLE mail_sent ADD COLUMN to_name VARCHAR(80) NULL DEFAULT NULL;
