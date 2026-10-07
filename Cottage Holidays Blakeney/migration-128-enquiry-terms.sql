-- ============================================================
--  migration-128 — the price and plan agreed with an enquirer are KEPT.
--
--  They lived only on the owner's phone (the in-memory enquiry object), so any
--  data refresh before approval quietly dropped them and the approval charged
--  the standard price on the standard plan — after the owner had been told
--  "approving will charge £400". Stored on the enquiry; approval reads them.
-- ============================================================
ALTER TABLE enquiries ADD COLUMN agreed_price DECIMAL(10,2) NULL, ADD COLUMN plan_pct DECIMAL(5,2) NULL, ADD COLUMN plan_due DATE NULL;
