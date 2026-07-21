<?php
// ============================================================
//  payments-reconcile.php — Square settlement back-fill (shared lib).
//
//  A payment's processing FEE and a refund's final STATUS both land a day or two
//  AFTER the action, normally pushed by the square-webhook.php events. When that
//  webhook is unconfigured or a delivery is missed, the ledger would otherwise
//  read "Square fees − £0.00" or leave a refund on PENDING forever. These two
//  best-effort polls reconcile from Square. They run BOTH on the recent_payments
//  view (instant when the owner looks) AND daily from cron.php (so the ledger
//  self-heals even if nobody opens Payments). Included by bookings.php + cron.php.
//
//  Pure DB + Square API (db.php helpers). Capped, guarded, never throws out —
//  a bad lookup skips one row, a missing column degrades to a no-op.
// ============================================================

// Bring still-pending refund / deposit-return rows up to Square's ACTUAL status
// (PENDING → COMPLETED once it truly processes; stays PENDING only while Square
// itself still says so). Only touches Square-issued rows in a non-terminal state.
function reconcile_pending_refunds($limit = 12)
{
    if (!square_enabled()) {
        return;
    }
    try {
        // Bounded to the last 60 days: a Square refund settles PENDING→COMPLETED
        // within a day or two, so an older-than-60-day non-terminal row will never
        // resolve (it's a manual refund with no real Square id) — polling it every
        // view forever just wastes a serial API round-trip and can starve fresh rows.
        $q = db()->prepare(
            "SELECT id, square_payment_id FROM payments
             WHERE kind IN ('refund','damages_return')
               AND (status IS NULL OR status NOT IN ('COMPLETED','FAILED','REJECTED'))
               AND square_payment_id IS NOT NULL AND square_payment_id <> ''
               AND created_at >= (NOW() - INTERVAL 60 DAY)
             ORDER BY id DESC LIMIT " . (int) $limit,
        );
        $q->execute();
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        return;
    }
    foreach ($rows as $r) {
        try {
            $res = square_api('GET', '/v2/refunds/' . rawurlencode((string) $r['square_payment_id']));
            $status = $res['body']['refund']['status'] ?? '';
            // Only a recognised Square status overwrites the row — a 404/error
            // (e.g. a manually recorded refund with no Square id) leaves it as-is.
            if (in_array($status, ['PENDING', 'COMPLETED', 'FAILED', 'REJECTED', 'APPROVED'], true)) {
                db()->prepare('UPDATE payments SET status = ? WHERE id = ?')->execute([$status, (int) $r['id']]);
            }
        } catch (\Throwable $e) {
            // best-effort per row — never let one bad lookup break the rest
        }
    }
}

// Back-fill the Square PROCESSING FEE on settled card payments that don't have
// one yet (a not-yet-settled payment simply has no fee, so we leave it and try
// again next time). Best-effort, capped; refunds carry no processing fee.
function reconcile_missing_fees($limit = 15)
{
    if (!square_enabled()) {
        return;
    }
    try {
        // Exclude synthetic ledger ids — kept-deposit rows ('kept-…', kind
        // 'damages') and manually-recorded payments ('manual-…') are NOT Square
        // charges, so GET /v2/payments/<id> 404s forever, wasting a call every run
        // and (under ORDER BY id DESC LIMIT) starving real card rows behind them.
        // Bounded to the last 60 days too: a Square fee settles within a day or two
        // of the charge, so a card row still fee-less after 60 days never will be
        // (the webhook/lookup already missed it) — stop re-polling it on every view.
        $q = db()->prepare(
            "SELECT id, square_payment_id FROM payments
             WHERE kind NOT IN ('refund','damages_return','damages')
               AND fee IS NULL
               AND square_payment_id IS NOT NULL AND square_payment_id <> ''
               AND square_payment_id NOT LIKE 'kept-%'
               AND square_payment_id NOT LIKE 'manual-%'
               AND created_at >= (NOW() - INTERVAL 60 DAY)
             ORDER BY id DESC LIMIT " . (int) $limit,
        );
        $q->execute();
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        return; // fee column not migrated / table missing
    }
    foreach ($rows as $r) {
        try {
            $res = square_api('GET', '/v2/payments/' . rawurlencode((string) $r['square_payment_id']));
            $payment = $res['body']['payment'] ?? null;
            if (!$payment || empty($payment['processing_fee']) || !is_array($payment['processing_fee'])) {
                continue; // not settled yet (or a non-Square/manual row) — leave null
            }
            $cents = 0;
            foreach ($payment['processing_fee'] as $pf) {
                $cents += (int) ($pf['amount_money']['amount'] ?? 0);
            }
            db()->prepare('UPDATE payments SET fee = ? WHERE id = ?')->execute([round($cents / 100, 2), (int) $r['id']]);
        } catch (\Throwable $e) {
            // best-effort per row
        }
    }
}
