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

if (!square_enabled()) json_out(['error' => 'Online payment is not available right now.'], 503);

$bookingId = (int)($in['booking_id'] ?? 0);
$token     = clean($in['token'] ?? '');
$kind      = (($in['kind'] ?? 'deposit') === 'balance') ? 'balance' : 'deposit';

// Validate the pay token before touching anything.
if ($bookingId <= 0 || !hash_equals(pay_token($bookingId), $token)) {
    json_out(['error' => 'This payment link is invalid or has expired.'], 403);
}

$b = (function ($id) {
    $s = db()->prepare('SELECT * FROM bookings WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch();
})($bookingId);
if (!$b) json_out(['error' => 'Booking not found.'], 404);

// Effective total = manual override if set, else the locked agreed total
// (fall back to a live calc only for legacy rows missing the snapshot).
$rate = get_rate($b['prop_key']);
if ($b['agreed_total'] !== null) {
    $total = ($b['price_override'] !== null) ? (float)$b['price_override'] : (float)$b['agreed_total'];
} else {
    $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
    $total = $p['total'];
}
$total = round($total, 2);

// Deposit policy: a global percentage in the content table (default 25%).
$depPct = square_deposit_pct();
$depositAmount = round($total * ($depPct / 100), 2);
$alreadyPaid   = round((float)($b['deposit_paid'] ?? 0), 2);

// Amount due for this request, derived from kind (never trusted from the client).
$amountDue = ($kind === 'balance')
    ? round(max(0, $total - $alreadyPaid), 2)
    : round(max(0, $depositAmount - $alreadyPaid), 2);

$propName = $rate['name'] ?? $b['prop_key'];

if ($action === 'summary') {
    json_out([
        'ok'         => true,
        'propName'   => $propName,
        'guestName'  => $b['name'],
        'checkIn'    => $b['check_in'],
        'checkOut'   => $b['check_out'],
        'currency'   => 'GBP',
        'kind'       => $kind,
        'total'      => $total,
        'alreadyPaid'=> $alreadyPaid,
        'balance'    => round(max(0, $total - $alreadyPaid), 2),
        'depositPct' => $depPct,
        'amountDue'  => $amountDue,
    ]);
}

if ($action === 'charge') {
    $sourceId = clean($in['source_id'] ?? '');
    if ($sourceId === '') json_out(['error' => 'Missing card details — please try again.'], 400);
    if ($amountDue <= 0)  json_out(['error' => 'This booking is already paid in full.'], 409);

    book_lock($b['prop_key']);   // serialise so two tabs can't double-charge

    // Re-read deposit_paid under the lock (a concurrent charge may have moved it).
    $fresh = db()->prepare('SELECT deposit_paid FROM bookings WHERE id = ?');
    $fresh->execute([$bookingId]);
    $nowPaid = round((float)($fresh->fetchColumn() ?: 0), 2);
    $amountDue = ($kind === 'balance')
        ? round(max(0, $total - $nowPaid), 2)
        : round(max(0, $depositAmount - $nowPaid), 2);
    if ($amountDue <= 0) { book_unlock($b['prop_key']); json_out(['error' => 'This booking is already paid in full.'], 409); }

    $pence = (int)round($amountDue * 100);
    $ref = 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string)$bookingId), -6), 6, '0', STR_PAD_LEFT);
    $res = square_api('POST', '/v2/payments', [
        'source_id'           => $sourceId,
        'idempotency_key'     => bin2hex(random_bytes(16)),
        'amount_money'        => ['amount' => $pence, 'currency' => 'GBP'],
        'location_id'         => SQUARE_LOCATION_ID,
        'reference_id'        => $ref,
        'note'                => ucfirst($kind) . " for {$propName} ({$b['check_in']} to {$b['check_out']})",
        'buyer_email_address' => $b['email'] ?: null,
    ]);

    $payment = $res['body']['payment'] ?? null;
    $ok = in_array($res['status'], [200, 201], true) && $payment
        && in_array(($payment['status'] ?? ''), ['COMPLETED', 'APPROVED'], true);
    if (!$ok) {
        book_unlock($b['prop_key']);
        $detail = $res['body']['errors'][0]['detail'] ?? ($res['body']['error'] ?? 'Payment was declined. Please check your card and try again.');
        json_out(['error' => $detail], 402);
    }

    // Reconcile: record the ledger row (idempotent on square_payment_id) and move
    // the booking's headline payment state forward.
    $sqId = (string)$payment['id'];
    try {
        db()->prepare('INSERT IGNORE INTO payments (booking_id, square_payment_id, kind, amount, status, guest_name, prop_key, created_at)
                       VALUES (?,?,?,?,?,?,?,NOW())')
            ->execute([$bookingId, $sqId, $kind, $amountDue, $payment['status'], $b['name'], $b['prop_key']]);
    } catch (\Throwable $e) { /* table missing — booking update below still applies */ }

    $newPaid = round(min($total, $nowPaid + $amountDue), 2);
    $newStatus = ($newPaid >= $total - 0.001) ? 'paid' : ($newPaid > 0 ? 'deposit' : 'unpaid');
    db()->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_method=?, payment_date=? WHERE id=?')
        ->execute([$newStatus, $newPaid, 'Square card', date('Y-m-d'), $bookingId]);

    book_unlock($b['prop_key']);

    // Receipt email (best-effort — never fails the payment).
    try {
        require_once __DIR__ . '/mailer.php';
        send_payment_receipt([
            'name' => $b['name'], 'email' => $b['email'], 'prop_key' => $b['prop_key'],
            'prop_name' => $propName, 'ref' => $ref, 'kind' => $kind,
            'amount' => $amountDue, 'total' => $total, 'paid_so_far' => $newPaid,
            'balance' => round(max(0, $total - $newPaid), 2), 'fully_paid' => ($newStatus === 'paid'),
        ]);
    } catch (\Throwable $e) {}

    // Notify the owner that money has landed (best-effort).
    try {
        require_once __DIR__ . '/mailer.php';
        send_owner_payment_notice([
            'name' => $b['name'], 'prop_key' => $b['prop_key'], 'prop_name' => $propName,
            'kind' => $kind, 'amount' => $amountDue, 'status' => $newStatus,
        ]);
    } catch (\Throwable $e) {}

    json_out(['ok' => true, 'status' => $newStatus, 'paid' => $amountDue, 'fullyPaid' => ($newStatus === 'paid')]);
}

json_out(['error' => 'Unknown action'], 400);
