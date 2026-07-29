<?php
// ============================================================
//  admin-bootstrap.php — everything the back office needs to open, in ONE
//  round-trip: { ok, rates, bookings, enquiries, blocks, cron }.
//  loadData() previously fired four parallel requests on EVERY admin screen
//  open (rates, bookings, enquiries, iCal blocks) plus cron-status on the
//  dashboard — each its own PHP process + DB connection on shared hosting.
//
//  Zero drift: each part is built by the SAME payload function its own
//  endpoint serves (the endpoints early-return before routing when included
//  — the bootstrap.php pattern). The blocks query is the one exception: it
//  mirrors ical-import.php's 'blocks' action (a plain table read) because
//  that file runs auth/routing at include time. The individual endpoints
//  stay live as the front end's fallback.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

require_once __DIR__ . '/rates.php';
require_once __DIR__ . '/bookings.php';
require_once __DIR__ . '/enquiries.php';
require_once __DIR__ . '/cron-status.php';

// Imported OTA blocks — mirrors ical-import.php action 'blocks' exactly.
$blocks = [];
try {
    $blocks = db()
        ->query('SELECT id, prop_key, source, check_in, check_out FROM ical_blocks ORDER BY check_in ASC')
        ->fetchAll();
} catch (\Throwable $e) {
}

// Per-cottage iCal feed health, folded into the SAME round-trip as everything
// else. The search foot's status line may not fire a request of its own (a line
// you normally ignore is a bad trade for a fetch on every open), which is why
// only the cron was wired there — this is what makes the second signal free.
// Reduced to what a status line needs: the worst staleness across the feeds, and
// which cottage it belongs to. ical-import.php still serves the full per-source
// detail to the settings page that asks for it.
$feeds = [];
try {
    foreach (db()->query('SELECT prop_key FROM properties WHERE archived_at IS NULL')->fetchAll() as $row) {
        $pk = (string) ($row['prop_key'] ?? '');
        if ($pk === '') {
            continue;
        }
        $st = content_json('ical-status-' . $pk, []);
        $at = (string) ($st['at'] ?? '');
        if ($at === '') {
            continue; // never imported — not the same thing as stalled
        }
        $ageH = (time() - strtotime($at)) / 3600;
        $bad = 0;
        foreach ((array) ($st['sources'] ?? []) as $src) {
            if (!($src['ok'] ?? true)) {
                $bad++;
            }
        }
        $feeds[] = ['pk' => $pk, 'name' => prop_display($pk) ?: $pk, 'ageHours' => round($ageH, 1), 'failing' => $bad];
    }
} catch (\Throwable $e) {
    $feeds = [];
}

// Payout trouble, folded into the same round trip for the same reason as $feeds. A
// FAILED payout usually means the bank details are wrong and every later transfer
// will fail too, so it belongs in the owner's duty list — and reading the CACHE
// costs nothing (payouts-lib never fetches from Square on a request path).
$payoutTrouble = null;
try {
    require_once __DIR__ . '/payouts-lib.php';
    $poc = payouts_cached();
    if (is_array($poc)) {
        $f = payouts_failed($poc['payouts'] ?? []);
        $dsp = is_array($poc['disputes'] ?? null) ? $poc['disputes'] : null;
        if ($f['count'] > 0 || ($dsp && ($dsp['count'] ?? 0) > 0)) {
            $payoutTrouble = [
                'failed' => $f,
                'disputed' => $dsp ? ['count' => (int) $dsp['count'], 'amount' => (float) $dsp['amount']] : null,
            ];
        }
    }
} catch (\Throwable $e) {
    $payoutTrouble = null;
}

json_out([
    'ok' => true,
    'feeds' => $feeds,
    'payoutTrouble' => $payoutTrouble,
    'rates' => rates_public_payload(),
    'bookings' => bookings_admin_payload(),
    'enquiries' => enquiries_admin_payload(),
    'blocks' => ['ok' => true, 'blocks' => $blocks],
    'cron' => cron_status_payload(),
]);
