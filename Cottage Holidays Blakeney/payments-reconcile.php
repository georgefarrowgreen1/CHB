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
            "SELECT id, square_payment_id, status FROM payments
             WHERE kind IN ('refund','damages_return')
               AND (status IS NULL OR UPPER(status) NOT IN ('COMPLETED','FAILED','REJECTED','MANUAL'))
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
            // Never downgrade a decided row. The query above already skips them, but a
            // row can settle between the SELECT and this write, and Square's own events
            // arrive out of order — so the guard belongs at the write too.
            if (payment_status_known($status) && !payment_status_terminal((string) ($r['status'] ?? ''))) {
                db()->prepare('UPDATE payments SET status = ? WHERE id = ?')->execute([payment_status_norm($status), (int) $r['id']]);
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

// ============================================================
//  ORPHAN SWEEP — money taken at Square that has NO row here.
//
//  Both reconcilers above start from OUR rows and ask Square about them, so by
//  construction neither can see a payment we never recorded. That gap is a real
//  one: pay.php charges the card and THEN writes the ledger row, so a fatal, a
//  dropped connection or a rolled-back write between the two leaves the guest
//  charged and the booking reading unpaid — and every downstream surface then
//  agrees the money is still owed, so the guest gets chased for it.
//
//  This looks the other way: list what Square says it took, subtract what we
//  hold, and report the difference. It DETECTS AND FLAGS — it never writes a
//  payment row. Recording money is a decision with the owner's name on it (the
//  "no destructive one-tap" rule, and self-repair's own stance of flagging the
//  ambiguous rather than touching it); this hands them the facts and the row is
//  one tap away on the booking hub.
// ============================================================

const ORPHAN_LOOKBACK_DAYS = 60; // a write that failed is discovered within days, not months
const ORPHAN_LIST_MAX = 100; // one page of Square's list — the cap is DECLARED, never silent
const ORPHAN_FLAG_MAX = 5; // how many get named in one run; the rest are counted

// Which booking a Square reference names, or null if it names none of ours.
// pay.php writes 'CHB-000042' for a charge and 'CHBHOLD-000042' for the legacy
// card hold; nothing else this site sends carries a reference at all.
function orphan_reference_booking($ref)
{
    if (!preg_match('/^CHB(?:HOLD)?-(\d+)$/', strtoupper(trim((string) $ref)), $m)) {
        return null;
    }
    $id = (int) $m[1];
    return $id > 0 ? $id : null;
}

// The whole judgement, pure: given Square's payments and every id we already
// hold, which ones are money we have not recorded?
function orphan_payments_scan(array $payments, array $knownIds, $cap = ORPHAN_FLAG_MAX)
{
    $known = [];
    foreach ($knownIds as $k) {
        $k = trim((string) $k);
        if ($k !== '') {
            $known[$k] = true;
        }
    }
    $out = [];
    foreach ($payments as $p) {
        if (!is_array($p)) {
            continue;
        }
        $id = trim((string) ($p['id'] ?? ''));
        if ($id === '' || isset($known[$id])) {
            continue;
        }
        // ONLY MONEY THAT ACTUALLY MOVED. APPROVED is the legacy card hold —
        // authorised, not captured — and FAILED/CANCELED took nothing at all.
        // Reporting either as takings we have lost would be alarming and wrong.
        if (strtoupper((string) ($p['status'] ?? '')) !== 'COMPLETED') {
            continue;
        }
        // ONLY A PAYMENT THAT CLAIMS TO BE OURS. Square is the owner's whole card
        // business, not just this site — a card reader or a Square invoice takes
        // money under the same account and has no row here BY DESIGN. Nagging
        // about those is how a money warning becomes noise nobody reads, so the
        // sweep is scoped to references this site itself wrote.
        $bid = orphan_reference_booking($p['reference_id'] ?? '');
        if ($bid === null) {
            continue;
        }
        // Net, because a payment refunded in full is not money waiting to be
        // recorded — it came and went, and the guest owes exactly what they did
        // before. A PARTIAL refund still leaves money we hold no record of.
        $net = (int) ($p['amount_money']['amount'] ?? 0) - (int) ($p['refunded_money']['amount'] ?? 0);
        if ($net <= 0) {
            continue;
        }
        $out[] = [
            'id' => $id,
            'booking_id' => $bid,
            'ref' => (string) ($p['reference_id'] ?? ''),
            'amount' => round($net / 100, 2),
            // Carried, NEVER converted — the payouts_money rule. That an
            // unrecorded payment exists is true in any currency; inventing a
            // pound figure for it would not be.
            'currency' => strtoupper((string) ($p['amount_money']['currency'] ?? 'GBP')) ?: 'GBP',
            'created_at' => (string) ($p['created_at'] ?? ''),
        ];
    }
    // Newest first: a capped list should show the ones most likely still fixable.
    usort($out, function ($a, $b) {
        return strcmp((string) $b['created_at'], (string) $a['created_at']);
    });
    return ['rows' => $cap > 0 ? array_slice($out, 0, $cap) : $out, 'total' => count($out)];
}

// Ask Square what it took, read what we hold, and hand back the difference.
// Read-only on both sides — no UPDATE, no INSERT, nothing to undo.
function reconcile_orphan_payments($cap = ORPHAN_FLAG_MAX)
{
    $fail = function ($reason) {
        return ['ok' => false, 'reason' => $reason, 'rows' => [], 'total' => 0, 'truncated' => false];
    };
    if (!function_exists('square_enabled') || !square_enabled()) {
        return $fail('Square payments are not switched on');
    }
    // Scoped to the location this site trades under, for the reason payouts-lib
    // states at length: omitting it asks about Square's DEFAULT location, which
    // on a multi-location account is a confident answer about the wrong shop.
    $loc = function_exists('square_location_id') ? square_location_id() : '';
    $res = square_api(
        'GET',
        '/v2/payments?limit=' . ORPHAN_LIST_MAX .
            '&sort_order=DESC&begin_time=' . rawurlencode(gmdate('Y-m-d\TH:i:s\Z', time() - ORPHAN_LOOKBACK_DAYS * 86400)) .
            ($loc !== '' ? '&location_id=' . rawurlencode($loc) : ''),
    );
    $st = (int) ($res['status'] ?? 0);
    if ($st === 403) {
        return $fail("Square refused the request — the access token can't read payments");
    }
    if ($st < 200 || $st >= 300) {
        return $fail("Square didn't answer (" . $st . ')');
    }
    $payments = $res['body']['payments'] ?? [];
    if (!is_array($payments)) {
        $payments = [];
    }
    // WHAT WE ALREADY HOLD. A failure here must NOT fall through to an empty set:
    // with nothing known, every genuine payment of the last sixty days reads as
    // unrecorded, and the sweep would report the owner's whole quarter as lost
    // money. An unreadable ledger is "I don't know", and it says so.
    $known = [];
    try {
        $known = db()
            ->query("SELECT square_payment_id FROM payments WHERE square_payment_id IS NOT NULL AND square_payment_id <> ''")
            ->fetchAll(\PDO::FETCH_COLUMN);
    } catch (\Throwable $e) {
        return $fail("Couldn't read the payment ledger");
    }
    // The legacy card hold's id lives on the BOOKING, not in payments, so reading
    // only the ledger would report a captured hold as money we never recorded.
    try {
        foreach (
            db()
                ->query("SELECT hold_payment_id FROM bookings WHERE hold_payment_id IS NOT NULL AND hold_payment_id <> ''")
                ->fetchAll(\PDO::FETCH_COLUMN) as $h
        ) {
            $known[] = $h;
        }
    } catch (\Throwable $e) {
        // column not migrated on this install — the ledger alone still answers
    }
    $scan = orphan_payments_scan($payments, is_array($known) ? $known : [], $cap);
    return [
        'ok' => true,
        'reason' => '',
        'rows' => $scan['rows'],
        'total' => $scan['total'],
        // Declared, not silent: beyond one page we are not claiming to have
        // looked at everything Square took.
        'truncated' => count($payments) >= ORPHAN_LIST_MAX || !empty($res['body']['cursor']),
    ];
}
