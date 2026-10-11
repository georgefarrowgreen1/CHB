<?php
// ============================================================
//  booking-confirm-lib.php — the ONE booking confirmation.
//
//  send_booking_confirmation() was a function inside the bookings.php ROUTE,
//  so the enquiry approval (enquiry-actions.php) could not call it and composed
//  its own payload — without the plan's balance date, the invoice link or the
//  guest-register link (the UK hotel-records duty). Both routes now send this.
// ============================================================
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(404);
    exit();
}
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

if (!function_exists('booking_by_id')) {
    function booking_by_id($id)
    {
        $s = db()->prepare('SELECT * FROM bookings WHERE id = ?');
        $s->execute([$id]);
        return $s->fetch();
    }
}

function send_booking_confirmation($bookingId, $guestOnly = false, $deferOwner = false, $skipGuest = false)
{
    try {
        $b = booking_by_id((int) $bookingId);
        if (!$b) {
            return ['error' => 'Booking not found'];
        }
        $rate = get_rate($b['prop_key']);
        require_once __DIR__ . '/mailer.php';

        // Prefer the locked agreed figures; fall back to a live calc if missing.
        if ($b['agreed_total'] !== null) {
            $nights = (int) $b['agreed_nights'];
            $perNight = (float) $b['agreed_per_night'];
            $nightly = (float) $b['agreed_nightly'];
            $txPct = (float) $b['agreed_txn_pct'];
            $txFee = (float) $b['agreed_txn_fee'];
            $deposit = (float) $b['agreed_booking_fee'];
            $total = booking_agreed_total($b);
        } else {
            if (!$rate) {
                return ['error' => 'Property rate not found'];
            }
            $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            $nights = $p['nights'];
            $perNight = $p['perNight'];
            $nightly = $p['nightly'];
            $txPct = $p['transactionPct'];
            $txFee = $p['txFee'];
            $deposit = $p['damagesDeposit'];
            $total = $p['total'];
        }
        $ref = 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string) $bookingId), -6), 6, '0', STR_PAD_LEFT);

        // Paid-so-far / balance for the confirmation. MUST mirror the JS
        // displayGrand()/depositCharged() (app.js) so the email agrees with the
        // invoice + My Stays: the refundable deposit is only "paid" when actually
        // collected (Square → hold_status 'charged'/'captured'/'kept'); a manual
        // cash/bank payment leaves it 'none', so it isn't counted.
        $holdStatus = $b['hold_status'] ?? 'none';
        $depAmt = in_array($holdStatus, ['returned', 'released'], true) ? 0.0 : (float) $deposit;
        $grand = round($total + $depAmt, 2);
        $rentalPaid = $b['payment'] === 'paid' ? $total : min($total, (float) ($b['deposit_paid'] ?? 0));
        $chargedDep = in_array($holdStatus, ['charged', 'captured', 'kept'], true) ? $depAmt : 0.0;
        // A CASH deposit counts as paid too — what was recorded ABOVE the rental,
        // capped at the agreed deposit (damages_collected's own arithmetic; JS
        // mirror displayGrand). hold_status is a card-rail fact cash never sets,
        // and $rentalPaid caps at the total — so a re-sent confirmation for a
        // guest who handed over £750 in cash said "Paid so far £700 · Balance
        // remaining £50" about a settled stay. Zero for legacy folded totals
        // (paid never exceeds the total there).
        $cashDep = $holdStatus === 'none'
            ? min($depAmt, max(0.0, round((float) ($b['deposit_paid'] ?? 0) - $total, 2)))
            : 0.0;
        $paidSoFar = round($rentalPaid + $chargedDep + $cashDep, 2);
        $balanceDue = round(max(0, $grand - $paidSoFar), 2);

        return send_booking_emails([
            'name' => $b['name'],
            'email' => $b['email'],
            'phone' => $b['phone'] ?? '',
            'prop_key' => $b['prop_key'],
            'prop_name' => $rate['name'] ?? $b['prop_key'],
            'address' => $rate['address'] ?? '',
            'check_in' => $b['check_in'],
            'check_out' => $b['check_out'],
            'check_in_time' => $b['check_in_time'] ?? '15:00',
            'check_out_time' => $b['check_out_time'] ?? '10:00',
            'nights' => $nights,
            'per_night' => $perNight,
            'nightly' => $nightly,
            'tx_pct' => $txPct,
            'tx_fee' => $txFee,
            'adults' => $b['adults'],
            'children' => $b['children'],
            'total' => $total,
            'damages_deposit' => $deposit,
            'payment' => $b['payment'],
            // The guest's rail (payment_rail reads this): a cash/BACS guest's
            // re-sent confirmation must offer bank details, not a Square card
            // link. Omitting it left the rail guard reading '' → 'card' always.
            'payment_method' => $b['payment_method'] ?? '',
            'ref' => $ref,
            // The booking's own id, so the confirmation can sign a pay link and
            // the owner copy can link straight to the hub. Without it both
            // features are dead code guarded on a key nobody passed.
            'id' => (int) $bookingId,
            // What a queued copy is about, so a retry after the stay moved or was
            // cancelled is not sent (email_outbox_wanted).
            'outbox_ref' => email_booking_ref($b),
            // Payment state so the confirmation reflects money received (shown only
            // when something has been paid; a fresh unpaid booking omits it).
            'paid_so_far' => $paidSoFar,
            'balance_due' => $balanceDue,
            // WHEN the rest falls due, from this booking's own plan. The
            // confirmation stated how much was outstanding and never by when,
            // so the schedule the owner agreed existed only in the back office.
            'balance_due_date' => booking_balance_due_shown($b),
            'grand_total' => $grand,
            // Suppress the owner copy on a re-send after a payment.
            'skip_owner' => $guestOnly,
            // Send the owner copy after the HTTP response (booking-add flow).
            'defer_owner' => $deferOwner,
            // The Add-booking sheet's "Email the confirmation" switch, turned off:
            // the owner copy still goes, the guest's does not.
            'skip_guest' => $skipGuest,
            // Signed link to the guest-viewable HTML invoice (invoice.php).
            'invoice_url' => site_base_url() . 'invoice.php?b=' . (int) $bookingId . '&token=' . invoice_token((int) $bookingId),
            // Signed link to the guest-registration form (UK hotel-records duty).
            'guest_reg_url' => site_base_url() . 'guest-details.php?b=' . (int) $bookingId . '&token=' . guest_reg_token((int) $bookingId),
        ]);
    } catch (\Throwable $ex) {
        return ['error' => 'Mail step skipped: ' . $ex->getMessage()];
    }
}
