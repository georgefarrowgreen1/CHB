<?php
// ============================================================
//  api/bookings.php
//  GET                          -> admin: all bookings (calendar/back office)
//  POST {action:'add', ...}     -> admin: create booking (snapshots price)
//  POST {action:'update', ...}  -> admin: edit booking
//  POST {action:'delete', id}   -> admin: delete booking
//  POST {action:'set_payment', id, payment, deposit, method, date}
//                                -> admin: reconcile deposit/status (date required if money)
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

// ---- helpers ----
function booking_by_id($id)
{
    $s = db()->prepare('SELECT * FROM bookings WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch();
}
// (A boolean dates_clash() lives in db.php; this file uses the message form below.)
// Returns a human-readable clash message if the dates overlap an existing booking
// or an imported platform (Airbnb/Vrbo) block; empty string if the dates are free.
function clash_message($propKey, $checkIn, $checkOut, $ignoreId = null)
{
    // Existing bookings on this site
    $sql = 'SELECT name, check_in, check_out FROM bookings WHERE prop_key = ? AND check_in < ? AND check_out > ?';
    $args = [$propKey, $checkOut, $checkIn];
    if ($ignoreId) {
        $sql .= ' AND id <> ?';
        $args[] = $ignoreId;
    }
    $s = db()->prepare($sql);
    $s->execute($args);
    $rows = $s->fetchAll();
    if ($rows) {
        $r = $rows[0];
        $who = $r['name'] !== '' ? $r['name'] : 'another guest';
        return 'These dates overlap an existing booking (' .
            $who .
            ', ' .
            $r['check_in'] .
            ' to ' .
            $r['check_out'] .
            ').';
    }
    // Imported iCal blocks (Airbnb/Vrbo) — table may not exist on older installs.
    try {
        $s2 = db()->prepare(
            'SELECT source, check_in, check_out FROM ical_blocks WHERE prop_key = ? AND check_in < ? AND check_out > ?',
        );
        $s2->execute([$propKey, $checkOut, $checkIn]);
        $b = $s2->fetch();
        if ($b) {
            return 'These dates are blocked by a ' .
                ucfirst($b['source']) .
                ' booking (' .
                $b['check_in'] .
                ' to ' .
                $b['check_out'] .
                ').';
        }
    } catch (\Throwable $e) {
        /* table not migrated yet */
    }
    return '';
}
// Soft email-deliverability warning for a booking's guest address. Returns an
// ['email_warn'=>true, 'message'=>…, 'suggest'=>…] payload the client can act
// on (confirm / use suggestion / override), or null when the address is fine
// or empty (a booking with no email is allowed — it just gets no emails).
function booking_email_warning($email)
{
    $email = trim((string) $email);
    if ($email === '') {
        return null; // no address on file — nothing to warn about
    }
    $chk = email_deliverability($email);
    if (!empty($chk['ok'])) {
        return null;
    }
    if (($chk['reason'] ?? '') === 'format') {
        return ['email_warn' => true, 'message' => '“' . $email . '” doesn’t look like a valid email address.', 'suggest' => null];
    }
    if (($chk['reason'] ?? '') === 'disposable') {
        return ['email_warn' => true, 'message' => '“' . $email . '” is a temporary / throwaway address — you may not be able to reach the guest later. Ask for a permanent email if you can.', 'suggest' => null];
    }
    if (($chk['reason'] ?? '') === 'typo') {
        return ['email_warn' => true, 'message' => '“' . $email . '” looks like a common misspelling — mail could go to the wrong place.', 'suggest' => $chk['suggest'] ?? null];
    }
    $msg = '“' . $email . '” may not receive email — its domain (' . substr(strrchr($email, '@'), 1) . ') has no mail server.';
    return ['email_warn' => true, 'message' => $msg, 'suggest' => $chk['suggest'] ?? null];
}

// Soft occupancy warning for a booking's party size, read from the PROPERTY ROW
// itself (occupancy_limits() deliberately covers only live+listed cottages — the
// back office can book private/unlisted ones too). Returns an
// ['occupancy_warn'=>true,'message'=>…] payload the client confirms, or null.
// The UI already warns; this makes the server the single source of truth so a
// direct API call can't create a 10-guest booking in a 2-person cottage silently.
function booking_occupancy_warning($propKey, $adults, $children)
{
    try {
        $s = db()->prepare('SELECT max_adults, max_children, max_total FROM properties WHERE prop_key = ?');
        $s->execute([$propKey]);
        $row = $s->fetch();
    } catch (\Throwable $e) {
        return null; // columns not migrated — nothing to check against
    }
    if (!$row) {
        return null;
    }
    $maxAdults = max(1, (int) ($row['max_adults'] ?? 2));
    $maxChildren = max(0, (int) ($row['max_children'] ?? 0));
    $maxTotal = max(1, (int) ($row['max_total'] ?? 2));
    if ($adults > $maxAdults || $children > $maxChildren || $adults + $children > $maxTotal) {
        return [
            'occupancy_warn' => true,
            'message' =>
                'That party (' . $adults . ' adult' . ($adults === 1 ? '' : 's') .
                ($children > 0 ? ', ' . $children . ' child' . ($children === 1 ? '' : 'ren') : '') .
                ') is over this property’s normal limit of ' . $maxTotal . ' guest' . ($maxTotal === 1 ? '' : 's') . '.',
        ];
    }
    return null;
}

// (prop_is_archived() lives in db.php — shared with the approval path.)

// Reconcile a deposit amount against a chosen status + total. Returns float or null(invalid).
function reconcile_deposit($status, $total, $currentDep, $proposedDep)
{
    if ($status === 'paid') {
        return round($total, 2);
    }
    if ($status === 'unpaid') {
        return 0.0;
    }
    // 'deposit' — needs a partial amount strictly between 0 and total
    $dep = $proposedDep !== null ? (float) $proposedDep : (float) $currentDep;
    if ($dep <= 0 || $dep >= $total) {
        return null;
    }
    return round($dep, 2);
}
function snapshot_fields($rate, $b, $depositOverride = null)
{
    $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out'], $depositOverride);
    return [
        'agreed_total' => $p['total'],
        'agreed_per_night' => $p['perNight'],
        'agreed_nights' => $p['nights'],
        'agreed_nightly' => $p['nightly'],
        // booking_fee column is repurposed to store the refundable damages deposit
        'agreed_booking_fee' => $p['damagesDeposit'],
        'agreed_txn_pct' => $p['transactionPct'],
        'agreed_txn_fee' => $p['txFee'],
        'agreed_on' => date('Y-m-d'),
    ];
}

// ---- Square refund + ledger helpers (shared by refund / return_deposit / cancel) ----
// Insert a payments ledger row, tolerating an un-migrated schema (no note/snapshot cols).
function insert_payment_row($bookingId, $sqId, $kind, $amount, $status, $gName, $gProp, $note)
{
    try {
        db()
            ->prepare(
                'INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, guest_name, prop_key, note, created_at)
                       VALUES (?,?,?,?,?,?,?,?,NOW())',
            )
            ->execute([$bookingId, $sqId, $kind, $amount, $status, $gName, $gProp, $note !== '' ? $note : null]);
    } catch (\Throwable $e) {
        try {
            db()
                ->prepare(
                    'INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, created_at) VALUES (?,?,?,?,?,NOW())',
                )
                ->execute([$bookingId, $sqId, $kind, $amount, $status]);
        } catch (\Throwable $e2) {
            // A money movement that the ledger could not record must never be
            // silent — the owner reconciles from this ledger.
            try {
                log_activity('payment', 'ledger.write_fail', 'Payments ledger write FAILED — ' . $kind . ' £' . number_format((float) $amount, 2) . ' (booking #' . (int) $bookingId . ')', [
                    'actor' => 'system',
                    'severity' => 'action',
                    'meta' => ['detail' => mb_substr($e2->getMessage(), 0, 160)],
                ]);
            } catch (\Throwable $e3) {
            }
        }
    }
}
// A completed Square charge (deposit/balance) for a booking large enough to refund $need.
function find_charge_for_refund($bookingId, $need)
{
    try {
        $s = db()->prepare("SELECT square_payment_id, amount FROM payments
            WHERE booking_id = ? AND kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED')
            ORDER BY amount DESC");
        $s->execute([$bookingId]);
        foreach ($s->fetchAll() as $r) {
            if ((float) $r['amount'] + 0.001 >= $need) {
                return $r['square_payment_id'];
            }
        }
    } catch (\Throwable $e) {
    }
    return null;
}
// Issue a Square refund against $sqId and record a ledger row of $kind. Returns
// ['ok'=>bool,'status'=>..,'error'=>..]. $kind is 'refund' or 'damages_return'.
function record_square_refund($bookingId, $sqId, $amount, $kind, $note, $gName, $gProp)
{
    // DETERMINISTIC idempotency key: a retry after a mid-operation crash (Square
    // succeeded, ledger row lost) reuses the same key, so Square returns the
    // original refund instead of paying out twice. The refunded-so-far ledger
    // sum keeps the key stable across retries of the SAME intent but distinct
    // for a genuine second refund of the same amount later.
    $priorCents = 0;
    try {
        $q = db()->prepare('SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = ? AND kind = ?');
        $q->execute([(int) $bookingId, $kind]);
        $priorCents = (int) round(((float) $q->fetchColumn()) * 100);
    } catch (\Throwable $e) {
    }
    $idemKey = 'chb-r-' . (int) $bookingId . '-' . substr(hash('sha256', $sqId), 0, 8) . '-' . (int) round($amount * 100) . '-' . ($kind === 'damages_return' ? 'd' : 'r') . '-' . $priorCents;
    $res = square_api('POST', '/v2/refunds', [
        'idempotency_key' => $idemKey,
        'payment_id' => $sqId,
        'amount_money' => ['amount' => (int) round($amount * 100), 'currency' => 'GBP'],
        'reason' =>
            $note !== ''
                ? mb_substr($note, 0, 190)
                : ($kind === 'damages_return'
                    ? 'Damage deposit return'
                    : 'Booking refund'),
    ]);
    $refund = $res['body']['refund'] ?? null;
    $ok =
        in_array($res['status'], [200, 201], true) &&
        $refund &&
        in_array($refund['status'] ?? '', ['PENDING', 'COMPLETED', 'APPROVED'], true);
    if (!$ok) {
        return ['ok' => false, 'error' => $res['body']['errors'][0]['detail'] ?? 'Refund failed at Square.'];
    }
    insert_payment_row($bookingId, (string) $refund['id'], $kind, $amount, $refund['status'], $gName, $gProp, $note);
    return ['ok' => true, 'status' => $refund['status'], 'refund_id' => (string) $refund['id']];
}
// Re-derive the booking's rental payment status from the ledger (charges − rental
// refunds). NOTE: 'damages_return' is deliberately excluded — returning a held
// deposit must never make a booking look unpaid.
function reconcile_booking_payment($bookingId, $b = null)
{
    if ($b === null) {
        $b = booking_by_id($bookingId);
    }
    $total =
        $b && $b['agreed_total'] !== null
            ? ($b['price_override'] !== null
                ? (float) $b['price_override']
                : (float) $b['agreed_total'])
            : 0.0;
    $sum = db()->prepare("SELECT
            COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount ELSE 0 END),0) AS net
        FROM payments WHERE booking_id = ?");
    $sum->execute([$bookingId]);
    $paid = round(max(0, (float) $sum->fetchColumn()), 2);
    if ($total > 0) {
        $paid = min($total, $paid);
    }
    $status = $total > 0 && $paid >= $total - 0.001 ? 'paid' : ($paid > 0 ? 'deposit' : 'unpaid');
    db()
        ->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_date=? WHERE id=?')
        ->execute([$status, $paid, $paid > 0 ? date('Y-m-d') : null, $bookingId]);
    return ['paid' => $paid, 'status' => $status];
}
// Refundable damage deposit actually RECEIVED for a booking (rental paid first).
function damages_collected($b)
{
    $hs = $b['hold_status'] ?? 'none';
    // The full deposit amount is actual money the business now holds and can hand
    // back in two cases: 'charged' (charge-upfront model — taken with the booking)
    // and 'captured' (card-hold model — the authorisation was completed, which
    // inserts a 'damages' ledger row for the full hold_amount). This is keyed on
    // hold_amount — the sum ACTUALLY taken — not agreed_booking_fee, so a deposit
    // that was charged is never stranded even if the per-booking fee reads £0 (a
    // waived deposit that was nonetheless collected). damages_returned() then
    // shrinks this as returns are made, so repeated refunds can't exceed what was taken.
    if ($hs === 'charged' || $hs === 'captured') {
        return round((float) ($b['hold_amount'] ?? ($b['agreed_booking_fee'] ?? 0)), 2);
    }
    // Already settled (refunded to the guest, or kept for damage) → nothing to return.
    if (in_array($hs, ['returned', 'kept'], true)) {
        return 0.0;
    }
    // Uncaptured card-hold states took nothing into the ledger — an authorisation
    // that's still pending, was released, or expired holds no money to hand back.
    if (in_array($hs, ['authorized', 'released', 'expired'], true)) {
        return 0.0;
    }
    // hold_status 'none' (charge-upfront model, deposit bundled into the first
    // payment): the returnable deposit is whatever was paid ABOVE the pure rental,
    // capped at the agreed deposit. A £0/absent agreed deposit → nothing to return.
    $held = (float) ($b['agreed_booking_fee'] ?? 0);
    if ($held <= 0) {
        return 0.0;
    }
    // Pure rental (deposit EXCLUDED) — the same in both eras: legacy folded the
    // deposit into agreed_total, the current model does not. A price override is a
    // deliberate rental figure, so it raises the rental floor. Anything paid ABOVE
    // this is deposit money genuinely sitting in the ledger. Erring low here can
    // only under-return (safe); the old `total - held` over-returned rental income
    // as a phantom deposit for every fully-paid modern booking.
    $rental = (float) ($b['agreed_nightly'] ?? 0) + (float) ($b['agreed_txn_fee'] ?? 0);
    if ($b['price_override'] !== null) {
        $rental = max($rental, (float) $b['price_override']);
    }
    $paid = (float) ($b['deposit_paid'] ?? 0);
    return round(max(0.0, min($held, $paid - $rental)), 2);
}
function damages_returned($bookingId)
{
    try {
        $s = db()->prepare(
            "SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = ? AND kind = 'damages_return'",
        );
        $s->execute([$bookingId]);
        return round((float) $s->fetchColumn(), 2);
    } catch (\Throwable $e) {
        return 0.0;
    }
}

// Build the email payload from a saved booking row and send the confirmation +
// owner notification. Uses the booking's locked (agreed) figures so the email
// always matches what's on the booking. Never throws — returns the mailer result
// array (or an ['error'=>...] note) so callers can surface it without failing.
// $guestOnly = true suppresses the owner "new booking" notification — used when
// RE-sending after a payment is recorded, so the owner isn't re-pinged each time.
// $deferOwner = true sends the guest copy now (its result is what the UI shows)
// but moves the owner copy to after the response is flushed (mail_after_response).
function send_booking_confirmation($bookingId, $guestOnly = false, $deferOwner = false)
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
            $total = $b['price_override'] !== null ? (float) $b['price_override'] : (float) $b['agreed_total'];
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
        $paidSoFar = round($rentalPaid + $chargedDep, 2);
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
            'ref' => $ref,
            // Payment state so the confirmation reflects money received (shown only
            // when something has been paid; a fresh unpaid booking omits it).
            'paid_so_far' => $paidSoFar,
            'balance_due' => $balanceDue,
            'grand_total' => $grand,
            // Suppress the owner copy on a re-send after a payment.
            'skip_owner' => $guestOnly,
            // Send the owner copy after the HTTP response (booking-add flow).
            'defer_owner' => $deferOwner,
            // Signed link to the guest-viewable HTML invoice (invoice.php).
            'invoice_url' => site_base_url() . 'invoice.php?b=' . (int) $bookingId . '&token=' . invoice_token((int) $bookingId),
            // Signed link to the guest-registration form (UK hotel-records duty).
            'guest_reg_url' => site_base_url() . 'guest-details.php?b=' . (int) $bookingId . '&token=' . guest_reg_token((int) $bookingId),
        ]);
    } catch (\Throwable $ex) {
        return ['error' => 'Mail step skipped: ' . $ex->getMessage()];
    }
}

// The admin GET payload, as a function so admin-bootstrap.php can serve the
// SAME data in its combined back-office boot response. Caller must require_admin.
function bookings_admin_payload()
{
    $rows = db()->query('SELECT * FROM bookings ORDER BY check_in ASC')->fetchAll();
    // Attach the refunded-deposit total per booking (for the invoice's deposit
    // status when an owner downloads it). One grouped query, best-effort.
    try {
        $ret = [];
        foreach (
            db()->query(
                "SELECT booking_id, COALESCE(SUM(amount),0) t FROM payments WHERE kind = 'damages_return' GROUP BY booking_id",
            ) as $r
        ) {
            $ret[(int) $r['booking_id']] = round((float) $r['t'], 2);
        }
        foreach ($rows as &$bk) {
            $bk['damages_returned'] = $ret[(int) $bk['id']] ?? 0;
        }
        unset($bk);
    } catch (\Throwable $e) {
    }
    // Guest-registration status per booking (UK hotel-records duty). The bulk
    // payload carries only status + count + the owner-usable form link — never
    // the PII; the owner opens the token page to view/edit the actual names.
    // Robust to the guest_registrations table not existing yet (pre-migration).
    foreach ($rows as &$bk) {
        $id = (int) $bk['id'];
        $bk['reg_url'] = site_base_url() . 'guest-details.php?b=' . $id . '&token=' . guest_reg_token($id);
        $bk['reg_submitted'] = false;
        $bk['reg_count'] = 0;
    }
    unset($bk);
    try {
        $reg = [];
        foreach (db()->query('SELECT booking_id, guest_count, submitted_at FROM guest_registrations') as $r) {
            $reg[(int) $r['booking_id']] = $r;
        }
        foreach ($rows as &$bk) {
            $r = $reg[(int) $bk['id']] ?? null;
            if ($r) {
                $bk['reg_submitted'] = !empty($r['submitted_at']);
                $bk['reg_count'] = (int) $r['guest_count'];
            }
        }
        unset($bk);
    } catch (\Throwable $e) {
    }
    return ['bookings' => $rows];
}

// When admin-bootstrap.php includes this file for the payload helper, stop
// before the HTTP routing — routes below run only when this file IS the request.
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'bookings.php') {
    return;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_admin();
    json_out(bookings_admin_payload());
}

require_admin();
$in = body();
$action = $in['action'] ?? '';

if ($action === 'delete') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    // Hard delete is for junk/test rows. A booking that has taken MONEY must go
    // through Cancel instead — cancel refunds the card payment, settles/returns
    // the damage deposit and emails the guest; delete does none of that, which
    // previously left the guest a live confirmation and unreturned money.
    if ($b) {
        $moneyIn = (float) ($b['deposit_paid'] ?? 0) > 0.001;
        $holdLive = in_array($b['hold_status'] ?? 'none', ['authorized', 'charged', 'captured'], true);
        if ($moneyIn || $holdLive) {
            json_out([
                'error' =>
                    'This booking has taken money' .
                    ($holdLive ? ' (and holds a damages deposit)' : '') .
                    ' — use “Cancel booking” instead, which refunds the guest and lets them know. Delete is only for junk/test rows.',
            ], 400);
        }
    }
    db()
        ->prepare('DELETE FROM bookings WHERE id = ?')
        ->execute([$id]);
    if ($b) {
        try {
            require_once __DIR__ . '/waitlist.php';
            waitlist_notify_freed($b['prop_key'] ?? '', $b['check_in'] ?? '', $b['check_out'] ?? '');
        } catch (\Throwable $e) {
        }
    }
    log_activity('booking', 'booking.delete', 'Booking deleted' . ($b ? ' — ' . ($b['name'] ?? '') : ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

if ($action === 'add') {
    $propKey = clean($in['prop_key'] ?? '');
    $rate = get_rate($propKey);
    if (!$rate) {
        json_out(['error' => 'Unknown property'], 400);
    }
    if (prop_is_archived($propKey)) {
        json_out(['error' => 'That cottage has been removed from the site — restore it (Manage → Preferences) before adding bookings.'], 400);
    }
    $name = clean($in['name'] ?? '');
    $checkIn = clean($in['check_in'] ?? '');
    $checkOut = clean($in['check_out'] ?? '');
    if ($name === '' || !$checkIn || !$checkOut) {
        json_out(['error' => 'Name and dates required'], 400);
    }
    // Validate the ISO date shape (like enquiries.php) — a malformed date would
    // poison the lexical clash comparison and store garbage.
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkIn) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkOut)) {
        json_out(['error' => 'Dates must be in YYYY-MM-DD format.'], 400);
    }
    if ($checkOut <= $checkIn) {
        json_out(['error' => 'Check-out must be after check-in'], 400);
    }

    $adults = max(1, (int) ($in['adults'] ?? 2));
    $children = max(0, (int) ($in['children'] ?? 0));

    // Email deliverability warning (soft): a mistyped domain (e.g. ntl-world.com)
    // means the guest never gets their confirmation. Warn — with a suggested
    // correction where we can find one — unless override_email:true is sent.
    if (empty($in['override_email'])) {
        $emailWarn = booking_email_warning($in['email'] ?? '');
        if ($emailWarn) {
            json_out($emailWarn);
        }
    }

    // Occupancy warning (soft): over the property's limit needs a deliberate
    // confirm (override_occupancy:true), same pattern as email + clash.
    if (empty($in['override_occupancy'])) {
        $occWarn = booking_occupancy_warning($propKey, $adults, $children);
        if ($occWarn) {
            json_out($occWarn);
        }
    }

    // Date-clash warning (soft): if these dates overlap an existing booking or an
    // imported platform (Airbnb/Vrbo) block, return a clash notice so the owner
    // can confirm. Sending override_clash:true proceeds anyway.
    if (!book_lock($propKey)) {
        // Genuine lock timeout (another booking write held it >30s): proceeding
        // would run UNPROTECTED past the clash check — refuse instead.
        json_out(['error' => 'The calendar is busy with another booking for this cottage — please try again in a moment.'], 409);
    }
    if (empty($in['override_clash'])) {
        $clashMsg = clash_message($propKey, $checkIn, $checkOut, null);
        if ($clashMsg) {
            json_out(['clash' => true, 'message' => $clashMsg]);
        }
    }
    $status = in_array($in['payment'] ?? 'unpaid', ['unpaid', 'deposit', 'paid']) ? $in['payment'] : 'unpaid';
    $damagesOverride = array_key_exists('damages_deposit', $in) ? $in['damages_deposit'] : null;

    $snap = snapshot_fields(
        $rate,
        ['adults' => $adults, 'children' => $children, 'check_in' => $checkIn, 'check_out' => $checkOut],
        $damagesOverride,
    );
    // Manual total override (back office): if set, it becomes the agreed total.
    $priceOverride =
        array_key_exists('price_override', $in) && $in['price_override'] !== null && $in['price_override'] !== ''
            ? round((float) $in['price_override'], 2)
            : null;
    if ($priceOverride !== null) {
        $snap['agreed_total'] = $priceOverride;
    }
    $dep = reconcile_deposit($status, $snap['agreed_total'], 0, $in['deposit'] ?? null);
    if ($dep === null) {
        json_out(['error' => 'A deposit must be more than £0 and less than the total'], 400);
    }

    $method = '';
    $date = null;
    if ($dep > 0.001) {
        $date = clean($in['payment_date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            json_out(['error' => 'A valid payment date is required'], 400);
        }
        $method = clean($in['payment_method'] ?? '');
    }

    db()
        ->prepare(
            'INSERT INTO bookings
        (prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,notes,payment,
         deposit_paid,payment_method,payment_date,
         agreed_total,agreed_per_night,agreed_nights,agreed_nightly,agreed_booking_fee,agreed_txn_pct,agreed_txn_fee,agreed_on,price_override)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        ->execute([
            $propKey,
            $name,
            clean($in['email'] ?? ''),
            clean($in['phone'] ?? ''),
            clean($in['address'] ?? ''),
            clean($in['postcode'] ?? ''),
            $checkIn,
            $checkOut,
            clean($in['check_in_time'] ?? '15:00'),
            clean($in['check_out_time'] ?? '10:00'),
            $adults,
            $children,
            clean($in['notes'] ?? ''),
            $status,
            $dep,
            $method,
            $date ?: null,
            $snap['agreed_total'],
            $snap['agreed_per_night'],
            $snap['agreed_nights'],
            $snap['agreed_nightly'],
            $snap['agreed_booking_fee'],
            $snap['agreed_txn_pct'],
            $snap['agreed_txn_fee'],
            $snap['agreed_on'],
            $priceOverride,
        ]);
    $newId = (int) db()->lastInsertId();
    book_unlock($propKey); // free the lock before the (slower) email send
    // Auto-send the confirmation email for the newly created booking (if it has
    // a guest email). Email failure never blocks the booking.
    $emailResult = null;
    $guestEmail = clean($in['email'] ?? '');
    if ($guestEmail !== '') {
        // Guest copy sync (the UI reports its result); owner copy after the response.
        $emailResult = send_booking_confirmation($newId, false, true);
        // Record the confirmation so it shows in the Bookings page email log.
        if (is_array($emailResult) && !empty($emailResult['guest']['ok'])) {
            log_activity('comms', 'email.confirmation', 'Booking confirmation emailed — ' . $name, [
                'prop_key' => $propKey,
                'entity' => 'booking',
                'entity_id' => (string) $newId,
            ]);
        }
    }
    // Is this a returning guest? (other bookings on the same email.) Worth surfacing —
    // repeat customers are the most valuable ones.
    $priorStays = 0;
    if ($guestEmail !== '') {
        try {
            $pc = db()->prepare('SELECT COUNT(*) FROM bookings WHERE LOWER(email) = LOWER(?) AND id <> ?');
            $pc->execute([$guestEmail, $newId]);
            $priorStays = (int) $pc->fetchColumn();
        } catch (\Throwable $e) {
        }
    }
    log_activity(
        'booking',
        $priorStays > 0 ? 'booking.repeat_guest' : 'booking.add',
        ($priorStays > 0 ? 'Repeat guest booked — ' . $name . ' (' . ($priorStays + 1) . ' stays)' : 'Booking created — ' . $name),
        ['prop_key' => $propKey, 'entity' => 'booking', 'entity_id' => (string) $newId, 'meta' => ['detail' => trim($checkIn . ' → ' . $checkOut)]],
    );
    json_out(['ok' => true, 'id' => $newId, 'email' => $emailResult]);
}

if ($action === 'update') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $propKey = clean($in['prop_key'] ?? $b['prop_key']);
    $rate = get_rate($propKey);
    if (!$rate) {
        json_out(['error' => 'Unknown property'], 400);
    }

    $checkIn = clean($in['check_in'] ?? $b['check_in']);
    $checkOut = clean($in['check_out'] ?? $b['check_out']);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkIn) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkOut)) {
        json_out(['error' => 'Dates must be in YYYY-MM-DD format.'], 400);
    }
    if ($checkOut <= $checkIn) {
        json_out(['error' => 'Check-out must be after check-in'], 400);
    }

    // Email deliverability warning — only when the address actually CHANGED, so
    // editing an old booking's other fields never re-nags about a legacy email.
    if (empty($in['override_email']) && array_key_exists('email', $in) && trim((string) $in['email']) !== trim((string) ($b['email'] ?? ''))) {
        $emailWarn = booking_email_warning($in['email'] ?? '');
        if ($emailWarn) {
            json_out($emailWarn);
        }
    }

    $adults = max(1, (int) ($in['adults'] ?? $b['adults']));
    $children = max(0, (int) ($in['children'] ?? $b['children']));

    // Occupancy warning (soft) — only when the party actually GREW, so editing
    // other fields on a historic over-limit booking never re-nags.
    if (empty($in['override_occupancy']) && ($adults > (int) $b['adults'] || $children > (int) $b['children'] || $propKey !== $b['prop_key'])) {
        $occWarn = booking_occupancy_warning($propKey, $adults, $children);
        if ($occWarn) {
            json_out($occWarn);
        }
    }

    // Date-clash warning (soft) — ignore this booking's own dates. Confirm with
    // override_clash:true to proceed.
    if (!book_lock($propKey)) {
        json_out(['error' => 'The calendar is busy with another booking for this cottage — please try again in a moment.'], 409);
    }
    if (empty($in['override_clash'])) {
        $clashMsg = clash_message($propKey, $checkIn, $checkOut, $id);
        if ($clashMsg) {
            json_out(['clash' => true, 'message' => $clashMsg]);
        }
    }

    // Re-snapshot price if the stay changed OR a new damages deposit was supplied
    $damagesOverride = array_key_exists('damages_deposit', $in) ? $in['damages_deposit'] : null;
    $currentDeposit = $b['agreed_booking_fee'] !== null ? (float) $b['agreed_booking_fee'] : null;
    $depositChanged = $damagesOverride !== null && (float) $damagesOverride !== $currentDeposit;
    $stayChanged =
        $propKey !== $b['prop_key'] ||
        $checkIn !== $b['check_in'] ||
        $checkOut !== $b['check_out'] ||
        $adults != $b['adults'] ||
        $children != $b['children'] ||
        $b['agreed_total'] === null ||
        $depositChanged;
    // When re-snapshotting, use the supplied deposit if given, else preserve the existing one
    $depForSnap = $damagesOverride !== null ? $damagesOverride : $currentDeposit;
    $snap = $stayChanged
        ? snapshot_fields(
            $rate,
            ['adults' => $adults, 'children' => $children, 'check_in' => $checkIn, 'check_out' => $checkOut],
            $depForSnap,
        )
        : null;

    // Manual total override. If the field is sent: a value sets/keeps it, an empty
    // string clears it (revert to calculated). If not sent at all, keep existing.
    $overrideSent = array_key_exists('price_override', $in);
    if ($overrideSent) {
        $priceOverride =
            $in['price_override'] !== null && $in['price_override'] !== ''
                ? round((float) $in['price_override'], 2)
                : null;
    } else {
        $priceOverride = $b['price_override'] !== null ? (float) $b['price_override'] : null;
    }
    // The effective total: override wins; else the (re)snapshot; else existing.
    $calcTotal = $snap ? $snap['agreed_total'] : (float) $b['agreed_total'];
    $total = $priceOverride !== null ? $priceOverride : $calcTotal;

    $status = in_array($in['payment'] ?? $b['payment'], ['unpaid', 'deposit', 'paid'])
        ? $in['payment'] ?? $b['payment']
        : $b['payment'];
    $dep = reconcile_deposit($status, $total, $b['deposit_paid'], $in['deposit'] ?? null);
    if ($dep === null) {
        json_out(['error' => 'A deposit must be more than £0 and less than the total'], 400);
    }

    $method = $b['payment_method'];
    $date = $b['payment_date'];
    if ($dep > 0.001) {
        $date = clean($in['payment_date'] ?? ($b['payment_date'] ?? ''));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date)) {
            json_out(['error' => 'A valid payment date is required'], 400);
        }
        $method = clean($in['payment_method'] ?? ($b['payment_method'] ?? ''));
    } else {
        $method = '';
        $date = null;
    }

    $sql = 'UPDATE bookings SET prop_key=?,name=?,email=?,phone=?,address=?,postcode=?,check_in=?,check_out=?,check_in_time=?,check_out_time=?,
            adults=?,children=?,notes=?,payment=?,deposit_paid=?,payment_method=?,payment_date=?,price_override=?';
    $args = [
        $propKey,
        clean($in['name'] ?? $b['name']),
        clean($in['email'] ?? $b['email']),
        clean($in['phone'] ?? $b['phone']),
        clean($in['address'] ?? $b['address']),
        clean($in['postcode'] ?? $b['postcode']),
        $checkIn,
        $checkOut,
        clean($in['check_in_time'] ?? $b['check_in_time']),
        clean($in['check_out_time'] ?? $b['check_out_time']),
        $adults,
        $children,
        clean($in['notes'] ?? $b['notes']),
        $status,
        $dep,
        $method,
        $date ?: null,
        $priceOverride,
    ];
    if ($snap) {
        $sql .=
            ',agreed_total=?,agreed_per_night=?,agreed_nights=?,agreed_nightly=?,agreed_booking_fee=?,agreed_txn_pct=?,agreed_txn_fee=?,agreed_on=?';
        array_push(
            $args,
            $snap['agreed_total'],
            $snap['agreed_per_night'],
            $snap['agreed_nights'],
            $snap['agreed_nightly'],
            $snap['agreed_booking_fee'],
            $snap['agreed_txn_pct'],
            $snap['agreed_txn_fee'],
            $snap['agreed_on'],
        );
    }
    $sql .= ' WHERE id = ?';
    $args[] = $id;
    db()->prepare($sql)->execute($args);
    book_unlock($propKey);
    // Say WHAT changed, so the booking hub's history reads like a story
    // ("dates 12→15 Aug ⇒ 13→16 Aug") instead of a bare "edited".
    $changes = [];
    if ($checkIn !== $b['check_in'] || $checkOut !== $b['check_out']) {
        $changes[] = 'dates ' . $b['check_in'] . '→' . $b['check_out'] . ' ⇒ ' . $checkIn . '→' . $checkOut;
    }
    if ($propKey !== $b['prop_key']) {
        $changes[] = 'moved ' . $b['prop_key'] . ' ⇒ ' . $propKey;
    }
    if ($adults != $b['adults'] || $children != $b['children']) {
        $changes[] = 'party now ' . $adults . ' adult' . ($adults == 1 ? '' : 's') . ($children ? ' + ' . $children : '');
    }
    $oldOverride = $b['price_override'] !== null && $b['price_override'] !== '' ? (float) $b['price_override'] : null;
    if ($priceOverride !== $oldOverride) {
        $changes[] = $priceOverride !== null ? 'price set to £' . number_format($priceOverride, 2) : 'custom price removed';
    }
    if (trim((string) ($in['email'] ?? $b['email'])) !== trim((string) $b['email'])) {
        $changes[] = 'email updated';
    }
    log_activity(
        'booking',
        'booking.update',
        'Booking edited' . ($changes ? ' — ' . mb_substr(implode('; ', $changes), 0, 200) : '') . ' — ' . ($b['name'] ?? ''),
        ['prop_key' => $propKey, 'entity' => 'booking', 'entity_id' => (string) $id],
    );
    json_out(['ok' => true]);
}

// Lightweight save of the owner-only staff note (from the booking details modal).
// Separate from 'update' so a quick note doesn't touch dates/price/payment.
if ($action === 'set_notes') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $notes = mb_substr(clean($in['notes'] ?? ''), 0, 2000);
    db()
        ->prepare('UPDATE bookings SET notes = ? WHERE id = ?')
        ->execute([$notes, $id]);
    log_activity('booking', 'booking.note', 'Booking note updated — ' . ($b['name'] ?? ''), [
        'entity' => 'booking',
        'entity_id' => (string) $id,
        'prop_key' => $b['prop_key'] ?? '',
    ]);
    json_out(['ok' => true, 'notes' => $notes]);
}

if ($action === 'set_payment') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    // Honour a manual price override as the total (matches reconcile_booking_payment,
    // pay.php and the JS) so a part-payment against an overridden price reconciles to
    // the same figure everywhere instead of the un-overridden agreed_total.
    $total =
        $b['price_override'] !== null && $b['price_override'] !== ''
            ? (float) $b['price_override']
            : (float) ($b['agreed_total'] ?? 0);
    $status = in_array($in['payment'] ?? '', ['unpaid', 'deposit', 'paid']) ? $in['payment'] : $b['payment'];
    $dep = reconcile_deposit($status, $total, $b['deposit_paid'], $in['deposit'] ?? null);
    if ($dep === null) {
        json_out(
            ['error' => "Deposit must be more than £0 and less than the total. Use 'Paid' or 'Unpaid' otherwise."],
            400,
        );
    }

    $method = $b['payment_method'];
    $date = $b['payment_date'];
    if ($dep > 0.001) {
        $date = clean($in['payment_date'] ?? ($b['payment_date'] ?? ''));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date)) {
            json_out(['error' => 'A valid payment date is required'], 400);
        }
        $method = clean($in['payment_method'] ?? ($b['payment_method'] ?? ''));
    } else {
        $method = '';
        $date = null;
    }

    $prevDep = round((float) ($b['deposit_paid'] ?? 0), 2);
    db()
        ->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_method=?, payment_date=? WHERE id=?')
        ->execute([$status, $dep, $method, $date ?: null, $id]);
    // When money came in (recorded amount went UP), log it as a clear payment
    // event ("a deposit/payment has been made") rather than a vague status change.
    if ($dep > $prevDep + 0.001) {
        $kindWord = $status === 'paid' ? 'Payment' : 'Deposit';
        log_activity('payment', 'payment.recorded', $kindWord . ' recorded — £' . number_format($dep - $prevDep, 2) . ($method ? ' (' . $method . ')' : '') . ($b['name'] ? ' · ' . $b['name'] : ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    } else {
        log_activity('payment', 'booking.set_payment', 'Payment status set to ' . $status . ($b['name'] ? ' — ' . $b['name'] : ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    }
    json_out(['ok' => true]);
}

// Manually (re)send the confirmation email for an existing booking.
if ($action === 'send_arrival') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (empty($b['email'])) {
        json_out(['error' => 'This booking has no guest email on file.'], 400);
    }
    require_once __DIR__ . '/mailer.php'; // the arrival-email helpers live here
    $res = send_arrival_for_booking($b);
    if (!empty($res['ok'])) {
        log_activity('comms', 'email.arrival', 'Arrival info emailed — ' . ($b['name'] ?? ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
        json_out(['ok' => true]);
    }
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 500);
}

if ($action === 'send_confirmation') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (empty($b['email'])) {
        json_out(['error' => 'This booking has no guest email on file.'], 400);
    }
    // guest_only:true → re-send just the guest confirmation (no owner re-ping);
    // used when confirming a recorded payment.
    $guestOnly = !empty($in['guest_only']);
    $result = send_booking_confirmation($id, $guestOnly);
    if (is_array($result) && isset($result['guest']) && !empty($result['guest']['ok'])) {
        log_activity('comms', 'email.confirmation', 'Confirmation re-sent — ' . ($b['name'] ?? ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
        json_out(['ok' => true, 'email' => $result]);
    }
    $reason = $result['error'] ?? ($result['guest']['error'] ?? 'Unknown mail error');
    json_out(['error' => 'Email not sent: ' . $reason, 'email' => $result], 200);
}

// Build the branded email HTML for the composer's live preview (no send).
if ($action === 'email_preview') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $message = mb_substr(trim((string) ($in['message'] ?? '')), 0, 5000);
    $subject = mb_substr(clean($in['subject'] ?? ''), 0, 150);
    $priceEst = null;
    try {
        // Agreed (locked-in) price when the booking has a snapshot; live rates only as fallback
        $priceEst = booking_price(get_rate($b['prop_key']), $b);
    } catch (\Throwable $e) {
    }
    require_once __DIR__ . '/mailer.php';
    $m = build_enquiry_reply_email(array_merge($b, ['price' => $priceEst]), $subject, $message, 'booking');
    json_out(['ok' => true, 'html' => $m['html'], 'subject' => $m['subject']]);
}

// Free-text email to a booking's guest, with the booking details riding along
// underneath (mirrors enquiries.php 'email_guest'; the composer is shared).
if ($action === 'email_guest') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (empty($b['email'])) {
        json_out(['error' => 'This booking has no guest email on file.'], 400);
    }
    $message = trim((string) ($in['message'] ?? ''));
    if ($message === '') {
        json_out(['error' => 'Please write a message first.'], 400);
    }
    $message = mb_substr($message, 0, 5000);
    $subject = mb_substr(clean($in['subject'] ?? ''), 0, 150);
    $priceEst = null;
    try {
        // Agreed (locked-in) price when the booking has a snapshot; live rates only as fallback
        $priceEst = booking_price(get_rate($b['prop_key']), $b);
    } catch (\Throwable $e) {
    }
    require_once __DIR__ . '/mailer.php';
    $atts = sanitize_email_attachments($in['attachments'] ?? []);
    $r = ['ok' => false, 'error' => 'send failed'];
    try {
        $r = send_enquiry_reply_email(array_merge($b, ['price' => $priceEst]), $subject, $message, 'booking', $atts);
    } catch (\Throwable $e) {
        $r = ['ok' => false, 'error' => $e->getMessage()];
    }
    if (empty($r['ok'])) {
        json_out(['error' => $r['error'] ?? 'Could not send the email'], 400);
    }
    log_activity('comms', 'booking.email', 'Emailed guest — ' . ($b['name'] ?: $b['email']), [
        'entity' => 'booking',
        'entity_id' => (string) $id,
        'prop_key' => $b['prop_key'] ?? '',
        // Keep the message so the Bookings page email log can show what was sent.
        'meta' => ['subject' => $subject, 'body' => mb_substr($message, 0, 3000)],
    ]);
    json_out(['ok' => true]);
}

// ---- Square online payments (admin side) ----------------------------------
// (square_deposit_pct, booking_amount_due live in pricing.php; site_base_url in db.php.)

// Email the guest a secure link to pay the deposit (or balance) on our site.
if ($action === 'request_payment') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet (see config.php / Manage).'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $kind = ($in['kind'] ?? 'deposit') === 'balance' ? 'balance' : 'deposit';
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (empty($b['email'])) {
        json_out(['error' => 'This booking has no guest email on file.'], 400);
    }

    require_once __DIR__ . '/mailer.php';
    $res = request_booking_payment($b, $kind);
    if (!empty($res['ok'])) {
        log_activity('payment', 'payment.request', ucfirst($kind) . ' payment request emailed — ' . ($b['name'] ?? ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
        json_out(['ok' => true, 'amount' => $res['amount']]);
    }
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 200);
}

// Return the secure pay link for a booking (to copy/share by WhatsApp, SMS, etc.)
// without emailing it. Same token the email uses; authorises paying THIS booking.
if ($action === 'pay_link') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet (see config.php / Manage).'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $kind = ($in['kind'] ?? 'balance') === 'deposit' ? 'deposit' : 'balance';
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $url = site_base_url() . 'index.html?pay=' . pay_token($id) . '&b=' . $id . '&k=' . $kind;
    json_out(['ok' => true, 'url' => $url, 'kind' => $kind]);
}

// ---- Refundable damage deposit as a Square card HOLD (authorise/capture/release) ----
// Return the secure "place your card hold" link (to copy/share), like pay_link.
if ($action === 'hold_link') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet.'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $url = site_base_url() . 'index.html?hold=' . pay_token($id) . '&b=' . $id;
    json_out(['ok' => true, 'url' => $url]);
}

// Email the guest the "place your refundable card hold" link.
if ($action === 'hold_request') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet.'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (empty($b['email'])) {
        json_out(['error' => 'This booking has no guest email on file.'], 400);
    }
    // Block the LEGACY hold flow on new-model rows too: 'charged' means the
    // deposit was already collected with the first payment (a second hold
    // would overwrite hold_payment_id and orphan the refund), and
    // 'returned'/'kept' mean the deposit is already settled after the stay.
    if (in_array($b['hold_status'] ?? 'none', ['authorized', 'captured', 'charged', 'returned', 'kept'], true)) {
        json_out(['error' => 'The damages deposit for this booking is already collected or settled.'], 409);
    }
    require_once __DIR__ . '/mailer.php';
    $rate = get_rate($b['prop_key']);
    $amt = round((float) ($b['agreed_booking_fee'] ?? 0), 2);
    // Fall back to a live calc ONLY for legacy rows with no snapshot — a modern row
    // with a deliberately-waived (£0) deposit must stay £0 (see pay.php).
    if (($b['agreed_total'] ?? null) === null && $rate) {
        $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
        $amt = round((float) $p['damagesDeposit'], 2);
    }
    if ($amt <= 0) {
        json_out(['error' => 'This booking has no damage deposit set.'], 400);
    }
    $url = site_base_url() . 'index.html?hold=' . pay_token($id) . '&b=' . $id;
    $res = send_hold_request(
        [
            'name' => $b['name'],
            'email' => $b['email'],
            'prop_key' => $b['prop_key'],
            'prop_name' => $rate['name'] ?? $b['prop_key'],
            'check_in' => $b['check_in'],
            'check_out' => $b['check_out'],
            'amount' => $amt,
        ],
        $url,
    );
    if (!empty($res['ok'])) {
        try {
            db()
                ->prepare('UPDATE bookings SET hold_requested_at = NOW() WHERE id = ?')
                ->execute([$id]);
        } catch (\Throwable $e) {
        }
        json_out(['ok' => true, 'amount' => $amt]);
    }
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 200);
}

// Capture the hold (keep the money — used when there IS damage). Square's
// CompletePayment captures the full authorised amount; refund any excess via the
// normal refund flow if the damage was less than the full deposit.
if ($action === 'hold_capture') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet.'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (($b['hold_status'] ?? 'none') !== 'authorized' || empty($b['hold_payment_id'])) {
        json_out(['error' => 'There is no active hold to capture.'], 409);
    }
    $res = square_api('POST', '/v2/payments/' . rawurlencode($b['hold_payment_id']) . '/complete', new stdClass());
    if (!in_array($res['status'], [200, 201], true)) {
        json_out(
            [
                'error' =>
                    $res['body']['errors'][0]['detail'] ?? 'Could not capture the hold (it may have already expired).',
            ],
            402,
        );
    }
    $amt = round((float) ($b['hold_amount'] ?? 0), 2);
    db()
        ->prepare('UPDATE bookings SET hold_status = ?, hold_settled_at = NOW() WHERE id = ?')
        ->execute(['captured', $id]);
    try {
        db()
            ->prepare(
                'INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, guest_name, prop_key, created_at) VALUES (?,?,?,?,?,?,?,NOW())',
            )
            ->execute([$id, $b['hold_payment_id'], 'damages', $amt, 'COMPLETED', $b['name'], $b['prop_key']]);
    } catch (\Throwable $e) {
    }
    log_activity('payment', 'hold.capture', 'Damage deposit charged — £' . number_format($amt, 2) . ($b['name'] ? ' · ' . $b['name'] : ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    json_out(['ok' => true, 'captured' => $amt]);
}

// Release the hold (the normal, no-damage case): cancel the authorisation so the
// funds are freed on the guest's card.
if ($action === 'hold_release') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet.'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (($b['hold_status'] ?? 'none') !== 'authorized' || empty($b['hold_payment_id'])) {
        json_out(['error' => 'There is no active hold to release.'], 409);
    }
    $res = square_api('POST', '/v2/payments/' . rawurlencode($b['hold_payment_id']) . '/cancel', new stdClass());
    // Treat an already-expired/canceled auth as released (the funds are free either way).
    $ok = in_array($res['status'], [200, 201], true) || stripos(json_encode($res['body'] ?? []), 'CANCELED') !== false;
    if (!$ok) {
        json_out(['error' => $res['body']['errors'][0]['detail'] ?? 'Could not release the hold.'], 402);
    }
    db()
        ->prepare('UPDATE bookings SET hold_status = ?, hold_settled_at = NOW() WHERE id = ?')
        ->execute(['released', $id]);
    $emailResult = null;
    if (!empty($b['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $rate = get_rate($b['prop_key']);
            $emailResult = send_hold_released([
                'name' => $b['name'],
                'email' => $b['email'],
                'prop_key' => $b['prop_key'],
                'prop_name' => $rate['name'] ?? $b['prop_key'],
                'amount' => round((float) ($b['hold_amount'] ?? 0), 2),
            ]);
        } catch (\Throwable $e) {
        }
    }
    log_activity('payment', 'hold.release', 'Damage-deposit hold released — ' . ($b['name'] ?? ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    json_out(['ok' => true, 'email' => $emailResult]);
}

// Refund a Square payment (full or partial) and re-reconcile the booking.
// Whether the standalone RENTAL refund is still allowed for a booking. Mirrors
// rentalRefundBlocked() in app.js: blocked once the guest has arrived, or once the
// cancellation policy leaves nothing refundable (flexible/moderate: at arrival;
// limited: inside 7 days of check-in). After that, only the refundable damages
// deposit (return_deposit) can go back. Enforced here so the API can't be used to
// bypass the hidden button.
function rental_refund_blocked($b)
{
    if (!$b || empty($b['check_in'])) {
        return false;
    }
    $today = date('Y-m-d');
    if ($b['check_in'] <= $today) {
        return true;
    }
    $pol = (string) (function_exists('content_value') ? content_value(($b['prop_key'] ?? '') . '-cancellation-policy') : '');
    $within = ['flexible' => 0, 'moderate' => 0, 'limited' => 7][$pol] ?? 0;
    if ($within <= 0) {
        return false;
    }
    // Parse both dates at UTC midnight (like last_minute_factor() in pricing.php)
    // so the day count is DST-immune and matches the JS mirror rentalRefundBlocked(),
    // which uses UTC. Local midnights would drift ±1 hour across the clock changes
    // and could drop a day near the boundary, wrongly blocking a limited-policy refund.
    $daysUntil = (int) floor((strtotime($b['check_in'] . ' UTC') - strtotime($today . ' UTC')) / 86400);
    return $daysUntil < $within;
}
if ($action === 'refund') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet.'], 400);
    }
    $sqId = clean($in['square_payment_id'] ?? '');
    if ($sqId === '') {
        json_out(['error' => 'Missing payment id'], 400);
    }
    $row = (function ($sq) {
        $s = db()->prepare('SELECT * FROM payments WHERE square_payment_id = ?');
        $s->execute([$sq]);
        return $s->fetch();
    })($sqId);
    if (!$row) {
        json_out(['error' => 'Payment not found'], 404);
    }
    if (in_array($row['kind'], ['refund', 'damages_return'], true)) {
        json_out(['error' => 'That row is itself a refund.'], 400);
    }

    $amount =
        array_key_exists('amount', $in) && $in['amount'] !== null && $in['amount'] !== ''
            ? round((float) $in['amount'], 2)
            : (float) $row['amount'];
    if ($amount <= 0 || $amount > (float) $row['amount'] + 0.001) {
        json_out(['error' => 'Refund amount must be between £0 and the original charge.'], 400);
    }
    $note = clean($in['note'] ?? '');

    $bookingId = (int) $row['booking_id'];
    $b = booking_by_id($bookingId); // may be null if the booking was already deleted
    $gName = $b['name'] ?? ($row['guest_name'] ?? null);
    $gProp = $b['prop_key'] ?? ($row['prop_key'] ?? null);
    book_lock($gProp ?? '');
    // Refunding a captured DAMAGE deposit must be booked as 'damages_return', not
    // 'refund' — otherwise reconcile subtracts it from the RENTAL paid figure (which
    // damages never contributed to) and falsely flips the booking to part-paid. This
    // is also the correct path for a partial return of a captured hold.
    $refundKind = $row['kind'] === 'damages' ? 'damages_return' : 'refund';
    // Once the guest has arrived or the cancellation window has closed, the RENTAL
    // is no longer refundable — only the damages deposit can be returned (via
    // return_deposit). Block a rental refund here; damages_return is unaffected.
    if ($refundKind === 'refund' && rental_refund_blocked($b)) {
        book_unlock($gProp ?? '');
        json_out(['error' => 'This booking is no longer refundable — the guest has arrived or the cancellation window has closed. Only the refundable damages deposit can be returned now.'], 409);
    }
    // Cap by what's ACTUALLY still refundable on this booking — not just this row's
    // original amount — so repeated refunds can't exceed the money taken (and, with
    // the bundled deposit, can't eat into its Square headroom).
    $cap = null;
    if ($refundKind === 'damages_return' && $b) {
        $cap = round(max(0, damages_collected($b) - damages_returned($bookingId)), 2);
    } elseif ($refundKind === 'refund') {
        try {
            $ns = db()->prepare(
                "SELECT COALESCE(SUM(CASE WHEN kind IN('deposit','balance') AND status IN('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
                       - COALESCE(SUM(CASE WHEN kind='refund' THEN amount ELSE 0 END),0)
                 FROM payments WHERE booking_id = ?",
            );
            $ns->execute([$bookingId]);
            $cap = round(max(0, (float) $ns->fetchColumn()), 2);
        } catch (\Throwable $e) {
            $cap = null;
        }
    }
    if ($cap !== null && $amount > $cap + 0.001) {
        book_unlock($gProp ?? '');
        json_out(['error' => 'Only £' . number_format($cap, 2) . ' is still refundable on this booking.'], 400);
    }
    $rr = record_square_refund($bookingId, $sqId, $amount, $refundKind, $note, $gName, $gProp);
    if (empty($rr['ok'])) {
        book_unlock($gProp ?? '');
        json_out(['error' => $rr['error']], 402);
    }
    $rec = reconcile_booking_payment($bookingId, $b);
    book_unlock($gProp ?? '');

    // Tell the guest a refund is on its way (best-effort — never fails the refund).
    $emailResult = null;
    if ($b && !empty($b['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $rate = get_rate($b['prop_key']);
            $emailResult = send_refund_email([
                'name' => $b['name'],
                'email' => $b['email'],
                'prop_key' => $b['prop_key'],
                'prop_name' => $rate['name'] ?? $b['prop_key'],
                'check_in' => $b['check_in'],
                'check_out' => $b['check_out'],
                'amount' => $amount,
                'reason' => $note,
            ]);
        } catch (\Throwable $e) {
            $emailResult = ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    log_activity('payment', 'booking.refund', 'Refund issued — £' . number_format((float) $amount, 2), ['prop_key' => $gProp ?? '', 'entity' => 'booking', 'entity_id' => (string) $bookingId]);
    json_out(['ok' => true, 'refunded' => $amount, 'status' => $rec['status'], 'email' => $emailResult]);
}

// Return the held refundable damage deposit (full or partial) after checkout.
// Tracked as 'damages_return' so it never changes the rental payment status.
if ($action === 'return_deposit') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $note = clean($in['note'] ?? '');
    // Only refund once the guest has actually left.
    if (($b['check_out'] ?? '') !== '' && $b['check_out'] > date('Y-m-d')) {
        json_out(['error' => "The guest hasn't checked out yet — refund the deposit after they leave."], 409);
    }
    $reqAmount =
        array_key_exists('amount', $in) && $in['amount'] !== null && $in['amount'] !== ''
            ? round((float) $in['amount'], 2)
            : null;

    // Serialise, then re-read the deposit state UNDER the lock: a concurrent refund
    // or keep records its ledger/hold change first, so the second caller sees the
    // reduced remaining amount and can't double-return.
    book_lock($b['prop_key'] ?? '');
    $b = booking_by_id($id) ?: $b;
    $held = round(max(0, damages_collected($b) - damages_returned($id)), 2);
    if ($held <= 0) {
        book_unlock($b['prop_key'] ?? '');
        json_out(['error' => 'This deposit has already been settled.'], 409);
    }
    $amount = $reqAmount === null ? $held : $reqAmount;
    if ($amount <= 0 || $amount > $held + 0.001) {
        book_unlock($b['prop_key'] ?? '');
        json_out(['error' => 'Return amount must be between £0 and the held deposit (' . $held . ').'], 400);
    }
    // Charge-upfront deposits ride on their own Square payment (hold_payment_id) —
    // refund straight against it. (find_charge_for_refund only sees the rental
    // ledger rows, which may be smaller than the deposit.) Legacy CAPTURED card
    // holds route the same way: their ledger row is kind 'damages', invisible to
    // find_charge_for_refund, so falling through would refund against a rental
    // payment (mis-attributed at Square) or record a MANUAL return while the
    // captured money never moves. (The UI serves captured holds via the per-row
    // 'refund' action instead — this is the server-side guard for direct calls.)
    $charge = null;
    if (square_enabled()) {
        $charge =
            in_array($b['hold_status'] ?? '', ['charged', 'captured'], true) && !empty($b['hold_payment_id'])
                ? $b['hold_payment_id']
                : find_charge_for_refund($id, $amount);
    }
    if ($charge) {
        $rr = record_square_refund($id, $charge, $amount, 'damages_return', $note, $b['name'], $b['prop_key']);
        if (empty($rr['ok'])) {
            book_unlock($b['prop_key'] ?? '');
            json_out(['error' => $rr['error']], 402);
        }
        $status = $rr['status'];
    } else {
        // No card charge to refund against (manual/cash booking) — record that the
        // owner has returned it by hand.
        insert_payment_row(
            $id,
            'manual-' . bin2hex(random_bytes(8)),
            'damages_return',
            $amount,
            'MANUAL',
            $b['name'],
            $b['prop_key'],
            $note,
        );
        $status = 'MANUAL';
    }
    // New model (and a fully-returned legacy captured hold): once the whole
    // deposit is handed back, mark it settled.
    if (in_array($b['hold_status'] ?? '', ['charged', 'captured'], true) && $held - $amount <= 0.001) {
        try {
            db()
                ->prepare('UPDATE bookings SET hold_status = ?, hold_settled_at = NOW() WHERE id = ?')
                ->execute(['returned', $id]);
        } catch (\Throwable $e) {
        }
    }
    book_unlock($b['prop_key'] ?? '');

    $emailResult = null;
    if (!empty($b['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $rate = get_rate($b['prop_key']);
            $emailResult = send_deposit_return_email([
                'name' => $b['name'],
                'email' => $b['email'],
                'prop_key' => $b['prop_key'],
                'prop_name' => $rate['name'] ?? $b['prop_key'],
                'check_in' => $b['check_in'],
                'check_out' => $b['check_out'],
                'amount' => $amount,
                'held' => $held,
                'reason' => $note,
                'manual' => $status === 'MANUAL',
            ]);
        } catch (\Throwable $e) {
            $emailResult = ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    log_activity('payment', 'deposit.return', 'Damage deposit returned — £' . number_format((float) $amount, 2) . ($b['name'] ? ' · ' . $b['name'] : ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    json_out(['ok' => true, 'returned' => $amount, 'status' => $status, 'email' => $emailResult]);
}

// Keep a charge-upfront deposit (there WAS damage): don't refund it. Marks the
// deposit settled and books the kept amount as retained income (a 'damages' ledger
// row, so it's never confused with rental). No Square call — the money's already in.
if ($action === 'keep_deposit') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $note = clean($in['note'] ?? '');
    // Serialise + re-read under the lock so a concurrent refund/keep can't
    // double-settle (refund the guest AND book it as kept income).
    book_lock($b['prop_key'] ?? '');
    $b = booking_by_id($id) ?: $b;
    if (($b['hold_status'] ?? '') !== 'charged') {
        book_unlock($b['prop_key'] ?? '');
        json_out(['error' => 'This deposit has already been settled.'], 409);
    }
    $held = round(max(0, damages_collected($b) - damages_returned($id)), 2);
    if ($held <= 0) {
        book_unlock($b['prop_key'] ?? '');
        json_out(['error' => 'This deposit has already been settled.'], 409);
    }
    // Record the kept deposit as income (kind 'damages'; excluded from rental status).
    insert_payment_row($id, 'kept-' . bin2hex(random_bytes(8)), 'damages', $held, 'COMPLETED', $b['name'], $b['prop_key'], $note);
    try {
        db()
            ->prepare('UPDATE bookings SET hold_status = ?, hold_settled_at = NOW() WHERE id = ?')
            ->execute(['kept', $id]);
    } catch (\Throwable $e) {
    }
    book_unlock($b['prop_key'] ?? '');
    log_activity('payment', 'deposit.kept', 'Damage deposit kept (damage) — £' . number_format($held, 2) . ($b['name'] ? ' · ' . $b['name'] : ''), ['severity' => 'warn', 'prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id, 'meta' => $note !== '' ? ['detail' => $note] : []]);
    json_out(['ok' => true, 'kept' => $held]);
}

// Cancel a booking: optional refund (per chosen amount), email the guest, then
// free the dates by deleting it (the ledger rows are kept for the record).
if ($action === 'cancel') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $reason = clean($in['reason'] ?? '');
    $refundAmount =
        array_key_exists('refund_amount', $in) && $in['refund_amount'] !== null && $in['refund_amount'] !== ''
            ? round((float) $in['refund_amount'], 2)
            : 0.0;
    $refundedByCard = 0.0;
    $depositRefunded = 0.0; // refundable damage deposit auto-returned below (reported back)
    if ($refundAmount > 0 && square_enabled()) {
        $charge = find_charge_for_refund($id, $refundAmount);
        if ($charge) {
            book_lock($b['prop_key'] ?? '');
            $rr = record_square_refund(
                $id,
                $charge,
                $refundAmount,
                'refund',
                $reason !== '' ? $reason : 'Cancellation',
                $b['name'],
                $b['prop_key'],
            );
            book_unlock($b['prop_key'] ?? '');
            if (empty($rr['ok'])) {
                json_out(['error' => 'Refund failed: ' . $rr['error']], 402);
            }
            $refundedByCard = $refundAmount;
        }
        // No single charge big enough → leave it for a manual refund; still cancel + email.
    }
    // Settle the refundable damage deposit / legacy hold BEFORE the row is deleted —
    // afterwards there's no hold_payment_id to act against. A charged deposit is
    // refunded to the guest (they aren't staying); a legacy authorised hold is
    // released. Best-effort — never blocks the cancellation.
    if (square_enabled()) {
        $hs = $b['hold_status'] ?? 'none';
        if ($hs === 'charged' && !empty($b['hold_payment_id'])) {
            $dep = round(max(0, damages_collected($b) - damages_returned($id)), 2);
            if ($dep > 0) {
                book_lock($b['prop_key'] ?? '');
                $depRr = record_square_refund($id, $b['hold_payment_id'], $dep, 'damages_return', 'Booking cancelled', $b['name'], $b['prop_key']);
                book_unlock($b['prop_key'] ?? '');
                if (!empty($depRr['ok'])) {
                    $depositRefunded = $dep;
                }
            }
        } elseif ($hs === 'authorized' && !empty($b['hold_payment_id'])) {
            try {
                square_api('POST', '/v2/payments/' . rawurlencode($b['hold_payment_id']) . '/cancel', new stdClass());
            } catch (\Throwable $e) {
            }
        }
    }
    $emailResult = null;
    if (!empty($b['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $rate = get_rate($b['prop_key']);
            $emailResult = send_cancellation_email([
                'name' => $b['name'],
                'email' => $b['email'],
                'prop_key' => $b['prop_key'],
                'prop_name' => $rate['name'] ?? $b['prop_key'],
                'check_in' => $b['check_in'],
                'check_out' => $b['check_out'],
                'refund' => $refundAmount,
                'card' => $refundedByCard > 0,
                'reason' => $reason,
            ]);
        } catch (\Throwable $e) {
            $emailResult = ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    db()
        ->prepare('DELETE FROM bookings WHERE id = ?')
        ->execute([$id]);
    try {
        require_once __DIR__ . '/waitlist.php';
        waitlist_notify_freed($b['prop_key'] ?? '', $b['check_in'] ?? '', $b['check_out'] ?? '');
    } catch (\Throwable $e) {
    }
    log_activity(
        'booking',
        'booking.cancel',
        'Booking cancelled — ' . ($b['name'] ?? '') . ($refundAmount > 0 ? ' (refund £' . number_format((float) $refundAmount, 2) . ')' : ''),
        ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id],
    );
    json_out([
        'ok' => true,
        'refunded' => $refundedByCard,
        // The refundable damage deposit is returned on its OWN Square payment here —
        // report it so the owner isn't left thinking they must refund it by hand (and
        // double-return it) when the rental refund couldn't be auto-matched.
        'deposit_refunded' => $depositRefunded,
        'manual_refund' => $refundAmount > $refundedByCard + 0.001,
        'email' => $emailResult,
    ]);
}

// Per-booking log of emails sent to the guest (Bookings page → each booking).
// Reads the activity log: comms.* (confirmation / arrival / free-text message)
// plus payment.request (the pay-link email). Keyed by booking id (string).
if ($action === 'email_logs') {
    require_admin();
    try {
        $rows = db()
            ->query(
                "SELECT entity_id, action, summary, meta, created_at
                   FROM activity_log
                  WHERE entity = 'booking'
                    AND (category = 'comms' OR action = 'payment.request')
               ORDER BY created_at DESC
                  LIMIT 3000",
            )
            ->fetchAll();
        $map = [];
        foreach ($rows as $r) {
            $id = (string) ($r['entity_id'] ?? '');
            if ($id === '') {
                continue;
            }
            if (!isset($map[$id])) {
                $map[$id] = [];
            }
            // Free-text messages carry the subject/body in meta (JSON); templated
            // emails (confirmation/arrival/pay request) have none.
            $meta = [];
            if (!empty($r['meta'])) {
                $decoded = json_decode((string) $r['meta'], true);
                if (is_array($decoded)) {
                    $meta = $decoded;
                }
            }
            $map[$id][] = [
                'action' => $r['action'],
                'summary' => $r['summary'],
                'at' => $r['created_at'],
                'subject' => isset($meta['subject']) ? (string) $meta['subject'] : '',
                'body' => isset($meta['body']) ? (string) $meta['body'] : '',
            ];
        }
        json_out(['logs' => $map]);
    } catch (\Throwable $e) {
        json_out(['logs' => []]);
    }
}

// Everything the activity log recorded about ONE booking — created, edited,
// payments recorded, emails, cancellation — newest first. Powers the booking
// hub's History card, so "what happened on this booking?" is answerable in
// one look instead of scrolling the whole site-wide activity feed.
if ($action === 'history') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $events = [];
    try {
        $st = db()->prepare(
            "SELECT action, summary, actor, created_at
               FROM activity_log
              WHERE entity = 'booking' AND entity_id = ?
           ORDER BY id DESC
              LIMIT 80",
        );
        $st->execute([(string) $id]);
        foreach ($st->fetchAll() as $r) {
            $events[] = [
                'action' => $r['action'],
                'summary' => $r['summary'],
                'actor' => $r['actor'] ?: 'system',
                'at' => $r['created_at'],
            ];
        }
    } catch (\Throwable $e) {
        // table not migrated yet → empty history, never an error
    }
    json_out(['ok' => true, 'events' => $events]);
}

// Regenerate a templated email exactly as it would be sent to the guest, so the
// owner can READ it (from the email log) or REVIEW it before hitting send.
// Reuses the real builders via mail-preview capture (no send, no side effects).
// Supported kinds: email.confirmation, email.arrival, payment.request.
// NB: distinct action from the free-text composer 'email_preview' above — that
// one shadowed this block, so the templated preview never actually ran.
if ($action === 'email_render') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $kind = preg_replace('/[^a-z._]/', '', strtolower((string) ($in['kind'] ?? '')));
    require_once __DIR__ . '/mailer.php';
    if (!function_exists('mail_preview_start')) {
        json_out(['error' => 'Preview isn’t available on this version.'], 200);
    }
    mail_preview_start();
    try {
        if ($kind === 'email.arrival') {
            // Build the payload the way send_arrival_for_booking does, but call the
            // pure sender directly so we DON'T stamp pre_arrival_sent on a preview.
            $pp = db()->prepare('SELECT name, address FROM properties WHERE prop_key = ?');
            $pp->execute([$b['prop_key']]);
            $prop = $pp->fetch() ?: ['name' => $b['prop_key'], 'address' => ''];
            send_arrival_email([
                'prop_key' => $b['prop_key'],
                'prop_name' => $prop['name'],
                'name' => $b['name'],
                'email' => $b['email'],
                'check_in' => $b['check_in'],
                'check_out' => $b['check_out'],
                'check_in_time' => $b['check_in_time'] ?? '15:00',
                'address' => $prop['address'],
            ]);
        } elseif ($kind === 'payment.request') {
            request_booking_payment($b, 'balance'); // no side effects — just builds a signed link
        } else {
            send_booking_confirmation($id); // email.confirmation (default)
        }
    } catch (\Throwable $e) {
        // fall through — an empty capture becomes the "no preview" response below
    }
    $caps = mail_preview_take();
    $pick = null;
    foreach ($caps as $c) {
        if (!empty($b['email']) && strcasecmp($c['to'], (string) $b['email']) === 0) {
            $pick = $c; // the guest copy (confirmation also builds an owner copy)
            break;
        }
    }
    if (!$pick && $caps) {
        $pick = $caps[0];
    }
    if (!$pick) {
        json_out(['error' => 'That email can’t be previewed (it may need Square on, or there’s nothing left to pay).'], 200);
    }
    json_out(['ok' => true, 'subject' => $pick['subject'], 'html' => $pick['html'], 'text' => $pick['text']]);
}

// Per-booking damage-deposit returns, summed (Money & income dashboard).
if ($action === 'deposit_returns') {
    try {
        $rows = db()
            ->query(
                "SELECT booking_id, COALESCE(SUM(amount),0) total FROM payments WHERE kind = 'damages_return' GROUP BY booking_id",
            )
            ->fetchAll();
        $map = [];
        foreach ($rows as $r) {
            $map[(string) $r['booking_id']] = round((float) $r['total'], 2);
        }
        json_out(['returns' => $map]);
    } catch (\Throwable $e) {
        json_out(['returns' => []]);
    }
}

// List the Square payment ledger for a booking (admin detail panel).
if ($action === 'payments') {
    $id = (int) ($in['id'] ?? 0);
    try {
        $s = db()->prepare(
            'SELECT square_payment_id, kind, amount, status, note, created_at FROM payments WHERE booking_id = ? ORDER BY id ASC',
        );
        $s->execute([$id]);
        json_out(['payments' => $s->fetchAll()]);
    } catch (\Throwable $e) {
        json_out(['payments' => []]);
    }
}

// Recent Square transactions across all bookings (Money & income feed).
// LEFT JOIN + snapshot fallback so payments/refunds from DELETED bookings stay
// visible (the ledger rows are deliberately kept when a booking is removed).
if ($action === 'recent_payments') {
    try {
        $rows = db()
            ->query(
                'SELECT p.square_payment_id, p.kind, p.amount, p.fee, p.status, p.note, p.created_at,
                    COALESCE(b.name, p.guest_name) AS name,
                    COALESCE(b.prop_key, p.prop_key) AS prop_key,
                    (b.id IS NULL) AS booking_deleted
             FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
             ORDER BY p.id DESC LIMIT 50',
            )
            ->fetchAll();
        json_out(['payments' => $rows]);
    } catch (\Throwable $e) {
        // Pre-snapshot schema: fall back to the inner join (no deleted-booking rows).
        try {
            $rows = db()
                ->query(
                    'SELECT p.square_payment_id, p.kind, p.amount, p.status, p.created_at, b.name, b.prop_key
                 FROM payments p JOIN bookings b ON b.id = p.booking_id ORDER BY p.id DESC LIMIT 50',
                )
                ->fetchAll();
            json_out(['payments' => $rows]);
        } catch (\Throwable $e2) {
            json_out(['payments' => []]);
        }
    }
}

// Remove a single Square transaction from the ledger (e.g. tidying up test
// payments). This only deletes the audit record — it does not refund the guest
// or change a booking's stored figures.
json_out(['error' => 'Unknown action'], 400);
