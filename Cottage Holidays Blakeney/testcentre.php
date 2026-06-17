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
function tc_guest_meta() {
    try {
        $v = content_value('testcentre-guest');
        if (!$v) return null;
        $d = json_decode($v, true);
        if (!is_array($d) || empty($d['id'])) return null;
        $s = db()->prepare('SELECT id, email FROM guests WHERE id = ?'); $s->execute([$d['id']]);
        $row = $s->fetch();
        if (!$row) return null;            // account gone — treat as no test guest
        $d['email'] = $row['email'];
        return $d;
    } catch (\Throwable $e) { return null; }
}
function tc_set_guest_meta($id, $created, $email) {
    try { db()->prepare('INSERT INTO content (item_key, item_value, updated_at) VALUES (?,?,NOW())
                         ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()')
        ->execute(['testcentre-guest', json_encode(['id' => (int)$id, 'created' => (bool)$created, 'email' => $email])]); }
    catch (\Throwable $e) {}
}
function tc_clear_guest_meta() { try { db()->prepare('DELETE FROM content WHERE item_key = ?')->execute(['testcentre-guest']); } catch (\Throwable $e) {} }
// Delete the test guest only if WE created it (never the owner's real account).
function tc_remove_test_guest() {
    $meta = tc_guest_meta();
    if ($meta && !empty($meta['created'])) {
        try { db()->prepare('DELETE FROM guest_passkeys WHERE guest_id = ?')->execute([$meta['id']]); } catch (\Throwable $e) {}
        try { db()->prepare('DELETE FROM guests WHERE id = ?')->execute([$meta['id']]); } catch (\Throwable $e) {}
    }
    tc_clear_guest_meta();
}

// ---------------------------------------------------------------------------
//  Email samples
// ---------------------------------------------------------------------------
if ($action === 'send_email') {
    require_once __DIR__ . '/mailer.php';
    if (!defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) json_out(['ok' => false, 'error' => 'No owner email is set in config.php (OWNER_NOTIFY_EMAIL).']);
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) json_out(['ok' => false, 'error' => 'Email is switched off (MAIL_ENABLED is false).']);

    $which = $in['which'] ?? 'all';
    $owner = OWNER_NOTIFY_EMAIL;

    // A live cottage to name in the samples (falls back to a placeholder).
    $propKey = ''; $propName = 'A Test Cottage';
    try {
        $row = db()->query('SELECT prop_key, name FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name LIMIT 1')->fetch();
        if ($row) { $propKey = $row['prop_key']; $propName = $row['name']; }
    } catch (\Throwable $e) {}

    $base = function_exists('site_base_url') ? site_base_url() : '';
    $ci = date('Y-m-d', strtotime('+30 days'));
    $co = date('Y-m-d', strtotime('+33 days'));

    // One fully-populated dummy booking covering every key the send_* functions read.
    $b = [
        'id' => 0, 'ref' => 'TEST-0001',
        'name' => 'Test Guest', 'email' => $owner, 'phone' => '01234 567890',
        'prop_key' => $propKey, 'prop_name' => $propName,
        'check_in' => $ci, 'check_out' => $co, 'check_in_time' => '15:00', 'check_out_time' => '10:00',
        'nights' => 3, 'adults' => 2, 'children' => 0,
        'payment' => 'deposit', 'address' => '123 Test Street, Blakeney, Norfolk NR25 7XX',
        'per_night' => 130.0, 'nightly' => 390.0, 'tx_pct' => 3, 'tx_fee' => 11.70,
        'damages_deposit' => 75.0, 'total' => 476.70,
        'kind' => 'deposit', 'amount' => 119.18,
        'held' => 75.0, 'manual' => false, 'reason' => 'Sample reason (test email only)',
        'refund' => 119.18, 'card' => true,
        'fully_paid' => false, 'balance' => 357.52, 'paid_so_far' => 119.18,
        'reviewUrl' => $base . 'index.html', 'googleUrl' => '',
    ];
    $g = ['id' => 0, 'name' => 'Test Guest', 'email' => $owner];
    $payUrl   = $base . 'index.html?pay=SAMPLE&b=0&k=deposit';
    $magicUrl = $base . 'index.html?magic=SAMPLE';

    // which => [human label, sender closure]
    $senders = [
        'confirmation'   => ['Booking confirmation', fn() => send_booking_emails($b)],
        'arrival'        => ['Arrival information',   fn() => send_arrival_email($b)],
        'payment_request'=> ['Payment request',       fn() => send_payment_request($b, $payUrl)],
        'payment_reminder'=>['Balance reminder',      fn() => send_payment_reminder($b, $payUrl)],
        'payment_receipt'=> ['Payment receipt',       fn() => send_payment_receipt($b)],
        'review_request' => ['Review request',        fn() => send_review_request_email($b)],
        'magic_link'     => ['Sign-in (magic) link',  fn() => send_magic_link_email($g, $magicUrl)],
        'refund'         => ['Refund notice',         fn() => send_refund_email($b)],
        'deposit_return' => ['Damage deposit return', fn() => send_deposit_return_email($b)],
        'cancellation'   => ['Booking cancelled',     fn() => send_cancellation_email($b)],
        'owner_notice'   => ['Owner: payment received', fn() => send_owner_payment_notice(array_merge($b, ['status' => 'deposit']))],
    ];

    $GLOBALS['__chb_test_prefix'] = '[TEST] ';
    $results = [];
    $todo = ($which === 'all') ? array_keys($senders) : (isset($senders[$which]) ? [$which] : []);
    if (!$todo) { unset($GLOBALS['__chb_test_prefix']); json_out(['ok' => false, 'error' => 'Unknown email type']); }
    foreach ($todo as $key) {
        [$label, $fn] = $senders[$key];
        try {
            $r = $fn();
            // send_booking_emails returns a guest/owner pair; flatten to one ok flag.
            $ok = isset($r['guest']) ? (!empty($r['guest']['ok']) || !empty($r['owner']['ok'])) : !empty($r['ok']);
            $err = isset($r['guest']) ? ($r['guest']['error'] ?? ($r['owner']['error'] ?? null)) : ($r['error'] ?? null);
            $results[] = ['which' => $key, 'label' => $label, 'ok' => $ok, 'error' => $ok ? null : $err];
        } catch (\Throwable $e) {
            $results[] = ['which' => $key, 'label' => $label, 'ok' => false, 'error' => $e->getMessage()];
        }
    }
    unset($GLOBALS['__chb_test_prefix']);
    $sent = count(array_filter($results, fn($r) => $r['ok']));
    json_out(['ok' => true, 'to' => $owner, 'sent' => $sent, 'results' => $results]);
}

// ---------------------------------------------------------------------------
//  Log in as a test guest — create/reuse a guest tied to the owner email (so
//  My Stays shows the test booking and its emails reach the owner), then return
//  a real magic-link URL that signs that guest in.
// ---------------------------------------------------------------------------
if ($action === 'guest_login') {
    $owner = (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) ? OWNER_NOTIFY_EMAIL : '';
    if ($owner === '') json_out(['ok' => false, 'error' => 'Set OWNER_NOTIFY_EMAIL in config.php first — the test guest uses it so its bookings & emails reach you.']);
    $meta = tc_guest_meta();
    if (!$meta) {
        $s = db()->prepare('SELECT id FROM guests WHERE email = ?'); $s->execute([$owner]);
        $row = $s->fetch();
        if ($row) { $gid = (int)$row['id']; $created = false; }          // reuse the owner's existing account
        else {
            $pw = password_hash(bin2hex(random_bytes(9)), PASSWORD_DEFAULT);
            db()->prepare('INSERT INTO guests (name, email, password_hash) VALUES (?,?,?)')
                ->execute(['Test Centre (test guest)', $owner, $pw]);
            $gid = (int)db()->lastInsertId(); $created = true;
        }
        tc_set_guest_meta($gid, $created, $owner);
        $meta = ['id' => $gid, 'created' => $created, 'email' => $owner];
    }
    // Make sure the test booking(s) belong to this guest's email so they appear in My Stays.
    try { db()->prepare("UPDATE bookings SET email = ? WHERE notes LIKE ? AND (email = '' OR email IS NULL)")->execute([$owner, '%' . TEST_MARK . '%']); } catch (\Throwable $e) {}
    $ts = time();
    $base = function_exists('site_base_url') ? site_base_url() : '';
    $url = $base . 'index.html?mlogin=' . (int)$meta['id'] . '&t=' . $ts . '&k=' . login_token((int)$meta['id'], $ts);
    json_out(['ok' => true, 'url' => $url, 'email' => $owner]);
}

// ---------------------------------------------------------------------------
//  Run a daily automation on demand, scoped to ONE test booking (so it emails
//  the owner, never real guests). Reuses the exact cron senders.
// ---------------------------------------------------------------------------
if ($action === 'run_automation') {
    require_once __DIR__ . '/mailer.php';
    require_once __DIR__ . '/pricing.php';
    $which = $in['which'] ?? ''; $id = (int)($in['id'] ?? 0);
    $b = null;
    try { $s = db()->prepare("SELECT * FROM bookings WHERE id = ? AND notes LIKE ?"); $s->execute([$id, '%' . TEST_MARK . '%']); $b = $s->fetch(); } catch (\Throwable $e) {}
    if (!$b) json_out(['error' => 'Test booking not found — create one first.'], 404);
    if (empty($b['email'])) json_out(['ok' => false, 'error' => 'The test booking has no email — use “Log in as a test guest” first so it reaches your inbox.']);

    if ($which === 'pre_arrival') {
        $r = send_arrival_for_booking($b);
        json_out(['ok' => !empty($r['ok']), 'error' => $r['error'] ?? null]);
    }
    if ($which === 'review') {
        $base = function_exists('site_base_url') ? site_base_url() : '';
        $r = send_review_request_email([
            'name' => $b['name'], 'email' => $b['email'], 'prop_key' => $b['prop_key'],
            'prop_name' => prop_display($b['prop_key'])['name'],
            'reviewUrl' => $base . 'index.html?review=' . rawurlencode($b['prop_key']),
            'googleUrl' => trim(content_value('google-review-url')),
        ]);
        json_out(['ok' => !empty($r['ok']), 'error' => $r['error'] ?? null]);
    }
    if ($which === 'balance_reminder') {
        if (!function_exists('square_enabled') || !square_enabled()) json_out(['ok' => false, 'error' => 'Square is off — balance reminders need card payments enabled.']);
        $r = request_booking_payment($b, 'balance', true);
        json_out(['ok' => !empty($r['ok']), 'error' => $r['error'] ?? null]);
    }
    if ($which === 'checkin_push') {
        require_once __DIR__ . '/webpush.php';
        try { notify_guest_email($b['email'], 'Your cottage is ready', 'Your arrival map and key code are now available — tap to open.', './?arrival=1'); } catch (\Throwable $e) {}
        json_out(['ok' => true, 'note' => 'push sent if the test guest has notifications enabled on a device']);
    }
    json_out(['error' => 'Unknown automation'], 400);
}

// ---------------------------------------------------------------------------
//  Test data — list / delete / purge
// ---------------------------------------------------------------------------
function tc_test_bookings() {
    try {
        $st = db()->prepare("SELECT id, prop_key, name, check_in, check_out, agreed_total, created_at
                             FROM bookings WHERE notes LIKE ? ORDER BY id DESC");
        $st->execute(['%' . TEST_MARK . '%']);
        return $st->fetchAll();
    } catch (\Throwable $e) { return []; }
}
function tc_test_enquiries() {
    try {
        $st = db()->prepare("SELECT id, prop_key, name, check_in, check_out, created_at
                             FROM enquiries WHERE message LIKE ? ORDER BY id DESC");
        $st->execute(['%' . TEST_MARK . '%']);
        return $st->fetchAll();
    } catch (\Throwable $e) { return []; }
}
// Remove a test booking and any payment rows that reference it.
function tc_delete_booking($id) {
    try { db()->prepare('DELETE FROM payments WHERE booking_id = ?')->execute([$id]); } catch (\Throwable $e) {}
    db()->prepare("DELETE FROM bookings WHERE id = ? AND notes LIKE ?")->execute([$id, '%' . TEST_MARK . '%']);
}

if ($action === 'list_data') {
    $bookings = tc_test_bookings();
    foreach ($bookings as &$b) {
        $b['agreed_total'] = (float)$b['agreed_total'];
        try { $st = db()->prepare('SELECT COUNT(*) FROM payments WHERE booking_id = ?'); $st->execute([$b['id']]); $b['payments'] = (int)$st->fetchColumn(); }
        catch (\Throwable $e) { $b['payments'] = 0; }
    }
    unset($b);
    $enquiries = tc_test_enquiries();
    $gmeta = tc_guest_meta();
    $guest = $gmeta ? ['id' => (int)$gmeta['id'], 'email' => $gmeta['email'], 'created' => !empty($gmeta['created'])] : null;
    json_out([
        'ok' => true, 'bookings' => $bookings, 'enquiries' => $enquiries, 'guest' => $guest,
        'count' => count($bookings) + count($enquiries) + ($guest ? 1 : 0),
        'owner_email' => (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) ? OWNER_NOTIFY_EMAIL : '',
        'square' => [
            'enabled'    => function_exists('square_enabled') && square_enabled(),
            'production' => defined('SQUARE_ENVIRONMENT') && SQUARE_ENVIRONMENT === 'production',
        ],
    ]);
}

if ($action === 'delete_data') {
    $type = $in['type'] ?? ''; $id = (int)($in['id'] ?? 0);
    if ($id <= 0) json_out(['error' => 'Missing id'], 400);
    if ($type === 'booking')      tc_delete_booking($id);
    else if ($type === 'enquiry') db()->prepare("DELETE FROM enquiries WHERE id = ? AND message LIKE ?")->execute([$id, '%' . TEST_MARK . '%']);
    else if ($type === 'guest')   tc_remove_test_guest();
    else json_out(['error' => 'Unknown type'], 400);
    json_out(['ok' => true]);
}

if ($action === 'purge_data') {
    foreach (tc_test_bookings() as $b) tc_delete_booking((int)$b['id']);
    try { db()->prepare("DELETE FROM enquiries WHERE message LIKE ?")->execute(['%' . TEST_MARK . '%']); } catch (\Throwable $e) {}
    tc_remove_test_guest();
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
