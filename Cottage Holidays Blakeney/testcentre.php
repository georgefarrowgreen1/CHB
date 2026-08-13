<?php
// ============================================================
//  testcentre.php — admin "Test centre" backend.
//  Lets the owner exercise customer-facing features from the back office:
//   - send_email  : send [TEST]-marked sample emails to the owner inbox
//   - list_data   : list everything flagged [CHB-TEST] (test bookings + payments)
//   - delete_data : remove one test record (and its dependent rows)
//   - purge_data  : remove ALL test data in one go
//
//  Test bookings themselves are created via bookings.php (action 'add') with a
//  [CHB-TEST] marker in notes, and the pay/arrival flows reuse the real endpoints
//  — this file only handles the email samples and the test-data clean-up.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

// The test tools only ever run on the staging sandbox — never let them touch the
// live database, even if this endpoint is somehow hit directly on production.
if (!preg_match('/(^|\.)staging\./i', $_SERVER['HTTP_HOST'] ?? '')) {
    json_out(['error' => 'The test tools are available on the staging site only.'], 403);
}

$in = body();
$action = $in['action'] ?? '';

// The marker that tags every record any test action creates, so the Test data
// page can find and remove all of it in one place.
const TEST_MARK = '[CHB-TEST]';

// ---- Test guest tracking ---------------------------------------------------
// The test guest is stored in content('testcentre-guest') as {id, created, email}
// so we know whether WE created the account (safe to delete on purge) or merely
// reused the owner's existing guest account (must never be deleted).
function tc_guest_meta()
{
    try {
        $v = content_json('testcentre-guest', null); // object key — content_value() returns '' for it
        if (!is_array($v)) {
            return null;
        }
        $d = $v; // already decoded by content_json()
        if (empty($d['id'])) {
            return null;
        }
        $s = db()->prepare('SELECT id, email FROM guests WHERE id = ?');
        $s->execute([$d['id']]);
        $row = $s->fetch();
        if (!$row) {
            return null;
        } // account gone — treat as no test guest
        $d['email'] = $row['email'];
        return $d;
    } catch (\Throwable $e) {
        return null;
    }
}
function tc_set_guest_meta($id, $created, $email)
{
    try {
        db()
            ->prepare(
                'INSERT INTO content (item_key, item_value, updated_at) VALUES (?,?,NOW())
                         ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()',
            )
            ->execute([
                'testcentre-guest',
                json_encode(['id' => (int) $id, 'created' => (bool) $created, 'email' => $email]),
            ]);
    } catch (\Throwable $e) {
    }
}
function tc_clear_guest_meta()
{
    try {
        db()
            ->prepare('DELETE FROM content WHERE item_key = ?')
            ->execute(['testcentre-guest']);
    } catch (\Throwable $e) {
    }
}
// Delete the test guest only if WE created it (never the owner's real account).
function tc_remove_test_guest()
{
    $meta = tc_guest_meta();
    if ($meta && !empty($meta['created'])) {
        try {
            db()
                ->prepare('DELETE FROM guest_passkeys WHERE guest_id = ?')
                ->execute([$meta['id']]);
        } catch (\Throwable $e) {
        }
        try {
            db()
                ->prepare('DELETE FROM guests WHERE id = ?')
                ->execute([$meta['id']]);
        } catch (\Throwable $e) {
        }
    }
    tc_clear_guest_meta();
}

// ---------------------------------------------------------------------------
//  Email samples
// ---------------------------------------------------------------------------
if ($action === 'send_email') {
    // Shared sender (email-samples.php) — the live Health check uses the same
    // machinery with a [SAMPLE] prefix; here the samples are marked [TEST].
    require_once __DIR__ . '/email-samples.php';
    json_out(chb_send_sample_emails($in['which'] ?? 'all', '[TEST] '));
}

// ---------------------------------------------------------------------------
//  Log in as a test guest — create/reuse a guest tied to the owner email (so
//  My Stays shows the test booking and its emails reach the owner), then return
//  a real magic-link URL that signs that guest in.
// ---------------------------------------------------------------------------
// Create (or reuse) the owner-email test guest and return its meta — shared by
// guest_login and the stage seeder (the chat thread and the pending review both
// need a real guests row). Null when OWNER_NOTIFY_EMAIL is unset; each caller
// says why in its own words.
function tc_ensure_guest()
{
    $owner = defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL ? OWNER_NOTIFY_EMAIL : '';
    if ($owner === '') {
        return null;
    }
    $meta = tc_guest_meta();
    if ($meta) {
        return $meta;
    }
    $s = db()->prepare('SELECT id FROM guests WHERE email = ?');
    $s->execute([$owner]);
    $row = $s->fetch();
    if ($row) {
        $gid = (int) $row['id']; // reuse the owner's existing account
        $created = false;
    } else {
        $pw = password_hash(bin2hex(random_bytes(9)), PASSWORD_DEFAULT);
        db()
            ->prepare('INSERT INTO guests (name, email, password_hash) VALUES (?,?,?)')
            ->execute(['Test Centre (test guest)', $owner, $pw]);
        $gid = (int) db()->lastInsertId();
        $created = true;
    }
    tc_set_guest_meta($gid, $created, $owner);
    return ['id' => $gid, 'created' => $created, 'email' => $owner];
}

if ($action === 'guest_login') {
    $meta = tc_ensure_guest();
    if (!$meta) {
        json_out([
            'ok' => false,
            'error' =>
                'Set OWNER_NOTIFY_EMAIL in config.php first — the test guest uses it so its bookings & emails reach you.',
        ]);
    }
    $owner = $meta['email'];
    // Make sure the test booking(s) belong to this guest's email so they appear in My Stays.
    try {
        db()
            ->prepare("UPDATE bookings SET email = ? WHERE notes LIKE ? AND (email = '' OR email IS NULL)")
            ->execute([$owner, '%' . TEST_MARK . '%']);
    } catch (\Throwable $e) {
    }
    $ts = time();
    $base = function_exists('site_base_url') ? site_base_url() : '';
    $url = $base . 'index.html?mlogin=' . (int) $meta['id'] . '&t=' . $ts . '&k=' . login_token((int) $meta['id'], $ts);
    json_out(['ok' => true, 'url' => $url, 'email' => $owner]);
}

// ---------------------------------------------------------------------------
//  Run a daily automation on demand, scoped to ONE test booking (so it emails
//  the owner, never real guests). Reuses the exact cron senders.
// ---------------------------------------------------------------------------
if ($action === 'run_automation') {
    require_once __DIR__ . '/mailer.php';
    require_once __DIR__ . '/pricing.php';
    $which = $in['which'] ?? '';
    $id = (int) ($in['id'] ?? 0);
    $b = null;
    try {
        $s = db()->prepare('SELECT * FROM bookings WHERE id = ? AND notes LIKE ?');
        $s->execute([$id, '%' . TEST_MARK . '%']);
        $b = $s->fetch();
    } catch (\Throwable $e) {
    }
    if (!$b) {
        json_out(['error' => 'Test booking not found — create one first.'], 404);
    }
    if (empty($b['email'])) {
        json_out([
            'ok' => false,
            'error' => 'The test booking has no email — use “Log in as a test guest” first so it reaches your inbox.',
        ]);
    }

    if ($which === 'pre_arrival') {
        $r = send_arrival_for_booking($b);
        json_out(['ok' => !empty($r['ok']), 'error' => $r['error'] ?? null]);
    }
    if ($which === 'review') {
        $base = function_exists('site_base_url') ? site_base_url() : '';
        $r = send_review_request_email([
            'name' => $b['name'],
            'email' => $b['email'],
            'prop_key' => $b['prop_key'],
            'prop_name' => prop_display($b['prop_key'])['name'],
            'reviewUrl' => $base . 'index.html?review=' . rawurlencode($b['prop_key']),
            'googleUrl' => trim(content_value('google-review-url')),
        ]);
        json_out(['ok' => !empty($r['ok']), 'error' => $r['error'] ?? null]);
    }
    if ($which === 'balance_reminder') {
        if (!function_exists('square_enabled') || !square_enabled()) {
            json_out(['ok' => false, 'error' => 'Square is off — balance reminders need card payments enabled.']);
        }
        $r = request_booking_payment($b, 'balance', true);
        json_out(['ok' => !empty($r['ok']), 'error' => $r['error'] ?? null]);
    }
    json_out(['error' => 'Unknown automation'], 400);
}

// ---------------------------------------------------------------------------
//  Seed demo data — populate everything needed to exercise the recent features
//  (cottages map pins, Airbnb-style cards + Guest-favourite badge, weekend
//  pricing, Pricing Coach, cross-channel Airbnb/Vrbo blocks, the arrival
//  banner). Everything is tagged/manifested so "Remove all test data" reverses
//  it completely. Staging-only (guarded at the top of this file).
// ---------------------------------------------------------------------------
if ($action === 'seed_features') {
    $owner = defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL ? OWNER_NOTIFY_EMAIL : '';
    $keys = [];
    try {
        $keys = db()
            ->query('SELECT prop_key FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name')
            ->fetchAll(\PDO::FETCH_COLUMN);
    } catch (\Throwable $e) {
    }
    if (!$keys) {
        json_out(['ok' => false, 'error' => 'No cottages found — run migrations first (Manage → System check).']);
    }
    $k0 = $keys[0];
    $k1 = $keys[1] ?? $keys[0];
    $k2 = $keys[2] ?? $keys[0];
    $manifest = ['geo' => [], 'weekend' => [], 'reviews' => true];

    // 1) GPS coords → map pins (spread slightly around Blakeney). Record prior
    //    values so purge restores them.
    $coords = [[52.9536, 1.0206], [52.9551, 1.0182], [52.9523, 1.0235], [52.951, 1.015]];
    foreach ($keys as $i => $k) {
        try {
            $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
            $s->execute(['geo-' . $k]);
            $prev = $s->fetchColumn();
            $manifest['geo'][$k] = $prev === false ? null : $prev;
            $c = $coords[$i % count($coords)];
            db()
                ->prepare(
                    'INSERT INTO content (item_key, item_value, updated_at) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()',
                )
                ->execute(['geo-' . $k, json_encode(['lat' => $c[0], 'lng' => $c[1]])]);
        } catch (\Throwable $e) {
        }
    }

    // 2) Weekend uplift on the first cottage (visible in price + calendar).
    try {
        $s = db()->prepare('SELECT weekend_pct FROM properties WHERE prop_key = ?');
        $s->execute([$k0]);
        $prevW = $s->fetchColumn();
        $manifest['weekend'][$k0] = $prevW === false || $prevW === null ? 0 : (float) $prevW;
        db()
            ->prepare('UPDATE properties SET weekend_pct = 20, weekend_days = ? WHERE prop_key = ?')
            ->execute(['5,6', $k0]);
    } catch (\Throwable $e) {
    }

    // 3) Curated 5★ reviews on k0 → card rating + "Guest favourite" badge.
    try {
        $arr = content_json('reviews', []); // array key — content_value() returns '' and would WIPE curated reviews
        $names = ['Sarah & Tom', 'The Williams family', 'Margaret H', 'James P'];
        $texts = [
            'Spotless, beautifully styled and steps from the quay. We will be back!',
            'Perfect coastal bolthole — the welcome book made everything effortless.',
            'Faultless from booking to check-out, and the local tips were spot on.',
            'A real gem: comfortable, characterful and brilliantly located.',
        ];
        for ($i = 0; $i < 4; $i++) {
            $arr[] = [
                'prop' => $k0,
                'stars' => 5,
                'text' => $texts[$i],
                'name' => $names[$i],
                'source' => 'Airbnb',
                'date' => date('Y-m-d', strtotime('-' . (3 + $i) . ' days')),
                '_test' => true,
            ];
        }
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value, updated_at) VALUES ('reviews', ?, NOW()) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()",
            )
            ->execute([json_encode($arr)]);
    } catch (\Throwable $e) {
    }

    // 4) Bookings (TEST_MARK in notes → removed by purge): a CURRENT stay for the
    //    test guest (current in-stay) + two on k1 with a 1-night orphan gap.
    $mkBooking = function ($prop, $name, $ci, $co, $email) {
        db()
            ->prepare(
                'INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, notes, payment) VALUES (?,?,?,?,?,?,?,?,?)',
            )
            ->execute([$prop, $name, $email, $ci, $co, 2, 0, 'Seeded demo ' . TEST_MARK, 'paid']);
    };
    try {
        $mkBooking(
            $k0,
            'Current guest ' . TEST_MARK,
            date('Y-m-d', strtotime('-1 day')),
            date('Y-m-d', strtotime('+3 days')),
            $owner,
        );
        $mkBooking(
            $k1,
            'Gap A ' . TEST_MARK,
            date('Y-m-d', strtotime('+14 days')),
            date('Y-m-d', strtotime('+17 days')),
            '',
        );
        $mkBooking(
            $k1,
            'Gap B ' . TEST_MARK,
            date('Y-m-d', strtotime('+18 days')),
            date('Y-m-d', strtotime('+21 days')),
            '',
        ); // 1-night gap (17→18)
    } catch (\Throwable $e) {
    }

    // 5) Imported Airbnb/Vrbo blocks → calendar labels + cross-channel Coach.
    try {
        $mkBlock = function ($prop, $src, $ci, $co) {
            db()
                ->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES (?,?,?,?,?)')
                ->execute([$prop, $src, $src . '-' . bin2hex(random_bytes(4)) . '-' . TEST_MARK, $ci, $co]);
        };
        $mkBlock($k0, 'airbnb', date('Y-m-d', strtotime('+25 days')), date('Y-m-d', strtotime('+28 days')));
        $mkBlock($k2, 'vrbo', date('Y-m-d', strtotime('+33 days')), date('Y-m-d', strtotime('+36 days')));
    } catch (\Throwable $e) {
    }

    // 6) Search demand incl. a no-result month → Coach "unmet demand". Tagged via
    //    a sentinel ip_hash so purge can find them.
    try {
        $sentinel = hash('sha256', TEST_MARK);
        $month = date('Y-m', strtotime('+2 months'));
        $ins = db()->prepare(
            'INSERT INTO search_log (mode, adults, children, nights, month, results, found, ip_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        );
        for ($i = 0; $i < 22; $i++) {
            $ins->execute([
                'flex',
                2,
                0,
                3,
                $month,
                1,
                1,
                $sentinel,
                date('Y-m-d H:i:s', strtotime('-' . random_int(1, 40) . ' days')),
            ]);
        }
        for ($i = 0; $i < 9; $i++) {
            $ins->execute([
                'flex',
                2,
                0,
                3,
                $month,
                0,
                0,
                $sentinel,
                date('Y-m-d H:i:s', strtotime('-' . random_int(1, 40) . ' days')),
            ]);
        }
    } catch (\Throwable $e) {
    }

    try {
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value, updated_at) VALUES ('testcentre-seeded', ?, NOW()) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()",
            )
            ->execute([json_encode($manifest)]);
    } catch (\Throwable $e) {
    }

    json_out(['ok' => true, 'cottages' => count($keys), 'owner_email' => $owner]);
}

// ---------------------------------------------------------------------------
//  Set the stage — a full pretend business in one tap, so every admin screen
//  and duty has something real to say and the guest seat has stays to walk
//  through: bookings in every money state, fresh/stale/declined enquiries, a
//  chat thread, a pending review, expenses and a waitlist entry. Reversible:
//  bookings/enquiries carry TEST_MARK in their invisible fields (notes /
//  message) so the existing purge sweeps find them, and rows with no such
//  field are id-tracked in the 'testcentre-staged' manifest. Every stay is
//  priced with the REAL model (price_breakdown) so the money surfaces cohere,
//  and never seeded over existing dates — a sandbox calendar must stay as
//  double-booking-proof as the live one. Staging-only (guarded at the top).
// ---------------------------------------------------------------------------
if ($action === 'seed_stage') {
    require_once __DIR__ . '/pricing.php';
    $props = [];
    try {
        $props = db()
            ->query('SELECT * FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name')
            ->fetchAll();
    } catch (\Throwable $e) {
    }
    if (!$props) {
        json_out(['ok' => false, 'error' => 'No cottages found — run migrations first (Manage → System check).']);
    }
    $P = fn($i) => $props[$i % count($props)];
    $owner = defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL ? OWNER_NOTIFY_EMAIL : '';
    $D = fn($n) => date('Y-m-d', strtotime(($n >= 0 ? '+' . $n : (string) $n) . ' days'));
    $made = ['bookings' => 0, 'skipped' => 0, 'enquiries' => 0, 'expenses' => 0, 'waitlist' => 0, 'reviews' => 0, 'messages' => 0];
    $man = ['expenses' => [], 'waitlist' => [], 'reviews' => [], 'messages' => []];

    // One stay. opts: pay (fraction of the rental already in: 0 | 0.25 | 1),
    // withDep (cash rail's bundled damages deposit — what makes a deposit
    // RETURNABLE end to end with no Square charge behind it), email, method,
    // paidOn/createdN (day offsets), arrival (window code), plan_pct + due.
    $stay = function ($prop, $name, $ciN, $coN, $opts = []) use (&$made, $D) {
        $ci = $D($ciN);
        $co = $D($coN);
        try {
            if (dates_clash($prop['prop_key'], $ci, $co)) {
                $made['skipped']++;
                return 0;
            }
            $p = price_breakdown($prop, 2, 0, $ci, $co);
            $frac = (float) ($opts['pay'] ?? 0);
            $paid = round((float) $p['total'] * $frac, 2) + (!empty($opts['withDep']) ? (float) $p['damagesDeposit'] : 0);
            $status = $frac >= 1 ? 'paid' : ($frac > 0 ? 'deposit' : 'unpaid');
            db()->prepare(
                'INSERT INTO bookings (prop_key, name, email, phone, check_in, check_out, adults, children, notes,
                    payment, deposit_paid, payment_method, payment_date, agreed_total, agreed_per_night, agreed_nights,
                    agreed_nightly, agreed_booking_fee, agreed_txn_pct, agreed_txn_fee, agreed_on, arrival_window,
                    deposit_pct_override, balance_due_date, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )->execute([
                $prop['prop_key'],
                $name,
                $opts['email'] ?? '',
                '07700 900123', // Ofcom's reserved drama range — never a real number
                $ci,
                $co,
                2,
                0,
                'Seeded walkthrough ' . TEST_MARK,
                $status,
                $paid,
                $paid > 0 ? ($opts['method'] ?? 'Card') : null,
                $paid > 0 ? $D((int) ($opts['paidOn'] ?? 0)) : null,
                $p['total'],
                $p['perNight'],
                $p['nights'],
                $p['nightly'],
                $p['damagesDeposit'],
                $p['transactionPct'],
                $p['txFee'],
                date('Y-m-d'),
                $opts['arrival'] ?? null,
                $opts['plan_pct'] ?? null,
                $opts['due'] ?? null,
                $D((int) ($opts['createdN'] ?? 0)) . ' 10:00:00',
            ]);
            $made['bookings']++;
            return (int) db()->lastInsertId();
        } catch (\Throwable $e) {
            return 0;
        }
    };
    // The six money states an owner actually meets. Sofia, Daniel and Eleanor
    // carry the OWNER email so the guest seat's My Stays shows an arrival-day
    // stay (door-code companion), a balance to pay (the sandbox-card walk) and
    // a finished one (review ask + deposit coming back).
    $stay($P(0), 'Harriet Webb', -2, 2, ['pay' => 1, 'paidOn' => -20, 'createdN' => -60]);
    $stay($P(1), 'Sofia Laurent', 0, 4, ['pay' => 1, 'email' => $owner, 'arrival' => '16-18', 'paidOn' => -15, 'createdN' => -45]);
    $stay($P(2), 'Daniel Okafor', 10, 14, ['pay' => 0.25, 'email' => $owner, 'paidOn' => -8, 'createdN' => -30]);
    $stay($P(0), 'Priya Chandra', 40, 44, ['plan_pct' => 30, 'due' => $D(19), 'createdN' => -5]);
    $stay($P(1), 'Martin Gale', 2, 5, ['createdN' => -20]);
    $stay($P(2), 'Eleanor Brady', -5, -1, ['pay' => 1, 'withDep' => true, 'method' => 'Cash', 'email' => $owner, 'paidOn' => -12, 'createdN' => -40]);

    // Enquiries: one fresh, one gone stale (the red duty), one declined (the
    // recovery drawer). Terms + no-dogs recorded so approval works end to end.
    $ask = function ($prop, $name, $ciN, $coN, $msg, $createdN = 0, $declinedN = null) use (&$made, $D) {
        try {
            db()->prepare(
                'INSERT INTO enquiries (prop_key, name, email, phone, check_in, check_out, adults, children, message,
                    terms_accepted_at, terms_version, no_dogs_at, created_at, declined_at)
                 VALUES (?,?,?,?,?,?,?,?,?,NOW(),?,NOW(),?,?)',
            )->execute([
                $prop['prop_key'],
                $name,
                strtolower(str_replace(' ', '.', $name)) . '@example.com',
                '07700 900456',
                $D($ciN),
                $D($coN),
                2,
                0,
                $msg . ' ' . TEST_MARK,
                'v1',
                $D($createdN) . ' 09:30:00',
                $declinedN === null ? null : $D($declinedN) . ' 17:00:00',
            ]);
            $made['enquiries']++;
        } catch (\Throwable $e) {
        }
    };
    $ask($P(0), 'Grace Holloway', 21, 25, "We'd love a few days by the coast — is the cottage free then?");
    $ask($P(1), 'Tom Barrett', 35, 38, 'Hoping for a long weekend — do you allow late checkout?', -3);
    $ask($P(2), 'Nina Perez', 8, 11, 'Any chance of a last-minute stay next week?', -5, -1);

    // The chat thread and the pending review both hang off a real guests row —
    // the owner-email test guest, so the guest seat sees its own thread too.
    $g = tc_ensure_guest();
    if ($g) {
        try {
            $ins = db()->prepare(
                'INSERT INTO messages (guest_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?,?,?,?,?)',
            );
            foreach (
                [
                    ['guest', 'Hi — is there parking right by the cottage, or is it a walk with the bags?', 1, 1],
                    ['admin', "There's a space directly outside, and an overflow spot two doors down — you'll be fine.", 1, 1],
                    ['guest', 'Perfect, thank you! One more thing — do you have a travel cot we could borrow?', 0, 1],
                ]
                as $m
            ) {
                $ins->execute([$g['id'], $m[0], $m[1], $m[2], $m[3]]);
                $man['messages'][] = (int) db()->lastInsertId();
                $made['messages']++;
            }
        } catch (\Throwable $e) {
        }
        try {
            db()->prepare(
                "INSERT INTO guest_reviews (guest_id, prop_key, stars, review_text, status) VALUES (?,?,5,?,'pending')
                 ON DUPLICATE KEY UPDATE status = 'pending', review_text = VALUES(review_text)",
            )->execute([
                $g['id'],
                $P(1)['prop_key'],
                'A wonderful stay — the welcome book had everything and the beach walk from the door is glorious.',
            ]);
            $s = db()->prepare('SELECT id FROM guest_reviews WHERE guest_id = ? AND prop_key = ?');
            $s->execute([$g['id'], $P(1)['prop_key']]);
            $rid = (int) $s->fetchColumn();
            if ($rid) {
                $man['reviews'][] = $rid;
                $made['reviews']++;
            }
        } catch (\Throwable $e) {
        }
    }

    // Expenses (the books stop reading as a gross margin) + a waitlist entry
    // asking for nights Sofia holds — which is what a waitlist is for.
    try {
        $ins = db()->prepare('INSERT INTO expenses (category, description, amount, prop_key, expense_date) VALUES (?,?,?,?,?)');
        foreach (
            [
                ['Cleaning', 'Changeover clean', 85.0, $P(0)['prop_key'], $D(-10)],
                ['Maintenance', 'Boiler service', 120.0, $P(1)['prop_key'], $D(-30)],
                ['Laundry', 'Linen hire', 42.5, $P(2)['prop_key'], $D(-6)],
            ]
            as $e2
        ) {
            $ins->execute($e2);
            $man['expenses'][] = (int) db()->lastInsertId();
            $made['expenses']++;
        }
    } catch (\Throwable $e) {
    }
    try {
        db()->prepare('INSERT INTO waitlist (prop_key, name, email, check_in, check_out, note) VALUES (?,?,?,?,?,?)')
            ->execute([$P(1)['prop_key'], 'Olivia Fenwick', 'olivia.fenwick@example.com', $D(0), $D(4), 'Anniversary trip — any cancellation welcome']);
        $man['waitlist'][] = (int) db()->lastInsertId();
        $made['waitlist']++;
    } catch (\Throwable $e) {
    }

    // The manifest MERGES with any earlier staging — overwriting it would
    // orphan the previous round's id-tracked rows from the purge.
    try {
        $prev = content_json('testcentre-staged', []);
        if (is_array($prev)) {
            foreach ($man as $k => $ids) {
                $man[$k] = array_values(array_unique(array_merge(array_map('intval', (array) ($prev[$k] ?? [])), $ids)));
            }
        }
        db()->prepare(
            "INSERT INTO content (item_key, item_value, updated_at) VALUES ('testcentre-staged', ?, NOW())
             ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()",
        )->execute([json_encode($man)]);
    } catch (\Throwable $e) {
    }
    json_out(['ok' => true] + $made);
}

// ---------------------------------------------------------------------------
//  Test data — list / delete / purge
// ---------------------------------------------------------------------------
function tc_test_bookings()
{
    try {
        $st = db()->prepare("SELECT id, prop_key, name, check_in, check_out, agreed_total, created_at
                             FROM bookings WHERE notes LIKE ? ORDER BY id DESC");
        $st->execute(['%' . TEST_MARK . '%']);
        return $st->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}
function tc_test_enquiries()
{
    try {
        $st = db()->prepare("SELECT id, prop_key, name, check_in, check_out, created_at
                             FROM enquiries WHERE message LIKE ? ORDER BY id DESC");
        $st->execute(['%' . TEST_MARK . '%']);
        return $st->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}
// Remove a test booking and any payment rows that reference it.
function tc_delete_booking($id)
{
    try {
        db()
            ->prepare('DELETE FROM payments WHERE booking_id = ?')
            ->execute([$id]);
    } catch (\Throwable $e) {
    }
    db()
        ->prepare('DELETE FROM bookings WHERE id = ? AND notes LIKE ?')
        ->execute([$id, '%' . TEST_MARK . '%']);
}

if ($action === 'list_data') {
    $bookings = tc_test_bookings();
    foreach ($bookings as &$b) {
        $b['agreed_total'] = (float) $b['agreed_total'];
        try {
            $st = db()->prepare('SELECT COUNT(*) FROM payments WHERE booking_id = ?');
            $st->execute([$b['id']]);
            $b['payments'] = (int) $st->fetchColumn();
        } catch (\Throwable $e) {
            $b['payments'] = 0;
        }
    }
    unset($b);
    $enquiries = tc_test_enquiries();
    $gmeta = tc_guest_meta();
    $guest = $gmeta
        ? ['id' => (int) $gmeta['id'], 'email' => $gmeta['email'], 'created' => !empty($gmeta['created'])]
        : null;
    json_out([
        'ok' => true,
        'bookings' => $bookings,
        'enquiries' => $enquiries,
        'guest' => $guest,
        'count' => count($bookings) + count($enquiries) + ($guest ? 1 : 0),
        'owner_email' => defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL ? OWNER_NOTIFY_EMAIL : '',
        'square' => [
            'enabled' => function_exists('square_enabled') && square_enabled(),
            'production' => defined('SQUARE_ENVIRONMENT') && SQUARE_ENVIRONMENT === 'production',
        ],
    ]);
}

if ($action === 'delete_data') {
    $type = $in['type'] ?? '';
    $id = (int) ($in['id'] ?? 0);
    if ($id <= 0) {
        json_out(['error' => 'Missing id'], 400);
    }
    if ($type === 'booking') {
        tc_delete_booking($id);
    } elseif ($type === 'enquiry') {
        db()
            ->prepare('DELETE FROM enquiries WHERE id = ? AND message LIKE ?')
            ->execute([$id, '%' . TEST_MARK . '%']);
    } elseif ($type === 'guest') {
        tc_remove_test_guest();
    } else {
        json_out(['error' => 'Unknown type'], 400);
    }
    json_out(['ok' => true]);
}

if ($action === 'purge_data') {
    foreach (tc_test_bookings() as $b) {
        tc_delete_booking((int) $b['id']);
    }
    try {
        db()
            ->prepare('DELETE FROM enquiries WHERE message LIKE ?')
            ->execute(['%' . TEST_MARK . '%']);
    } catch (\Throwable $e) {
    }
    // Seeded feature data (ical blocks + search demand).
    try {
        db()
            ->prepare('DELETE FROM ical_blocks WHERE uid LIKE ?')
            ->execute(['%' . TEST_MARK . '%']);
    } catch (\Throwable $e) {
    }
    try {
        db()
            ->prepare('DELETE FROM search_log WHERE ip_hash = ?')
            ->execute([hash('sha256', TEST_MARK)]);
    } catch (\Throwable $e) {
    }
    // Reverse the seed manifest (GPS coords, weekend uplift, curated test reviews).
    try {
        $m = content_json('testcentre-seeded', []);
        if (is_array($m)) {
            foreach ($m['geo'] ?? [] as $k => $prev) {
                if ($prev === null) {
                    db()
                        ->prepare('DELETE FROM content WHERE item_key = ?')
                        ->execute(['geo-' . $k]);
                } else {
                    db()
                        ->prepare('UPDATE content SET item_value = ? WHERE item_key = ?')
                        ->execute([$prev, 'geo-' . $k]);
                }
            }
            foreach ($m['weekend'] ?? [] as $prop => $prev) {
                db()
                    ->prepare('UPDATE properties SET weekend_pct = ? WHERE prop_key = ?')
                    ->execute([(float) $prev, $prop]);
            }
            if (!empty($m['reviews'])) {
                $arr = content_json('reviews', []); // array key — must not read via content_value() (would blank it)
                if (is_array($arr)) {
                    $arr = array_values(
                        array_filter($arr, function ($r) {
                            return empty($r['_test']);
                        }),
                    );
                    db()
                        ->prepare("UPDATE content SET item_value = ? WHERE item_key = 'reviews'")
                        ->execute([json_encode($arr)]);
                }
            }
        }
    } catch (\Throwable $e) {
    }
    try {
        db()->prepare("DELETE FROM content WHERE item_key = 'testcentre-seeded'")->execute();
    } catch (\Throwable $e) {
    }
    // Reverse the stage seeder's id-tracked rows (bookings/enquiries were
    // already swept above by their TEST_MARK). Table names come from this
    // fixed map and ids are int-cast — nothing owner-written reaches the SQL.
    try {
        $m2 = content_json('testcentre-staged', []);
        if (is_array($m2)) {
            foreach (['expenses' => 'expenses', 'waitlist' => 'waitlist', 'reviews' => 'guest_reviews', 'messages' => 'messages'] as $key => $table) {
                $ids = array_values(array_filter(array_map('intval', (array) ($m2[$key] ?? []))));
                if ($ids) {
                    db()->prepare("DELETE FROM $table WHERE id IN (" . implode(',', array_fill(0, count($ids), '?')) . ')')
                        ->execute($ids);
                }
            }
        }
        db()->prepare("DELETE FROM content WHERE item_key = 'testcentre-staged'")->execute();
    } catch (\Throwable $e) {
    }
    tc_remove_test_guest();
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
