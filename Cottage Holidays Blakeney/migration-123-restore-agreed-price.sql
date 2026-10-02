-- ============================================================
--  migration-123 — give a booking back the agreed price its Edit form took.
--
--  The Edit-booking form opened with its price-override, payment-method and
--  payment-date inputs BLANK (openEditBookingNow never fed them in) and saveModal
--  posts every one of them on every save — price_override as '' meaning "clear
--  it". So saving ANY edit, even a corrected phone number, silently dropped the
--  agreed price, wiped the payment method and re-dated the payment to today. The
--  inputs are hidden on a paid stay, so nothing looked wrong.
--
--  What that leaves behind is recognisable. An agreed price that was negotiated
--  (an enquiry's agreed price, or an Add-booking override) is stored as
--  agreed_total AND price_override. Losing the override leaves agreed_total at the
--  agreed figure while agreed_nightly + agreed_txn_fee — the standard price the
--  booking was snapshotted at — no longer add up to it. Every money screen then
--  disagreed with itself: set_payment and the emails treat the agreed total as
--  the rental, while the hub, damages_collected and the accounts measured a cash
--  deposit against the STANDARD rental, so a guest who had paid rental + deposit
--  in full still read as owing the deposit.
--
--  This restores price_override = agreed_total for exactly those rows, so the two
--  frames agree again. NO amount changes: the booking's total is agreed_total
--  either way.
--
--  Deliberately narrow:
--    * only rows with NO override at all (nothing is ever overwritten);
--    * only where the total matches NEITHER the standard rental NOR the standard
--      rental plus the refundable deposit (the older "deposit folded into the
--      total" shape), so a standard-priced or folded booking is never relabelled
--      custom;
--    * only where both snapshot lines exist (a half-snapshotted legacy row says
--      nothing about what the total should be — SQL's NULL arithmetic would
--      already exclude it; the explicit test keeps the intent if it is rewritten);
--    * only stays that are not over: history is left exactly as it was, because
--      accounts.php attributes past income against this figure and restating a
--      closed tax year is not this migration's business.
--
--  Idempotent: a repaired row has an override, so a re-run selects nothing. It is
--  DATA, so migrate.php?force=1 skips it (migration_stmt_is_schema), as it must.
-- ============================================================

UPDATE bookings
   SET price_override = agreed_total
 WHERE price_override IS NULL
   AND agreed_total IS NOT NULL
   AND agreed_total > 0
   AND agreed_nightly IS NOT NULL
   AND agreed_txn_fee IS NOT NULL
   AND check_out >= CURDATE()
   AND ABS((agreed_nightly + agreed_txn_fee) - agreed_total) > 0.005
   AND ABS((agreed_nightly + agreed_txn_fee + COALESCE(agreed_booking_fee, 0)) - agreed_total) > 0.005;
