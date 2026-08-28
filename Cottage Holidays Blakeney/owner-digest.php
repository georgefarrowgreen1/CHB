<?php
// ============================================================
//  owner-digest.php — a Monday-morning summary email to the owner: the week
//  just gone, the week ahead, money in and money owed, pending enquiries and
//  near-term occupancy. One glance at how things stand.
//
//  Add it to the SAME daily cron as the others — it only actually sends on a
//  Monday, and at most once per day, so a daily trigger is safe:
//    https://YOURDOMAIN/owner-digest.php?cron=APP_SECRET
//
//  A logged-in admin can preview/force a send any day with ?force=1.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron) {
    // A signed-in admin's manual run must be a POST so require_admin() enforces the
    // CSRF token — a cross-site GET link in the owner's browser must not be able to
    // fire this job via their session (same guard as cron.php / self-repair.php).
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
}

$force = !empty($_GET['force']);

// Only send on Mondays (date('N')===1), unless forced.
if (!$force && (int) date('N') !== 1) {
    json_out(['ok' => true, 'sent' => false, 'reason' => 'not Monday']);
}
// At most once per calendar day (idempotent across multiple cron pings / deploys).
$today = date('Y-m-d');
if (!$force && content_value('owner-digest-last') === $today) {
    json_out(['ok' => true, 'sent' => false, 'reason' => 'already sent today']);
}

// send_owner() also delivers to the Settings co-host list ('notify-emails'),
// so gate on the full recipient set, not the constant alone.
if (!owner_recipients()) {
    json_out(['ok' => false, 'error' => 'No owner email — set OWNER_NOTIFY_EMAIL in config.php or add a recipient in Settings → Notifications']);
}

$money = fn($n) => '£' . number_format((float) $n, 2);
$totalExpr = 'COALESCE(price_override, agreed_total, 0)';

// ---- The week just gone -------------------------------------------------
$newBookings = 0;
$newValue = 0.0;
try {
    $r = db()
        ->query(
            "SELECT COUNT(*) c, COALESCE(SUM($totalExpr),0) v FROM bookings
                      WHERE created_at >= (NOW() - INTERVAL 7 DAY)",
        )
        ->fetch();
    $newBookings = (int) ($r['c'] ?? 0);
    $newValue = (float) ($r['v'] ?? 0);
} catch (\Throwable $e) {
}

// THE WEEK'S MONEY, NOT EACH BOOKING'S LIFETIME. deposit_paid is CUMULATIVE and
// payment_date is restamped on every payment, so summing it for bookings "paid in
// the last 7 days" counted everything those bookings had EVER received: a stay with
// £100.43 in March and £301.27 on the 10th of August reported "£401.70 in" for the
// week of the 17th — and the £100.43 had already been reported by March's own
// digest. accounts.php's comment documents this exact model as the flaw it fixed
// for the books; the digest was the surviving copy. The card ledger carries a date
// per payment, so ask it.
$received = 0.0;
try {
    $r = db()
        ->query(
            "SELECT ROUND(COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED') THEN amount ELSE 0 END),0)
                       - COALESCE(SUM(CASE WHEN kind='refund' AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED')) THEN amount ELSE 0 END),0),2) v
                 FROM payments WHERE created_at >= (NOW() - INTERVAL 7 DAY)",
        )
        ->fetch();
    $received = (float) ($r['v'] ?? 0);
    // Cash and bank bookings leave no ledger row, so the cumulative figure is their
    // only record. Counted for bookings with NO ledger rows at all, so a card
    // booking is never counted twice. NB one hand-recorded booking paid across two
    // different weeks still reports its whole total in the later week — there is no
    // per-payment history to split, and inventing one would be worse than saying so.
    $r2 = db()
        ->query(
            "SELECT COALESCE(SUM(b.deposit_paid),0) v FROM bookings b
                     WHERE b.payment_date >= (CURDATE() - INTERVAL 7 DAY)
                       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)",
        )
        ->fetch();
    $received += (float) ($r2['v'] ?? 0);
} catch (\Throwable $e) {
    // payments table not migrated — fall back to the pre-ledger shape rather than
    // reporting nothing came in.
    try {
        $r = db()
            ->query(
                "SELECT COALESCE(SUM(deposit_paid),0) v FROM bookings
                          WHERE payment_date >= (CURDATE() - INTERVAL 7 DAY)",
            )
            ->fetch();
        $received = (float) ($r['v'] ?? 0);
    } catch (\Throwable $e2) {
    }
}

// ---- The week ahead: arrivals -------------------------------------------
// Direct bookings PLUS imported OTA guest stays (ical_blocks, source != owner —
// the same rule as the in-app insights), so an Airbnb guest arriving Wednesday
// shows in the Monday email like they do on the timeline.
$arrivals = [];
try {
    $s = db()->query("SELECT name, prop_key, check_in, check_out FROM bookings
                      WHERE check_in >= CURDATE() AND check_in <= (CURDATE() + INTERVAL 7 DAY)
                      ORDER BY check_in ASC");
    $arrivals = $s->fetchAll();
} catch (\Throwable $e) {
}
try {
    $s = db()->query("SELECT source, prop_key, check_in, check_out FROM ical_blocks
                      WHERE source <> 'owner' AND check_in >= CURDATE() AND check_in <= (CURDATE() + INTERVAL 7 DAY)");
    foreach ($s->fetchAll() as $bl) {
        $src = ucfirst((string) $bl['source']);
        $arrivals[] = ['name' => 'Guest via ' . $src, 'prop_key' => $bl['prop_key'], 'check_in' => $bl['check_in'], 'check_out' => $bl['check_out']];
    }
    usort($arrivals, fn($a, $z) => strcmp((string) $a['check_in'], (string) $z['check_in']));
} catch (\Throwable $e) {
    /* pre-migration — direct arrivals still listed */
}

// ---- Money owed: future, not fully paid ---------------------------------
$owedCount = 0;
$owedSum = 0.0;
try {
    $s = db()->query("SELECT $totalExpr AS total, deposit_paid, payment_method FROM bookings
                      WHERE payment <> 'paid' AND check_in >= CURDATE()");
    foreach ($s->fetchAll() as $b) {
        // Owner-arranged money (the cash/bank rail) is never volunteered — the
        // same rule Today's strip and header follow (owner's ask, 06 Aug):
        // those deposits and prices are discussed personally, so the digest's
        // "Balances owed" line must not count them either.
        if (payment_rail($b) !== 'card') {
            continue;
        }
        $out = round((float) $b['total'] - (float) $b['deposit_paid'], 2);
        if ($out > 0.009) {
            $owedCount++;
            $owedSum += $out;
        }
    }
} catch (\Throwable $e) {
}

// ---- Pending enquiries --------------------------------------------------
$pending = 0;
try {
    // Live enquiries only (declined ones are soft-deleted); fall back for a
    // pre-migration database that lacks the column.
    try {
        $pending = (int) db()->query('SELECT COUNT(*) FROM enquiries WHERE declined_at IS NULL')->fetchColumn();
    } catch (\Throwable $inner) {
        $pending = (int) db()->query('SELECT COUNT(*) FROM enquiries')->fetchColumn();
    }
} catch (\Throwable $e) {
}

// ---- Occupancy over the next 30 days ------------------------------------
$occPct = null;
try {
    $cottages = (int) db()->query('SELECT COUNT(*) FROM properties WHERE archived_at IS NULL')->fetchColumn();
    if ($cottages < 1) {
        $cottages = 3;
    }
    // Count booked nights in [today, today+30) across all cottages — direct
    // bookings UNION imported OTA guest stays (source != owner), the same rule
    // as the in-app pulse/insights, so an Airbnb-full month doesn't read 0%.
    $rows = db()->query("SELECT check_in, check_out FROM bookings
                      WHERE check_out > CURDATE() AND check_in < (CURDATE() + INTERVAL 30 DAY)")->fetchAll();
    try {
        $rows = array_merge($rows, db()->query("SELECT check_in, check_out FROM ical_blocks
                      WHERE source <> 'owner' AND check_out > CURDATE() AND check_in < (CURDATE() + INTERVAL 30 DAY)")->fetchAll());
    } catch (\Throwable $e) {
        /* pre-migration — direct bookings still counted */
    }
    $start = strtotime($today);
    $end = strtotime('+30 day', $start);
    $bookedNights = 0;
    foreach ($rows as $b) {
        $ci = max($start, strtotime($b['check_in']));
        $co = min($end, strtotime($b['check_out']));
        if ($co > $ci) {
            $bookedNights += (int) round(($co - $ci) / 86400);
        }
    }
    $capacity = $cottages * 30;
    if ($capacity > 0) {
        $occPct = round(($bookedNights / $capacity) * 100);
    }
} catch (\Throwable $e) {
}

// ---- Activity log: this week's tally + anything that needs attention -----
$actTotal = 0;
$actAttention = [];
try {
    // SELECT * so this works whether or not the severity column has migrated yet.
    foreach (
        db()
            ->query('SELECT * FROM activity_log WHERE created_at >= (NOW() - INTERVAL 7 DAY) ORDER BY id DESC')
            ->fetchAll()
        as $r
    ) {
        $actTotal++;
        if (in_array($r['severity'] ?? 'info', ['warn', 'action'], true) && count($actAttention) < 6) {
            $actAttention[] = ['summary' => (string) ($r['summary'] ?? ''), 'severity' => $r['severity'] ?? 'info'];
        }
    }
} catch (\Throwable $e) {
}

// ---- Teach your assistant: searches that found nothing this week ---------
// The palette syncs its dead-end queries to the content table (admin.js
// chbAssistSyncPush → 'search-misses'); the digest surfaces the week's, so
// teaching the assistant becomes a Monday habit rather than a buried screen.
$misses = [];
try {
    $weekAgo = date('Y-m-d', time() - 7 * 86400);
    foreach (content_json('search-misses', []) as $m) {
        if (!is_array($m) || empty($m['t']) || !is_string($m['t'])) {
            continue;
        }
        if ((string) ($m['at'] ?? '') < $weekAgo) {
            continue;
        }
        $misses[] = ['t' => mb_substr($m['t'], 0, 80), 'n' => max(1, (int) ($m['n'] ?? 1))];
    }
    usort($misses, fn($a, $b) => $b['n'] <=> $a['n']);
    $misses = array_slice($misses, 0, 5);
} catch (\Throwable $e) {
    $misses = [];
}

// ---- Compose ------------------------------------------------------------
// Names + accents come from the cottage rows, so any owner-added cottage is labelled correctly.
$nameOf = fn($k) => prop_display($k)['name'];
$accentOf = fn($k) => prop_display($k)['accent'];
$pretty = fn($d) => date('D j M', strtotime($d));

// Composed by owner_digest_body() in mailer.php — one payload, so the template is
// previewable and render-gated rather than existing only inside this cron run.
$m = owner_digest_body([
    'newBookings' => $newBookings, 'newValue' => $newValue, 'received' => $received,
    'arrivals' => $arrivals, 'owedCount' => $owedCount, 'owedSum' => $owedSum,
    'pending' => $pending, 'occPct' => $occPct, 'misses' => $misses,
    'actTotal' => $actTotal, 'actAttention' => $actAttention,
]);
[$subject, $text, $html] = [$m['subject'], $m['text'], $m['html']];

$res = send_owner($subject, $text, $html);

// Stamp on delivered OR queued: a failed morning send that queued to the outbox
// must still suppress a same-day resend (a noon cron or deploy ping), or the
// queued copy drains AND the resend delivers — the owner gets the digest twice.
if (!empty($res['ok']) || $res === true || !empty($res['queued'])) {
    // Record the send so we don't repeat today (store as JSON so content_value reads it back).
    try {
        db()
            ->prepare(
                'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
            )
            ->execute(['owner-digest-last', json_encode($today)]);
    } catch (\Throwable $e) {
    }
}

json_out([
    'ok' => true,
    'sent' => true,
    'new_bookings' => $newBookings,
    'received' => $received,
    'arrivals' => count($arrivals),
    'owed' => $owedCount,
    'pending' => $pending,
    'occupancy_pct' => $occPct,
    'mail' => $res,
]);
