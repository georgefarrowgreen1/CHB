<?php
// ============================================================
//  availability.php — public: returns blocked date ranges for a property,
//  combining confirmed bookings on this site AND imported iCal blocks
//  (Airbnb / Vrbo). Used by the booking form to show/enforce availability.
//
//  GET ?prop=21a  ->  { ranges: [ {start:'YYYY-MM-DD', end:'YYYY-MM-DD'}, ... ] }
//  (end is exclusive — the checkout day is free again, hotel-style)
// ============================================================
require_once __DIR__ . '/db.php';

// ?all=1 — every live cottage's blocked ranges in one call. Powers the homepage
// availability chips + the late-availability spotlight without three round-trips.
if (isset($_GET['all'])) {
    $keys = [];
    try {
        // AN UNLISTED COTTAGE MUST NOT EXIST ON THE PUBLIC SITE — rates.php,
        // sitemap.php and leads.php all filter it and this did not, so an anonymous
        // ?all=1 (the call the homepage chips already make) returned a private
        // cottage's prop_key AND its whole forward occupancy calendar. Admin-aware
        // rather than unconditional, mirroring rates.php's posture, so an owner-side
        // caller keeps seeing everything.
        $pubOnly = empty($_SESSION['admin_id']);
        $keys = db()
            ->query('SELECT prop_key FROM properties WHERE archived_at IS NULL' . ($pubOnly ? ' AND unlisted = 0' : ''))
            ->fetchAll(PDO::FETCH_COLUMN);
    } catch (\Throwable $e) {
        $keys = ['21a', 'jollyboat', 'pimpernel'];
    } // pre-migration fallback
    $out = [];
    foreach ($keys as $k) {
        $rs = [];
        $s = db()->prepare('SELECT check_in, check_out FROM bookings WHERE prop_key = ? AND check_out >= CURDATE()');
        $s->execute([$k]);
        foreach ($s->fetchAll() as $r) {
            $rs[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
        }
        try {
            $s = db()->prepare(
                'SELECT check_in, check_out FROM ical_blocks WHERE prop_key = ? AND check_out >= CURDATE()',
            );
            $s->execute([$k]);
            foreach ($s->fetchAll() as $r) {
                $rs[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
            }
        } catch (\Throwable $e) {
        }
        $out[$k] = $rs;
    }
    json_out(['props' => $out]);
}

$prop = isset($_GET['prop']) ? preg_replace('/[^a-z0-9_]/i', '', (string) $_GET['prop']) : '';
if ($prop === '') {
    json_out(['ranges' => []]);
}

// THE SAME RULE AS ?all=1 ABOVE, which was fixed for this and left its twin
// behind: an unlisted cottage must not exist on the public site, and naming it
// directly was the way round the fix — an anonymous
// availability.php?prop=<private key> returned its whole forward occupancy
// calendar, every arrival and departure date, for a cottage the site never
// shows. Answers with an EMPTY range set, exactly as an unknown prop does, so
// the response cannot be used to tell a private cottage from a nonexistent one.
// Admin-aware, so every owner-side caller keeps seeing everything, and tolerant
// of a pre-migration install with no `unlisted` column (fail open there, as the
// ?all=1 fallback does).
if (empty($_SESSION['admin_id'])) {
    try {
        $chk = db()->prepare('SELECT unlisted FROM properties WHERE prop_key = ?');
        $chk->execute([$prop]);
        $row = $chk->fetch();
        if ($row && !empty($row['unlisted'])) {
            json_out(['ranges' => []]);
        }
    } catch (\Throwable $e) {
        /* no `unlisted` column on this install — behave exactly as before */
    }
}

$ranges = [];

// Confirmed bookings on this site
$s = db()->prepare('SELECT check_in, check_out FROM bookings WHERE prop_key = ? AND check_out >= CURDATE()');
$s->execute([$prop]);
foreach ($s->fetchAll() as $r) {
    $ranges[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
}

// Imported iCal blocks (Airbnb/Vrbo) — table may not exist on older installs.
try {
    $s = db()->prepare('SELECT check_in, check_out FROM ical_blocks WHERE prop_key = ? AND check_out >= CURDATE()');
    $s->execute([$prop]);
    foreach ($s->fetchAll() as $r) {
        $ranges[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
    }
} catch (\Throwable $e) {
    /* table not migrated yet — ignore */
}

json_out(['ranges' => $ranges]);
