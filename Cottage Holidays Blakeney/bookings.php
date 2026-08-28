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
require_once __DIR__ . '/payments-reconcile.php'; // reconcile_pending_refunds / reconcile_missing_fees

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
    // Exclude the booking's OWN re-imported mirror: the site exports its bookings
    // to the platforms, which re-import them and export them back, so a two-way
    // sync stores each of our bookings as an ical_blocks row at the same dates.
    // Without excluding it, editing a synced booking (even a phone-number fix that
    // changes no dates) false-clashed against its own mirror — training reflexive
    // override, which then skips every check. The mirror sits at the ignored
    // booking's dates, so a block exactly matching them is skipped.
    try {
        $mirrorFrom = '';
        $mirrorTo = '';
        if ($ignoreId) {
            $mq = db()->prepare('SELECT check_in, check_out FROM bookings WHERE id = ?');
            $mq->execute([$ignoreId]);
            if ($mrow = $mq->fetch()) {
                $mirrorFrom = (string) $mrow['check_in'];
                $mirrorTo = (string) $mrow['check_out'];
            }
        }
        $s2 = db()->prepare(
            'SELECT source, check_in, check_out FROM ical_blocks WHERE prop_key = ? AND check_in < ? AND check_out > ?',
        );
        $s2->execute([$propKey, $checkOut, $checkIn]);
        foreach ($s2->fetchAll() as $b) {
            if ((string) $b['check_in'] === $mirrorFrom && (string) $b['check_out'] === $mirrorTo && $mirrorFrom !== '') {
                continue; // this block is a mirror of the booking being edited
            }
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
// $withDeposit: the agreed damages deposit when the owner says they collected it
// in cash/bank alongside the rental (the cash rail's version of pay.php bundling
// it into the first card payment). Only ever added on 'paid' — the one state
// where "everything, including the deposit" is unambiguous — and only the exact
// agreed figure, never an arbitrary overpayment. Before this there was NO way to
// record a cash-collected deposit at all: 'paid' clamped to the rental total and
// a deposit-inclusive partial was refused, so the £50 in the drawer was invisible
// to the deposits-to-return queue, the duties list and the return flow — while
// every DISPLAY of the state was already consistent (displayGrand, the
// confirmation, damages_collected all read paid-above-rental as the deposit).
function reconcile_deposit($status, $total, $currentDep, $proposedDep, $withDeposit = 0.0)
{
    if ($status === 'paid') {
        return round($total + max(0.0, (float) $withDeposit), 2);
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
            ->execute([$bookingId, $sqId, $kind, $amount, payment_status_norm($status), $gName, $gProp, $note !== '' ? $note : null]);
    } catch (\Throwable $e) {
        try {
            db()
                ->prepare(
                    'INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, created_at) VALUES (?,?,?,?,?,NOW())',
                )
                ->execute([$bookingId, $sqId, $kind, $amount, payment_status_norm($status)]);
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
            WHERE booking_id = ? AND kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED')
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
// reconcile_pending_refunds() + reconcile_missing_fees() moved to the shared
// payments-reconcile.php (required at the top of this file) so cron.php can run
// the same settlement back-fill daily, not only on the recent_payments view.

// Re-derive the booking's rental payment status from the ledger (charges − rental
// refunds). NOTE: 'damages_return' is deliberately excluded — returning a held
// deposit must never make a booking look unpaid.
function reconcile_booking_payment($bookingId, $b = null, $refundJustIssued = 0)
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
    $ledgerNet = booking_ledger_net($bookingId);
    // The booking's recorded deposit_paid can include MANUALLY entered cash/bank
    // payments that have NO ledger rows (set_payment). Recomputing paid purely from
    // the ledger would wipe that money the moment a card refund is issued. A refund
    // reduces paid by exactly the refunded amount, so floor the figure at
    // priorPaid − thisRefund; the ledger net is only used when it's HIGHER (a card
    // payment that settled). With no refund passed, paid never drops.
    $prior = round((float) ($b['deposit_paid'] ?? 0), 2);
    $paid = round(max(0, max($ledgerNet, $prior - (float) $refundJustIssued)), 2);
    if ($total > 0) {
        // The cap allows the CASH-collected damages deposit on top of the rental
        // (hold_status 'none' — the card rail records its deposit on hold_*, so
        // its cap stays the rental). Without the headroom, the first card event
        // on a booking whose owner had recorded rental + deposit clamped
        // deposit_paid back to the rental — silently erasing the deposit from
        // the deposits-to-return queue it had just joined.
        $cap =
            ($b['hold_status'] ?? 'none') === 'none'
                ? round($total + max(0.0, (float) ($b['agreed_booking_fee'] ?? 0)), 2)
                : $total;
        $paid = min($cap, $paid);
    }
    $status = derive_payment_status($total, $paid);
    // Do NOT restamp payment_date on a refund — accounts.php allocates the WHOLE
    // booking's income to the year of payment_date, so moving it to the refund date
    // would shift all its income into the wrong UK tax year. And do NOT advance it
    // on an increase either: card money is dated by its own ledger row, while
    // payment_date is the only date the manual cash/bank remainder carries, so
    // advancing it moved earlier manual income forward (the pay.php fix, mirrored).
    // Stamp today only when no date is recorded yet; keep an existing one; null at zero.
    $existingDate = trim((string) ($b['payment_date'] ?? ''));
    $newDate = $paid <= 0 ? null : ($existingDate !== '' ? $existingDate : date('Y-m-d'));
    db()
        ->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_date=? WHERE id=?')
        ->execute([$status, $paid, $newDate, $bookingId]);
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
    $rental = booking_rental_price($b);
    $paid = (float) ($b['deposit_paid'] ?? 0);
    return round(max(0.0, min($held, $paid - $rental)), 2);
}
function damages_returned($bookingId)
{
    // Delegates so there is ONE query shape for "what has actually gone back" — the
    // three display sites had drifted into an unfiltered copy of it.
    return damages_returned_map([(int) $bookingId])[(int) $bookingId] ?? 0.0;
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
            'ref' => $ref,
            // The booking's own id, so the confirmation can sign a pay link and
            // the owner copy can link straight to the hub. Without it both
            // features are dead code guarded on a key nobody passed.
            'id' => (int) $bookingId,
            // Payment state so the confirmation reflects money received (shown only
            // when something has been paid; a fresh unpaid booking omits it).
            'paid_so_far' => $paidSoFar,
            'balance_due' => $balanceDue,
            // WHEN the rest falls due, from this booking's own plan. The
            // confirmation stated how much was outstanding and never by when,
            // so the schedule the owner agreed existed only in the back office.
            'balance_due_date' => booking_balance_due_date($b),
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
        // The SHARED figure — this used to sum every damages_return row regardless of
        // status, so a FAILED refund made the hub show the deposit as settled.
        $ret = damages_returned_map();
        foreach ($rows as &$bk) {
            $bk['damages_returned'] = $ret[(int) $bk['id']] ?? 0;
        }
        unset($bk);
    } catch (\Throwable $e) {
    }
    // THE PLAN'S STATE, on the owner path too. booking_autopay_state is already
    // derived for my-bookings.php, and app.js's mapper documents autopayState as ''
    // here — so nothing owner-side could tell an ARRANGED balance from an unpaid
    // one. A guest who consented to automatic collection produced an ordinary chase
    // duty every day, and both taps it offered emailed them a "pay your balance"
    // request for money that will be taken from their card in three days,
    // contradicting the "Balance · already arranged" the app showed them.
    try {
        require_once __DIR__ . '/pricing.php';
        foreach ($rows as &$bk) {
            [$st] = booking_autopay_state($bk);
            $bk['autopay_state'] = $st;
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
    // The Guest Book (owner-only payload — this function is only ever served
    // behind require_admin). Attached as gr_* fields; best-effort so a
    // pre-migration install just carries no ratings.
    try {
        $gr = [];
        foreach (db()->query('SELECT * FROM guest_ratings') as $r) {
            $gr[(int) $r['booking_id']] = $r;
        }
        foreach ($rows as &$bk) {
            $r = $gr[(int) $bk['id']] ?? null;
            if ($r) {
                $bk['gr_overall'] = (int) $r['overall'];
                $bk['gr_clean'] = $r['clean'];
                $bk['gr_rules'] = $r['rules'];
                $bk['gr_comms'] = $r['comms'];
                $bk['gr_note'] = $r['note'];
                $bk['gr_rated_at'] = $r['rated_at'];
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

// payment_plan_parse lives in pricing.php, beside booking_deposit_amount and
// booking_balance_due_date — the other two halves of the same plan. It moved
// there when enquiry approval needed it: bookings.php is a ROUTED endpoint, so
// requiring it to reach one validator would have run its routing (the trap the
// *-lib.php extractions exist for).

if ($action === 'add') {
    // Exactly-once for a hand-retried save: the client stamps a DETERMINISTIC
    // op_id (chbOpFor — same form, same id; any edit, a fresh one), so a retry
    // whose first attempt landed but lost its reply is answered from the
    // ledger instead of double-adding the booking. Warn/clash/error exits
    // below store nothing — a refusal must re-run (the op-ledger rule).
    $opTok = op_claim($in);
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

    // A payment plan set AT booking time (the Add form's optional fields) —
    // validated by the SAME rules as the hub's Edit-plan dialog, refused
    // BEFORE anything is written, and stored in the same INSERT so a refusal
    // or failure can never leave a booking half-created. The plan columns
    // join the statement only when a plan was actually given, so an
    // un-migrated database keeps adding standard bookings untouched.
    [$planPct, $planAmt, $planDue] = payment_plan_parse($in, $checkIn, (float) $snap['agreed_total']);

    $cols = 'prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,notes,payment,
         deposit_paid,payment_method,payment_date,
         agreed_total,agreed_per_night,agreed_nights,agreed_nightly,agreed_booking_fee,agreed_txn_pct,agreed_txn_fee,agreed_on,price_override';
    $vals = [
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
    ];
    if ($planPct !== null || $planAmt !== null || $planDue !== null) {
        $cols .= ',deposit_pct_override,deposit_amount_override,balance_due_date';
        array_push($vals, $planPct, $planAmt, $planDue);
    }
    db()
        ->prepare('INSERT INTO bookings (' . $cols . ') VALUES (' . implode(',', array_fill(0, count($vals), '?')) . ')')
        ->execute($vals);
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
            $pc = db()->prepare('SELECT COUNT(*) FROM bookings WHERE email = ? AND id <> ?');
            $pc->execute([$guestEmail, $newId]);
            $priorStays = (int) $pc->fetchColumn();
        } catch (\Throwable $e) {
        }
    }
    log_activity(
        'booking',
        $priorStays > 0 ? 'booking.repeat_guest' : 'booking.add',
        ($priorStays > 0 ? 'Repeat guest booked — ' . $name . ' (' . ($priorStays + 1) . ' stays)' : 'Booking created — ' . $name) . via_label($in),
        ['prop_key' => $propKey, 'entity' => 'booking', 'entity_id' => (string) $newId, 'meta' => ['detail' => trim($checkIn . ' → ' . $checkOut)]],
    );
    json_out(op_finish($opTok, ['ok' => true, 'id' => $newId, 'email' => $emailResult]));
}

if ($action === 'update') {
    // Same exactly-once posture as 'add'. The write itself is absolute values,
    // so a double-apply would be harmless — what the ledger buys here is the
    // retry being ANSWERED (with `material` intact) instead of re-walking the
    // whole warn ladder against the row it already changed.
    $opTok = op_claim($in);
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
    // Only worth a clash check when the dates or cottage actually change — an edit
    // that leaves the stay where it is (a phone-number or note fix) cannot create
    // a new overlap, so running it there only produced false "Save anyway?" asks.
    $datesMoved = $propKey !== $b['prop_key'] || $checkIn !== $b['check_in'] || $checkOut !== $b['check_out'];
    if (empty($in['override_clash']) && $datesMoved) {
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

    // Money ACTUALLY received is a fact — it must never change just because the
    // stay was re-priced. reconcile_deposit('paid', $total) returns $total, so
    // letting it run on a stay edit rewrote deposit_paid up to the NEW total,
    // fabricating an extension as already-paid (the hub then said "all set" and
    // never chased the balance) — or clamped it down and erased an owed refund.
    // So we only defer to reconcile_deposit when the owner EXPLICITLY edits the
    // payment (a `payment` or `deposit` field in the request — the payment editor
    // sends these; the trim-paid-fields stay edit does not). Otherwise we PRESERVE
    // the received amount and only re-derive the status against the new total, so
    // an extended paid booking correctly flips to 'deposit' with the balance owed.
    $explicitPay = array_key_exists('payment', $in) || array_key_exists('deposit', $in);
    if ($explicitPay) {
        $status = in_array($in['payment'] ?? $b['payment'], ['unpaid', 'deposit', 'paid'])
            ? $in['payment'] ?? $b['payment']
            : $b['payment'];
        $dep = reconcile_deposit($status, $total, $b['deposit_paid'], $in['deposit'] ?? null);
        if ($dep === null) {
            json_out(['error' => 'A deposit must be more than £0 and less than the total'], 400);
        }
    } else {
        $dep = round((float) ($b['deposit_paid'] ?? 0), 2);
        $status = derive_payment_status($total, $dep);
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

    // THE PLAN TRAVELS WITH THE STAY. This action writes check_in, and used to
    // leave a custom balance_due_date exactly where it was — which could move a
    // booking INTO the state set_payment_plan refuses (due after check-in), and
    // then every downstream reader under-asks. booking_replan_on_move is the one
    // decision; here we only persist what it returns.
    $replan = booking_replan_on_move($b['check_in'] ?? '', $checkIn, $b['balance_due_date'] ?? null);

    // THE ARRIVAL EMAIL DESCRIBES A STAY — "your stay at {cottage} begins on
    // {date}, check-in from {time}" — and this action can change the stay out
    // from under it. pre_arrival_sent is exactly the flag migration-107's note
    // warns against ("a flag would have to be remembered-to-be-cleared at every
    // site that can move the date"), and no site cleared it: move the dates or
    // the cottage after the email went and the guest holds arrival info naming
    // a stay that no longer exists, the cron's IS NULL guard never re-fires,
    // the pipeline reads "Arrival info ✓", and the hub's own send-arrival next
    // action stays suppressed by the stamp. Autopay solved the same problem by
    // COMPARING (booking_autopay_state re-derives and reads a moved date as
    // stale); this stamp has nothing to compare against, so it is cleared and
    // the cron re-sends for the stay as it now is. Only for a FUTURE stay:
    // editing a finished booking is a record correction, and un-stamping
    // history would flip a past stay's pipeline. empty() also stands the whole
    // thing down on a pre-migration DB, where $b carries no such key.
    $reArrival = !empty($b['pre_arrival_sent'])
        && ($checkIn !== ($b['check_in'] ?? '') || $propKey !== ($b['prop_key'] ?? ''))
        && $checkIn >= date('Y-m-d');

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
    if ($replan['changed']) {
        $sql .= ',balance_due_date=?';
        $args[] = $replan['due'];
    }
    if ($reArrival) {
        $sql .= ',pre_arrival_sent=NULL';
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
    // A plan that re-anchored itself must SAY so — it is the owner's agreement
    // with a guest, and a silent change to it is the thing to be afraid of here.
    if ($replan['changed']) {
        $changes[] = $replan['reason'] === 'past'
            ? 'balance due date dropped to the site standard (it would now be in the past)'
            : 'balance due date moved with the stay ⇒ ' . uk_date($replan['due']);
    }
    // Says so in the history, because the guest is about to receive a second
    // arrival email and the owner should not have to wonder why.
    if ($reArrival) {
        $changes[] = 'arrival info will be re-sent — the email already sent names the old stay';
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
    // WHICH EDITS CHANGE THE AGREEMENT. The client offers to email an updated
    // confirmation after a save (offerUpdatedConfirmationEmail), and it offered
    // after EVERY save — so correcting a typo in a phone number raised a dialog
    // asking whether to re-send the guest their booking confirmation. An ask that
    // appears when nothing the guest would notice has changed teaches the owner to
    // dismiss it, which is how the one that matters gets dismissed too.
    //
    // Material = what the confirmation actually STATES and the guest acts on: the
    // dates, the cottage, the party, and the price. Contact details, notes and the
    // payment-method label are not — the guest already knows their own phone number.
    // Derived here rather than in the client because the client does not hold the
    // OLD row; it has already overwritten its copy.
    $material = $checkIn !== ($b['check_in'] ?? '')
        || $checkOut !== ($b['check_out'] ?? '')
        || $propKey !== ($b['prop_key'] ?? '')
        || (int) $adults !== (int) ($b['adults'] ?? 0)
        || (int) $children !== (int) ($b['children'] ?? 0)
        || $priceOverride !== $oldOverride;
    json_out(op_finish($opTok, ['ok' => true, 'material' => $material]));
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
    // Replay-safe: the offline day sheet queues this write and retries it, and a
    // stale replay would REGRESS deposit_paid to an older figure (this action
    // writes an absolute, reconciled value). op_claim answers a repeat from the
    // ledger before any work happens.
    $opTok = op_claim($in);
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
    // Legacy pre-snapshot rows have agreed_total NULL → total 0, against which
    // choosing 'Paid' reconciled deposit_paid to £0 (wiping recorded income) and
    // 'deposit' was impossible. Fall back to the LIVE price via booking_price()
    // (agreed-first, then live — same helper pay.php / the composer use) so a
    // legacy booking prices like any other. Using booking_price (not a raw direct
    // price call) keeps the snapshot-guard call count intact.
    if ($total <= 0 && !booking_has_price($b)) {
        $rate = get_rate($b['prop_key'] ?? '');
        $bp = $rate ? booking_price($rate, $b) : null;
        if ($bp && (float) ($bp['total'] ?? 0) > 0) {
            $total = (float) $bp['total'];
        }
    }
    $status = in_array($in['payment'] ?? '', ['unpaid', 'deposit', 'paid']) ? $in['payment'] : $b['payment'];
    // "I also collected the damages deposit" — cash-rail only (hold_status 'none';
    // the card rail records its deposit on hold_* when pay.php charges it), and
    // only ever the exact agreed figure. damages_collected then reads it back as
    // paid-above-rental, which lights up the deposits-to-return queue, the duty
    // and the (already-manual-capable) return flow end to end.
    $withDep =
        !empty($in['deposit_collected']) && ($b['hold_status'] ?? 'none') === 'none'
            ? round(max(0.0, (float) ($b['agreed_booking_fee'] ?? 0)), 2)
            : 0.0;
    $dep = reconcile_deposit($status, $total, $b['deposit_paid'], $in['deposit'] ?? null, $withDep);
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
    json_out(op_finish($opTok, ['ok' => true]));
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
    // Same window as the payment request, and for a stronger reason: the arrival email's
    // content is GENERATED from the booking, so a second copy in the same breath is never
    // a different message — and this is the app's other BULK send (chbBulkArrivalAction),
    // where one tap covers a set and a repeat covers the whole set again.
    resend_guard($id, 'email.arrival', (string) ($b['name'] ?? ''), 'arrival email');
    require_once __DIR__ . '/mailer.php'; // the arrival-email helpers live here
    // The REVIEWED message, when the owner wrote one. Capped, and plain text —
    // send_arrival_email escapes it and turns its line breaks into <br>, so a
    // typed apostrophe or a stray "<" can never reach the guest as markup.
    $note = trim((string) ($in['note'] ?? ''));
    if (mb_strlen($note) > 2000) {
        $note = mb_substr($note, 0, 2000);
    }
    $res = send_arrival_for_booking($b, $note);
    if (!empty($res['ok'])) {
        // The review stamp is CLEARED on a successful send, so the duty and the
        // "ready to review" state end with the thing they were waiting for.
        try {
            db()->prepare('UPDATE bookings SET pre_arrival_ready_at = NULL WHERE id = ?')->execute([$id]);
        } catch (\Throwable $e) {
        }
        log_activity('comms', 'email.arrival', 'Arrival info emailed — ' . ($b['name'] ?? '') . ($note !== '' ? ' (reviewed)' : '') . via_label($in), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
        json_out(['ok' => true]);
    }
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 500);
}

// The arrival email as the owner will see it before sending: the editable
// MESSAGE (prefilled from the same function the email renders, so the box and
// the inbox agree) plus the facts the template adds for them. Read-only.
if ($action === 'arrival_preview') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    require_once __DIR__ . '/mailer.php';
    $disp = prop_display($b['prop_key'] ?? '');
    $name = first_name($b['name'] ?? '', 'Guest');
    $prop = $disp['name'] ?: 'your cottage';
    // The address comes from the properties row, exactly as send_arrival_for_booking
    // reads it — prop_display carries name/accent/slug only.
    $addr = '';
    try {
        $ap = db()->prepare('SELECT address FROM properties WHERE prop_key = ?');
        $ap->execute([$b['prop_key'] ?? '']);
        $addr = trim((string) ($ap->fetchColumn() ?: ''));
    } catch (\Throwable $e) {
    }
    json_out([
        'ok' => true,
        'subject' => 'You arrive ' . email_date($b['check_in']) . ' — everything you need for ' . $prop,
        'message' => arrival_default_message($name, $prop),
        'facts' => [
            'cottage' => $prop,
            'arrive' => email_date($b['check_in']) . ', from ' . email_time($b['check_in_time'] ?: '15:00'),
            'leave' => $b['check_out'] ? email_date($b['check_out']) . ', by ' . email_time($b['check_out_time'] ?: '10:00') : '',
            'address' => $addr,
            // The cottage's house rules ride the email now, so the review screen
            // names them among the facts it adds — an owner who cannot see they
            // are already going writes them into the message by hand and the
            // guest reads them twice. Same helper the send uses.
            'rules' => arrival_house_rules($b['prop_key'] ?? ''),
        ],
    ]);
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
    // DELIBERATELY NOT resend_guard()ed, unlike the payment request and the arrival email.
    // A confirmation's content follows the booking's PAYMENT STATE, and the normal flow is
    // add booking → record the deposit → confirm, which fires `add`'s own confirmation and
    // then this one within a minute or two. Those two emails say different things, so a
    // window here would refuse a genuinely different message — and this action exists to
    // re-send. The button lock still covers the double-tap.
    // guest_only:true → re-send just the guest confirmation (no owner re-ping);
    // used when confirming a recorded payment.
    $guestOnly = !empty($in['guest_only']);
    $result = send_booking_confirmation($id, $guestOnly);
    if (is_array($result) && isset($result['guest']) && !empty($result['guest']['ok'])) {
        log_activity('comms', 'email.confirmation', 'Confirmation re-sent — ' . ($b['name'] ?? ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
        json_out(['ok' => true, 'email' => $result]);
    }
    // A MAIL FAILURE IS A FAILURE, so it gets a failing status. This answered 200 with
    // an `error` key, and apiPost only throws on a non-2xx — so a caller that did not
    // hand-check `res.error` reported a send that never happened (admin.js's
    // record-a-payment flow toasted "Updated confirmation sent."). send_arrival has
    // always used 500 for exactly this; the other three sends now match it.
    $reason = $result['error'] ?? ($result['guest']['error'] ?? 'Unknown mail error');
    json_out(['error' => $reason, 'email' => $result], 500);
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
    require_once __DIR__ . '/mailer.php';
    // THE ARRIVAL REVIEW PREVIEWS THE ARRIVAL EMAIL. The send has always routed to
    // send_arrival (the reply shell would lose the designed email) and the PREVIEW
    // did not — so the owner was shown the enquiry-reply template, which opens with
    // its own "Hello <name>," above a reviewed message that already greets. Two
    // greetings, and a preview of an email nobody receives. Same builder as the
    // send, from the same payload.
    if (!empty($in['arrival'])) {
        $m = arrival_email_body(arrival_email_payload($b, $message));
        json_out(['ok' => true, 'html' => $m['html'], 'subject' => $m['subject']]);
    }
    $priceEst = null;
    try {
        // Agreed (locked-in) price when the booking has a snapshot; live rates only as fallback
        $priceEst = booking_price(get_rate($b['prop_key']), $b);
    } catch (\Throwable $e) {
    }
    require_once __DIR__ . '/mailer.php';
    // Saved-reply buttons ride the preview too — the whole point of the preview
    // is that it cannot drift from what goes out. A button the state refuses is
    // a 409 WITH its sentence, never silently dropped: the owner attached it.
    $acts = ['actions' => []];
    if (!empty($in['actions']) && is_array($in['actions'])) {
        $acts = email_reply_actions('booking', email_reply_facts($b), array_map('strval', $in['actions']));
        if ($acts['refused']) {
            $r0 = $acts['refused'][0];
            json_out(['error' => 'Can\'t attach "' . $r0['label'] . '" — ' . $r0['why']], 409);
        }
    }
    $m = build_enquiry_reply_email(array_merge($b, ['price' => $priceEst]), $subject, $message, 'booking', $acts['actions']);
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
    // Validate the saved-reply buttons against the booking's LIVE state at the
    // moment of sending — the guest may have paid or registered since the owner
    // attached one, and that genuinely changes the email's meaning. Refusing
    // with the reason beats sending a button that lands on a page refusing it.
    $acts = ['actions' => []];
    if (!empty($in['actions']) && is_array($in['actions'])) {
        $acts = email_reply_actions('booking', email_reply_facts($b), array_map('strval', $in['actions']));
        if ($acts['refused']) {
            $r0 = $acts['refused'][0];
            json_out(['error' => 'Can\'t attach "' . $r0['label'] . '" — ' . $r0['why']], 409);
        }
    }
    $r = ['ok' => false, 'error' => 'send failed'];
    try {
        $r = send_enquiry_reply_email(array_merge($b, ['price' => $priceEst]), $subject, $message, 'booking', $atts, $acts['actions']);
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
// `reminder: true` re-sends as the gentler reminder wording (the same email the
// nightly chaser's reminder pass sends) — refused when nothing has been asked
// for yet, because a reminder about a request that never went is a first ask
// wearing the wrong clothes.
if ($action === 'request_payment') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet (see config.php / Manage).'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $asked = ($in['kind'] ?? 'deposit') === 'balance' ? 'balance' : 'deposit';
    $isReminder = !empty($in['reminder']);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if (empty($b['email'])) {
        json_out(['error' => 'This booking has no guest email on file.'], 400);
    }
    if ($isReminder && empty($b['balance_requested_at']) && empty($b['deposit_requested_at'])) {
        json_out(['error' => 'Nothing has been asked for yet — email the deposit or balance link first, then remind.'], 400);
    }
    // THE WINDOW DECIDES, NOT THE CALLER. `kind` arrived from the client and
    // defaulted to 'deposit', so a booking made inside the balance window was
    // emailed "Pay your deposit — £X" for 25% when the whole amount was already
    // due — while the banner the owner tapped read "Nothing received yet — £Y
    // due" with the full figure. Same rule enquiry-actions.php applies on
    // approval; the amount was always server-derived, and now the KIND is too.
    // (booking_within_balance_window reads the per-booking due date, so a custom
    // plan moves this upgrade with it.)
    $kind = booking_payment_kind($b, $asked);

    // DON'T ASK THE SAME GUEST TWICE IN THE SAME BREATH. The client disables the button
    // whose handler is still running, but that does not survive a reload mid-request or a
    // second device — those arrive as genuinely new requests. A repeat inside the window
    // is refused IN WORDS AND WITH A STATUS, so the owner knows it went rather than
    // wondering whether to try again. See resend_guard() for why the status matters.
    resend_guard($id, 'payment.request', (string) ($b['name'] ?? ''), $isReminder ? 'reminder' : 'payment request');

    require_once __DIR__ . '/mailer.php';
    $res = request_booking_payment($b, $kind, $isReminder);
    if (!empty($res['ok'])) {
        log_activity('payment', 'payment.request', ($isReminder ? ucfirst($kind) . ' reminder emailed — ' : ucfirst($kind) . ' payment request emailed — ') . ($b['name'] ?? '') . via_label($in), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
        // Bookkeeping mirrors the nightly chaser's, so the manual and scheduled
        // paths tell one story: a balance ask stops payments-due.php asking
        // again, a deposit ask arms its abandoned-deposit recovery, and a
        // reminder spaces the cron's own reminders off this one.
        try {
            if ($isReminder) {
                db()->prepare('UPDATE bookings SET balance_reminded_at = NOW() WHERE id = ?')->execute([$id]);
            } elseif ($kind === 'balance') {
                db()->prepare('UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')->execute([$id]);
            } else {
                db()->prepare('UPDATE bookings SET deposit_requested_at = COALESCE(deposit_requested_at, NOW()) WHERE id = ?')->execute([$id]);
            }
        } catch (\Throwable $e) {
        }
        json_out(['ok' => true, 'amount' => $res['amount'], 'kind' => $kind, 'reminder' => $isReminder]);
    }
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 500);
}

// ---- Per-booking payment plan (migration-103) ------------------------------
// The owner states the PLAN (a custom deposit as % or £, a custom balance due
// date); every figure is then DERIVED from it server-side — the client never
// sends an amount to charge. Clearing a field returns that half to the site
// standard. Bounds, each refused in words: at most one deposit form, pct in
// (0,100], amount within the rental total, the due date between today and
// check-in. Changing a plan never unsends anything already gone.
if ($action === 'set_payment_plan') {
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    // The Add form and this dialog share ONE validator (payment_plan_parse) —
    // the total is only fetched when a £ amount needs capping, since
    // booking_amount_due is the costlier derivation.
    $tot = trim((string) ($in['deposit_amount'] ?? '')) !== ''
        ? (float) (booking_amount_due($b, 'balance')['total'] ?? 0)
        : 0.0;
    [$pct, $amt, $due] = payment_plan_parse($in, (string) ($b['check_in'] ?? ''), $tot);
    // THE OWNER'S SAY over the monthly offer: '' = automatic, 0 = never,
    // 2..4 = offer exactly that many. This only shapes what the deposit screen
    // OFFERS — nothing collects until the guest agrees and saves a card.
    $apOffer = trim((string) ($in['autopay_offer'] ?? ''));
    if ($apOffer !== '' && !in_array($apOffer, ['0', '2', '3', '4'], true)) {
        json_out(['error' => 'Monthly payments can be 2, 3 or 4 — or 0 to never offer them.'], 400);
    }
    try {
        db()->prepare('UPDATE bookings SET deposit_pct_override = ?, deposit_amount_override = ?, balance_due_date = ?, autopay_offer = ? WHERE id = ?')
            ->execute([$pct, $amt, $due, $apOffer === '' ? null : (int) $apOffer, $id]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not save the plan — has migrate.php been run?'], 500);
    }
    $bits = [];
    if ($amt !== null) {
        $bits[] = '£' . number_format($amt, 2) . ' deposit';
    } elseif ($pct !== null) {
        $bits[] = rtrim(rtrim(number_format($pct, 2), '0'), '.') . '% deposit';
    }
    if ($due !== null) {
        $bits[] = 'balance due ' . uk_date($due);
    }
    log_activity('payment', 'payment.plan', ($bits ? 'Payment plan set — ' . implode(', ', $bits) : 'Payment plan cleared — back to the site standard') . ($b['name'] ? ' · ' . $b['name'] : ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    json_out(['ok' => true, 'deposit_pct' => $pct, 'deposit_amount' => $amt, 'balance_due_date' => $due, 'autopay_offer' => $apOffer === '' ? null : (int) $apOffer]);
}

// Return the secure pay link for a booking (to copy/share by WhatsApp, SMS, etc.)
// without emailing it. Same token the email uses; authorises paying THIS booking.
if ($action === 'pay_link') {
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on yet (see config.php / Manage).'], 400);
    }
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    // The caller's `kind` is GONE, not ignored-with-a-shrug: the link no longer
    // carries a stage, so a caller cannot choose one, and reporting back what
    // was ASKED for would let the owner's toast name a stage the link will not
    // use. What comes back is what the link RESOLVES to, derived the same way
    // pay.php will derive it when the guest opens it.
    // ONE link, no stage in it — a link copied today and used after the deposit
    // lands asks for the balance instead of a settled £0.
    $url = site_base_url() . 'index.html?pay=' . pay_token($id) . '&b=' . $id;
    json_out(['ok' => true, 'url' => $url, 'kind' => booking_payment_kind($b)]);
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
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 500);
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
    // MONEY GOING BACK OUT — prove it is still you. See require_reauth() in
    // db.php: a signed-in session is long-lived and pocket-carried; a refund is
    // the one action here that cannot be undone by noticing it later.
    require_reauth('refunding a payment');
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
            $cap = booking_ledger_net($bookingId);
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
    // Pass the amount just refunded so paid drops by exactly that (never wiping
    // manual cash/bank money the ledger can't see). A damages_return is NOT a
    // rental refund — it must not reduce the rental paid figure at all.
    $rec = reconcile_booking_payment($bookingId, $b, $refundKind === 'refund' ? (float) $amount : 0);
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
    // AND THE SEND IS ON THE RECORD, either way. The hub's Emails fold and
    // hubEmailsSum read comms rows, so without this the one email that explains a
    // refund to the guest left no trace on the booking at all — the owner could not
    // tell later whether it had gone.
    log_comms_outcome('email.refund', 'Refund email', $emailResult, $bookingId, $gProp ?? '');
    json_out(['ok' => true, 'refunded' => $amount, 'status' => $rec['status'], 'email' => $emailResult]);
}

// CONFIRM BY HAND THAT A REFUND HAS ACTUALLY GONE. Square's API can lag what the
// owner can already see on their own statement — a deposit refund taken out of the
// Square balance sat reading "not yet confirmed settled here" for days. This is the
// owner asserting a fact they have verified, so the ledger stops fencing money that
// has left. MANUAL is the existing word for "settled by hand"; ret_settled and
// damages_returned already treat it as settled, so nothing downstream has to change.
//
// Deliberately narrow: it only ever moves a NON-TERMINAL damages_return to MANUAL. It
// cannot resurrect a FAILED refund (that money genuinely did not go), cannot touch a
// rental charge, and cannot invent a return that was never issued.
// ---- RECORD A PAYMENT SQUARE HAS BUT WE DO NOT ------------------------------
// The orphan sweep (payments-reconcile.php) finds money taken at Square with no
// row here and FLAGS it — deliberately, because recording money is a decision
// with the owner's name on it. This is the one tap that acts on the flag, and
// what makes it safe is that it does not trust a word of what it is sent: the
// id is re-fetched from Square and must still be a COMPLETED payment whose own
// reference names THIS booking. The client supplies an identifier, never a sum.
if ($action === 'record_square_payment') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $sqId = trim((string) ($in['square_payment_id'] ?? ''));
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    if ($sqId === '') {
        json_out(['error' => 'No payment to record.'], 400);
    }
    if (!square_enabled()) {
        json_out(['error' => 'Square payments are not switched on.'], 409);
    }
    // ALREADY HAVE IT is not an error — the sweep may have been flagged twice, or
    // the webhook may have arrived between the flag and the tap. Say so.
    try {
        $seen = db()->prepare('SELECT id FROM payments WHERE square_payment_id = ?');
        $seen->execute([$sqId]);
        if ($seen->fetchColumn()) {
            json_out(['ok' => true, 'recorded' => 0, 'note' => 'That payment is already on the ledger.']);
        }
    } catch (\Throwable $e) {
        json_out(['error' => "Couldn't read the payment ledger."], 500);
    }
    $res = square_api('GET', '/v2/payments/' . rawurlencode($sqId));
    $payment = $res['body']['payment'] ?? null;
    if (!$payment || (int) ($res['status'] ?? 0) < 200 || (int) ($res['status'] ?? 0) >= 300) {
        json_out(['error' => "Square doesn't have a payment with that id."], 404);
    }
    if (strtoupper((string) ($payment['status'] ?? '')) !== 'COMPLETED') {
        // The same judgement the sweep makes: an APPROVED payment is an
        // uncaptured hold and a FAILED one took nothing. Neither is money to record.
        json_out(['error' => 'That payment has not completed at Square, so there is nothing to record.'], 409);
    }
    // THE REFERENCE MUST NAME THIS BOOKING. Without it the action would record
    // any Square payment against any booking on the owner's say-so, and a
    // mistyped id would land another guest's money on this guest's ledger.
    require_once __DIR__ . '/payments-reconcile.php';
    if (orphan_reference_booking($payment['reference_id'] ?? '') !== $id) {
        json_out(['error' => "That payment is not for this booking — its own reference names a different one."], 409);
    }
    $gross = (int) ($payment['amount_money']['amount'] ?? 0) - (int) ($payment['refunded_money']['amount'] ?? 0);
    $cur = strtoupper((string) ($payment['amount_money']['currency'] ?? 'GBP'));
    if ($gross <= 0) {
        json_out(['error' => 'That payment has been fully refunded, so there is nothing to record.'], 409);
    }
    if ($cur !== 'GBP') {
        // The payouts_money rule: carried, never converted. A foreign charge
        // cannot be added to a sterling ledger by guessing a rate.
        json_out(['error' => 'That payment is in ' . $cur . ', so it cannot be added to this booking automatically.'], 409);
    }
    $amount = round($gross / 100, 2);
    $fee = null;
    if (!empty($payment['processing_fee']) && is_array($payment['processing_fee'])) {
        $cents = 0;
        foreach ($payment['processing_fee'] as $pf) {
            $cents += (int) ($pf['amount_money']['amount'] ?? 0);
        }
        $fee = round($cents / 100, 2);
    }
    // Under the booking lock, and INSERT IGNORE on the unique square_payment_id,
    // so two taps in the same breath cannot write the money twice.
    if (!book_lock($b['prop_key'])) {
        json_out(['error' => 'This booking is being processed — please try again in a moment.'], 409);
    }
    // json_out() exits, so the catch below never falls through — but a static
    // reader cannot know that, and 0 is the right answer if it ever did.
    $paid = 0.0;
    try {
        // A guest's FIRST payment bundles the refundable deposit into one Square
        // charge (pay.php charges rental + deposit and records only the rental in
        // the ledger, tracking the deposit on hold_*). If pay.php died before its
        // writes, this recovery is that same charge — so the ledger row must be
        // the RENTAL portion and the deposit must land on hold_* as 'charged', or
        // the deposit reads £0 collected, never joins Deposits-to-return, and
        // cannot be returned. Signature of the bundle: no deposit taken yet
        // (hold_status 'none'), a deposit is due, and the gross exceeds it with a
        // positive rental remainder. A plain later balance orphan fails this and
        // records whole, unchanged.
        $rateRow = get_rate($b['prop_key']);
        $depDue = round((float) booking_damages_due($b, $rateRow ?: null), 2);
        $bundled = ($b['hold_status'] ?? 'none') === 'none'
            && empty($b['hold_payment_id'])
            && $depDue > 0.005
            && $amount > $depDue + 0.005;
        $ledgerAmount = $bundled ? round($amount - $depDue, 2) : $amount;
        db()
            ->prepare(
                'INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, fee, guest_name, prop_key, created_at)
                 VALUES (?,?,?,?,?,?,?,?,NOW())',
            )
            ->execute([$id, $sqId, booking_payment_kind($b), $ledgerAmount, 'COMPLETED', $fee, $b['name'], $b['prop_key']]);
        if ($bundled) {
            db()
                ->prepare('UPDATE bookings SET hold_payment_id = ?, hold_status = ?, hold_amount = ? WHERE id = ?')
                ->execute([$sqId, 'charged', $depDue, $id]);
            $b['hold_status'] = 'charged';
            $b['hold_payment_id'] = $sqId;
            $b['hold_amount'] = $depDue;
        }
        // The headline figure is re-derived from the ledger through the shared
        // helper rather than added to — the one-definition rule, and the reason
        // this cannot drift from what every other screen reports. The cap carries
        // the deposit headroom (total + agreed_booking_fee) so a bundled deposit
        // riding above the rental total isn't clamped away.
        $total = round((float) ($b['price_override'] ?? 0) ?: (float) ($b['agreed_total'] ?? 0), 2);
        $cap = $total > 0 ? round($total + ($bundled ? $depDue : 0), 2) : 0;
        $paid = round(booking_paid_so_far(['id' => $id, 'deposit_paid' => (float) ($b['deposit_paid'] ?? 0)]), 2);
        $paid = $cap > 0 ? min($cap, $paid) : $paid;
        db()
            ->prepare('UPDATE bookings SET deposit_paid = ?, payment = ? WHERE id = ?')
            ->execute([$paid, $total > 0 && $paid >= $total - 0.001 ? 'paid' : ($paid > 0 ? 'deposit' : 'unpaid'), $id]);
    } catch (\Throwable $e) {
        book_unlock($b['prop_key']);
        json_out(['error' => "Couldn't record that just now."], 500);
    }
    book_unlock($b['prop_key']);
    // Logged as the owner's decision, with the Square id, so the trail back to
    // what was recorded and why starts here.
    log_activity('payment', 'payment.recorded_from_square', 'Recorded a Square payment that had no record here — £' . number_format($amount, 2) . ($b['name'] ? ' · ' . $b['name'] : ''), [
        'prop_key' => $b['prop_key'] ?? '',
        'entity' => 'booking',
        'entity_id' => (string) $id,
        'meta' => ['square_payment_id' => $sqId, 'amount' => $amount],
    ]);
    json_out(['ok' => true, 'recorded' => 1, 'amount' => $amount, 'paid' => $paid]);
}

// THE GUEST BOOK (migration-121): the owner's PRIVATE rating of a stay.
// Owner-only in every direction — nothing guest-reachable joins the table, and
// integration §31 asserts the absence in the guest payload rather than assuming
// it. One row per booking: re-rating replaces, overall 0 deletes (a rating
// really can be taken back). It informs, never decides: no read path anywhere
// gates an action on this value.
if ($action === 'rate_guest') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    $overall = (int) ($in['overall'] ?? 0);
    $markOk = fn($v) => in_array((string) $v, ['', 'good', 'poor'], true);
    $clean = (string) ($in['clean'] ?? '');
    $rules = (string) ($in['rules'] ?? '');
    $comms = (string) ($in['comms'] ?? '');
    if (!$markOk($clean) || !$markOk($rules) || !$markOk($comms)) {
        json_out(['error' => 'A category mark is good, poor, or left unset.'], 400);
    }
    $note = trim((string) ($in['note'] ?? ''));
    if (mb_strlen($note) > 500) {
        json_out(['error' => 'Keep the note under 500 characters.'], 400);
    }
    try {
        if ($overall === 0) {
            db()->prepare('DELETE FROM guest_ratings WHERE booking_id = ?')->execute([$id]);
            json_out(['ok' => true, 'removed' => true]);
        }
        if ($overall < 1 || $overall > 5) {
            json_out(['error' => 'The rating is 1 to 5 stars.'], 400);
        }
        db()->prepare(
            'INSERT INTO guest_ratings (booking_id, overall, clean, rules, comms, note, rated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE overall = VALUES(overall), clean = VALUES(clean),
                 rules = VALUES(rules), comms = VALUES(comms), note = VALUES(note), rated_at = NOW()',
        )->execute([$id, $overall, $clean, $rules, $comms, $note]);
        $at = (string) db()->query('SELECT rated_at FROM guest_ratings WHERE booking_id = ' . $id)->fetchColumn();
        json_out(['ok' => true, 'at' => $at]);
    } catch (\Throwable $e) {
        // Pre-migration installs have no table; say so rather than a bare 500.
        json_out(['error' => 'Could not save the rating — run the migrations (Manage → System check).'], 500);
    }
}

if ($action === 'confirm_return_settled') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) {
        json_out(['error' => 'Booking not found'], 404);
    }
    // json_out() exits, so the catch below never falls through — but a static reader
    // cannot know that, and an empty list is the right answer if it ever did.
    $rows = [];
    try {
        $q = db()->prepare(
            "SELECT id, amount FROM payments
              WHERE booking_id = ? AND kind = 'damages_return'
                AND (status IS NULL OR UPPER(status) NOT IN ('COMPLETED','MANUAL','FAILED','REJECTED'))",
        );
        $q->execute([$id]);
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => "Couldn't read the refunds for this booking."], 500);
    }
    if (!$rows) {
        // Nothing waiting is not an error — it is the state the owner wanted. Saying so
        // beats a silent no-op that leaves them tapping again.
        json_out(['ok' => true, 'confirmed' => 0, 'note' => 'Nothing was waiting to be confirmed.']);
    }
    $sum = 0.0;
    foreach ($rows as $r) {
        $sum += (float) $r['amount'];
    }
    try {
        db()
            ->prepare(
                "UPDATE payments SET status = 'MANUAL'
                  WHERE booking_id = ? AND kind = 'damages_return'
                    AND (status IS NULL OR UPPER(status) NOT IN ('COMPLETED','MANUAL','FAILED','REJECTED'))",
            )
            ->execute([$id]);
    } catch (\Throwable $e) {
        json_out(['error' => "Couldn't record that just now."], 500);
    }
    // Logged as the owner's assertion, not as something Square told us — if the money
    // turns out not to have gone, this line is where the answer starts.
    log_activity('payment', 'deposit.confirm_settled', 'Deposit refund confirmed settled by hand — £' . number_format($sum, 2) . ($b['name'] ? ' · ' . $b['name'] : ''), [
        'prop_key' => $b['prop_key'] ?? '',
        'entity' => 'booking',
        'entity_id' => (string) $id,
    ]);
    json_out(['ok' => true, 'confirmed' => count($rows), 'amount' => round($sum, 2)]);
}

// Return the held refundable damage deposit (full or partial) after checkout.
// Tracked as 'damages_return' so it never changes the rental payment status.
if ($action === 'return_deposit') {
    require_reauth('returning a deposit'); // money out — same rule as 'refund'
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
        // A CASH-COLLECTED deposit must never refund a card charge. With
        // hold_status 'none' the deposit was recorded by hand (paid above the
        // rental — recordPayment's "collected too"), so falling through to
        // find_charge_for_refund on a booking that ALSO carries rental card rows
        // would push the guest's cash back onto their card: mis-attributed at
        // Square, and the drawer still holds the cash. 'none' → always a MANUAL
        // return. The find_charge_for_refund fallthrough remains for the LEGACY
        // shapes it existed for (pre-hold-model rows whose deposit rode the
        // rental ledger with hold_status long since cleared to ''/other).
        $hs = (string) ($b['hold_status'] ?? '');
        $charge =
            in_array($hs, ['charged', 'captured'], true) && !empty($b['hold_payment_id'])
                ? $b['hold_payment_id']
                : ($hs === 'none' ? null : find_charge_for_refund($id, $amount));
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
    // Photo evidence from the offline decision, riding the confirmed op —
    // best-effort (deposit_evidence_store never throws; the refund stands
    // whatever happens to the photo).
    $evidence = deposit_evidence_store($id, $in['photo_data'] ?? '');
    if ($evidence !== '') {
        log_activity('payment', 'deposit.evidence', 'Deposit photo saved — ' . $evidence, ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    }
    log_activity('payment', 'deposit.return', 'Damage deposit returned — £' . number_format((float) $amount, 2) . ($b['name'] ? ' · ' . $b['name'] : ''), ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    log_comms_outcome('email.deposit_return', 'Deposit-return email', $emailResult, $id, $b['prop_key'] ?? '');
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
    // RAIL-BLIND, like the duty and the ring fence. This required hold_status
    // 'charged' — a CARD-rail fact that a cash or bank deposit never sets — so a
    // deposit handed over in cash, recorded through "Collected too", counted by
    // damages_collected, listed in "Deposits to return" and raised as a duty could
    // only ever be GIVEN BACK: with damage, the owner's one offered action was to
    // return money they were keeping, and the guest was emailed "we're returning
    // your refundable damage deposit" about it. What matters is whether money is
    // actually held, which damages_collected already answers for both eras; a
    // SETTLED deposit is refused on its own terms below and by the $held check.
    if (in_array($b['hold_status'] ?? '', ['returned', 'kept', 'released', 'expired'], true)) {
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
    // Photo evidence (see return_deposit) — on the KEEP it matters most: this
    // is the decision a guest may dispute, and the photo taken in the cottage
    // at the moment of deciding is what settles it.
    $evidence = deposit_evidence_store($id, $in['photo_data'] ?? '');
    if ($evidence !== '') {
        log_activity('payment', 'deposit.evidence', 'Deposit photo saved — ' . $evidence, ['prop_key' => $b['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $id]);
    }
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
    // A cancellation is a booking action, not inherently a money one — the
    // step-up is asked for only when this one actually SENDS MONEY BACK, either
    // the typed refund or the damages deposit the block below returns
    // automatically. Cancelling a booking nobody has paid for stays one tap.
    if ($refundAmount > 0.005 || (float) damages_collected($b) > 0.005) {
        require_reauth('refunding as part of this cancellation');
    }
    $refundedByCard = 0.0;
    $depositRefunded = 0.0; // refundable damage deposit auto-returned below (reported back)
    // …and what could NOT be returned. Cancelling DELETES the booking row, which
    // is the only record that a damages deposit is owed — see the block below.
    $depositOwed = 0.0;
    // CAP IT, exactly as the per-row 'refund' action does. This is a free-typed figure
    // on the one screen where a typo is most likely, and without the cap the only thing
    // stopping an over-refund was Square rejecting it — which then aborts the
    // cancellation too, so the owner cannot cancel at all until they guess a workable
    // number. Same rule, same sentence.
    if ($refundAmount > 0) {
        $cancelCap = null;
        try {
            $cancelCap = booking_ledger_net($id);
        } catch (\Throwable $e) {
            $cancelCap = null; // ledger unreadable — leave it to Square, as before
        }
        if ($cancelCap !== null && $refundAmount > $cancelCap + 0.001) {
            json_out(['error' => 'Only £' . number_format($cancelCap, 2) . ' is still refundable on this booking.'], 400);
        }
    }
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
    // A DEPOSIT THAT COULD NOT GO BACK MUST OUTLIVE THE BOOKING. The rental
    // refund above ABORTS the cancellation when Square refuses it; this one is
    // deliberately best-effort, because the owner must be able to cancel with
    // Square down. But the row is DELETED a few lines below, and that row is the
    // only place a damages deposit is recorded — so a refused refund (expired
    // card, no Square balance, Square switched off) silently deleted the fact
    // that the owner owes the guest their money: gone from the ring fence, gone
    // from "Deposits to return", gone from the duty list, with the owner told
    // only "Booking cancelled." It is reported and LOGGED instead, and the log
    // line has to stand on its own — the booking it points at will not exist.
    $hs = $b['hold_status'] ?? 'none';
    if ($hs === 'charged' && !empty($b['hold_payment_id'])) {
        // Serialise, then RE-READ the deposit state under the lock — the same
        // discipline return_deposit/keep_deposit follow. Computing $dep from the
        // row read at the top of this action (before any lock) let a concurrent
        // return_deposit on another device commit its £75 damages_return row in
        // the gap, so cancel refunded the same deposit a second time (the refund
        // idempotency key includes refunded-so-far, so the two keys differ by
        // design and Square issues both — £150 out for a £75 deposit). Reading
        // damages_returned() under the lock nets out that committed return.
        book_lock($b['prop_key'] ?? '');
        $bNow = booking_by_id($id) ?: $b;
        $hsNow = $bNow['hold_status'] ?? 'none';
        $dep = $hsNow === 'charged'
            ? round(max(0, damages_collected($bNow) - damages_returned($id)), 2)
            : 0.0;
        if ($dep > 0) {
            if (square_enabled()) {
                $depRr = record_square_refund($id, $bNow['hold_payment_id'], $dep, 'damages_return', 'Booking cancelled', $bNow['name'], $bNow['prop_key']);
                if (!empty($depRr['ok'])) {
                    $depositRefunded = $dep;
                }
            }
            if ($depositRefunded <= 0) {
                $depositOwed = $dep;
            }
        }
        book_unlock($b['prop_key'] ?? '');
    }
    if (square_enabled()) {
        if ($hs === 'authorized' && !empty($b['hold_payment_id'])) {
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
                // Settled just above, and only ever the amount that really went.
                'deposit_refunded' => $depositRefunded,
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
    if ($depositOwed > 0) {
        // WARN, so it lands in "Needs attention" and the weekly digest — this is
        // an unpaid obligation, not a note. It names the guest, the amount and
        // how to reach them, because the booking that held all three is gone.
        log_activity(
            'payment',
            'deposit.owed',
            'Refundable deposit of £' . number_format($depositOwed, 2) . ' still owed to ' . ($b['name'] ?: 'the guest') .
                ' — their booking was cancelled and the automatic refund did not go through. Return it by hand.',
            [
                'severity' => 'warn',
                'prop_key' => $b['prop_key'] ?? '',
                'entity' => 'booking',
                'entity_id' => (string) $id,
                'meta' => ['amount' => $depositOwed, 'email' => (string) ($b['email'] ?? ''), 'phone' => (string) ($b['phone'] ?? '')],
            ],
        );
    }
    json_out([
        'ok' => true,
        'refunded' => $refundedByCard,
        // The refundable damage deposit is returned on its OWN Square payment here —
        // report it so the owner isn't left thinking they must refund it by hand (and
        // double-return it) when the rental refund couldn't be auto-matched.
        'deposit_refunded' => $depositRefunded,
        // Still owed to the guest, with no booking left to hold the fact.
        'deposit_owed' => $depositOwed,
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

// ONE round trip for everything the hub renders after open. The hub used to
// fire three requests (payments, history, email logs) and fill three cards as
// each landed — on a weak signal the page assembled visibly, card by card. The
// bundle also powers the ACTIVITY FEED: the ledger rows (with their live Square
// status + deposit_carried) interleaved with this booking's activity-log events,
// whose comms rows carry subject/body meta so an email can be read in place.
// The single-purpose actions above/below are KEPT — tests and other callers use
// them, and one shared helper (booking_payments_rows) means they cannot drift.
if ($action === 'hub_bundle') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $payments = [];
    $events = [];
    try {
        $payments = booking_payments_rows($id);
    } catch (\Throwable $e) {
    }
    try {
        $st = db()->prepare(
            "SELECT action, summary, actor, meta, created_at
               FROM activity_log
              WHERE entity = 'booking' AND entity_id = ?
           ORDER BY id DESC
              LIMIT 80",
        );
        $st->execute([(string) $id]);
        foreach ($st->fetchAll() as $r) {
            $meta = [];
            if (!empty($r['meta'])) {
                $decoded = json_decode((string) $r['meta'], true);
                if (is_array($decoded)) {
                    $meta = $decoded;
                }
            }
            $events[] = [
                'action' => $r['action'],
                'summary' => $r['summary'],
                'actor' => $r['actor'] ?: 'system',
                'at' => $r['created_at'],
                'subject' => isset($meta['subject']) ? (string) $meta['subject'] : '',
                'body' => isset($meta['body']) ? (string) $meta['body'] : '',
            ];
        }
    } catch (\Throwable $e) {
        // activity_log not migrated yet -> feed shows the ledger alone
    }
    json_out(['ok' => true, 'payments' => $payments, 'events' => $events]);
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
        // NOT an error — a successful "no preview available" answer. The composer
        // (previewAndSendEmail) reads only r.ok and falls back to a plain confirm,
        // so this is a legitimate 200 carrying ok:false, never `error` at 2xx (the
        // shape apiPost can't throw on — gated by test-error-status.php).
        json_out(['ok' => false, 'reason' => 'Preview isn’t available on this version.']);
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
        // Same as above: a successful "nothing to preview" answer, not an error.
        json_out(['ok' => false, 'reason' => 'That email can’t be previewed (it may need Square on, or there’s nothing left to pay).']);
    }
    json_out(['ok' => true, 'subject' => $pick['subject'], 'html' => $pick['html'], 'text' => $pick['text']]);
}

// Per-booking damage-deposit returns, summed (Money & income dashboard).
if ($action === 'deposit_returns') {
    try {
        // The SHARED figure. Unfiltered, a FAILED refund removed the deposit from the
        // owner's "Deposits to return" queue (and its Needs-you duty), so the failed
        // refund was never re-tried and the guest never got their money.
        $map = [];
        foreach (damages_returned_map() as $bid => $t) {
            $map[(string) $bid] = $t;
        }
        json_out(['returns' => $map]);
    } catch (\Throwable $e) {
        json_out(['returns' => []]);
    }
}

// List the Square payment ledger for a booking (admin detail panel).
// ONE definition of a booking's ledger rows (incl. the deposit_carried flag) —
// consumed by the 'payments' action and by 'hub_bundle', so the hub's activity
// feed and any direct caller can never disagree about what a charge took.
function booking_payments_rows($id)
{
    $s = db()->prepare(
        'SELECT square_payment_id, kind, amount, status, note, created_at FROM payments WHERE booking_id = ? ORDER BY id ASC',
    );
    $s->execute([$id]);
    $rows = $s->fetchAll();
    // WHICH ROW THE DAMAGES DEPOSIT RODE — see the 'payments' action's original
    // comment (#921): payments.amount is RENTAL-only, so the row the guest's
    // card statement disagrees with is flagged with the carried sum.
    $bq = db()->prepare('SELECT hold_payment_id, hold_amount FROM bookings WHERE id = ?');
    $bq->execute([$id]);
    $hb = $bq->fetch();
    $hpid = (string) ($hb['hold_payment_id'] ?? '');
    foreach ($rows as &$r) {
        $r['deposit_carried'] =
            $hpid !== '' && (string) $r['square_payment_id'] === $hpid && in_array($r['kind'], ['deposit', 'balance'], true)
                ? round((float) ($hb['hold_amount'] ?? 0), 2)
                : 0.0;
    }
    unset($r);
    return $rows;
}
if ($action === 'payments') {
    $id = (int) ($in['id'] ?? 0);
    try {
        $rows = booking_payments_rows($id);
        json_out(['payments' => $rows]);
    } catch (\Throwable $e) {
        json_out(['payments' => []]);
    }
}

// Recent Square transactions across all bookings (Money & income feed).
// LEFT JOIN + snapshot fallback so payments/refunds from DELETED bookings stay
// visible (the ledger rows are deliberately kept when a booking is removed).
if ($action === 'recent_payments') {
    // First bring any still-pending refunds up to date with Square, so a refund
    // that has actually processed shows COMPLETED here rather than a stale PENDING.
    try {
        reconcile_pending_refunds();
    } catch (\Throwable $e) {
    }
    // …and back-fill Square processing fees Square has since settled, so the
    // reconciliation shows the real fee instead of a permanent "− £0.00".
    try {
        reconcile_missing_fees();
    } catch (\Throwable $e) {
    }
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
