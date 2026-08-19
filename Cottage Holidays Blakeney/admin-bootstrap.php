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

// Customer emails waiting to be read, folded into the same round trip for the
// same reason as $feeds: it is a CONTENT READ, not a mailbox fetch — the POP3
// poll (mailbox-read.php, on the cron) is what notices new mail, and a page must
// never wait on a mail server.
$newMail = ['count' => 0, 'items' => []];
try {
    require_once __DIR__ . '/mailbox-read.php';
    $newMail = mailbox_new_pending();
} catch (\Throwable $e) {
    $newMail = ['count' => 0, 'items' => []];
}

// Same rule as the public boot: a part that cannot be built is OMITTED and
// reported, never a 500 that takes the whole back office's first paint with it
// — loadData() already keeps its last good copy per store and each loader can
// fetch its own endpoint (see "A POOR SIGNAL MUST NOT MOVE THE OWNER").
$part = function (string $fn) {
    try {
        if (!function_exists($fn)) {
            chb_log_server_error('Missing payload helper', 'admin-bootstrap: ' . $fn . '() is not defined — is the deploy complete?', __FILE__, 0);
            return null;
        }
        return $fn();
    } catch (\Throwable $e) {
        chb_log_server_error('Payload error', 'admin-bootstrap: ' . $fn . '() failed — ' . $e->getMessage(), $e->getFile(), $e->getLine());
        return null;
    }
};
// Overnight work: whether the queue is on, and how many items are waiting.
// Two integers on a payload the back office already fetches, the same trade
// $feeds makes — so Today can render (or, far more often, NOT render) the
// "Ready for you" card with no request of its own, and admin.js only asks for
// the rows when this says there are rows. Wrapped because an un-migrated
// install has no table and that is not an error the owner needs to see.
$night = ['on' => 0, 'n' => 0];
try {
    require_once __DIR__ . '/nightshift-lib.php';
    $night = night_summary(db(), content_value('night-shift') === '1');
    // HOW LONG THE MAC HAS BEEN QUIET, on the payload loadData already makes,
    // so the duty costs no request of its own (the $feeds precedent). -1 when
    // the question does not apply: nothing paired, or nothing has run yet.
    $night['quiet'] = -1;
    if (!empty($night['on'])) {
        $raw = content_secret_json('apikey-nightshift', null);
        if ($raw === null) {
            $raw = trim((string) content_value('apikey-nightshift'));
        }
        $devs = night_devices($raw);
        $night['quiet'] = night_quiet_problem($devs, time());
        // Live presence for the Draft-on-your-Mac buttons — free, the same
        // devices read (the $feeds precedent: never a request of its own).
        $night['mac'] = night_mac_presence($devs, time());
    }
} catch (\Throwable $e) {
    $night = ['on' => 0, 'n' => 0];
}

$out = [
    'ok' => true,
    'feeds' => $feeds,
    'night' => $night,
    'payoutTrouble' => $payoutTrouble,
    'newMail' => $newMail,
    'blocks' => ['ok' => true, 'blocks' => $blocks],
];
foreach ([
    'rates' => $part('rates_public_payload'),
    'bookings' => $part('bookings_admin_payload'),
    'enquiries' => $part('enquiries_admin_payload'),
    'cron' => $part('cron_status_payload'),
] as $key => $val) {
    if ($val !== null) {
        $out[$key] = $val;
    }
}
json_out($out);
