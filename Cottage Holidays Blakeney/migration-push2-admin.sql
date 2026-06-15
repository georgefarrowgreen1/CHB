-- Allow the owner (admin) to subscribe their own device(s) for push alerts
-- (new enquiries, messages, payments, and "new version deployed"). Guest rows
-- keep role='guest'; admin rows have guest_id NULL and role='admin'.
ALTER TABLE push_subscriptions ADD COLUMN role VARCHAR(10) NOT NULL DEFAULT 'guest';
ALTER TABLE push_subscriptions MODIFY guest_id INT NULL;
