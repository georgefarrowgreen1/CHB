<?php
// ============================================================
//  conflict-audit.php — nightly double-booking safety net.
//  Scans every active cottage for overlapping commitments on current/future
//  dates and logs any it finds to the activity log as a 'warn' (so it surfaces
//  in the owner's "Needs attention" stream). It checks:
//    • two direct bookings on the same cottage that overlap, and
//    • a direct booking overlapping an imported OTA block (Airbnb/Vrbo iCal).
//  OTA↔OTA overlaps are skipped: the same stay legitimately mirrors across
//  platforms, so those would be noise, not conflicts.
//
//  Idempotent: a signature of every current conflict is stored in the content
//  key 'conflict-audit-state', so a standing conflict is logged ONCE, not daily.
//  A conflict that's since been resolved simply drops out of the set.
//
//  Run daily via cron.php, or manually as a signed-in admin:
//    https://YOURDOMAIN/conflict-audit.php?cron=APP_SECRET
// ============================================================
require_once __DIR__ . '/db.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}

// Two half-open date ranges [aIn,aOut) and [bIn,bOut) overlap iff each starts
// before the other ends. Same rule the booking check (dates_clash) uses.
function ca_overlap($aIn, $aOut, $bIn, $bOut)
{
    return $aIn < $bOut && $bIn < $aOut;
}

$today = gmdate('Y-m-d');
$conflicts = [];

try {
    // Active cottages only — an archived prop's stale rows aren't actionable.
    $props = db()->query('SELECT prop_key, name FROM properties WHERE archived_at IS NULL')->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not read cottages'], 500);
}

foreach ($props as $p) {
    $prop = $p['prop_key'];
    $propName = $p['name'] ?: $prop;

    // Only current/future commitments matter (check_out today or later).
    try {
        $bs = db()->prepare(
            'SELECT id, name, check_in, check_out FROM bookings
             WHERE prop_key = ? AND check_out >= ? ORDER BY check_in',
        );
        $bs->execute([$prop, $today]);
        $bookings = $bs->fetchAll();
    } catch (\Throwable $e) {
        $bookings = [];
    }
    try {
        $bl = db()->prepare(
            'SELECT id, source, check_in, check_out FROM ical_blocks
             WHERE prop_key = ? AND check_out >= ? ORDER BY check_in',
        );
        $bl->execute([$prop, $today]);
        $blocks = $bl->fetchAll();
    } catch (\Throwable $e) {
        $blocks = [];
    }

    // Booking ↔ booking overlaps.
    $n = count($bookings);
    for ($i = 0; $i < $n; $i++) {
        for ($j = $i + 1; $j < $n; $j++) {
            $a = $bookings[$i];
            $b = $bookings[$j];
            if (ca_overlap($a['check_in'], $a['check_out'], $b['check_in'], $b['check_out'])) {
                $ids = [(int) $a['id'], (int) $b['id']];
                sort($ids);
                $conflicts[] = [
                    'sig' => "bb|$prop|{$ids[0]}|{$ids[1]}",
                    'prop_key' => $prop,
                    'summary' =>
                        'Double booking at ' . $propName . ' — ' .
                        ($a['name'] ?: 'guest') . ' (' . $a['check_in'] . '→' . $a['check_out'] . ') overlaps ' .
                        ($b['name'] ?: 'guest') . ' (' . $b['check_in'] . '→' . $b['check_out'] . ')',
                ];
            }
        }
    }

    // Booking ↔ OTA block overlaps (a direct guest AND an Airbnb/Vrbo guest on
    // the same nights).
    foreach ($bookings as $a) {
        foreach ($blocks as $bk) {
            if (ca_overlap($a['check_in'], $a['check_out'], $bk['check_in'], $bk['check_out'])) {
                $conflicts[] = [
                    'sig' => "bo|$prop|" . (int) $a['id'] . '|' . (int) $bk['id'],
                    'prop_key' => $prop,
                    'summary' =>
                        'Booking clashes with an ' . ($bk['source'] ?: 'external') . ' block at ' . $propName .
                        ' — ' . ($a['name'] ?: 'guest') . ' (' . $a['check_in'] . '→' . $a['check_out'] . ') overlaps a blocked range (' .
                        $bk['check_in'] . '→' . $bk['check_out'] . ')',
                ];
            }
        }
    }
}

// Load the previously-seen signatures so a standing conflict isn't re-logged
// every night. content_value() returns '' when unset.
$prevRaw = content_value('conflict-audit-state');
$prev = [];
if ($prevRaw !== '') {
    $decoded = json_decode($prevRaw, true);
    if (is_array($decoded)) {
        $prev = $decoded;
    }
}
$prevSet = array_fill_keys($prev, true);

$newlyLogged = 0;
$currentSigs = [];
foreach ($conflicts as $c) {
    $currentSigs[] = $c['sig'];
    if (isset($prevSet[$c['sig']])) {
        continue; // already flagged on an earlier run — don't spam the log
    }
    log_activity('calendar', 'booking.conflict', $c['summary'], [
        'actor' => $isCron ? 'cron' : 'owner',
        'severity' => 'warn',
        'prop_key' => $c['prop_key'],
        'entity' => 'booking',
    ]);
    $newlyLogged++;
}

// Persist the current signature set (dedup + drop resolved ones).
try {
    db()
        ->prepare(
            "INSERT INTO content (item_key, item_value) VALUES ('conflict-audit-state', ?)
             ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
        )
        ->execute([json_encode(array_values(array_unique($currentSigs)))]);
} catch (\Throwable $e) {
    /* the log is the important bit; state is only for dedup */
}

json_out([
    'ok' => true,
    'conflicts' => count($currentSigs),
    'newly_logged' => $newlyLogged,
]);
