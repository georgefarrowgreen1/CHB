<?php
// ============================================================
//  square-webhook.php — server-to-server payment notifications (public).
//  Square POSTs payment.created / payment.updated here. We verify the HMAC
//  signature, then reconcile the booking from its payments ledger so the state
//  is correct even if the guest's browser dropped after a successful charge.
//  Register the URL in Square (Developer Dashboard > Webhooks) and paste the
//  signature key + the exact URL into config.php.
//
//  Signature: base64( HMAC-SHA256( notificationUrl + rawBody, signatureKey ) )
//  in header x-square-hmacsha256-signature. (Square's standard scheme.)
// ============================================================
require_once __DIR__ . '/db.php';

$raw = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '';
$key = defined('SQUARE_WEBHOOK_SIGNATURE_KEY') ? SQUARE_WEBHOOK_SIGNATURE_KEY : '';
$url = defined('SQUARE_WEBHOOK_URL') ? SQUARE_WEBHOOK_URL : '';

if ($key === '' || $url === '') {
    json_out(['error' => 'Webhook not configured'], 503);
}
$expected = base64_encode(hash_hmac('sha256', $url . $raw, $key, true));
if ($sig === '' || !hash_equals($expected, $sig)) {
    json_out(['error' => 'Invalid signature'], 401);
}

$event = json_decode($raw, true);
$type = $event['type'] ?? '';

// Refund events: keep the ledger row's status current (e.g. PENDING -> COMPLETED).
// Refund/damages-return rows store the Square refund id as square_payment_id.
if (strpos($type, 'refund.') === 0) {
    $refund = $event['data']['object']['refund'] ?? null;
    if ($refund && !empty($refund['id'])) {
        try {
            db()
                ->prepare('UPDATE payments SET status = ? WHERE square_payment_id = ?')
                ->execute([(string) ($refund['status'] ?? ''), (string) $refund['id']]);
        } catch (\Throwable $e) {
        }
    }
    json_out(['ok' => true]);
}

// Disputes / chargebacks: a guest's bank has pulled a payment back. This needs
// the owner's attention (evidence deadline, lost funds), so log it prominently.
if (strpos($type, 'dispute.') === 0) {
    $d = $event['data']['object']['dispute'] ?? null;
    if ($d && function_exists('log_activity')) {
        $amt = isset($d['amount_money']['amount']) ? ' — £' . number_format((int) $d['amount_money']['amount'] / 100, 2) : '';
        log_activity('payment', 'payment.dispute', 'Card payment DISPUTED' . $amt . ' (' . ($d['reason'] ?? 'chargeback') . ')', [
            'severity' => 'action',
            'entity' => 'dispute',
            'entity_id' => (string) ($d['id'] ?? ''),
            'meta' => ['detail' => 'state: ' . ($d['state'] ?? '')],
        ]);
    }
    json_out(['ok' => true]);
}

$payment = $event['data']['object']['payment'] ?? null;

// Only payment events carry what we need; acknowledge anything else so Square
// doesn't keep retrying.
if (strpos($type, 'payment.') !== 0 || !$payment) {
    json_out(['ok' => true]);
}

$sqId = (string) ($payment['id'] ?? '');
$status = (string) ($payment['status'] ?? '');
$refId = (string) ($payment['reference_id'] ?? '');

// Square computes the processing fee after settlement; sum any fee components
// present on this event (in pence) so we can store gross/fee/net.
$fee = null;
if (!empty($payment['processing_fee']) && is_array($payment['processing_fee'])) {
    $cents = 0;
    foreach ($payment['processing_fee'] as $pf) {
        $cents += (int) ($pf['amount_money']['amount'] ?? 0);
    }
    $fee = round($cents / 100, 2);
}

// Map back to our booking: prefer the ledger row; fall back to reference_id (CHB-000123).
$bookingId = 0;
try {
    $s = db()->prepare('SELECT booking_id FROM payments WHERE square_payment_id = ?');
    $s->execute([$sqId]);
    $bookingId = (int) ($s->fetchColumn() ?: 0);
    // Reflect the latest status (and fee, once known) on the ledger row. COALESCE
    // keeps a previously-recorded fee if this event doesn't carry one. Falls back
    // to a status-only update if the fee column hasn't been migrated yet.
    if ($bookingId && $status !== '') {
        try {
            db()
                ->prepare('UPDATE payments SET status = ?, fee = COALESCE(?, fee) WHERE square_payment_id = ?')
                ->execute([$status, $fee, $sqId]);
        } catch (\Throwable $eFee) {
            db()
                ->prepare('UPDATE payments SET status = ? WHERE square_payment_id = ?')
                ->execute([$status, $sqId]);
        }
    }
} catch (\Throwable $e) {
    /* payments table not migrated — nothing to reconcile */ json_out(['ok' => true]);
}

if (!$bookingId && preg_match('/(\d+)/', $refId, $m)) {
    $bookingId = (int) $m[1];
}
if (!$bookingId) {
    json_out(['ok' => true]);
}

// Recompute the booking's headline payment state from the COMPLETED ledger rows
// (deposit + balance, minus refunds). This is idempotent and order-independent.
require_once __DIR__ . '/pricing.php';
$bs = db()->prepare('SELECT * FROM bookings WHERE id = ?');
$bs->execute([$bookingId]);
$b = $bs->fetch();
if (!$b) {
    json_out(['ok' => true]);
}

$total =
    $b['agreed_total'] !== null
        ? ($b['price_override'] !== null
            ? (float) $b['price_override']
            : (float) $b['agreed_total'])
        : 0.0;
if ($total <= 0) {
    $rate = get_rate($b['prop_key']);
    if ($rate) {
        $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
        $total = $p['total'];
    }
}
$total = round($total, 2);

$sum = db()->prepare("SELECT
        COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount ELSE 0 END),0) AS net
    FROM payments WHERE booking_id = ?");
$sum->execute([$bookingId]);
$paid = round(max(0, (float) $sum->fetchColumn()), 2);
$paid = min($total > 0 ? $total : $paid, $paid);

// GUARD: never write a LOWER figure than the booking already carries unless the
// ledger actually contains refunds. Manually recorded payments (bank transfer)
// have no ledger rows — without this, any webhook event matching the booking
// (including the digits-in-reference fallback above) would wipe them to £0.
if ($paid < (float) $b['deposit_paid'] - 0.001) {
    $rq = db()->prepare("SELECT COUNT(*) FROM payments WHERE booking_id = ? AND kind = 'refund'");
    $rq->execute([$bookingId]);
    if ((int) $rq->fetchColumn() === 0) {
        json_out(['ok' => true]); // ledger knows less than the booking — leave it be
    }
}
$newStatus = $total > 0 && $paid >= $total - 0.001 ? 'paid' : ($paid > 0 ? 'deposit' : 'unpaid');

// Only stamp payment_date/payment_method when the reconciled figures actually
// CHANGED. Square routinely re-sends payment.updated days later (the settlement
// fee back-fill, hold releases), and an unconditional write drifted the
// recorded payment date to the event date — desyncing the owner's records from
// when the money really arrived, and overwriting a manually recorded method
// (e.g. bank transfer) with 'Square card'.
if ($newStatus !== ($b['payment'] ?? '') || abs($paid - (float) $b['deposit_paid']) > 0.001) {
    db()
        ->prepare('UPDATE bookings SET payment=?, deposit_paid=?, payment_method=?, payment_date=? WHERE id=?')
        ->execute([$newStatus, $paid, $paid > 0 ? 'Square card' : '', $paid > 0 ? date('Y-m-d') : null, $bookingId]);
}

json_out(['ok' => true]);
