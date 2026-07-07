<?php
// ============================================================
//  api/rates.php — property rates & fees (and the cottage list itself).
//  GET                          -> list all properties (public; pricing needs it)
//  POST {action:'save', ...}    -> update one property (admin only)
//  POST {action:'create', ...}  -> add a new cottage (admin only)
//  POST {action:'archive'|'unarchive'} -> hide/restore a cottage (admin only)
//
//  Cottages are dynamic: the owner can add/remove them from the back office.
//  Removal is a SOFT ARCHIVE (archived_at) so past bookings, payments and
//  confirmation emails that reference the cottage stay intact — all the
//  payment/booking logic keys off the prop_key row, which is never deleted.
// ============================================================
require_once __DIR__ . '/db.php';

// The public GET payload, as a function so bootstrap.php can serve the SAME data
// in its combined first-paint response without duplicating this logic.
function rates_public_payload()
{
    $rows = db()->query('SELECT * FROM properties ORDER BY sort_order, name')->fetchAll();
    // Cast numerics for clean JSON
    foreach ($rows as &$r) {
        $r['couple_rate'] = (float) $r['couple_rate'];
        $r['extra_adult_rate'] = (float) $r['extra_adult_rate'];
        $r['child_rate'] = (float) $r['child_rate'];
        $r['booking_fee'] = (float) $r['booking_fee'];
        $r['transaction_pct'] = (float) $r['transaction_pct'];
        if (array_key_exists('weekend_pct', $r)) {
            $r['weekend_pct'] = (float) $r['weekend_pct'];
        }
        if (array_key_exists('sort_order', $r)) {
            $r['sort_order'] = (int) $r['sort_order'];
        }
        // Surface the archived flag plainly so the front end can hide archived
        // cottages from the public site but still let the admin restore them.
        $r['archived'] = !empty($r['archived_at']);
        // "Unlisted" (private) cottages are managed in the back office but hidden
        // from the public site. Surface the flag for the admin front end.
        $r['unlisted'] = !empty($r['unlisted']);
    }
    unset($r);
    // Never send unlisted (private) cottages to a NON-admin visitor — they must
    // not exist on the public site at all. The admin client still receives them
    // (flagged) so the calendar / money / booking picker can manage them.
    if (empty($_SESSION['admin_id'])) {
        $rows = array_values(array_filter($rows, fn($r) => empty($r['unlisted'])));
    }
    // Seasonal rates (table may not exist yet — then no seasons key is sent)
    $seasons = [];
    try {
        foreach (
            db()
                ->query(
                    'SELECT prop_key, label, start_date, end_date, couple_rate FROM rate_seasons ORDER BY start_date, id',
                )
                ->fetchAll()
            as $s
        ) {
            $s['couple_rate'] = (float) $s['couple_rate'];
            $seasons[$s['prop_key']][] = $s;
        }
    } catch (\Throwable $e) {
    }
    return ['properties' => $rows, 'seasons' => $seasons, 'occupancy' => occupancy_limits()];
}

// When bootstrap.php includes this file for the payload helper, stop before the
// HTTP routing — the routes below run only when this file IS the request.
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'rates.php') {
    return;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_out(rates_public_payload());
}

$in = body();
if (($in['action'] ?? '') === 'seasons_save') {
    require_admin();
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate_exists($propKey)) {
        json_out(['error' => 'Unknown property'], 400);
    }
    $list = is_array($in['seasons'] ?? null) ? $in['seasons'] : [];
    $cleaned = [];
    foreach ($list as $s) {
        $label = clean($s['label'] ?? '');
        $start = clean($s['start'] ?? '');
        $end = clean($s['end'] ?? '');
        $rate = (float) ($s['rate'] ?? 0);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) {
            json_out(['error' => 'Each season needs valid start and end dates'], 400);
        }
        if ($end < $start) {
            json_out(['error' => 'A season\'s end date is before its start date'], 400);
        }
        if ($rate <= 0) {
            json_out(['error' => 'Each season needs a couple rate above £0'], 400);
        }
        $cleaned[] = [$propKey, mb_substr($label, 0, 100), $start, $end, $rate];
    }
    // Replace-all for this property (simple + predictable)
    try {
        db()
            ->prepare('DELETE FROM rate_seasons WHERE prop_key = ?')
            ->execute([$propKey]);
        if ($cleaned) {
            $ins = db()->prepare(
                'INSERT INTO rate_seasons (prop_key, label, start_date, end_date, couple_rate) VALUES (?,?,?,?,?)',
            );
            foreach ($cleaned as $row) {
                $ins->execute($row);
            }
        }
    } catch (\Throwable $e) {
        json_out(['error' => 'Seasonal rates table missing — run migration-seasons.sql in phpMyAdmin first'], 500);
    }
    log_activity('rates', 'rates.seasons_save', 'Seasonal rates updated (' . count($cleaned) . ')', ['prop_key' => $propKey]);
    json_out(['ok' => true, 'count' => count($cleaned)]);
}

if (($in['action'] ?? '') === 'create') {
    require_admin();
    // "Create then fill in": just a name + nightly couple rate are required; the
    // key, slug and accent colour are generated, and the rest is completed later
    // in the cottage's Preferences folders. The row is all the payment/booking
    // logic needs to start working for the new cottage.
    $name = trim(clean($in['name'] ?? ''));
    $rate = max(0, (float) ($in['couple_rate'] ?? 0));
    // Optional at create time (the Add-Booking "new property" setup sends these;
    // Settings → Add accommodation sends only name + couple rate → defaults).
    // Occupancy caps are always left at defaults and filled in later per cottage.
    $extraAdult = max(0, (float) ($in['extra_adult_rate'] ?? 0));
    $childRate = max(0, (float) ($in['child_rate'] ?? 0));
    $deposit = array_key_exists('booking_fee', $in) ? max(0, (float) $in['booking_fee']) : 75;
    $txnPct = array_key_exists('transaction_pct', $in) ? max(0, (float) $in['transaction_pct']) : 3;
    if ($name === '') {
        json_out(['error' => 'Please give the accommodation a name'], 400);
    }
    if ($rate <= 0) {
        json_out(['error' => 'Please set a nightly couple rate above £0'], 400);
    }

    $key = unique_prop_key($name);
    $slug = unique_prop_slug($name, $key);
    $accent = next_prop_accent();
    // Private/unlisted: bookable in the back office, never shown on the site.
    $unlisted = !empty($in['unlisted']) ? 1 : 0;
    // Place it after the existing cottages.
    $ord = 100;
    try {
        $ord = (int) db()->query('SELECT COALESCE(MAX(sort_order),0)+10 FROM properties')->fetchColumn();
    } catch (\Throwable $e) {
    }

    try {
        db()
            ->prepare(
                'INSERT INTO properties (prop_key, name, couple_rate, extra_adult_rate, child_rate, booking_fee, transaction_pct, address, slug, accent, sort_order, max_adults, max_children, max_total, unlisted)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            ->execute([$key, $name, $rate, $extraAdult, $childRate, $deposit, $txnPct, '', $slug, $accent, $ord, 2, 0, 2, $unlisted]);
    } catch (\Throwable $e) {
        json_out(
            [
                'error' =>
                    'Could not create the cottage — run migrations first (Settings → System check → Run migrations).',
            ],
            500,
        );
    }
    log_activity('rates', 'rates.create', ($unlisted ? 'Private accommodation added' : 'Accommodation added') . ' — ' . $name, ['prop_key' => $key, 'entity' => 'property']);
    json_out(['ok' => true, 'prop_key' => $key, 'slug' => $slug, 'accent' => $accent, 'unlisted' => (bool) $unlisted]);
}

// Toggle a cottage's PRIVATE (unlisted) state — hides it from the public site
// while keeping it fully bookable in the back office. Its own action (like
// archive) so it never rides the field-by-field 'save'.
if (($in['action'] ?? '') === 'set_unlisted') {
    require_admin();
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate_exists($propKey)) {
        json_out(['error' => 'Unknown property'], 400);
    }
    $unlisted = !empty($in['unlisted']) ? 1 : 0;
    // Don't let the owner hide their last PUBLIC cottage — the website needs one.
    if ($unlisted) {
        try {
            $pub = (int) db()
                ->query('SELECT COUNT(*) FROM properties WHERE archived_at IS NULL AND unlisted = 0')
                ->fetchColumn();
            if ($pub <= 1) {
                json_out(['error' => 'You can’t make your only public cottage private — the website needs at least one.'], 400);
            }
        } catch (\Throwable $e) {
        }
    }
    try {
        db()
            ->prepare('UPDATE properties SET unlisted = ? WHERE prop_key = ?')
            ->execute([$unlisted, $propKey]);
    } catch (\Throwable $e) {
        json_out(
            ['error' => 'Could not update — please run updates first (Settings → Health check → Install updates).'],
            500,
        );
    }
    log_activity('rates', 'rates.unlisted', ($unlisted ? 'Cottage made private' : 'Cottage made public') . ' — ' . $propKey, ['prop_key' => $propKey, 'entity' => 'property']);
    json_out(['ok' => true, 'unlisted' => (bool) $unlisted]);
}

if (($in['action'] ?? '') === 'archive' || ($in['action'] ?? '') === 'unarchive') {
    require_admin();
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate_exists($propKey)) {
        json_out(['error' => 'Unknown property'], 400);
    }
    $archiving = $in['action'] === 'archive';
    // Don't let the owner archive their last live cottage — the public site needs one.
    if ($archiving) {
        try {
            $live = (int) db()->query('SELECT COUNT(*) FROM properties WHERE archived_at IS NULL')->fetchColumn();
            if ($live <= 1) {
                json_out(['error' => 'You can’t remove your only live accommodation.'], 400);
            }
        } catch (\Throwable $e) {
        }
    }
    try {
        // archived_at is a bound value (UTC timestamp or NULL) rather than concatenated SQL.
        $archivedAt = $archiving ? gmdate('Y-m-d H:i:s') : null;
        db()
            ->prepare('UPDATE properties SET archived_at = ? WHERE prop_key = ?')
            ->execute([$archivedAt, $propKey]);
    } catch (\Throwable $e) {
        json_out(
            ['error' => 'Could not update — please run updates first (Settings → Health check → Install updates).'],
            500,
        );
    }
    log_activity(
        'rates',
        $archiving ? 'rates.archive' : 'rates.unarchive',
        ($archiving ? 'Accommodation removed' : 'Accommodation restored') . ' — ' . $propKey,
        ['prop_key' => $propKey, 'entity' => 'property'],
    );
    json_out(['ok' => true, 'archived' => $archiving]);
}

if (($in['action'] ?? '') === 'save') {
    require_admin();
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate_exists($propKey)) {
        json_out(['error' => 'Unknown property'], 400);
    }

    $numeric = ['couple_rate', 'extra_adult_rate', 'child_rate', 'booking_fee', 'transaction_pct', 'weekend_pct', 'lastmin_pct'];
    $ints = ['sort_order', 'max_adults', 'max_children', 'max_total', 'lastmin_days'];
    $text = ['address', 'name', 'slug', 'accent', 'weekend_days'];
    $set = [];
    $vals = [];
    foreach (array_merge($numeric, $ints, $text) as $f) {
        if (!array_key_exists($f, $in)) {
            continue;
        }
        if (in_array($f, $numeric, true)) {
            $v = max(0, (float) $in[$f]);
            // Last-minute discount can't exceed the engine's 90% cap — clamp at save
            // so the stored value never silently diverges from what guests are charged.
            if ($f === 'lastmin_pct') {
                $v = min(90.0, $v);
            }
            $set[] = "$f = ?";
            $vals[] = $v;
        } elseif (in_array($f, $ints, true)) {
            $v = max(0, (int) $in[$f]);
            // A sane ceiling on the last-minute window (a "discount" for a booking
            // 99999 days out would be permanent).
            if ($f === 'lastmin_days') {
                $v = min(60, $v);
            }
            $set[] = "$f = ?";
            $vals[] = $v;
        } elseif ($f === 'slug') {
            $set[] = "$f = ?";
            $vals[] = slugify(clean($in[$f])) ?: $propKey;
        } else {
            $set[] = "$f = ?";
            $vals[] = clean($in[$f]);
        }
    }
    if (!$set) {
        json_out(['error' => 'Nothing to update'], 400);
    }
    // Note the current nightly rate so we can flag a big (>20%) change — a fat-finger
    // guard, since the rate drives every quote.
    $oldRate = 0.0;
    try {
        $rs = db()->prepare('SELECT couple_rate FROM properties WHERE prop_key = ?');
        $rs->execute([$propKey]);
        $oldRate = (float) $rs->fetchColumn();
    } catch (\Throwable $e) {
    }
    $vals[] = $propKey;
    db()
        ->prepare('UPDATE properties SET ' . implode(', ', $set) . ' WHERE prop_key = ?')
        ->execute($vals);
    $bigJump =
        array_key_exists('couple_rate', $in) &&
        $oldRate > 0 &&
        abs(max(0, (float) $in['couple_rate']) - $oldRate) / $oldRate > 0.2;
    $opts = ['prop_key' => $propKey, 'entity' => 'property'];
    if ($bigJump) {
        $opts['severity'] = 'warn';
        $opts['meta'] = ['detail' => '£' . number_format($oldRate, 2) . ' → £' . number_format(max(0, (float) $in['couple_rate']), 2)];
    }
    log_activity(
        'rates',
        'rates.save',
        ($bigJump ? 'Nightly rate changed by more than 20% — ' : 'Cottage settings/rates updated — ') . $propKey,
        $opts,
    );
    json_out(['ok' => true]);
}

function get_rate_exists($k)
{
    $s = db()->prepare('SELECT 1 FROM properties WHERE prop_key = ?');
    $s->execute([$k]);
    return (bool) $s->fetch();
}

// Lowercase, hyphen-separated, alnum-only slug (e.g. "The Boat House" -> "the-boat-house").
function slugify($s)
{
    $s = strtolower(trim((string) $s));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    return trim($s, '-');
}

// A short, unique prop_key derived from the name (the DB primary key, ≤32 chars).
function unique_prop_key($name)
{
    $base = preg_replace('/[^a-z0-9]/', '', strtolower($name));
    if ($base === '') {
        $base = 'cottage';
    }
    $base = substr($base, 0, 24);
    $key = $base;
    $n = 2;
    while (get_rate_exists($key)) {
        $key = substr($base, 0, 22) . $n;
        $n++;
    }
    return $key;
}

// A unique URL slug (falls back to the key when the name has no usable letters).
function unique_prop_slug($name, $key)
{
    $base = slugify($name) ?: $key;
    $slug = $base;
    $n = 2;
    $exists = function ($s) {
        try {
            $q = db()->prepare('SELECT 1 FROM properties WHERE slug = ?');
            $q->execute([$s]);
            return (bool) $q->fetch();
        } catch (\Throwable $e) {
            return false;
        }
    };
    while ($exists($slug)) {
        $slug = $base . '-' . $n;
        $n++;
    }
    return $slug;
}

// Pick the next accent colour from a palette, preferring one not already in use.
function next_prop_accent()
{
    $palette = [
        '#8FB3C7',
        '#7CA982',
        '#9B8FC7',
        '#C7A27C',
        '#C77C9B',
        '#7C9BC7',
        '#A9C77C',
        '#C7B97C',
        '#7CC7B9',
        '#B97CC7',
    ];
    $used = [];
    try {
        foreach (db()->query('SELECT accent FROM properties')->fetchAll(\PDO::FETCH_COLUMN) as $a) {
            if ($a) {
                $used[strtoupper($a)] = true;
            }
        }
    } catch (\Throwable $e) {
    }
    foreach ($palette as $c) {
        if (!isset($used[strtoupper($c)])) {
            return $c;
        }
    }
    return $palette[count($used) % count($palette)];
}

json_out(['error' => 'Unknown action'], 400);
