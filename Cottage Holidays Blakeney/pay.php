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
// A HINT, never the answer — booking_payment_kind derives the stage below.
// Anything unrecognised (and, crucially, an ABSENT one: a pay link no longer
// names a stage) becomes null = "no preference". NB the old form read
// `in_array($in['kind'] ?? 'deposit', …) ? $in['kind'] : 'deposit'`, which
// tested the DEFAULT and then returned the RAW value — so a posted null passed
// the test and came straight back out as null.
$reqKind = $in['kind'] ?? null;
$reqKind = in_array($reqKind, ['deposit', 'balance', 'hold'], true) ? $reqKind : null;

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
// The amount was already server-derived; the KIND is too. A pay link names no
// stage at all now — booking_payment_kind reads it off the booking, so ONE link
// asks for whatever the plan wants next and keeps doing so as the plan moves on.
// Only ever UPWARDS, and never for the legacy 'hold' flow.
$kind = booking_payment_kind($b, $reqKind);

// ONE ask derivation. This block used to re-derive total/deposit/already-paid
// inline — a second copy of booking_amount_due's arithmetic (pricing.php), the
// exact two-copies shape behind most of this codebase's money drift. The emails
// (request_booking_payment) and the cron chasers already quote booking_amount_due,
// so delegating makes it impossible for the ask in the email and the charge on
// this screen to disagree. The one behaviour kept from the inline copy: a legacy
// row with no snapshot AND no property rate is a hard 404 here (the helper
// returns total 0, which as a charge would read "already settled" — a lie).
$rate = get_rate($b['prop_key']);
if ($b['agreed_total'] === null && !$rate) {
    json_out(['error' => 'Property not found'], 404);
}
$amt = booking_amount_due($b, $kind === 'hold' ? 'deposit' : $kind);
$total = $amt['total'];
$alreadyPaid = $amt['alreadyPaid'];
// Deposit policy: the BOOKING'S OWN figure (per-booking plan, else the global
// percentage) via the one helper booking_amount_due itself reads. The pre-lock
// due figures come from $amt; $depositAmount is still needed by the UNDER-LOCK
// recompute at charge time, which re-derives the due figure against a fresh
// paid read so a retry cannot double-charge (deleting it here left that
// recompute reading an undefined £0 — caught before it shipped). Reading the
// global pct here would let the charge disagree with the ask whenever a custom
// deposit is set — the exact drift the delegation above exists to prevent.
$depositAmount = booking_deposit_amount($b, $total);

// Refundable damages deposit — CHARGED upfront, bundled into the guest's first
// rental payment and refunded after checkout once the owner approves. Taken ONCE:
// only for a booking that hasn't gone down the legacy card-hold route
// (hold_status 'none'), tracked on the reused hold_* columns. Both figures come
// from booking_damages_due (pricing.php), which was this block — moved so the
// guest's ACCOUNT can name the same charge this screen is about to make.
$holdStatus = $b['hold_status'] ?? 'none';
$holdAmount = booking_damages_amount($b, $rate ?: null); // the deposit itself
$damagesDue = booking_damages_due($b, $rate ?: null);     // …and how much rides THIS charge

// Amount due for this request, derived from kind (never trusted from the client).
// The rental asks are booking_amount_due's own figure ($amt); only the legacy
// 'hold' flow keeps its special case (the hold IS the deposit, not a rental ask).
if ($kind === 'hold') {
    $amountDue = in_array($holdStatus, ['authorized', 'captured'], true) ? 0.0 : $holdAmount;
} else {
    $amountDue = $amt['due'];
}

$propName = $rate['name'] ?? $b['prop_key'];

if ($action === 'summary') {
    // THE WAY BACK IN after a failed collection: whenever a live consent has a
    // failed try recorded, the screen renders the repair card, whose save-a-card
    // action touches no money. 'stale' is not card-repairable (the terms moved,
    // not the card) and 'settled' has nothing left, so neither invites it.
    $apAttempts = (int) ($b['autopay_attempts'] ?? 0);
    $apStateNow = booking_autopay_state($b);
    $apRepair = null;
    if (!empty($b['autopay_consent_at']) && empty($b['autopay_revoked_at']) && $apAttempts > 0 && !in_array($apStateNow[0], ['settled', 'stale'], true)) {
        $apRetryDays = defined('AUTOPAY_RETRY_DAYS') ? AUTOPAY_RETRY_DAYS : 1;
        $apLastTry = substr((string) ($b['autopay_last_try'] ?? ''), 0, 10);
        $apRepair = [
            'stopped' => $apAttempts >= AUTOPAY_MAX_TRIES,
            'why' => (string) ($b['autopay_last_error'] ?? ''),
            'monthly' => (int) ($b['autopay_instalments'] ?? 0) > 1,
            // When the collector will present the card again — null once stopped
            // (it will not) or before any try is stamped.
            'retry' => $apAttempts >= AUTOPAY_MAX_TRIES || $apLastTry === '' ? null : date('Y-m-d', strtotime($apLastTry . ' +' . $apRetryDays . ' days')),
        ];
    }
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
        // WHEN it falls due, from the booking's own plan (custom date wins,
        // else check-in minus the window) — the screen said how much and
        // never when.
        'balanceDueDate' => booking_balance_due_date($b),
        // The EFFECTIVE share, derived from the booking's own deposit figure —
        // under a per-booking plan the global pct is not what this screen is
        // charging, and the itemised sub-line ("£267.00 deposit (30%)") must
        // describe the ask in front of the guest, not the site default.
        'depositPct' => $total > 0 ? round($depositAmount / $total * 100) : square_deposit_pct(),
        'amountDue' => $amountDue,
        // The refundable damage deposit bundled into (and charged with) this payment.
        'damagesDue' => $damagesDue,
        // WHAT THE GUEST IS ABOUT TO AGREE TO, signed. The charge re-derives its
        // own figure under the booking lock and takes THAT — this only lets it
        // notice that the sum has moved since this screen was drawn (an edited
        // plan, a changed price, another payment landing) and stop instead of
        // charging a number the guest never read. See payment_quote_sign.
        'quote' => payment_quote_sign($bookingId, $kind, round($amountDue + $damagesDue, 2)),
        // PAYING PART OF IT. The bounds come from the server so the screen that
        // offers it and the charge that clamps it cannot disagree; null means
        // there is nothing to part-pay (settled, or already under the floor).
        // The legacy hold is excluded — it is one authorisation, not a balance.
        'part' => $kind === 'hold' ? null : booking_part_bounds($amountDue),
        // WHAT THE CHECKBOX WOULD PROMISE, or null when there is nothing to
        // schedule — in which case it must not be OFFERED, rather than offered
        // and quietly doing nothing. booking_autopay_terms derives it the same
        // way this screen quotes the money, so the two can never disagree.
        'autopayTerms' => booking_autopay_terms($b),
        'autopayState' => booking_autopay_state($b)[0],
        // The MONTHLY offer (or null) — derived server-side so the screen that
        // shows it and the charge that validates the guest's pick read the
        // same object. The legacy hold is one authorisation, never a schedule.
        'instalmentOffer' => $kind === 'hold' ? null : booking_instalment_offer($b),
        // …and the one ALREADY taken (charged with the first payment, or a
        // captured/kept legacy hold), so the pay screen's "of £X total · £Y
        // already paid" can fold it into both sides — the guest whose card took
        // £225 was shown "£175.00 already paid" of a "£700.00 total" here while
        // every other document said £225 of £750. The balance is unmoved.
        'depositCharged' => in_array($holdStatus, ['charged', 'captured', 'kept'], true) ? $holdAmount : 0.0,
        'holdAmount' => $holdAmount,
        'holdStatus' => $holdStatus,
        'autopayRepair' => $apRepair,
    ]);
}

// TURNING IT OFF. Rides the pay token the guest already holds, so there is no new
// endpoint and no new way in — and it is deliberately available on the same screen
// that offered it. A standing permission you can only cancel by emailing someone
// is not one most people would give.
if ($action === 'autopay_off') {
    require_once __DIR__ . '/autopay-lib.php';
    autopay_revoke($bookingId);
    log_activity('payment', 'autopay.revoked', 'Automatic payment switched off by the guest', [
        'actor' => 'guest',
        'entity' => 'booking',
        'entity_id' => (string) $bookingId,
    ]);
    json_out(['ok' => true, 'autopayState' => 'revoked']);
}

// A NEW CARD FOR THE PLAN — the repair the failure email points at. Touches no
// money: autopay_replace_card stores the tokenised card against the existing
// consent and resets the tries; the collector resumes on its own tick. Rides
// the pay token like autopay_off (no new way in), refuses in words and a 400
// so the screen can show them verbatim, and never invents a consent — a
// booking without a live one is refused inside the lib.
if ($action === 'update_card') {
    require_once __DIR__ . '/autopay-lib.php';
    $r = autopay_replace_card($b, (string) ($in['source_id'] ?? ''));
    if (empty($r['ok'])) {
        json_out(['error' => $r['reason'] !== '' ? $r['reason'] : 'Could not save the card'], 400);
    }
    json_out([
        'ok' => true,
        'say' => 'Card updated — the plan carries on, and nothing was charged today.',
        // The state as it now stands, so the screen can re-render without a
        // second round trip (the lib reset the tries and cleared the error).
        'autopayState' => booking_autopay_state(array_merge($b, ['autopay_card_id' => $r['card_id'], 'autopay_attempts' => 0, 'autopay_last_error' => null]))[0],
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
        // What to DO, keyed on Square's error code — never their raw prose.
        $detail = payment_decline_message(
            $res['body']['errors'][0]['code'] ?? '',
            'Your card could not be authorised. Please try another card.',
        );
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
        alert_owner('Damage hold placed', '£' . number_format($holdAmount, 2) . ' held · ' . $propName, ['category' => 'money', 'tag' => 'booking-' . (int) $bookingId, 'url' => './?open=booking-' . (int) $bookingId]);
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
    // Re-read deposit_paid UNDER THE LOCK, then take the shared paid-so-far figure —
    // the fresh read is what stops a retry double-charging, and the shared helper is
    // what stops this diverging from the quote the guest was shown.
    $fresh = db()->prepare('SELECT deposit_paid FROM bookings WHERE id = ?');
    $fresh->execute([$bookingId]);
    $bookingPaid = round((float) ($fresh->fetchColumn() ?: 0), 2);
    $nowPaid = round(min($total, booking_paid_so_far(['id' => $bookingId, 'deposit_paid' => $bookingPaid])), 2);
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

    // THE FIGURE THE GUEST READ MUST BE THE FIGURE THAT LEAVES THEIR CARD. The
    // summary above signed what it displayed; if the amount has moved since, stop
    // — nothing is charged, and the client refetches so they can agree to the new
    // total. An absent quote proceeds exactly as this endpoint did before quotes
    // existed (a client too old to send one must still be able to pay), which
    // costs no guarantee: a quote can only ever refuse.
    if (payment_quote_check($in['quote'] ?? '', $bookingId, $kind, $chargeTotal) === false) {
        book_unlock($b['prop_key']);
        $shown = payment_quote_amount($in['quote'] ?? '', $bookingId, $kind);
        json_out(
            [
                'error' =>
                    'The amount has changed since this page loaded' .
                    ($shown !== null ? ' — it was £' . number_format($shown, 2) . ' and is now £' . number_format($chargeTotal, 2) : '') .
                    '. Nothing has been charged. Please check the new total and try again.',
                'code' => 'amount_changed',
                'chargeTotal' => $chargeTotal,
            ],
            409,
        );
    }

    // PART PAYMENT, APPLIED AFTER THE QUOTE HAS VERIFIED THE FULL FIGURE.
    // Order is the whole safety argument. The quote's job is "the figure the
    // guest read is the figure that leaves" — and what they READ on a part
    // payment is the balance, from which they chose a slice. So the balance is
    // checked against the signed quote FIRST; only then is their slice taken of
    // the amount that check just proved. Clamping before the check would let a
    // moved balance through unnoticed, because the part figure would no longer
    // be the one the quote describes.
    //
    // The client may ASK; booking_part_amount decides — the same rule as every
    // other figure here. And the refundable deposit does NOT ride a part
    // payment: bundling £50 onto a £20 slice makes the sum not what the guest
    // typed, and the deposit still rides the payment that completes the stage.
    // The screen's own ask, held BEFORE the clamp: `remaining` in the response
    // is this minus what was taken, so the done screen can offer the rest in
    // the same frame the guest was just reading ("£220.00 would remain").
    $fullCharge = $chargeTotal;
    $partReq = isset($in['part_amount']) ? (float) $in['part_amount'] : 0.0;
    $partial = false;
    if ($partReq > 0) {
        $part = booking_part_amount($partReq, $amountDue);
        if ($part !== null) {
            // A SLICE IS NOT ITS STAGE, and that fact is decided HERE — the one
            // place that knows the clamp fired. Every surface that describes
            // this payment named the STAGE, so £120 of a £290 balance read as
            // "your balance payment" two lines above "Remaining balance:
            // £220.00", and reached the owner as "Type: balance". The decision
            // is shared; each surface still says it in its own voice.
            // Judged against the SCREEN'S ask ($fullCharge), not the rental
            // alone: a slice typed at the max bound equals the rental due while
            // the refundable deposit it displaced is still to take — comparing
            // to $amountDue called that "not partial", so the guest the client
            // had just told "£50.00 would remain" got fullyPaid, remaining 0,
            // and nothing ever chased the deposit. Asking for the whole of what
            // this screen asked is still not a part payment (damages-free max
            // slice: the two figures are equal and nothing changes).
            $partial = $part < $fullCharge - 0.005;
            $amountDue = $part;
            $damagesDue = 0.0;
            $chargeTotal = round($amountDue, 2);
        }
    }
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
        // Same rule as the authorise branch above: the guest is told what to do
        // next, from the CODE. Square's `detail` is written for a developer.
        $detail = payment_decline_message(
            $res['body']['errors'][0]['code'] ?? '',
            'The payment was declined. Please check the card and try again.',
        );
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

    // THE CARD, IF THEY ASKED US TO KEEP IT. Deliberately after the money is
    // taken and the ledger is written, and wrapped so hard it cannot reach the
    // response: a convenience that turned a successful payment into an error
    // page would invite the guest to pay a second time. A failure here leaves
    // them exactly where they were — no consent, no card, chased as usual.
    // …BUT NEVER ON A SLICE. booking_autopay_terms describes the rest after the
    // FULL ask is paid; recorded beside a part payment, the agreed sum can never
    // match what booking_autopay_state derives at collection time, so the
    // arrangement would sit "agreed" and silently never fire — the exact
    // offered-and-quietly-doing-nothing promise the terms helper exists to
    // prevent. The client hides the offer while a slice is armed; this is the
    // server's half, for the stale tab or crafted request that sends both.
    // The OUTCOME of the arrangement, carried to the response: a guest who
    // just agreed to automatic payments must hear whether that WORKED — the
    // old shape logged a failed vault for the owner and told the guest
    // nothing, so they left believing something was arranged that was not.
    $apOutcome = null;
    if (!empty($in['autopay']) && !$partial) {
        $apOutcome = ['ok' => false];
        try {
            require_once __DIR__ . '/autopay-lib.php';
            // MONTHLY, only as offered: the client may ask for n instalments,
            // and booking_autopay_terms honours it only when it matches what
            // booking_instalment_offer derives — anything else returns null and
            // autopay_vault refuses, never guessing a consent the guest was not
            // shown. 0/absent keeps the single collection, byte for byte.
            $apN = (int) ($in['autopay_instalments'] ?? 0);
            $apTerms = booking_autopay_terms($b, $apN > 1 ? $apN : 1);
            $vault = autopay_vault($b, $sqId, $apTerms);
            if ($vault['ok'] && $apTerms) {
                $apOutcome = [
                    'ok' => true,
                    'monthly' => isset($apTerms['instalments']) && (int) $apTerms['instalments'] > 1,
                    'n' => (int) ($apTerms['instalments'] ?? 1),
                    'per' => round((float) $apTerms['amount'], 2),
                    'next' => $apTerms['next'] ?? null,
                    'due' => $apTerms['due'],
                ];
            } else {
                log_activity('payment', 'autopay.vault_failed', "Couldn't save the card for automatic payment — " . $vault['reason'], [
                    'severity' => 'info',
                    'entity' => 'booking',
                    'entity_id' => (string) $bookingId,
                ]);
            }
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
        ($partial ? 'Part payment by card — £' : ucfirst($kind) . ' paid by card — £') .
            number_format($amountDue, 2) .
            ($partial ? ' towards the ' . $kind : '') .
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
    mail_after_response(function () use ($b, $propName, $ref, $kind, $amountDue, $total, $newPaid, $newStatus, $damagesDue, $bookingId, $partial) {
        // Receipt email (best-effort — never fails the payment).
        try {
            $receipt = send_payment_receipt([
                'name' => $b['name'],
                'email' => $b['email'],
                'prop_key' => $b['prop_key'],
                'prop_name' => $propName,
                'ref' => $ref,
                'kind' => $kind,
                // A slice of the stage, not the stage — see the clamp above.
                'partial' => $partial,
                'amount' => $amountDue,
                'total' => $total,
                'paid_so_far' => $newPaid,
                'balance' => round(max(0, $total - $newPaid), 2),
                // A slice at the max bound settles the RENTAL while the
                // refundable deposit it displaced is still to take — "paid in
                // full" above "towards your balance" would be the receipt
                // contradicting itself, so a partial never claims it.
                'fully_paid' => $newStatus === 'paid' && !$partial,
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
                'partial' => $partial,
                'amount' => $amountDue,
                'status' => $newStatus,
            ]);
        } catch (\Throwable $e) {
        }
        // Wake the owner's devices (best-effort).
        try {
            require_once __DIR__ . '/webpush.php';
            alert_owner('Payment received', '£' . number_format($amountDue, 2) . ' · ' . $propName, ['category' => 'money', 'email' => true, 'tag' => 'booking-' . (int) $bookingId, 'url' => './?open=booking-' . (int) $bookingId]);
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
    // the rental portion for compatibility. 'remaining' is what is left OF THIS
    // SCREEN'S ASK after a slice (including the refundable deposit the slice
    // pushed to the next payment) — the same "£X would remain" the part hint
    // showed — so the done screen can offer to take the rest.
    json_out([
        'ok' => true,
        'status' => $newStatus,
        'paid' => $amountDue,
        'charged' => $chargeTotal,
        'fullyPaid' => $newStatus === 'paid',
        'remaining' => $partial ? round($fullCharge - $chargeTotal, 2) : 0,
        // The arrangement's outcome (null = none was asked for) — the done
        // screen speaks it, both ways round.
        'autopay' => $apOutcome,
    ]);
}

json_out(['error' => 'Unknown action'], 400);
