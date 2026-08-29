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
// How many days before the charge the guest is told it is coming. Three, so an
// unwanted one can be stopped on a working day without the notice arriving so
// early it is forgotten by the time the money moves.
const AUTOPAY_NOTICE_DAYS = 3;

// ---- IS THIS FAILURE WORTH TRYING AGAIN? ------------------------------------
// 'hard'  — the card said no, and it will say no tomorrow. Stop, tell everyone,
//           and hand back to the ordinary chase.
// 'soft'  — something got in the way that has nothing to do with the card.
//           Worth one more go tomorrow.
// The default is HARD, deliberately. An unrecognised decline retried three times
// is three presentations of a card that may be refusing for a reason the guest
// would rather we noticed the first time; an unrecognised blip treated as final
// merely falls back to the chase that would have happened anyway.
// The hard declines we have a name for. Nothing branches on this list — a code
// in it and a code missing from it are both fatal — it exists so the log can say
// which failures are routine and which are new. Without that distinction the
// default-to-fatal rule hides the one case worth looking at.
const AUTOPAY_KNOWN_HARD = [
    'CARD_DECLINED',
    'CARD_DECLINED_VERIFICATION_REQUIRED',
    'CARD_EXPIRED',
    'INSUFFICIENT_FUNDS',
    'CVV_FAILURE',
    'ADDRESS_VERIFICATION_FAILURE',
    'INVALID_CARD',
    'INVALID_CARD_DATA',
    'GENERIC_DECLINE',
    'CARD_NOT_SUPPORTED',
    'ALLOWABLE_PIN_TRIES_EXCEEDED',
    'CARD_TOKEN_EXPIRED',
    'CARD_TOKEN_USED',
    'VOICE_FAILURE',
    'PAN_FAILURE',
];

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
    // MONTHLY terms carry `instalments` + `next` (booking_autopay_terms with
    // n > 1); a single collection writes NULLs, which is exactly what every
    // pre-instalment row already holds.
    $instalments = isset($terms['instalments']) && (int) $terms['instalments'] > 1 ? (int) $terms['instalments'] : null;
    $nextAt = $instalments !== null && !empty($terms['next']) ? substr((string) $terms['next'], 0, 10) : null;
    try {
        db()
            ->prepare(
                'UPDATE bookings SET autopay_customer_id = ?, autopay_card_id = ?, autopay_amount = ?, autopay_due = ?,
                    autopay_instalments = ?, autopay_next_at = ?,
                    autopay_consent_at = COALESCE(autopay_consent_at, NOW()), autopay_revoked_at = NULL,
                    autopay_attempts = 0, autopay_last_error = NULL, autopay_last_code = NULL
                 WHERE id = ?',
            )
            ->execute([$cust, $cardId, round((float) $terms['amount'], 2), substr((string) $terms['due'], 0, 10), $instalments, $nextAt, $bookingId]);
    } catch (\Throwable $e) {
        // migration-108 (or 107) not applied on this install. A MONTHLY consent
        // must NOT degrade to the old single-collection write — the stored
        // amount would be the per-instalment ceiling, and the state machine
        // would read a single plan promising a third of the money. Refuse, and
        // the ordinary chase carries on exactly as before.
        if ($instalments !== null) {
            return $bad('This install cannot record a monthly plan yet');
        }
        try {
            db()
                ->prepare(
                    'UPDATE bookings SET autopay_customer_id = ?, autopay_card_id = ?, autopay_amount = ?, autopay_due = ?,
                        autopay_consent_at = COALESCE(autopay_consent_at, NOW()), autopay_revoked_at = NULL,
                        autopay_attempts = 0, autopay_last_error = NULL, autopay_last_code = NULL
                     WHERE id = ?',
                )
                ->execute([$cust, $cardId, round((float) $terms['amount'], 2), substr((string) $terms['due'], 0, 10), $bookingId]);
        } catch (\Throwable $e1) {
            // migration-107 not applied either — record the arrangement without
            // the code column rather than refusing to save a card at all.
            try {
                db()
                    ->prepare(
                        'UPDATE bookings SET autopay_customer_id = ?, autopay_card_id = ?, autopay_amount = ?, autopay_due = ?,
                            autopay_consent_at = COALESCE(autopay_consent_at, NOW()), autopay_revoked_at = NULL,
                            autopay_attempts = 0, autopay_last_error = NULL
                         WHERE id = ?',
                    )
                    ->execute([$cust, $cardId, round((float) $terms['amount'], 2), substr((string) $terms['due'], 0, 10), $bookingId]);
            } catch (\Throwable $e2) {
                return $bad('Could not record the arrangement');
            }
        }
    }
    return ['ok' => true, 'reason' => '', 'card_id' => $cardId, 'customer_id' => $cust];
}

// A NEW CARD FOR AN EXISTING CONSENT — the repair half of the vault. The
// agreement (amount, dates, count) is untouched: only the card that pays it
// changes, the attempt counter resets, and the collector picks the plan up on
// its next tick. NOTHING IS CHARGED here — the source is a tokenised card,
// stored via /v2/cards exactly as the vault stores a payment's card. Refusals
// come back in words because pay.php shows them to the guest verbatim.
function autopay_replace_card($b, $sourceId)
{
    $bad = function ($why) {
        return ['ok' => false, 'reason' => $why, 'card_id' => ''];
    };
    if (!function_exists('square_enabled') || !square_enabled()) {
        return $bad('Card payments are not switched on');
    }
    $src = trim((string) $sourceId);
    if ($src === '') {
        return $bad('No card to save');
    }
    $bookingId = (int) ($b['id'] ?? 0);
    if ($bookingId <= 0) {
        return $bad('No booking');
    }
    // Only a LIVE consent is repairable. No consent means nothing was agreed;
    // a revoked one means the guest turned it off, and a new card must not
    // quietly turn it back on; a settled plan has nothing left to pay; and a
    // STALE plan's problem is the terms, not the card — a fresh card would arm
    // a schedule the guest never saw.
    if (empty($b['autopay_consent_at'])) {
        return $bad('There is no automatic payment set up on this booking');
    }
    if (!empty($b['autopay_revoked_at'])) {
        return $bad('Automatic payments were switched off — you can set them up again next time you pay');
    }
    $state = booking_autopay_state($b);
    if ($state[0] === 'settled') {
        return $bad('Nothing is left to collect — there is no plan to repair');
    }
    if ($state[0] === 'stale') {
        return $bad('The plan has changed since you agreed it — pay any time, or set it up again when you do');
    }
    // The same customer-per-booking rule the vault documents; a 'nocard' repair
    // may arrive before any customer exists, so it is created the same way.
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
        'idempotency_key' => 'chb-recard-' . $bookingId . '-' . substr(sha1($src), 0, 12),
        'source_id' => $src,
        'card' => [
            'customer_id' => $cust,
            'reference_id' => 'CHB-' . $bookingId,
        ],
    ]);
    $cardId = (string) ($res['body']['card']['id'] ?? '');
    if ($cardId === '') {
        return $bad(autopay_square_why($res, "Square wouldn't save the card"));
    }
    // Fresh card, fresh tries — the failed state exists to stop a refusing card
    // being presented for ever, and this is the one event that changes the card.
    // UNDER book_lock: the collector holds this same lock across its whole
    // read → Square → write, so a repair landing mid-collection blocks until the
    // collector's failure-write finishes and THEN resets the tries — otherwise a
    // hard-decline write (attempts = MAX) issued after our reset would silently
    // walk the plan back to 'stopped', undoing the card the guest just saved.
    $plock = (string) ($b['prop_key'] ?? '');
    $held = $plock !== '' && function_exists('book_lock') ? book_lock($plock) : false;
    try {
        db()
            ->prepare('UPDATE bookings SET autopay_customer_id = ?, autopay_card_id = ?, autopay_attempts = 0, autopay_last_error = NULL, autopay_last_code = NULL WHERE id = ?')
            ->execute([$cust, $cardId, $bookingId]);
    } catch (\Throwable $e) {
        try {
            db()
                ->prepare('UPDATE bookings SET autopay_customer_id = ?, autopay_card_id = ?, autopay_attempts = 0, autopay_last_error = NULL WHERE id = ?')
                ->execute([$cust, $cardId, $bookingId]);
        } catch (\Throwable $e2) {
            if ($held) {
                book_unlock($plock);
            }
            return $bad('Could not record the new card');
        }
    }
    if ($held) {
        book_unlock($plock);
    }
    try {
        log_activity('payment', 'autopay.card_updated', 'Guest saved a new card — the plan resumes', [
            'actor' => 'guest',
            'entity' => 'booking',
            'entity_id' => (string) $bookingId,
        ]);
    } catch (\Throwable $e) {
    }
    return ['ok' => true, 'reason' => '', 'card_id' => $cardId];
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
        // WHAT THIS COLLECTION MAY TAKE is one derivation (pricing.php): the
        // whole rest for a single collection; for a monthly plan the agreed
        // per-instalment ceiling — or the remainder once the final date has
        // arrived — capped either way by what is actually owed.
        $take = booking_autopay_collect_amount($now, $today);
        $damages = $take['damages'];
        $charge = $take['charge'];
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
            $failKind = autopay_decline_kind($code);
            autopay_record_failure($bookingId, $today, $why, $failKind, $code);
            // THE GUEST HEARS FIRST. A declined card is usually theirs to fix
            // (expired, reissued), and the person best placed to fix it is the
            // one reading the email — most plans repair themselves before the
            // third failure ever becomes the owner's duty. Sent on the FIRST
            // soft failure ("we'll try again") and on the failure that STOPS
            // the plan (a hard decline, or the soft one that reaches the cap);
            // the middle attempt is silence — they already know. Deduped by
            // construction: each attempt count is hit once, and a hard decline
            // jumps straight to the cap so no further tries follow. Best-effort
            // and wrapped — the failure is already recorded either way.
            $prior = (int) ($now['autopay_attempts'] ?? 0);
            $stopped = $failKind === 'hard' || $prior + 1 >= AUTOPAY_MAX_TRIES;
            if (($stopped || $prior === 0) && function_exists('send_autopay_failure')) {
                try {
                    // What is owed now, so the email's future rows show the real
                    // shrunk figures after a manual part-payment (the composer is
                    // otherwise DB-free and falls back to the ceiling).
                    $restNow = null;
                    if (function_exists('booking_amount_due') && function_exists('booking_payment_kind')) {
                        $rk = booking_payment_kind($now);
                        $rd = booking_amount_due($now, $rk === 'hold' ? 'deposit' : $rk);
                        $restNow = round((float) $rd['due'], 2);
                    }
                    send_autopay_failure($now, $why, $stopped, $today, $charge, $restNow);
                } catch (\Throwable $e) {
                }
            }
            book_unlock($b['prop_key']);
            return ['fail', $why];
        }
        autopay_record_success($now, $payment, $take['rental'], $damages, $today);
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
function autopay_record_failure($bookingId, $today, $why, $kind, $code = '')
{
    $code = mb_substr(strtoupper(trim((string) $code)), 0, 64);
    try {
        // The CODE is stored beside the prose. Only the sentence used to be kept,
        // and because an unrecognised code is fatal by default, one code Square
        // introduced later would stop collection for every booking it touched
        // and read in the log as N unrelated sentences instead of one pattern.
        $sql =
            $kind === 'hard'
                ? 'UPDATE bookings SET autopay_attempts = ?, autopay_last_try = ?, autopay_last_error = ?, autopay_last_code = ? WHERE id = ?'
                : 'UPDATE bookings SET autopay_attempts = autopay_attempts + 1, autopay_last_try = ?, autopay_last_error = ?, autopay_last_code = ? WHERE id = ?';
        $args = $kind === 'hard'
            ? [AUTOPAY_MAX_TRIES, $today, mb_substr($why, 0, 255), $code, (int) $bookingId]
            : [$today, mb_substr($why, 0, 255), $code, (int) $bookingId];
        db()->prepare($sql)->execute($args);
    } catch (\Throwable $e) {
        // Column not migrated on this install — record what we can rather than
        // losing the failure entirely.
        try {
            $sql =
                $kind === 'hard'
                    ? 'UPDATE bookings SET autopay_attempts = ?, autopay_last_try = ?, autopay_last_error = ? WHERE id = ?'
                    : 'UPDATE bookings SET autopay_attempts = autopay_attempts + 1, autopay_last_try = ?, autopay_last_error = ? WHERE id = ?';
            $args = $kind === 'hard' ? [AUTOPAY_MAX_TRIES, $today, mb_substr($why, 0, 255), (int) $bookingId] : [$today, mb_substr($why, 0, 255), (int) $bookingId];
            db()->prepare($sql)->execute($args);
        } catch (\Throwable $e2) {
        }
    }
    try {
        // An UNRECOGNISED code says so in the log line. A decline we have a name
        // for is routine; one we do not is the thing worth spotting twice.
        $known = $kind === 'soft' || in_array($code, AUTOPAY_KNOWN_HARD, true);
        log_activity(
            'payment',
            'autopay.failed',
            'Automatic balance payment failed — ' . $why . ($code !== '' ? ' [' . $code . ($known ? '' : ', not seen before') . ']' : ''),
            ['severity' => 'warn', 'entity' => 'booking', 'entity_id' => (string) (int) $bookingId, 'meta' => ['code' => $code, 'kind' => $kind]],
        );
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
    // READ WHAT WAS PAID *BEFORE* THE LEDGER ROW LANDS. booking_paid_so_far reads
    // booking_ledger_net, so once the INSERT below has run it ALREADY contains this
    // collection — adding $rental to a reading taken afterwards counts it twice, which
    // on a monthly plan makes deposit_paid run ahead of the money and the last
    // instalment is never collected. pay.php snapshots before its own INSERT for the
    // same reason.
    $prior = booking_paid_so_far(['id' => $bookingId, 'deposit_paid' => (float) ($b['deposit_paid'] ?? 0)]);
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
    // The paid figure comes from the shared helper — read ABOVE, before the ledger
    // row for this collection existed (see $prior).
    $paid = round($prior + $rental, 2);
    // Strict-null, not ?: — a £0 price override is a real price (a comped stay);
    // ?: read it as unset and fell back to agreed_total (booking_amount_due's
    // own comment documents the predicate; these sites sat outside that fix).
    $total = round((($b['price_override'] ?? null) !== null && $b['price_override'] !== '') ? (float) $b['price_override'] : (float) ($b['agreed_total'] ?? 0), 2);
    $status = $total > 0 && $paid >= $total - 0.001 ? 'paid' : ($paid > 0 ? 'deposit' : 'unpaid');
    // A MONTHLY plan advances to its next scheduled date (NULL once done) and
    // gets a fresh set of tries — each instalment earns its own three. Derived
    // from the same schedule the guest was shown; the date this collection was
    // FOR is the gate that admitted it.
    $gate = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10) ?: substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    $nextAt = booking_autopay_next_after($b, $gate !== '' ? $gate : $today);
    try {
        // autopay_collected_for (migration-122) records the DAY this collection
        // was FOR — the marker a single collection otherwise has none of, since
        // its autopay_next_at is NULL before and after. Without it, giving the
        // money back re-armed the spent consent and the card was charged again
        // the next night. Written in the same statement as the rest of the
        // outcome: a collection whose marker did not land is the state this
        // exists to prevent.
        db()
            ->prepare('UPDATE bookings SET deposit_paid = ?, payment = ?, autopay_last_try = ?, autopay_last_error = NULL, autopay_next_at = ?, autopay_collected_for = ?, autopay_attempts = 0 WHERE id = ?')
            ->execute([$total > 0 ? min($total, $paid) : $paid, $status, $today, $nextAt, $gate !== '' ? $gate : $today, $bookingId]);
    } catch (\Throwable $e) {
        // migration-108 not applied — keep the pre-instalment write so a single
        // collection still records exactly as it always did. NB the column is
        // `payment` (the ENUM), NOT `payment_status`: naming a column that does not
        // exist threw here AND in the fallback, and the inner catch swallowed it, so
        // a successful charge wrote NOTHING back — autopay_next_at never advanced and
        // the plan re-collected the next morning, and the one every morning after.
        try {
            db()
                ->prepare('UPDATE bookings SET deposit_paid = ?, payment = ?, autopay_last_try = ?, autopay_last_error = NULL WHERE id = ?')
                ->execute([$total > 0 ? min($total, $paid) : $paid, $status, $today, $bookingId]);
        } catch (\Throwable $e2) {
            // A swallowed write-back over a SUCCESSFUL charge is money taken with no
            // record — it must never be silent again.
            try {
                log_activity('payment', 'autopay.writeback_failed', 'Collected the money but could not record it against the booking — check this booking before the next daily run', [
                    'severity' => 'action',
                    'entity' => 'booking',
                    'entity_id' => (string) $bookingId,
                    'meta' => ['error' => mb_substr($e2->getMessage(), 0, 200)],
                ]);
            } catch (\Throwable $e3) {
            }
        }
    }
    try {
        log_activity('payment', 'autopay.collected', 'Balance collected automatically — £' . number_format($rental + $damages, 2) . ' · ' . (string) ($b['name'] ?? ''), [
            'severity' => 'info',
            'entity' => 'booking',
            'entity_id' => (string) $bookingId,
        ]);
    } catch (\Throwable $e) {
    }
    autopay_send_receipt($b, $sqId, $rental, $damages, $paid);
}

// THE GUEST IS TOLD. This was the one charge in the app that sent nothing: every
// other payment ends in send_payment_receipt, and the path where the guest was
// NOT at the keyboard is exactly the one where silence is worst — the first they
// would know is their statement.
//
// It reuses the same composer pay.php does, so the receipt for a collection and
// the receipt for a payment they made themselves cannot say different things
// about the same money. Best-effort and wrapped: the money is already taken and
// the ledger already written, so a mail failure must never propagate.
function autopay_send_receipt($b, $sqId, $rental, $damages, $paidSoFar = null)
{
    $bookingId = (int) ($b['id'] ?? 0);
    try {
        if (empty($b['email']) || !function_exists('send_payment_receipt')) {
            return;
        }
        // The collector passes the figure it derived BEFORE its ledger row landed.
        // Re-reading it here would count this collection twice (booking_ledger_net
        // already holds it), which is what put an inflated "paid so far" in front of
        // the guest. The fallback is for a caller with nothing to hand.
        $paid = $paidSoFar !== null
            ? round((float) $paidSoFar, 2)
            : round(booking_paid_so_far(['id' => $bookingId, 'deposit_paid' => (float) ($b['deposit_paid'] ?? 0)]), 2);
        // Strict-null, not ?: — a £0 price override is a real price (a comped stay);
    // ?: read it as unset and fell back to agreed_total (booking_amount_due's
    // own comment documents the predicate; these sites sat outside that fix).
    $total = round((($b['price_override'] ?? null) !== null && $b['price_override'] !== '') ? (float) $b['price_override'] : (float) ($b['agreed_total'] ?? 0), 2);
        $paid = $total > 0 ? min($total, $paid) : $paid;
        $prop = function_exists('prop_display') ? (prop_display((string) $b['prop_key'])['name'] ?? '') : '';
        $receipt = send_payment_receipt([
            'name' => $b['name'],
            'email' => $b['email'],
            'prop_key' => $b['prop_key'],
            'prop_name' => $prop !== '' ? $prop : (string) $b['prop_key'],
            'ref' => 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string) $bookingId), -6), 6, '0', STR_PAD_LEFT),
            'kind' => 'balance',
            'amount' => $rental,
            'total' => $total,
            'paid_so_far' => $paid,
            'balance' => round(max(0, $total - $paid), 2),
            // A monthly plan collects a SLICE, not the whole balance — so this
            // instalment must not read "Balance collected" over "Remaining balance
            // £Y". partial is true whenever money is still to come after this one.
            'partial' => !($total > 0 && $paid >= $total - 0.001),
            // The date the plan is working towards. NB no 'pay_url' on this path,
            // deliberately: the rest is collected automatically, so a "pay the
            // rest now" button beside "nothing to do" would contradict it.
            'balance_due_date' => (string) ($b['balance_due_date'] ?? ''),
            'fully_paid' => $total > 0 && $paid >= $total - 0.001,
            'deposit_charged' => $damages,
            'invoice_url' => site_base_url() . 'invoice.php?b=' . $bookingId . '&token=' . invoice_token($bookingId),
            // The one thing this receipt says that pay.php's does not: nobody
            // typed anything. A charge the guest does not remember making is
            // what a chargeback is made of.
            'automatic' => true,
        ]);
        if (is_array($receipt) && !empty($receipt['ok'])) {
            log_activity('comms', 'email.receipt', 'Payment receipt emailed — £' . number_format($rental + $damages, 2) . ' · collected automatically', [
                'actor' => 'cron',
                'prop_key' => $b['prop_key'],
                'entity' => 'booking',
                'entity_id' => (string) $bookingId,
            ]);
        }
    } catch (\Throwable $e) {
    }
}

// ---- THE DAILY PASS --------------------------------------------------------
// Serial, capped, and it reports what it did rather than running silently.
function autopay_run($today = null, $limit = AUTOPAY_RUN_MAX)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $out = ['ok' => true, 'collected' => 0, 'failed' => 0, 'skipped' => 0, 'lines' => [], 'okLines' => [], 'failLines' => [], 'truncated' => false];
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
               AND autopay_due IS NOT NULL AND COALESCE(autopay_next_at, autopay_due) <= ?
             ORDER BY COALESCE(autopay_next_at, autopay_due) ASC LIMIT " . ((int) $limit + 1),
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
            // Kept SEPARATE from the failures: the owner notification used to
            // read lines[0] for a collection and lines[count-1] for a failure,
            // positional — so on a pass with one of each, each alert quoted the
            // OTHER event's body. Read the matching bucket instead.
            $out['okLines'][] = $line;
        } elseif ($verdict === 'fail') {
            $out['failed']++;
            $out['lines'][] = $line;
            $out['failLines'][] = $line;
        } else {
            $out['skipped']++;
        }
    }
    return $out;
}


// ---- TELLING THEM BEFORE, NOT ONLY AFTER -----------------------------------
// They agreed to a sum on a date, and that agreement could be months old. Taking
// money with no warning is how a perfectly authorised charge becomes a disputed
// one — and a dispute here costs the fee AND gets the money ring-fenced by
// payouts-lib until it resolves, so the cheap notice is also the cheap insurance.
//
// PURE, so the gate can drive every boundary without a clock or a database.
// Returns true when this booking is owed a notice today.
function autopay_notice_due($b, $today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    // Only an arrangement that would actually charge. 'stale' and 'failed' are
    // deliberately excluded: warning someone about a payment that is not going
    // to be taken is worse than not warning them at all.
    if (booking_autopay_state($b, $today)[0] !== 'armed') {
        return false;
    }
    // A monthly plan warns before its NEXT collection — every instalment earns
    // its own notice; a single collection keys on the due date as it always did.
    $due = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10);
    if ($due === '') {
        $due = substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    }
    if ($due === '') {
        return false;
    }
    // ALREADY SENT FOR THIS DATE. Keyed on the date rather than a flag, so an
    // owner moving the balance date — or the plan advancing to its next
    // instalment — makes a fresh notice due by construction: the notice
    // already sent describes a day that is no longer the day.
    if (substr((string) ($b['autopay_notified_at'] ?? ''), 0, 10) === $due) {
        return false;
    }
    // Inside the window, and not already past it. A notice on or after the day
    // itself is not a warning, and the charge is about to speak for itself.
    return $today >= ukShiftDaysPhp($due, -AUTOPAY_NOTICE_DAYS) && $today < $due;
}

// The pass. Runs from autopay-run.php beside the collection, because the two
// share every judgement and splitting them would let one drift.
function autopay_notice_run($today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $out = ['ok' => true, 'sent' => 0, 'skipped' => 0];
    try {
        // COALESCE so a monthly plan's window follows its NEXT collection —
        // migration-108 ships in the same deploy as this query, the 105-107
        // precedent.
        $q = db()->prepare(
            "SELECT * FROM bookings
             WHERE autopay_consent_at IS NOT NULL AND autopay_revoked_at IS NULL
               AND autopay_card_id IS NOT NULL AND autopay_card_id <> ''
               AND autopay_due IS NOT NULL
               AND COALESCE(autopay_next_at, autopay_due) >= ? AND COALESCE(autopay_next_at, autopay_due) <= ?
             ORDER BY COALESCE(autopay_next_at, autopay_due) ASC LIMIT " . (int) AUTOPAY_RUN_MAX,
        );
        $q->execute([$today, ukShiftDaysPhp($today, AUTOPAY_NOTICE_DAYS)]);
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        return ['ok' => false, 'sent' => 0, 'skipped' => 0];
    }
    foreach ($rows as $b) {
        // The SQL is a cheap pre-filter; autopay_notice_due is the decision, so
        // the gate and the cron cannot disagree about who gets a notice.
        if (!autopay_notice_due($b, $today)) {
            $out['skipped']++;
            continue;
        }
        $sent = false;
        try {
            $sent = function_exists('send_autopay_notice') && !empty(send_autopay_notice($b)['ok']);
        } catch (\Throwable $e) {
        }
        // STAMPED ONLY ON A SEND. A failed email that stamped anyway would take
        // the money three days later having told nobody — the exact failure this
        // whole function exists to prevent, arrived at by bookkeeping.
        if (!$sent) {
            $out['skipped']++;
            continue;
        }
        // The stamp and the log both carry the date the notice is ABOUT — for a
        // monthly plan that is the next collection, and notice_due keys off it.
        $noticeFor = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10) ?: substr((string) $b['autopay_due'], 0, 10);
        try {
            db()
                ->prepare('UPDATE bookings SET autopay_notified_at = ? WHERE id = ?')
                ->execute([$noticeFor, (int) $b['id']]);
        } catch (\Throwable $e) {
        }
        try {
            log_activity('comms', 'autopay.notice', 'Told ' . (string) ($b['name'] ?? 'the guest') . " we'll take £" . number_format((float) $b['autopay_amount'], 2) . ' on ' . uk_date($noticeFor), [
                'actor' => 'cron',
                'entity' => 'booking',
                'entity_id' => (string) (int) $b['id'],
            ]);
        } catch (\Throwable $e) {
        }
        $out['sent']++;
    }
    return $out;
}
