<?php
// ============================================================
//  square-webhook.php — server-to-server payment notifications (public).
//  Square POSTs payment.created / payment.updated here. We verify the HMAC
//  signature, then reconcile the booking from its payments ledger so the state
//  is correct even if the guest's browser dropped after a successful charge.
//  Setup is one-tap: Manage → Payments → "Connect" (square-setup.php) creates the
//  subscription via the Square API and stores the signing key ENCRYPTED — so
//  square_webhook_signing_key()/square_webhook_url() (db.php) resolve it with no
//  config.php edit. The SQUARE_WEBHOOK_* config constants still win if present.
//
//  Signature: base64( HMAC-SHA256( notificationUrl + rawBody, signatureKey ) )
//  in header x-square-hmacsha256-signature. (Square's standard scheme.)
// ============================================================
require_once __DIR__ . '/db.php';

$raw = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '';
// Key + URL resolve from config.php constants OR the self-provisioned values the
// app stored when it wired the webhook up (square-setup.php) — so this works with
// no manual config once "Connect automatic payment updates" has been run.
$key = square_webhook_signing_key();
$url = square_webhook_url();

if ($key === '' || $url === '') {
    json_out(['error' => 'Webhook not configured'], 503);
}
if (!square_webhook_signature_ok($url, $raw, $key, $sig)) {
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

$paid = booking_ledger_net($bookingId);
$paid = min($total > 0 ? $total : $paid, $paid);

// GUARD: the webhook only ever RAISES deposit_paid (a new / newly-settled card
// payment). It must NEVER lower it. Reductions are owned by the synchronous
// refund action (bookings.php `refund` → reconcile_booking_payment, which floors
// paid at prior − thisRefund and so preserves manually-recorded bank/cash money
// that has no ledger row) and by the dispute handler above. The old guard let a
// LOWER figure through whenever ANY refund row existed — so a routine
// post-refund `payment.updated` re-send (Square re-emits these on fee settlement
// and refund attachment) recomputed the ledger-only net and wiped bank money on
// a mixed bank+card booking to £0. The ledger genuinely can't attribute a refund
// between card and untracked bank money, so the only safe rule is: the app owns
// every reduction; the webhook may raise, never cut. (Equivalent to
// reconcile_booking_payment(booking, refundJustIssued: 0).)
if ($paid < (float) $b['deposit_paid'] - 0.001) {
    json_out(['ok' => true]); // ledger knows less than the booking — the app owns reductions
}
$newStatus = derive_payment_status($total, $paid);

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
