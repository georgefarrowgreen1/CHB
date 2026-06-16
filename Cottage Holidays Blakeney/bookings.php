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
function booking_by_id($id) {
    $s = db()->prepare('SELECT * FROM bookings WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch();
}
// (A boolean dates_clash() lives in db.php; this file uses the message form below.)
// Returns a human-readable clash message if the dates overlap an existing booking
// or an imported platform (Airbnb/Vrbo) block; empty string if the dates are free.
function clash_message($propKey, $checkIn, $checkOut, $ignoreId = null) {
    // Existing bookings on this site
    $sql = 'SELECT name, check_in, check_out FROM bookings WHERE prop_key = ? AND check_in < ? AND check_out > ?';
    $args = [$propKey, $checkOut, $checkIn];
    if ($ignoreId) { $sql .= ' AND id <> ?'; $args[] = $ignoreId; }
    $s = db()->prepare($sql); $s->execute($args);
    $rows = $s->fetchAll();
    if ($rows) {
        $r = $rows[0];
        $who = $r['name'] !== '' ? $r['name'] : 'another guest';
        return 'These dates overlap an existing booking (' . $who . ', ' . $r['check_in'] . ' to ' . $r['check_out'] . ').';
    }
    // Imported iCal blocks (Airbnb/Vrbo) — table may not exist on older installs.
    try {
        $s2 = db()->prepare('SELECT source, check_in, check_out FROM ical_blocks WHERE prop_key = ? AND check_in < ? AND check_out > ?');
        $s2->execute([$propKey, $checkOut, $checkIn]);
        $b = $s2->fetch();
        if ($b) {
            return 'These dates are blocked by a ' . ucfirst($b['source']) . ' booking (' . $b['check_in'] . ' to ' . $b['check_out'] . ').';
        }
    } catch (\Throwable $e) { /* table not migrated yet */ }
    return '';
}
// Reconcile a deposit amount against a chosen status + total. Returns float or null(invalid).
function reconcile_deposit($status, $total, $currentDep, $proposedDep) {
    if ($status === 'paid')   return round($total, 2);
    if ($status === 'unpaid') return 0.0;
    // 'deposit' — needs a partial amount strictly between 0 and total
    $dep = ($proposedDep !== null) ? (float)$proposedDep : (float)$currentDep;
    if ($dep <= 0 || $dep >= $total) return null;
    return round($dep, 2);
}
function snapshot_fields($rate, $b, $depositOverride = null) {
    $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out'], $depositOverride);
    return [
        'agreed_total' => $p['total'], 'agreed_per_night' => $p['perNight'],
        'agreed_nights' => $p['nights'], 'agreed_nightly' => $p['nightly'],
        // booking_fee column is repurposed to store the refundable damages deposit
        'agreed_booking_fee' => $p['damagesDeposit'], 'agreed_txn_pct' => $p['transactionPct'],
        'agreed_txn_fee' => $p['txFee'], 'agreed_on' => date('Y-m-d'),
    ];
}

// ---- Square refund + ledger helpers (shared by refund / return_deposit / cancel) ----
// Insert a payments ledger row, tolerating an un-migrated schema (no note/snapshot cols).
function insert_payment_row($bookingId, $sqId, $kind, $amount, $status, $gName, $gProp, $note) {
    try {
        db()->prepare('INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, guest_name, prop_key, note, created_at)
                       VALUES (?,?,?,?,?,?,?,?,NOW())')
            ->execute([$bookingId, $sqId, $kind, $amount, $status, $gName, $gProp, ($note !== '' ? $note : null)]);
    } catch (\Throwable $e) {
        try { db()->prepare('INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, created_at) VALUES (?,?,?,?,?,NOW())')
            ->execute([$bookingId, $sqId, $kind, $amount, $status]); } catch (\Throwable $e2) {}
    }
}
// A completed Square charge (deposit/balance) for a booking large enough to refund $need.
function find_charge_for_refund($bookingId, $need) {
    try {
        $s = db()->prepare("SELECT square_payment_id, amount FROM payments
            WHERE booking_id = ? AND kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED')
            ORDER BY amount DESC");
        $s->execute([$bookingId]);
        foreach ($s->fetchAll() as $r) { if ((float)$r['amount'] + 0.001 >= $need) return $r['square_payment_id']; }
    } catch (\Throwable $e) {}
    return null;
}
// Issue a Square refund against $sqId and record a ledger row of $kind. Returns
// ['ok'=>bool,'status'=>..,'error'=>..]. $kind is 'refund' or 'damages_return'.
function record_square_refund($bookingId, $sqId, $amount, $kind, $note, $gName, $gProp) {
    $res = square_api('POST', '/v2/refunds', [
        'idempotency_key' => bin2hex(random_bytes(16)),
        'payment_id'      => $sqId,
        'amount_money'    => ['amount' => (int)round($amount * 100), 'currency' => 'GBP'],
        'reason'          => ($note !== '' ? mb_substr($note, 0, 190) : ($kind === 'damages_return' ? 'Damage deposit return' : 'Booking refund')),
    ]);
    $refund = $res['body']['refund'] ?? null;
    $ok = in_array($res['status'], [200, 201], true) && $refund
        && in_array(($refund['status'] ?? ''), ['PENDING', 'COMPLETED', 'APPROVED'], true);
    if (!$ok) return ['ok' => false, 'error' => $res['body']['errors'][0]['detail'] ?? 'Refund failed at Square.'];
    insert_payment_row($bookingId, (string)$refund['id'], $kind, $amount, $refund['status'], $gName, $gProp, $note);
    return ['ok' => true, 'status' => $refund['status'], 'refund_id' => (string)$refund['id']];
}
// Re-derive the booking's rental payment status from the ledger (charges − rental
// refunds). NOTE: 'damages_return' is deliberately excluded — returning a held
// deposit must never make a booking look unpaid.
function reconcile_booking_payment($bookingId, $b = null) {
    if ($b === null) $b = booking_by_id($bookingId);
    $total = ($b && $b['agreed_total'] !== null) ? (($b['price_override'] !== null) ? (float)$b['price_override'] : (float)$b['agreed_total']) : 0.0;
    $sum = db()->prepare("SELECT
            COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount ELSE 0 END),0) AS net
        FROM payments WHERE booking_id = ?");
    $sum->execute([$bookingId]);
    $paid = round(max(0, (float)$sum->fetchColumn()), 2);
    if ($total > 0) $paid = min($total, $paid);
    $status = ($total > 0 && $paid >= $total - 0.001) ? 'paid' : ($paid > 0 ? 'deposit' : 'unpaid');
    db()->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_date=? WHERE id=?')
        ->execute([$status, $paid, ($paid > 0 ? date('Y-m-d') : null), $bookingId]);
    return ['paid' => $paid, 'status' => $status];
}
// Refundable damage deposit actually RECEIVED for a booking (rental paid first).
function damages_collected($b) {
    $total = ($b['agreed_total'] !== null) ? (($b['price_override'] !== null) ? (float)$b['price_override'] : (float)$b['agreed_total']) : 0.0;
    $held = (float)($b['agreed_booking_fee'] ?? 0);
    $rental = max(0.0, $total - $held);
    $paid = (float)($b['deposit_paid'] ?? 0);
    return round(max(0.0, min($held, $paid - $rental)), 2);
}
function damages_returned($bookingId) {
    try { $s = db()->prepare("SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = ? AND kind = 'damages_return'"); $s->execute([$bookingId]); return round((float)$s->fetchColumn(), 2); }
    catch (\Throwable $e) { return 0.0; }
}

// Build the email payload from a saved booking row and send the confirmation +
// owner notification. Uses the booking's locked (agreed) figures so the email
// always matches what's on the booking. Never throws — returns the mailer result
// array (or an ['error'=>...] note) so callers can surface it without failing.
function send_booking_confirmation($bookingId) {
    try {
        $b = booking_by_id((int)$bookingId);
        if (!$b) return ['error' => 'Booking not found'];
        $rate = get_rate($b['prop_key']);
        require_once __DIR__ . '/mailer.php';

        // Prefer the locked agreed figures; fall back to a live calc if missing.
        if ($b['agreed_total'] !== null) {
            $nights   = (int)$b['agreed_nights'];
            $perNight = (float)$b['agreed_per_night'];
            $nightly  = (float)$b['agreed_nightly'];
            $txPct    = (float)$b['agreed_txn_pct'];
            $txFee    = (float)$b['agreed_txn_fee'];
            $deposit  = (float)$b['agreed_booking_fee'];
            $total    = ($b['price_override'] !== null) ? (float)$b['price_override'] : (float)$b['agreed_total'];
        } else {
            $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            $nights=$p['nights']; $perNight=$p['perNight']; $nightly=$p['nightly'];
            $txPct=$p['transactionPct']; $txFee=$p['txFee']; $deposit=$p['damagesDeposit']; $total=$p['total'];
        }
        $ref = 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string)$bookingId), -6), 6, '0', STR_PAD_LEFT);

        return send_booking_emails([
            'name'           => $b['name'],
            'email'          => $b['email'],
            'phone'          => $b['phone'] ?? '',
            'prop_key'       => $b['prop_key'],
            'prop_name'      => $rate['name'] ?? $b['prop_key'],
            'address'        => $rate['address'] ?? '',
            'check_in'       => $b['check_in'],
            'check_out'      => $b['check_out'],
            'check_in_time'  => $b['check_in_time'] ?? '15:00',
            'check_out_time' => $b['check_out_time'] ?? '10:00',
            'nights'         => $nights,
            'per_night'      => $perNight,
            'nightly'        => $nightly,
            'tx_pct'         => $txPct,
            'tx_fee'         => $txFee,
            'adults'         => $b['adults'],
            'children'       => $b['children'],
            'total'          => $total,
            'damages_deposit'=> $deposit,
            'payment'        => $b['payment'],
            'ref'            => $ref,
        ]);
    } catch (\Throwable $ex) {
        return ['error' => 'Mail step skipped: ' . $ex->getMessage()];
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_admin();
    $rows = db()->query('SELECT * FROM bookings ORDER BY check_in ASC')->fetchAll();
    json_out(['bookings' => $rows]);
}

require_admin();
$in = body();
$action = $in['action'] ?? '';

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    $b = booking_by_id($id);
    db()->prepare('DELETE FROM bookings WHERE id = ?')->execute([$id]);
    if ($b) { try { require_once __DIR__ . '/waitlist.php'; waitlist_notify_freed($b['prop_key'] ?? '', $b['check_in'] ?? '', $b['check_out'] ?? ''); } catch (\Throwable $e) {} }
    json_out(['ok' => true]);
}

if ($action === 'add') {
    $propKey = clean($in['prop_key'] ?? '');
    $rate = get_rate($propKey);
    if (!$rate) json_out(['error' => 'Unknown property'], 400);
    $name = clean($in['name'] ?? '');
    $checkIn = clean($in['check_in'] ?? ''); $checkOut = clean($in['check_out'] ?? '');
    if ($name === '' || !$checkIn || !$checkOut) json_out(['error' => 'Name and dates required'], 400);
    if ($checkOut <= $checkIn) json_out(['error' => 'Check-out must be after check-in'], 400);

    // Date-clash warning (soft): if these dates overlap an existing booking or an
    // imported platform (Airbnb/Vrbo) block, return a clash notice so the owner
    // can confirm. Sending override_clash:true proceeds anyway.
    book_lock($propKey);   // serialise this property's writes (auto-frees at request end)
    if (empty($in['override_clash'])) {
        $clashMsg = clash_message($propKey, $checkIn, $checkOut, null);
        if ($clashMsg) json_out(['clash' => true, 'message' => $clashMsg]);
    }

    $adults = max(1, (int)($in['adults'] ?? 2));
    $children = max(0, (int)($in['children'] ?? 0));
    $status = in_array($in['payment'] ?? 'unpaid', ['unpaid','deposit','paid']) ? $in['payment'] : 'unpaid';
    $damagesOverride = array_key_exists('damages_deposit', $in) ? $in['damages_deposit'] : null;

    $snap = snapshot_fields($rate, ['adults'=>$adults,'children'=>$children,'check_in'=>$checkIn,'check_out'=>$checkOut], $damagesOverride);
    // Manual total override (back office): if set, it becomes the agreed total.
    $priceOverride = (array_key_exists('price_override', $in) && $in['price_override'] !== null && $in['price_override'] !== '')
        ? round((float)$in['price_override'], 2) : null;
    if ($priceOverride !== null) $snap['agreed_total'] = $priceOverride;
    $dep = reconcile_deposit($status, $snap['agreed_total'], 0, $in['deposit'] ?? null);
    if ($dep === null) json_out(['error' => 'A deposit must be more than £0 and less than the total'], 400);

    $method = ''; $date = null;
    if ($dep > 0.001) {
        $date = clean($in['payment_date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_out(['error' => 'A valid payment date is required'], 400);
        $method = clean($in['payment_method'] ?? '');
    }

    db()->prepare('INSERT INTO bookings
        (prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,notes,payment,
         deposit_paid,payment_method,payment_date,
         agreed_total,agreed_per_night,agreed_nights,agreed_nightly,agreed_booking_fee,agreed_txn_pct,agreed_txn_fee,agreed_on,price_override)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $propKey, $name, clean($in['email'] ?? ''), clean($in['phone'] ?? ''), clean($in['address'] ?? ''), clean($in['postcode'] ?? ''), $checkIn, $checkOut,
            clean($in['check_in_time'] ?? '15:00'), clean($in['check_out_time'] ?? '10:00'),
            $adults, $children, clean($in['notes'] ?? ''), $status,
            $dep, $method, ($date ?: null),
            $snap['agreed_total'],$snap['agreed_per_night'],$snap['agreed_nights'],$snap['agreed_nightly'],
            $snap['agreed_booking_fee'],$snap['agreed_txn_pct'],$snap['agreed_txn_fee'],$snap['agreed_on'],$priceOverride
        ]);
    $newId = (int)db()->lastInsertId();
    book_unlock($propKey);   // free the lock before the (slower) email send
    // Auto-send the confirmation email for the newly created booking (if it has
    // a guest email). Email failure never blocks the booking.
    $emailResult = null;
    $guestEmail = clean($in['email'] ?? '');
    if ($guestEmail !== '') {
        $emailResult = send_booking_confirmation($newId);
    }
    json_out(['ok' => true, 'id' => $newId, 'email' => $emailResult]);
}

if ($action === 'update') {
    $id = (int)($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) json_out(['error' => 'Booking not found'], 404);
    $propKey = clean($in['prop_key'] ?? $b['prop_key']);
    $rate = get_rate($propKey);
    if (!$rate) json_out(['error' => 'Unknown property'], 400);

    $checkIn = clean($in['check_in'] ?? $b['check_in']);
    $checkOut = clean($in['check_out'] ?? $b['check_out']);
    if ($checkOut <= $checkIn) json_out(['error' => 'Check-out must be after check-in'], 400);

    // Date-clash warning (soft) — ignore this booking's own dates. Confirm with
    // override_clash:true to proceed.
    book_lock($propKey);   // serialise this property's writes (auto-frees at request end)
    if (empty($in['override_clash'])) {
        $clashMsg = clash_message($propKey, $checkIn, $checkOut, $id);
        if ($clashMsg) json_out(['clash' => true, 'message' => $clashMsg]);
    }

    $adults = max(1, (int)($in['adults'] ?? $b['adults']));
    $children = max(0, (int)($in['children'] ?? $b['children']));

    // Re-snapshot price if the stay changed OR a new damages deposit was supplied
    $damagesOverride = array_key_exists('damages_deposit', $in) ? $in['damages_deposit'] : null;
    $currentDeposit = ($b['agreed_booking_fee'] !== null) ? (float)$b['agreed_booking_fee'] : null;
    $depositChanged = ($damagesOverride !== null && (float)$damagesOverride !== $currentDeposit);
    $stayChanged = ($propKey !== $b['prop_key']) || $checkIn !== $b['check_in'] ||
                   $checkOut !== $b['check_out'] || $adults != $b['adults'] || $children != $b['children'] ||
                   $b['agreed_total'] === null || $depositChanged;
    // When re-snapshotting, use the supplied deposit if given, else preserve the existing one
    $depForSnap = ($damagesOverride !== null) ? $damagesOverride : $currentDeposit;
    $snap = $stayChanged
        ? snapshot_fields($rate, ['adults'=>$adults,'children'=>$children,'check_in'=>$checkIn,'check_out'=>$checkOut], $depForSnap)
        : null;

    // Manual total override. If the field is sent: a value sets/keeps it, an empty
    // string clears it (revert to calculated). If not sent at all, keep existing.
    $overrideSent = array_key_exists('price_override', $in);
    if ($overrideSent) {
        $priceOverride = ($in['price_override'] !== null && $in['price_override'] !== '')
            ? round((float)$in['price_override'], 2) : null;
    } else {
        $priceOverride = ($b['price_override'] !== null) ? (float)$b['price_override'] : null;
    }
    // The effective total: override wins; else the (re)snapshot; else existing.
    $calcTotal = $snap ? $snap['agreed_total'] : (float)$b['agreed_total'];
    $total = ($priceOverride !== null) ? $priceOverride : $calcTotal;

    $status = in_array($in['payment'] ?? $b['payment'], ['unpaid','deposit','paid']) ? ($in['payment'] ?? $b['payment']) : $b['payment'];
    $dep = reconcile_deposit($status, $total, $b['deposit_paid'], $in['deposit'] ?? null);
    if ($dep === null) json_out(['error' => 'A deposit must be more than £0 and less than the total'], 400);

    $method = $b['payment_method']; $date = $b['payment_date'];
    if ($dep > 0.001) {
        $date = clean($in['payment_date'] ?? $b['payment_date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$date)) json_out(['error' => 'A valid payment date is required'], 400);
        $method = clean($in['payment_method'] ?? $b['payment_method'] ?? '');
    } else { $method = ''; $date = null; }

    $sql = 'UPDATE bookings SET prop_key=?,name=?,email=?,phone=?,address=?,postcode=?,check_in=?,check_out=?,check_in_time=?,check_out_time=?,
            adults=?,children=?,notes=?,payment=?,deposit_paid=?,payment_method=?,payment_date=?,price_override=?';
    $args = [$propKey, clean($in['name'] ?? $b['name']), clean($in['email'] ?? $b['email']), clean($in['phone'] ?? $b['phone']),
             clean($in['address'] ?? $b['address']), clean($in['postcode'] ?? $b['postcode']),
             $checkIn, $checkOut, clean($in['check_in_time'] ?? $b['check_in_time']), clean($in['check_out_time'] ?? $b['check_out_time']),
             $adults, $children, clean($in['notes'] ?? $b['notes']), $status, $dep, $method, ($date ?: null), $priceOverride];
    if ($snap) {
        $sql .= ',agreed_total=?,agreed_per_night=?,agreed_nights=?,agreed_nightly=?,agreed_booking_fee=?,agreed_txn_pct=?,agreed_txn_fee=?,agreed_on=?';
        array_push($args, $snap['agreed_total'],$snap['agreed_per_night'],$snap['agreed_nights'],$snap['agreed_nightly'],
                   $snap['agreed_booking_fee'],$snap['agreed_txn_pct'],$snap['agreed_txn_fee'],$snap['agreed_on']);
    }
    $sql .= ' WHERE id = ?'; $args[] = $id;
    db()->prepare($sql)->execute($args);
    book_unlock($propKey);
    json_out(['ok' => true]);
}

if ($action === 'set_payment') {
    $id = (int)($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) json_out(['error' => 'Booking not found'], 404);
    $total = (float)($b['agreed_total'] ?? 0);
    $status = in_array($in['payment'] ?? '', ['unpaid','deposit','paid']) ? $in['payment'] : $b['payment'];
    $dep = reconcile_deposit($status, $total, $b['deposit_paid'], $in['deposit'] ?? null);
    if ($dep === null) json_out(['error' => "Deposit must be more than £0 and less than the total. Use 'Paid' or 'Unpaid' otherwise."], 400);

    $method = $b['payment_method']; $date = $b['payment_date'];
    if ($dep > 0.001) {
        $date = clean($in['payment_date'] ?? $b['payment_date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$date)) json_out(['error' => 'A valid payment date is required'], 400);
        $method = clean($in['payment_method'] ?? $b['payment_method'] ?? '');
    } else { $method = ''; $date = null; }

    db()->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_method=?, payment_date=? WHERE id=?')
        ->execute([$status, $dep, $method, ($date ?: null), $id]);
    json_out(['ok' => true]);
}

// Manually (re)send the confirmation email for an existing booking.
if ($action === 'send_arrival') {
    require_admin();
    $id = (int)($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) json_out(['error' => 'Booking not found'], 404);
    if (empty($b['email'])) json_out(['error' => 'This booking has no guest email on file.'], 400);
    require_once __DIR__ . '/mailer.php';   // the arrival-email helpers live here
    $res = send_arrival_for_booking($b);
    if (!empty($res['ok'])) json_out(['ok' => true]);
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 500);
}

if ($action === 'send_confirmation') {
    require_admin();
    $id = (int)($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) json_out(['error' => 'Booking not found'], 404);
    if (empty($b['email'])) json_out(['error' => 'This booking has no guest email on file.'], 400);
    $result = send_booking_confirmation($id);
    if (is_array($result) && isset($result['guest']) && !empty($result['guest']['ok'])) {
        json_out(['ok' => true, 'email' => $result]);
    }
    $reason = $result['error'] ?? ($result['guest']['error'] ?? 'Unknown mail error');
    json_out(['error' => 'Email not sent: ' . $reason, 'email' => $result], 200);
}

// ---- Square online payments (admin side) ----------------------------------
// (square_deposit_pct, booking_amount_due live in pricing.php; site_base_url in db.php.)

// Email the guest a secure link to pay the deposit (or balance) on our site.
if ($action === 'request_payment') {
    if (!square_enabled()) json_out(['error' => 'Square payments are not switched on yet (see config.php / Settings).'], 400);
    $id = (int)($in['id'] ?? 0);
    $kind = (($in['kind'] ?? 'deposit') === 'balance') ? 'balance' : 'deposit';
    $b = booking_by_id($id);
    if (!$b) json_out(['error' => 'Booking not found'], 404);
    if (empty($b['email'])) json_out(['error' => 'This booking has no guest email on file.'], 400);

    require_once __DIR__ . '/mailer.php';
    $res = request_booking_payment($b, $kind);
    if (!empty($res['ok'])) json_out(['ok' => true, 'amount' => $res['amount']]);
    json_out(['error' => $res['error'] ?? 'Email failed to send'], 200);
}

// Refund a Square payment (full or partial) and re-reconcile the booking.
if ($action === 'refund') {
    if (!square_enabled()) json_out(['error' => 'Square payments are not switched on yet.'], 400);
    $sqId = clean($in['square_payment_id'] ?? '');
    if ($sqId === '') json_out(['error' => 'Missing payment id'], 400);
    $row = (function ($sq) { $s = db()->prepare('SELECT * FROM payments WHERE square_payment_id = ?'); $s->execute([$sq]); return $s->fetch(); })($sqId);
    if (!$row) json_out(['error' => 'Payment not found'], 404);
    if (in_array($row['kind'], ['refund', 'damages_return'], true)) json_out(['error' => 'That row is itself a refund.'], 400);

    $amount = (array_key_exists('amount', $in) && $in['amount'] !== null && $in['amount'] !== '')
        ? round((float)$in['amount'], 2) : (float)$row['amount'];
    if ($amount <= 0 || $amount > (float)$row['amount'] + 0.001) json_out(['error' => 'Refund amount must be between £0 and the original charge.'], 400);
    $note = clean($in['note'] ?? '');

    $bookingId = (int)$row['booking_id'];
    $b = booking_by_id($bookingId);   // may be null if the booking was already deleted
    $gName = $b['name'] ?? ($row['guest_name'] ?? null);
    $gProp = $b['prop_key'] ?? ($row['prop_key'] ?? null);
    book_lock($gProp ?? '');
    $rr = record_square_refund($bookingId, $sqId, $amount, 'refund', $note, $gName, $gProp);
    if (empty($rr['ok'])) { book_unlock($gProp ?? ''); json_out(['error' => $rr['error']], 402); }
    $rec = reconcile_booking_payment($bookingId, $b);
    book_unlock($gProp ?? '');

    // Tell the guest a refund is on its way (best-effort — never fails the refund).
    $emailResult = null;
    if ($b && !empty($b['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $rate = get_rate($b['prop_key']);
            $emailResult = send_refund_email([
                'name' => $b['name'], 'email' => $b['email'], 'prop_key' => $b['prop_key'],
                'prop_name' => $rate['name'] ?? $b['prop_key'],
                'check_in' => $b['check_in'], 'check_out' => $b['check_out'], 'amount' => $amount, 'reason' => $note,
            ]);
        } catch (\Throwable $e) { $emailResult = ['ok' => false, 'error' => $e->getMessage()]; }
    }
    json_out(['ok' => true, 'refunded' => $amount, 'status' => $rec['status'], 'email' => $emailResult]);
}

// Return the held refundable damage deposit (full or partial) after checkout.
// Tracked as 'damages_return' so it never changes the rental payment status.
if ($action === 'return_deposit') {
    $id = (int)($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) json_out(['error' => 'Booking not found'], 404);
    $note = clean($in['note'] ?? '');
    $held = round(max(0, damages_collected($b) - damages_returned($id)), 2);
    if ($held <= 0) json_out(['error' => 'No damage deposit is being held for this booking.'], 409);
    $amount = (array_key_exists('amount', $in) && $in['amount'] !== null && $in['amount'] !== '')
        ? round((float)$in['amount'], 2) : $held;
    if ($amount <= 0 || $amount > $held + 0.001) json_out(['error' => 'Return amount must be between £0 and the held deposit (' . $held . ').'], 400);

    book_lock($b['prop_key'] ?? '');
    $charge = square_enabled() ? find_charge_for_refund($id, $amount) : null;
    if ($charge) {
        $rr = record_square_refund($id, $charge, $amount, 'damages_return', $note, $b['name'], $b['prop_key']);
        if (empty($rr['ok'])) { book_unlock($b['prop_key'] ?? ''); json_out(['error' => $rr['error']], 402); }
        $status = $rr['status'];
    } else {
        // No card charge to refund against (manual/cash booking) — record that the
        // owner has returned it by hand.
        insert_payment_row($id, 'manual-' . bin2hex(random_bytes(8)), 'damages_return', $amount, 'MANUAL', $b['name'], $b['prop_key'], $note);
        $status = 'MANUAL';
    }
    book_unlock($b['prop_key'] ?? '');

    $emailResult = null;
    if (!empty($b['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $rate = get_rate($b['prop_key']);
            $emailResult = send_deposit_return_email([
                'name' => $b['name'], 'email' => $b['email'], 'prop_key' => $b['prop_key'],
                'prop_name' => $rate['name'] ?? $b['prop_key'], 'check_in' => $b['check_in'], 'check_out' => $b['check_out'],
                'amount' => $amount, 'held' => $held, 'reason' => $note, 'manual' => ($status === 'MANUAL'),
            ]);
        } catch (\Throwable $e) { $emailResult = ['ok' => false, 'error' => $e->getMessage()]; }
    }
    json_out(['ok' => true, 'returned' => $amount, 'status' => $status, 'email' => $emailResult]);
}

// Cancel a booking: optional refund (per chosen amount), email the guest, then
// free the dates by deleting it (the ledger rows are kept for the record).
if ($action === 'cancel') {
    $id = (int)($in['id'] ?? 0);
    $b = booking_by_id($id);
    if (!$b) json_out(['error' => 'Booking not found'], 404);
    $reason = clean($in['reason'] ?? '');
    $refundAmount = (array_key_exists('refund_amount', $in) && $in['refund_amount'] !== null && $in['refund_amount'] !== '')
        ? round((float)$in['refund_amount'], 2) : 0.0;
    $refundedByCard = 0.0;
    if ($refundAmount > 0 && square_enabled()) {
        $charge = find_charge_for_refund($id, $refundAmount);
        if ($charge) {
            book_lock($b['prop_key'] ?? '');
            $rr = record_square_refund($id, $charge, $refundAmount, 'refund', ($reason !== '' ? $reason : 'Cancellation'), $b['name'], $b['prop_key']);
            book_unlock($b['prop_key'] ?? '');
            if (empty($rr['ok'])) json_out(['error' => 'Refund failed: ' . $rr['error']], 402);
            $refundedByCard = $refundAmount;
        }
        // No single charge big enough → leave it for a manual refund; still cancel + email.
    }
    $emailResult = null;
    if (!empty($b['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $rate = get_rate($b['prop_key']);
            $emailResult = send_cancellation_email([
                'name' => $b['name'], 'email' => $b['email'], 'prop_key' => $b['prop_key'],
                'prop_name' => $rate['name'] ?? $b['prop_key'], 'check_in' => $b['check_in'], 'check_out' => $b['check_out'],
                'refund' => $refundAmount, 'card' => ($refundedByCard > 0), 'reason' => $reason,
            ]);
        } catch (\Throwable $e) { $emailResult = ['ok' => false, 'error' => $e->getMessage()]; }
    }
    db()->prepare('DELETE FROM bookings WHERE id = ?')->execute([$id]);
    try { require_once __DIR__ . '/waitlist.php'; waitlist_notify_freed($b['prop_key'] ?? '', $b['check_in'] ?? '', $b['check_out'] ?? ''); } catch (\Throwable $e) {}
    json_out(['ok' => true, 'refunded' => $refundedByCard, 'manual_refund' => ($refundAmount > $refundedByCard + 0.001), 'email' => $emailResult]);
}

// Per-booking damage-deposit returns, summed (Money & income dashboard).
if ($action === 'deposit_returns') {
    try {
        $rows = db()->query("SELECT booking_id, COALESCE(SUM(amount),0) total FROM payments WHERE kind = 'damages_return' GROUP BY booking_id")->fetchAll();
        $map = [];
        foreach ($rows as $r) { $map[(string)$r['booking_id']] = round((float)$r['total'], 2); }
        json_out(['returns' => $map]);
    } catch (\Throwable $e) { json_out(['returns' => []]); }
}

// List the Square payment ledger for a booking (admin detail panel).
if ($action === 'payments') {
    $id = (int)($in['id'] ?? 0);
    try {
        $s = db()->prepare('SELECT square_payment_id, kind, amount, status, note, created_at FROM payments WHERE booking_id = ? ORDER BY id ASC');
        $s->execute([$id]);
        json_out(['payments' => $s->fetchAll()]);
    } catch (\Throwable $e) { json_out(['payments' => []]); }
}

// Recent Square transactions across all bookings (Money & income feed).
// LEFT JOIN + snapshot fallback so payments/refunds from DELETED bookings stay
// visible (the ledger rows are deliberately kept when a booking is removed).
if ($action === 'recent_payments') {
    try {
        $rows = db()->query(
            'SELECT p.square_payment_id, p.kind, p.amount, p.fee, p.status, p.note, p.created_at,
                    COALESCE(b.name, p.guest_name) AS name,
                    COALESCE(b.prop_key, p.prop_key) AS prop_key,
                    (b.id IS NULL) AS booking_deleted
             FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
             ORDER BY p.id DESC LIMIT 50'
        )->fetchAll();
        json_out(['payments' => $rows]);
    } catch (\Throwable $e) {
        // Pre-snapshot schema: fall back to the inner join (no deleted-booking rows).
        try {
            $rows = db()->query(
                'SELECT p.square_payment_id, p.kind, p.amount, p.status, p.created_at, b.name, b.prop_key
                 FROM payments p JOIN bookings b ON b.id = p.booking_id ORDER BY p.id DESC LIMIT 50'
            )->fetchAll();
            json_out(['payments' => $rows]);
        } catch (\Throwable $e2) { json_out(['payments' => []]); }
    }
}

// Remove a single Square transaction from the ledger (e.g. tidying up test
// payments). This only deletes the audit record — it does not refund the guest
// or change a booking's stored figures.
if ($action === 'delete_payment') {
    $sqId = clean($in['square_payment_id'] ?? '');
    if ($sqId === '') json_out(['error' => 'Missing payment id'], 400);
    try { db()->prepare('DELETE FROM payments WHERE square_payment_id = ?')->execute([$sqId]); }
    catch (\Throwable $e) { json_out(['error' => 'Could not delete'], 500); }
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
