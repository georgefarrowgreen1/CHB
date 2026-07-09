<?php
// ============================================================
//  enquiry-actions.php — the approve / decline logic, as functions.
//
//  Extracted verbatim from enquiries.php so the SAME code path serves both
//  the admin inbox (enquiries.php, admin session) and the one-tap links in
//  the owner's notification email (enquiry-action.php, signed token). This
//  is booking-creation code — keep one copy, never fork it.
//
//  Include after db.php + pricing.php. Functions return arrays:
//    ['ok'=>true, ...]  or  ['error'=>'…', 'code'=>4xx]
// ============================================================
if (!function_exists('db')) {
    http_response_code(404);
    exit();
} // library, not an endpoint

// The HMAC that authorises an email action link for one enquiry + one action.
function enquiry_action_token($id, $action)
{
    return hash_hmac('sha256', 'enq-action|' . (int) $id . '|' . $action, APP_SECRET);
}

function enquiry_decline($id)
{
    db()
        ->prepare('DELETE FROM enquiries WHERE id = ?')
        ->execute([(int) $id]);
    return ['ok' => true];
}

// $priceOverride: optional agreed total (£) negotiated with the guest — parity
// with the manual Add Booking's "Override total price". Null/blank/≤0 = standard.
function enquiry_approve($id, $priceOverride = null)
{
    $id = (int) $id;
    $priceOverride =
        $priceOverride !== null && $priceOverride !== '' && (float) $priceOverride > 0
            ? round((float) $priceOverride, 2)
            : null;
    $stmt = db()->prepare('SELECT * FROM enquiries WHERE id = ?');
    $stmt->execute([$id]);
    $e = $stmt->fetch();
    if (!$e) {
        return ['error' => 'Enquiry not found', 'code' => 404];
    }

    $rate = get_rate($e['prop_key']);
    if (!$rate) {
        return ['error' => 'Property not found', 'code' => 404];
    }
    // get_rate() happily returns archived cottages — the public form rejects
    // them, so approval must too (restore the cottage first).
    if (function_exists('prop_is_archived') && prop_is_archived($e['prop_key'])) {
        return ['error' => 'That cottage has been removed from the site — restore it (Settings → Preferences) before approving.', 'code' => 400];
    }
    if (!book_lock($e['prop_key'])) {
        // Genuine lock timeout — proceeding would skip the concurrent-approval
        // protection, so refuse rather than risk a double booking.
        return ['error' => 'The calendar is busy with another booking for this cottage — please try again in a moment.', 'code' => 409];
    }
    // Don't approve onto dates that have since been taken (a confirmed booking or an
    // imported Airbnb/Vrbo block).
    if (dates_clash($e['prop_key'], $e['check_in'], $e['check_out'])) {
        book_unlock($e['prop_key']);
        return [
            'error' =>
                'Those dates are no longer available — another booking now overlaps them. Please decline or adjust this enquiry.',
            'code' => 409,
        ];
    }
    $p = price_breakdown($rate, $e['adults'], $e['children'], $e['check_in'], $e['check_out']);
    // Agreed-price parity with the manual add: the override becomes the agreed
    // total AND is stored in price_override, so confirmation emails, the payment
    // request (booking_amount_due) and the money views all follow the same figure.
    $agreedTotal = $priceOverride !== null ? $priceOverride : $p['total'];
    $today = date('Y-m-d');

    db()
        ->prepare(
            'INSERT INTO bookings
        (prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,notes,payment,
         agreed_total,agreed_per_night,agreed_nights,agreed_nightly,agreed_booking_fee,agreed_txn_pct,agreed_txn_fee,agreed_on,
         terms_accepted_at,terms_version,sms_opt_in,price_override)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        ->execute([
            $e['prop_key'],
            $e['name'],
            $e['email'],
            $e['phone'],
            $e['address'] ?? '',
            $e['postcode'] ?? '',
            $e['check_in'],
            $e['check_out'],
            $e['check_in_time'],
            $e['check_out_time'],
            $e['adults'],
            $e['children'],
            $e['message'] ?: 'Approved from enquiry inbox.',
            'unpaid',
            $agreedTotal,
            $p['perNight'],
            $p['nights'],
            $p['nightly'],
            $p['damagesDeposit'],
            $p['transactionPct'],
            $p['txFee'],
            $today,
            $e['terms_accepted_at'] ?? null,
            $e['terms_version'] ?? null,
            $e['sms_opt_in'] ?? 0,
            $priceOverride,
        ]);
    $bookingId = db()->lastInsertId();
    db()
        ->prepare('DELETE FROM enquiries WHERE id = ?')
        ->execute([$id]);
    book_unlock($e['prop_key']); // free before the (slower) email send

    // A booking was born — record it like the manual-add path does, so the
    // audit trail covers bookings however they're created.
    log_activity(
        'booking',
        'booking.add',
        'Booking created from enquiry — ' .
            ($e['name'] ?? '') .
            ($priceOverride !== null ? ' (agreed price £' . number_format($priceOverride, 2) . ')' : ''),
        [
            'prop_key' => $e['prop_key'] ?? '',
            'entity' => 'booking',
            'entity_id' => (string) $bookingId,
        ],
    );

    // Heads-up (non-blocking): enquiry emails are validated at submit NOW, but
    // older enquiries weren't — flag an undeliverable-looking address so the
    // owner knows the confirmation may not arrive, without blocking approval.
    $emailCheck = null;
    if (!empty($e['email']) && function_exists('email_deliverability')) {
        try {
            $chk = email_deliverability($e['email']);
            if (empty($chk['ok'])) {
                $emailCheck =
                    '“' . $e['email'] . '” may not receive email' .
                    (!empty($chk['suggest']) ? ' — did they mean ' . $chk['suggest'] . '?' : '') .
                    ' Check the address on the booking.';
            }
        } catch (\Throwable $ex) {
        }
    }

    // Send confirmation emails (guest + owner). Wrapped so an email problem
    // never breaks the approval — the booking is already saved above.
    $emailResult = null;
    try {
        require_once __DIR__ . '/mailer.php';
        $newId = (int) $bookingId;
        $ref = 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string) $newId), -6), 6, '0', STR_PAD_LEFT);
        $emailResult = send_booking_emails([
            'name' => $e['name'],
            'email' => $e['email'],
            'phone' => $e['phone'] ?? '',
            'prop_key' => $e['prop_key'],
            'prop_name' => $rate['name'] ?? $e['prop_key'],
            'address' => $rate['address'] ?? '',
            'check_in' => $e['check_in'],
            'check_out' => $e['check_out'],
            'check_in_time' => $e['check_in_time'] ?? '15:00',
            'check_out_time' => $e['check_out_time'] ?? '10:00',
            'nights' => $p['nights'],
            'per_night' => $p['perNight'],
            'nightly' => $p['nightly'],
            'tx_pct' => $p['transactionPct'],
            'tx_fee' => $p['txFee'],
            'adults' => $e['adults'],
            'children' => $e['children'],
            'total' => $agreedTotal,
            'damages_deposit' => $p['damagesDeposit'] ?? 0,
            'payment' => 'unpaid',
            'ref' => $ref,
            // The approval page reports the GUEST result; the owner copy goes
            // out after the response instead of blocking the confirmation page.
            'defer_owner' => true,
        ]);
    } catch (\Throwable $ex) {
        $emailResult = ['error' => 'Mail step skipped: ' . $ex->getMessage()];
    }
    // Visible in the per-booking email log (the approval's confirmation was
    // previously invisible there — only the manual re-send button logged).
    if (is_array($emailResult) && !empty($emailResult['guest']['ok'])) {
        log_activity('comms', 'email.confirmation', 'Booking confirmation emailed — ' . ($e['name'] ?? ''), [
            'prop_key' => $e['prop_key'] ?? '',
            'entity' => 'booking',
            'entity_id' => (string) $bookingId,
        ]);
    }

    // Best-effort: push the guest "booking confirmed" if they have an account +
    // a subscribed device. Never blocks the approval (no-op without either).
    try {
        require_once __DIR__ . '/webpush.php';
        notify_guest_email(
            $e['email'],
            'Booking confirmed 🎉',
            ($rate['name'] ?? 'Your cottage') . ' · ' . $e['check_in'] . ' to ' . $e['check_out'],
            './',
        );
    } catch (\Throwable $ex) {
    }

    // Auto payment request (Square): on approval ask the guest for the 25% deposit —
    // or, if check-in is already inside the balance window (default 30 days), ask for
    // the full amount upfront. The scheduled job (payments-due.php) chases the balance
    // ~a month before check-in for the staged bookings. Never blocks the approval.
    $paymentRequest = null;
    if (square_enabled() && !empty($e['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $nb = db()->prepare('SELECT * FROM bookings WHERE id = ?');
            $nb->execute([(int) $bookingId]);
            $bk = $nb->fetch();
            if ($bk) {
                $daysToCheckIn = (int) floor((strtotime($bk['check_in']) - strtotime(date('Y-m-d'))) / 86400);
                $withinWindow = $daysToCheckIn < payment_balance_days();
                $kind = $withinWindow ? 'balance' : 'deposit';
                $paymentRequest = request_booking_payment($bk, $kind);
                if (!empty($paymentRequest['ok'])) {
                    // Visible in the per-booking email log.
                    log_activity('payment', 'payment.request', ucfirst($kind) . ' payment request emailed — ' . ($e['name'] ?? ''), [
                        'prop_key' => $e['prop_key'] ?? '',
                        'entity' => 'booking',
                        'entity_id' => (string) $bookingId,
                    ]);
                }
                // If we asked for everything now, mark the balance as already requested
                // so the scheduled job never double-asks.
                if (!empty($paymentRequest['ok']) && $withinWindow) {
                    try {
                        db()
                            ->prepare('UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')
                            ->execute([(int) $bookingId]);
                    } catch (\Throwable $e2) {
                    }
                }
                // Deposit asked for now (check-in still far off): record when, so the
                // abandoned-payment recovery in payments-due.php can chase it once if it
                // goes unpaid. Harmless if the column isn't migrated yet.
                if (!empty($paymentRequest['ok']) && !$withinWindow) {
                    try {
                        db()
                            ->prepare('UPDATE bookings SET deposit_requested_at = NOW() WHERE id = ?')
                            ->execute([(int) $bookingId]);
                    } catch (\Throwable $e2) {
                    }
                }
            }
        } catch (\Throwable $ex) {
            $paymentRequest = ['ok' => false, 'error' => $ex->getMessage()];
        }
    }

    return [
        'ok' => true,
        'booking_id' => (int) $bookingId,
        'email' => $emailResult,
        'payment_request' => $paymentRequest,
        // Non-blocking deliverability heads-up (null when the address looks fine).
        'email_check' => $emailCheck,
    ];
}
