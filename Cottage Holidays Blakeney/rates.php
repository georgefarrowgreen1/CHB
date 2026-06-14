<?php
// ============================================================
//  api/rates.php — property rates & fees.
//  GET                       -> list all properties (public; pricing needs it)
//  POST {action:'save', ...} -> update one property (admin only)
// ============================================================
require_once __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = db()->query('SELECT * FROM properties')->fetchAll();
    // Cast numerics for clean JSON
    foreach ($rows as &$r) {
        $r['couple_rate'] = (float)$r['couple_rate'];
        $r['extra_adult_rate'] = (float)$r['extra_adult_rate'];
        $r['child_rate'] = (float)$r['child_rate'];
        $r['booking_fee'] = (float)$r['booking_fee'];
        $r['transaction_pct'] = (float)$r['transaction_pct'];
    }
    // Seasonal rates (table may not exist yet — then no seasons key is sent)
    $seasons = [];
    try {
        foreach (db()->query('SELECT prop_key, label, start_date, end_date, couple_rate FROM rate_seasons ORDER BY start_date, id')->fetchAll() as $s) {
            $s['couple_rate'] = (float)$s['couple_rate'];
            $seasons[$s['prop_key']][] = $s;
        }
    } catch (\Throwable $e) {}
    json_out(['properties' => $rows, 'seasons' => $seasons, 'occupancy' => occupancy_limits()]);
}

$in = body();
if (($in['action'] ?? '') === 'seasons_save') {
    require_admin();
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate_exists($propKey)) json_out(['error' => 'Unknown property'], 400);
    $list = is_array($in['seasons'] ?? null) ? $in['seasons'] : [];
    $cleaned = [];
    foreach ($list as $s) {
        $label = clean($s['label'] ?? '');
        $start = clean($s['start'] ?? '');
        $end   = clean($s['end'] ?? '');
        $rate  = (float)($s['rate'] ?? 0);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) {
            json_out(['error' => 'Each season needs valid start and end dates'], 400);
        }
        if ($end < $start) json_out(['error' => 'A season\'s end date is before its start date'], 400);
        if ($rate <= 0) json_out(['error' => 'Each season needs a couple rate above £0'], 400);
        $cleaned[] = [$propKey, mb_substr($label, 0, 100), $start, $end, $rate];
    }
    // Replace-all for this property (simple + predictable)
    try {
        db()->prepare('DELETE FROM rate_seasons WHERE prop_key = ?')->execute([$propKey]);
        if ($cleaned) {
            $ins = db()->prepare('INSERT INTO rate_seasons (prop_key, label, start_date, end_date, couple_rate) VALUES (?,?,?,?,?)');
            foreach ($cleaned as $row) $ins->execute($row);
        }
    } catch (\Throwable $e) {
        json_out(['error' => 'Seasonal rates table missing — run migration-seasons.sql in phpMyAdmin first'], 500);
    }
    json_out(['ok' => true, 'count' => count($cleaned)]);
}

if (($in['action'] ?? '') === 'save') {
    require_admin();
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate_exists($propKey)) json_out(['error' => 'Unknown property'], 400);

    $fields = ['couple_rate','extra_adult_rate','child_rate','booking_fee','transaction_pct','address'];
    $set = []; $vals = [];
    foreach ($fields as $f) {
        if (array_key_exists($f, $in)) {
            $set[] = "$f = ?";
            $vals[] = ($f === 'address') ? clean($in[$f]) : max(0, (float)$in[$f]);
        }
    }
    if (!$set) json_out(['error' => 'Nothing to update'], 400);
    $vals[] = $propKey;
    db()->prepare('UPDATE properties SET ' . implode(', ', $set) . ' WHERE prop_key = ?')->execute($vals);
    json_out(['ok' => true]);
}

function get_rate_exists($k) {
    $s = db()->prepare('SELECT 1 FROM properties WHERE prop_key = ?');
    $s->execute([$k]);
    return (bool)$s->fetch();
}

json_out(['error' => 'Unknown action'], 400);
