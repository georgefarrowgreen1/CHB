-- migration-108-autopay-instalments.sql — a consented balance may be collected
-- in MONTHLY INSTALMENTS instead of one payment on the due date.
--
--   autopay_instalments  how many collections the GUEST AGREED to (NULL or 1 =
--                        the original single collection — every existing row
--                        keeps its exact behaviour). When > 1, autopay_amount
--                        re-reads as the agreed PER-INSTALMENT ceiling; a
--                        collection may take less (a guest who pays some by
--                        hand shrinks the remainder), never more.
--   autopay_next_at      the next collection date. Advances after each
--                        successful collection; NULL once the schedule is done
--                        (or for single-collection rows, which key on
--                        autopay_due as they always did).
--   autopay_offer        the OWNER's say over what the deposit screen offers:
--                        NULL = derive automatically, 0 = never offer monthly,
--                        2..4 = offer exactly that many. The offer is only ever
--                        an offer — nothing collects until the guest agrees and
--                        saves a card.
--
-- The schedule itself is DERIVED (booking_instalment_offer in pricing.php),
-- never stored: the payments ledger is already the record of what was taken,
-- and a stored schedule would be a second answer to "how much have they paid".
--
-- Guarded plain ADD COLUMNs — migrate.php treats a duplicate-column error as
-- already-applied.

ALTER TABLE bookings ADD COLUMN autopay_instalments TINYINT NULL;
ALTER TABLE bookings ADD COLUMN autopay_next_at DATE NULL;
ALTER TABLE bookings ADD COLUMN autopay_offer TINYINT NULL;
