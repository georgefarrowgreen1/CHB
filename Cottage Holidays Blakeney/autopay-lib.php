<?php
// ============================================================
//  autopay-lib.php — SAVE THE CARD, THEN COLLECT THE BALANCE ON THE DAY.
//
//  migration-105 recorded the guest's permission and pricing.php's
//  booking_autopay_state() decides whether it still holds. This is the half that
//  acts: vaulting the card at the moment they agree, and charging it when the
//  agreed day arrives.
//
//  The whole feature is built around one asymmetry. Not collecting a balance is
//  an inconvenience — the ordinary chase still exists and still works. Charging
//  someone who did not agree, or charging them twice, or charging a figure they
//  never saw, is a different kind of failure entirely. So every judgement here
//  leans the same way: when unsure, DON'T take the money.
//
//  It is a lib for the reason sweep-lib / payouts-lib / bank-lib are: the
//  routing endpoints call require_admin() and exit, so a test that required one
//  could not drive it. Square goes through square_api(), which the gate stubs.
// ============================================================

// NB no require of db.php or pricing.php, matching payouts-lib / sweep-lib: the
// endpoints that use this already load both, and a lib that pulls in db.php
// cannot be driven by a test that stubs db(). That constraint is the reason the
// house pattern exists, and this file is the code most worth being able to drive.

// How long a soft failure waits before trying again. A day, not a cron tick:
// the pass runs more than once and a "temporary" error retried six times in an
// hour is not a retry policy, it is the same failure six times.
const AUTOPAY_RETRY_DAYS = 1;
// The most bookings one pass will collect. Serial, capped, and DECLARED in what
// it returns, for the reason the bulk chase is serial: simultaneous charges
// invite a rate limit, and a stampede makes a partial failure impossible to
// attribute.
const AUTOPAY_RUN_MAX = 20;

// ---- IS THIS FAILURE WORTH TRYING AGAIN? ------------------------------------
// 'hard'  — the card said no, and it will say no tomorrow. Stop, tell everyone,
//           and hand back to the ordinary chase.
// 'soft'  — something got in the way that has nothing to do with the card.
//           Worth one more go tomorrow.
// The default is HARD, deliberately. An unrecognised decline retried three times
// is three presentations of a card that may be refusing for a reason the guest
// would rather we noticed the first time; an unrecognised blip treated as final
// merely falls back to the chase that would have happened anyway.
function autopay_decline_kind($code)
{
    $soft = [
        'TEMPORARY_ERROR', // Square's own "try again"
        'RATE_LIMITED',
        'GATEWAY_TIMEOUT',
        'SERVICE_UNAVAILABLE',
        'INTERNAL_SERVER_ERROR',
        'PAYMENT_LIMIT_EXCEEDED', // a per-day ceiling — tomorrow is a new day
    ];
    return in_array(strtoupper(trim((string) $code)), $soft, true) ? 'soft' : 'hard';
}

// May this booking be TRIED today? Separate from booking_autopay_may_charge,
// which asks whether the arrangement holds at all: this asks whether we have
// already had a go today. Without it every cron tick is another presentation.
function autopay_try_due($b, $today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    if (!booking_autopay_may_charge($b, $today)) {
        return false;
    }
    $last = substr((string) ($b['autopay_last_try'] ?? ''), 0, 10);
    if ($last === '') {
        return true;
    }
    return $today >= ukShiftDaysPhp($last, AUTOPAY_RETRY_DAYS);
}

// Date arithmetic anchored at UTC noon, so a DST hour cannot move the calendar
// date — the PHP twin of app.js's ukShiftDays, and the same trap it documents.
function ukShiftDaysPhp($iso, $days)
{
    $t = strtotime(substr((string) $iso, 0, 10) . ' 12:00:00 UTC');
    return $t === false ? (string) $iso : gmdate('Y-m-d', $t + (int) $days * 86400);
}

// ---- VAULTING: turning a payment into a card we may charge again ------------
// Square will not store a card from thin air; it stores one from a SOURCE, and
// a completed payment is a valid source. That is why this runs after the charge
// rather than instead of it — the guest pays their deposit exactly as they
// always did, and the card that paid it is what gets saved.
//
// It returns a reason rather than throwing, because of the rule at the top of
// this file inverted: THE PAYMENT MUST NEVER BE LOST BECAUSE THE CONVENIENCE
// FAILED. pay.php calls this after the money is already taken and the ledger is
// already written; a throw here would turn a successful payment into an error
// page and invite the guest to pay again.
function autopay_vault($b, $squarePaymentId, $terms)
{
    $bad = function ($why) {
        return ['ok' => false, 'reason' => $why, 'card_id' => '', 'customer_id' => ''];
    };
    if (!function_exists('square_enabled') || !square_enabled()) {
        return $bad('Square payments are not switched on');
    }
    $pid = trim((string) $squarePaymentId);
    if ($pid === '') {
        return $bad('No payment to save the card from');
    }
    // NO TERMS, NO CONSENT. booking_autopay_terms returns null when there is
    // nothing to schedule, and a saved card with no agreed sum or date is a
    // stored card the guest was never asked about.
    if (!is_array($terms) || !isset($terms['amount'], $terms['due'])) {
        return $bad('There is nothing to schedule');
    }
    $bookingId = (int) ($b['id'] ?? 0);
    if ($bookingId <= 0) {
        return $bad('No booking');
    }
    // A CUSTOMER PER BOOKING, not per guest. Square hangs a stored card off a
    // customer record; reusing one across a guest's bookings would let consent
    // given for one stay authorise a charge on another.
    $cust = trim((string) ($b['autopay_customer_id'] ?? ''));
    if ($cust === '') {
        $res = square_api('POST', '/v2/customers', [
            'idempotency_key' => 'chb-cust-' . $bookingId,
            'given_name' => (string) ($b['name'] ?? 'Guest'),
            'email_address' => (string) ($b['email'] ?? ''),
            'reference_id' => 'CHB-' . $bookingId,
        ]);
        $cust = (string) ($res['body']['customer']['id'] ?? '');
        if ($cust === '') {
            return $bad(autopay_square_why($res, "Square wouldn't set up the card"));
        }
    }
    $res = square_api('POST', '/v2/cards', [
        'idempotency_key' => 'chb-card-' . $bookingId . '-' . substr(sha1($pid), 0, 12),
        'source_id' => $pid,
        'card' => [
            'customer_id' => $cust,
            'reference_id' => 'CHB-' . $bookingId,
        ],
    ]);
    $cardId = (string) ($res['body']['card']['id'] ?? '');
    if ($cardId === '') {
        return $bad(autopay_square_why($res, "Square wouldn't save the card"));
    }
    // Consent and its TERMS are written in one statement, because a consent with
    // no terms beside it is the one state booking_autopay_state cannot judge.
    // COALESCE on the timestamp so re-paying never re-dates an older agreement.
    try {
        db()
            ->prepare(
                'UPDATE bookings SET autopay_customer_id = ?, autopay_card_id = ?, autopay_amount = ?, autopay_due = ?,
                    autopay_consent_at = COALESCE(autopay_consent_at, NOW()), autopay_revoked_at = NULL,
                    autopay_attempts = 0, autopay_last_error = NULL
                 WHERE id = ?',
            )
            ->execute([$cust, $cardId, round((float) $terms['amount'], 2), substr((string) $terms['due'], 0, 10), $bookingId]);
    } catch (\Throwable $e) {
        return $bad('Could not record the arrangement');
    }
    return ['ok' => true, 'reason' => '', 'card_id' => $cardId, 'customer_id' => $cust];
}

// Square's own words where it gave any, ours where it did not. Never the raw
// body: a failed request's body can carry internals, and this string is shown.
function autopay_square_why($res, $fallback)
{
    $code = (string) ($res['body']['errors'][0]['code'] ?? '');
    $detail = trim((string) ($res['body']['errors'][0]['detail'] ?? ''));
    if ($code !== '' && function_exists('payment_decline_message')) {
        return payment_decline_message($code, $detail !== '' ? $detail : $fallback);
    }
    return $detail !== '' ? $detail : $fallback;
}

// The guest, or the owner on their behalf, turning it off. Recorded rather than
// cleared: "they agreed and then changed their mind" must stay distinguishable
// from "they never agreed", which is an audit trail on money.
function autopay_revoke($bookingId)
{
    try {
        db()
            ->prepare('UPDATE bookings SET autopay_revoked_at = NOW() WHERE id = ? AND autopay_revoked_at IS NULL')
            ->execute([(int) $bookingId]);
        return true;
    } catch (\Throwable $e) {
        return false;
    }
}

// ---- COLLECTING ------------------------------------------------------------
// One booking, all the way. Returns ['ok'|'skip'|'fail', sentence] — 'skip' is
// not a failure and must not count an attempt, because the commonest reason to
// skip is that the arrangement no longer applies (they paid by other means).
function autopay_collect_one($b, $today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $bookingId = (int) ($b['id'] ?? 0);
    if (!autopay_try_due($b, $today)) {
        return ['skip', 'Not due to be tried today'];
    }
    // UNDER THE LOCK, exactly as pay.php charges. Everything before this point
    // was read outside it, and between the read and now a guest can have paid
    // through their own link — which is the case that would double-charge.
    if (!book_lock($b['prop_key'])) {
        return ['skip', 'Another payment for this cottage is in flight'];
    }
    try {
        $fresh = db()->prepare('SELECT * FROM bookings WHERE id = ?');
        $fresh->execute([$bookingId]);
        $now = $fresh->fetch();
        if (!$now) {
            book_unlock($b['prop_key']);
            return ['skip', 'The booking is gone'];
        }
        // RE-ASKED UNDER THE LOCK, not re-used from above. The state is the whole
        // decision, and asking it again here is what makes the pre-lock read an
        // optimisation rather than the thing being trusted.
        $state = booking_autopay_state($now, $today);
        if ($state[0] !== 'armed') {
            book_unlock($b['prop_key']);
            return ['skip', $state[1]];
        }
        $kind = booking_payment_kind($now);
        $amt = booking_amount_due($now, $kind === 'hold' ? 'deposit' : $kind);
        $damages = booking_damages_due($now);
        $charge = round($amt['due'] + $damages, 2);
        // The agreed figure is checked by booking_autopay_state above; this is the
        // floor that stops a zero or negative ever reaching Square.
        if ($charge <= 0.005) {
            book_unlock($b['prop_key']);
            return ['skip', 'Nothing left to collect'];
        }
        $res = square_api('POST', '/v2/payments', [
            // DETERMINISTIC, and keyed on the booking + the sum + the day. A retry
            // of the same attempt collapses at Square rather than charging twice;
            // a genuinely different collection does not.
            'idempotency_key' => 'chb-auto-' . $bookingId . '-' . $today . '-' . (int) round($charge * 100),
            'source_id' => (string) $now['autopay_card_id'],
            'customer_id' => (string) $now['autopay_customer_id'],
            'amount_money' => ['amount' => (int) round($charge * 100), 'currency' => 'GBP'],
            'reference_id' => 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string) $bookingId), -6), 6, '0', STR_PAD_LEFT),
            'note' => 'Balance — ' . (string) ($now['name'] ?? ''),
            // MERCHANT-INITIATED, and it has to say so. This charge happens with
            // nobody at the keyboard, and telling the issuer otherwise is both
            // untrue and the thing that gets a card-on-file charge declined.
            'customer_details' => ['customer_initiated' => false],
            'location_id' => function_exists('square_location_id') ? square_location_id() : null,
        ]);
        $payment = $res['body']['payment'] ?? null;
        $st = (int) ($res['status'] ?? 0);
        if (!$payment || $st < 200 || $st >= 300) {
            $code = (string) ($res['body']['errors'][0]['code'] ?? '');
            $why = autopay_square_why($res, 'The payment did not go through');
            autopay_record_failure($bookingId, $today, $why, autopay_decline_kind($code));
            book_unlock($b['prop_key']);
            return ['fail', $why];
        }
        autopay_record_success($now, $payment, $amt['due'], $damages, $today);
        book_unlock($b['prop_key']);
        return ['ok', 'Collected £' . number_format($charge, 2) . ' from ' . (string) ($now['name'] ?? 'the guest')];
    } catch (\Throwable $e) {
        book_unlock($b['prop_key']);
        // An exception is OUR fault, not the card's — never counted as a decline,
        // or a bug here would exhaust a guest's three attempts without a single
        // request reaching Square.
        return ['skip', 'Could not complete the collection'];
    }
}

// A decline that will not change stops NOW: the attempt counter is taken
// straight to the cap so booking_autopay_state reports 'failed' and the ordinary
// chase takes over. A soft one costs a single attempt.
function autopay_record_failure($bookingId, $today, $why, $kind)
{
    try {
        $sql =
            $kind === 'hard'
                ? 'UPDATE bookings SET autopay_attempts = ?, autopay_last_try = ?, autopay_last_error = ? WHERE id = ?'
                : 'UPDATE bookings SET autopay_attempts = autopay_attempts + 1, autopay_last_try = ?, autopay_last_error = ? WHERE id = ?';
        $args = $kind === 'hard' ? [AUTOPAY_MAX_TRIES, $today, mb_substr($why, 0, 255), (int) $bookingId] : [$today, mb_substr($why, 0, 255), (int) $bookingId];
        db()->prepare($sql)->execute($args);
    } catch (\Throwable $e) {
    }
    try {
        log_activity('payment', 'autopay.failed', 'Automatic balance payment failed — ' . $why, [
            'severity' => 'warn',
            'entity' => 'booking',
            'entity_id' => (string) (int) $bookingId,
        ]);
    } catch (\Throwable $e) {
    }
}

// The same ledger row, deposit fold and status update pay.php writes, because
// this IS a payment for that booking and a second shape for it would be a second
// answer to "how much have they paid".
function autopay_record_success($b, $payment, $rental, $damages, $today)
{
    $bookingId = (int) $b['id'];
    $sqId = (string) ($payment['id'] ?? '');
    $fee = null;
    if (!empty($payment['processing_fee']) && is_array($payment['processing_fee'])) {
        $cents = 0;
        foreach ($payment['processing_fee'] as $pf) {
            $cents += (int) ($pf['amount_money']['amount'] ?? 0);
        }
        $fee = round($cents / 100, 2);
    }
    if ($rental > 0) {
        try {
            db()
                ->prepare(
                    'INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, fee, guest_name, prop_key, created_at)
                     VALUES (?,?,?,?,?,?,?,?,NOW())',
                )
                ->execute([$bookingId, $sqId, 'balance', $rental, payment_status_norm((string) ($payment['status'] ?? '')), $fee, $b['name'], $b['prop_key']]);
        } catch (\Throwable $e) {
        }
    }
    if ($damages > 0) {
        try {
            db()
                ->prepare('UPDATE bookings SET hold_payment_id = ?, hold_status = ?, hold_amount = ?, hold_authorized_at = NOW() WHERE id = ?')
                ->execute([$sqId, 'charged', $damages, $bookingId]);
        } catch (\Throwable $e) {
        }
    }
    try {
        // Read the paid figure back through the shared helper rather than adding
        // to a number carried in from before the lock — the one definition rule.
        $paid = round(booking_paid_so_far(['id' => $bookingId, 'deposit_paid' => (float) ($b['deposit_paid'] ?? 0)]) + $rental, 2);
        $total = round((float) ($b['price_override'] ?? 0) ?: (float) ($b['agreed_total'] ?? 0), 2);
        $status = $total > 0 && $paid >= $total - 0.001 ? 'paid' : ($paid > 0 ? 'deposit' : 'unpaid');
        db()
            ->prepare('UPDATE bookings SET deposit_paid = ?, payment_status = ?, autopay_last_try = ?, autopay_last_error = NULL WHERE id = ?')
            ->execute([$total > 0 ? min($total, $paid) : $paid, $status, $today, $bookingId]);
    } catch (\Throwable $e) {
    }
    try {
        log_activity('payment', 'autopay.collected', 'Balance collected automatically — £' . number_format($rental + $damages, 2) . ' · ' . (string) ($b['name'] ?? ''), [
            'severity' => 'info',
            'entity' => 'booking',
            'entity_id' => (string) $bookingId,
        ]);
    } catch (\Throwable $e) {
    }
}

// ---- THE DAILY PASS --------------------------------------------------------
// Serial, capped, and it reports what it did rather than running silently.
function autopay_run($today = null, $limit = AUTOPAY_RUN_MAX)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $out = ['ok' => true, 'collected' => 0, 'failed' => 0, 'skipped' => 0, 'lines' => [], 'truncated' => false];
    if (!function_exists('square_enabled') || !square_enabled()) {
        $out['ok'] = false;
        return $out;
    }
    try {
        // Narrowed in SQL to what could POSSIBLY be due — consent given, not
        // revoked, a card saved, still under the cap, due date reached — and
        // then judged properly in PHP. The SQL is an index, not the decision.
        $q = db()->prepare(
            "SELECT * FROM bookings
             WHERE autopay_consent_at IS NOT NULL AND autopay_revoked_at IS NULL
               AND autopay_card_id IS NOT NULL AND autopay_card_id <> ''
               AND autopay_attempts < " . AUTOPAY_MAX_TRIES . "
               AND autopay_due IS NOT NULL AND autopay_due <= ?
             ORDER BY autopay_due ASC LIMIT " . ((int) $limit + 1),
        );
        $q->execute([$today]);
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        $out['ok'] = false;
        return $out;
    }
    if (count($rows) > $limit) {
        $out['truncated'] = true;
        $rows = array_slice($rows, 0, $limit);
    }
    foreach ($rows as $b) {
        [$verdict, $line] = autopay_collect_one($b, $today);
        if ($verdict === 'ok') {
            $out['collected']++;
            $out['lines'][] = $line;
        } elseif ($verdict === 'fail') {
            $out['failed']++;
            $out['lines'][] = $line;
        } else {
            $out['skipped']++;
        }
    }
    return $out;
}
