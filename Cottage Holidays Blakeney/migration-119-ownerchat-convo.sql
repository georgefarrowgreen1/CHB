-- CONVERSATIONS, not one endless thread. Every ownerchat row names which
-- conversation it belongs to, so "New conversation" starts fresh WITHOUT
-- destroying the old one — the rail on the AI chat page lists them and any
-- device can pick one up. Existing rows all land in conversation 1, which
-- is exactly what they were. One guarded ALTER (the house migration rule);
-- the index serves the per-conversation read chat_thread makes.
ALTER TABLE ownerchat_msgs
    ADD COLUMN convo INT NOT NULL DEFAULT 1,
    ADD INDEX idx_convo (convo, id);
