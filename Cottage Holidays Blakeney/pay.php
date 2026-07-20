<?php
// ============================================================
//  pay.php — guest-facing online payment (public, pay-token gated).
//  POST {action:'summary', booking_id, token, kind}
//       -> amount due (deposit or balance), computed server-side, + booking summary
//  POST {action:'charge', booking_id, token, kind, source_id}
//       -> charge the Square card token via the Payments API, reconcile the booking
//  No login: the unguessable pay_token (db.php) authorises paying THIS booking only.
//  The amount is ALWAYS derived on the server; the client never sends an amount.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

$in = body();
$action = $in['action'] ?? '';

if (!square_enabled()) {
    json_out(['error' => 'Online payment is not available right now.'], 503);
}

$bookingId = (int) ($in['booking_id'] ?? 0);
$token = clean($in['token'] ?? '');
$kind = in_array($in['kind'] ?? 'deposit', ['deposit', 'balance', 'hold'], true) ? $in['kind'] : 'deposit';

// Validate the pay token before touching anything.
if ($bookingId <= 0 || !hash_equals(pay_token($bookingId), $token)) {
    json_out(['error' => 'This payment link is invalid or has expired.'], 403);
}

// Rate-limit the money-moving actions per IP so a leaked pay link can't be used
// to card-test (submit many card tokens). Summary is read-only, so it's exempt.
if ($action === 'charge' || $action === 'authorize') {
    rate_limit('pay', 20, 10);
}

$b = (function ($id) {
    $s = db()->prepare('SELECT * FROM bookings WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch();
})($bookingId);
if (!$b) {
    json_out(['error' => 'Booking not found.'], 404);
}

// Effective total = manual override if set, else the locked agreed total
// (fall back to a live calc only for legacy rows missing the snapshot).
$rate = get_rate($b['prop_key']);
if ($b['agreed_total'] !== null) {
    $total = $b['price_override'] !== null ? (float) $b['price_override'] : (float) $b['agreed_total'];
} else {
    if (!$rate) {
        json_out(['error' => 'Property not found'], 404);
    }
    $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
    $total = $p['total'];
}
$total = round($total, 2);

// Deposit policy: a global percentage in the content table (default 25%).
$depPct = square_deposit_pct();
$depositAmount = round($total * ($depPct / 100), 2);
$alreadyPaid = round((float) ($b['deposit_paid'] ?? 0), 2);

// Refundable damages deposit (bundled into the first payment). Use the frozen
// snapshot; fall back to a live calc ONLY for legacy rows that have no snapshot at
// all (agreed_total === null). A MODERN row that carries a snapshot but a
// deliberately-waived (£0) deposit must be honoured as £0 — the old `<= 0` gate
// second-guessed it into the property standard, charging (and then stranding) a
// deposit the owner had waived.
$holdAmount = round((float) ($b['agreed_booking_fee'] ?? 0), 2);
if ($b['agreed_total'] === null && $rate) {
    $pp = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
    $holdAmount = round((float) $pp['damagesDeposit'], 2);
}
$holdStatus = $b['hold_status'] ?? 'none';

// Refundable damage deposit is now CHARGED upfront (bundled into the guest's first
// rental payment) and refunded after checkout once the owner approves. It's taken
// once — only for a fresh booking that hasn't gone down the legacy card-hold route
// (hold_status 'none'). Tracked on the booking via the reused hold_* columns
// (hold_status becomes 'charged' → 'returned'/'kept').
$damagesDue = $holdStatus === 'none' ? $holdAmount : 0.0;

// Amount due for this request, derived from kind (never trusted from the client).
if ($kind === 'hold') {
    $amountDue = in_array($holdStatus, ['authorized', 'captured'], true) ? 0.0 : $holdAmount;
} else {
    $amountDue =
        $kind === 'balance' ? round(max(0, $total - $alreadyPaid), 2) : round(max(0, $depositAmount - $alreadyPaid), 2);
}

$propName = $rate['name'] ?? $b['prop_key'];

if ($action === 'summary') {
    json_out([
        'ok' => true,
        'propName' => $propName,
        'propKey' => $b['prop_key'], // for the cottage accent chip on the pay screen
        'guestName' => $b['name'],
        'checkIn' => $b['check_in'],
        'checkOut' => $b['check_out'],
        'currency' => 'GBP',
        'kind' => $kind,
        'total' => $total,
        'alreadyPaid' => $alreadyPaid,
        'balance' => round(max(0, $total - $alreadyPaid), 2),
        'depositPct' => $depPct,
        'amountDue' => $amountDue,
        // The refundable damage deposit bundled into (and charged with) this payment.
        'damagesDue' => $damagesDue,
        'holdAmount' => $holdAmount,
        'holdStatus' => $holdStatus,
    ]);
}

// Place a refundable card HOLD for the damages deposit (authorise, do NOT capture).
// Square holds the funds; the owner later captures (if damage) or releases it.
if ($action === 'authorize') {
    if ($kind !== 'hold') {
        json_out(['error' => 'Wrong action for this payment.'], 400);
    }
    $sourceId = clean($in['source_id'] ?? '');
    if ($sourceId === '') {
        json_out(['error' => 'Missing card details — please try again.'], 400);
    }
    if ($holdAmount <= 0) {
        json_out(['error' => 'No security deposit is required for this booking.'], 409);
    }
    // Also refuse when the deposit was CHARGED with the first payment (new
    // model) or already settled after the stay — a legacy authorise here
    // would overwrite hold_payment_id and orphan the charged deposit's refund.
    if (in_array($holdStatus, ['authorized', 'captured', 'charged', 'returned', 'kept'], true)) {
        json_out(['error' => 'The security deposit for this booking is already in place or settled.'], 409);
    }

    // Serialise + re-read the hold state under the lock so two concurrent submits
    // can't both place a Square auth (the pre-lock check above is a stale snapshot).
    if (!book_lock($b['prop_key'])) {
        json_out(['error' => 'This booking is being processed — please wait a moment and try again.'], 409);
    }
    $hs = db()->prepare('SELECT hold_status FROM bookings WHERE id = ?');
    $hs->execute([$bookingId]);
    if (in_array((string) ($hs->fetchColumn() ?: 'none'), ['authorized', 'captured', 'charged', 'returned', 'kept'], true)) {
        book_unlock($b['prop_key']);
        json_out(['error' => 'The security deposit for this booking is already in place or settled.'], 409);
    }

    $pence = (int) round($holdAmount * 100);
    $ref = 'CHBHOLD-' . str_pad(substr(preg_replace('/\D/', '', (string) $bookingId), -6), 6, '0', STR_PAD_LEFT);
    $res = square_api('POST', '/v2/payments', [
        'source_id' => $sourceId,
        'idempotency_key' => 'chb-h-' . $bookingId . '-' . substr(hash('sha256', $sourceId), 0, 20),
        'amount_money' => ['amount' => $pence, 'currency' => 'GBP'],
        'autocomplete' => false, // AUTHORISE only — funds held, not captured
        'location_id' => SQUARE_LOCATION_ID,
        'reference_id' => $ref,
        'note' => "Refundable damage hold for {$propName} ({$b['check_in']} to {$b['check_out']})",
        'buyer_email_address' => $b['email'] ?: null,
    ]);
    $payment = $res['body']['payment'] ?? null;
    $ok =
        in_array($res['status'], [200, 201], true) &&
        $payment &&
        in_array($payment['status'] ?? '', ['APPROVED', 'AUTHORIZED'], true);
    if (!$ok) {
        book_unlock($b['prop_key']);
        $detail = $res['body']['errors'][0]['detail'] ?? 'Your card couldn\'t be authorised. Please try another card.';
        json_out(['error' => $detail], 402);
    }
    $sqId = (string) $payment['id'];
    try {
        db()
            ->prepare(
                'UPDATE bookings SET hold_payment_id = ?, hold_status = ?, hold_amount = ?, hold_authorized_at = NOW() WHERE id = ?',
            )
            ->execute([$sqId, 'authorized', $holdAmount, $bookingId]);
    } catch (\Throwable $e) {
        book_unlock($b['prop_key']);
        json_out(['error' => 'Hold authorised but could not be recorded — please contact us.'], 500);
    }
    book_unlock($b['prop_key']);
    try {
        require_once __DIR__ . '/webpush.php';
        alert_owner('Damage hold placed', '£' . number_format($holdAmount, 2) . ' held · ' . $propName);
    } catch (\Throwable $e) {
    }
    log_activity(
        'payment',
        'hold.authorize',
        'Damage-deposit hold placed — £' . number_format($holdAmount, 2) . ($b['name'] ? ' · ' . $b['name'] : ''),
        ['actor' => 'guest', 'prop_key' => $b['prop_key'], 'entity' => 'booking', 'entity_id' => (string) $bookingId],
    );
    json_out(['ok' => true, 'held' => $holdAmount]);
}

if ($action === 'charge') {
    $sourceId = clean($in['source_id'] ?? '');
    if ($sourceId === '') {
        json_out(['error' => 'Missing card details — please try again.'], 400);
    }
    // Gate on the FULL charge (rental + bundled damages deposit), mirroring the
    // under-lock $chargeTotal check below. Rental settled off-Square leaves
    // $amountDue at 0 while the deposit is still uncollected — a rental-only
    // gate here made that deposit permanently unchargeable online.
    if ($amountDue + $damagesDue <= 0) {
        json_out(['error' => 'This booking is already paid in full.'], 409);
    }

    if (!book_lock($b['prop_key'])) {
        // Couldn't get the per-cottage lock (another charge for this booking is in
        // flight) — refuse rather than risk a double-charge.
        json_out(['error' => 'This booking is being processed — please wait a moment and try again.'], 409);
    }

    // Re-read paid amount under the lock. Take the MAX of the bookings row and the
    // payments LEDGER (deposit+balance − refunds): the ledger row is written right
    // after Square confirms, so if a prior charge succeeded at Square but the process
    // died before the bookings UPDATE, the ledger still has it — this recovers that
    // and makes the retry compute £0 due instead of charging a second time.
    $fresh = db()->prepare('SELECT deposit_paid FROM bookings WHERE id = ?');
    $fresh->execute([$bookingId]);
    $bookingPaid = round((float) ($fresh->fetchColumn() ?: 0), 2);
    $ledgerPaid = 0.0;
    try {
        $lp = db()->prepare("SELECT
                COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
              - COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount ELSE 0 END),0)
            FROM payments WHERE booking_id = ?");
        $lp->execute([$bookingId]);
        $ledgerPaid = round(max(0, (float) $lp->fetchColumn()), 2);
    } catch (\Throwable $e) {
        // payments table not migrated — fall back to the bookings figure
    }
    $nowPaid = round(min($total, max($bookingPaid, $ledgerPaid)), 2);
    $amountDue =
        $kind === 'balance' ? round(max(0, $total - $nowPaid), 2) : round(max(0, $depositAmount - $nowPaid), 2);
    // Re-read the deposit state under the lock so a retry can't double-charge it.
    $freshHold = db()->prepare('SELECT hold_status FROM bookings WHERE id = ?');
    $freshHold->execute([$bookingId]);
    $damagesDue = ((string) ($freshHold->fetchColumn() ?: 'none')) === 'none' ? $holdAmount : 0.0;
    // Charge the rental portion PLUS the refundable deposit (once, upfront).
    $chargeTotal = round($amountDue + $damagesDue, 2);
    if ($chargeTotal <= 0) {
        book_unlock($b['prop_key']);
        json_out(['error' => 'This booking is already paid in full.'], 409);
    }

    $pence = (int) round($chargeTotal * 100);
    $ref = 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string) $bookingId), -6), 6, '0', STR_PAD_LEFT);
    $res = square_api('POST', '/v2/payments', [
        'source_id' => $sourceId,
        // Derive the idempotency key from the card token so an accidental resubmit of
        // the SAME tokenised card collapses at Square into one charge (a genuine
        // retry with a fresh card gets a fresh token → a new key, as it should).
        'idempotency_key' => 'chb-c-' . $bookingId . '-' . $kind . '-' . substr(hash('sha256', $sourceId), 0, 20),
        'amount_money' => ['amount' => $pence, 'currency' => 'GBP'],
        'location_id' => SQUARE_LOCATION_ID,
        'reference_id' => $ref,
        'note' => ucfirst($kind) . " for {$propName} ({$b['check_in']} to {$b['check_out']})",
        'buyer_email_address' => $b['email'] ?: null,
    ]);

    $payment = $res['body']['payment'] ?? null;
    $ok =
        in_array($res['status'], [200, 201], true) &&
        $payment &&
        in_array($payment['status'] ?? '', ['COMPLETED', 'APPROVED'], true);
    if (!$ok) {
        book_unlock($b['prop_key']);
        $detail =
            $res['body']['errors'][0]['detail'] ??
            ($res['body']['error'] ?? 'Payment was declined. Please check your card and try again.');
        // Best-effort: alert the owner (push) so they can follow up on a failed card payment.
        try {
            require_once __DIR__ . '/webpush.php';
            alert_owner(
                'Card payment declined',
                ($b['name'] ?: 'A guest') .
                    ' — ' .
                    $propName .
                    ': ' .
                    ucfirst($kind) .
                    ' £' .
                    number_format($amountDue, 2) .
                    ' was declined.',
            );
        } catch (\Throwable $e) {
            /* never let an alert break the response */
        }
        log_activity(
            'payment',
            'payment.declined',
            'Card ' . $kind . ' declined — £' . number_format($amountDue, 2) . ($b['name'] ? ' · ' . $b['name'] : ''),
            ['severity' => 'warn', 'actor' => 'guest', 'prop_key' => $b['prop_key'], 'entity' => 'booking', 'entity_id' => (string) $bookingId, 'meta' => ['detail' => mb_substr((string) $detail, 0, 150)]],
        );
        json_out(['error' => $detail], 402);
    }

    // Reconcile: record the ledger row (idempotent on square_payment_id) and move
    // the booking's headline payment state forward.
    $sqId = (string) $payment['id'];
    // The processing fee is usually computed later (back-filled by the webhook),
    // but record it now if Square already returned it.
    $fee = null;
    if (!empty($payment['processing_fee']) && is_array($payment['processing_fee'])) {
        $cents = 0;
        foreach ($payment['processing_fee'] as $pf) {
            $cents += (int) ($pf['amount_money']['amount'] ?? 0);
        }
        $fee = round($cents / 100, 2);
    }
    // Ledger records the RENTAL portion only (income). The refundable deposit is
    // tracked separately on the booking via hold_* so it's never counted as rental
    // and can be refunded in full against this same Square payment later.
    if ($amountDue > 0) {
        try {
            db()
                ->prepare(
                    'INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, guest_name, prop_key, created_at)
                           VALUES (?,?,?,?,?,?,?,NOW())',
                )
                ->execute([$bookingId, $sqId, $kind, $amountDue, $payment['status'], $b['name'], $b['prop_key']]);
            if ($fee !== null) {
                try {
                    db()
                        ->prepare('UPDATE payments SET fee = ? WHERE square_payment_id = ?')
                        ->execute([$fee, $sqId]);
                } catch (\Throwable $eFee) {
                    /* fee column not migrated yet — ignore */
                }
            }
        } catch (\Throwable $e) {
            /* table missing — booking update below still applies */
        }
    }
    // Mark the refundable deposit as collected (charged), pointing at the Square
    // payment it rode on so we can refund it after checkout.
    if ($damagesDue > 0) {
        try {
            db()
                ->prepare(
                    'UPDATE bookings SET hold_payment_id = ?, hold_status = ?, hold_amount = ?, hold_authorized_at = NOW() WHERE id = ?',
                )
                ->execute([$sqId, 'charged', $damagesDue, $bookingId]);
        } catch (\Throwable $e) {
        }
    }

    $newPaid = round(min($total, $nowPaid + $amountDue), 2);
    $newStatus = $newPaid >= $total - 0.001 ? 'paid' : ($newPaid > 0 ? 'deposit' : 'unpaid');
    db()
        ->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_method=?, payment_date=? WHERE id=?')
        ->execute([$newStatus, $newPaid, 'Square card', date('Y-m-d'), $bookingId]);

    book_unlock($b['prop_key']);

    log_activity(
        'payment',
        'payment.card',
        ucfirst($kind) .
            ' paid by card — £' .
            number_format($amountDue, 2) .
            ($damagesDue > 0 ? ' + £' . number_format($damagesDue, 2) . ' refundable deposit' : '') .
            ($b['name'] ? ' · ' . $b['name'] : ''),
        ['actor' => 'guest', 'prop_key' => $b['prop_key'], 'entity' => 'booking', 'entity_id' => (string) $bookingId],
    );

    // The payment is fully recorded above — everything from here is
    // notification, so it runs AFTER the guest's "payment successful" response
    // is flushed (mail_after_response): the receipt + owner emails are SMTP
    // handshakes and the pushes are external HTTP calls, and none of them
    // should keep the guest staring at the card-payment spinner.
    require_once __DIR__ . '/mailer.php';
    mail_after_response(function () use ($b, $propName, $ref, $kind, $amountDue, $total, $newPaid, $newStatus, $damagesDue, $bookingId) {
        // Receipt email (best-effort — never fails the payment).
        try {
            $receipt = send_payment_receipt([
                'name' => $b['name'],
                'email' => $b['email'],
                'prop_key' => $b['prop_key'],
                'prop_name' => $propName,
                'ref' => $ref,
                'kind' => $kind,
                'amount' => $amountDue,
                'total' => $total,
                'paid_so_far' => $newPaid,
                'balance' => round(max(0, $total - $newPaid), 2),
                'fully_paid' => $newStatus === 'paid',
                // Refundable deposit taken with this payment (refunded after checkout).
                'deposit_charged' => $damagesDue,
                // Signed link to the guest invoice — reflects this payment.
                'invoice_url' => site_base_url() . 'invoice.php?b=' . (int) $bookingId . '&token=' . invoice_token((int) $bookingId),
            ]);
            // Record the receipt so it shows in the Bookings page email log.
            if (is_array($receipt) && !empty($receipt['ok'])) {
                log_activity(
                    'comms',
                    'email.receipt',
                    'Payment receipt emailed — £' . number_format($amountDue, 2) . ($b['name'] ? ' · ' . $b['name'] : ''),
                    ['actor' => 'guest', 'prop_key' => $b['prop_key'], 'entity' => 'booking', 'entity_id' => (string) $bookingId],
                );
            }
        } catch (\Throwable $e) {
        }

        // Notify the owner that money has landed (best-effort).
        try {
            send_owner_payment_notice([
                'name' => $b['name'],
                'prop_key' => $b['prop_key'],
                'prop_name' => $propName,
                'kind' => $kind,
                'amount' => $amountDue,
                'status' => $newStatus,
            ]);
        } catch (\Throwable $e) {
        }
        // Wake the owner's devices (best-effort).
        try {
            require_once __DIR__ . '/webpush.php';
            alert_owner('Payment received', '£' . number_format($amountDue, 2) . ' · ' . $propName);
        } catch (\Throwable $e) {
        }
        // And confirm to the guest on their own device (best-effort, no-op if none).
        try {
            $msg =
                $newStatus === 'paid'
                    ? 'Paid in full — thank you! We look forward to welcoming you.'
                    : 'We\'ve received £' . number_format($amountDue, 2) . ' — thank you.';
            notify_guest_email($b['email'], 'Payment received', $msg, './');
        } catch (\Throwable $e) {
        }
    });

    // 'charged' is what the CARD was actually charged (rental + bundled damages
    // deposit) — the figure the guest just saw on the Pay button. 'paid' stays
    // the rental portion for compatibility.
    json_out(['ok' => true, 'status' => $newStatus, 'paid' => $amountDue, 'charged' => $chargeTotal, 'fullyPaid' => $newStatus === 'paid']);
}

json_out(['error' => 'Unknown action'], 400);
