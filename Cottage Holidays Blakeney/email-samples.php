<?php
// ============================================================
//  email-samples.php — send [SAMPLE]-marked copies of every guest-facing
//  email to the owner's inbox, so they can see exactly what guests receive
//  without making a real booking. Available on the LIVE site (admin-only);
//  the staging Test centre reuses the same sender with a [TEST] prefix.
//
//  POST {action:'send', which:'all'|<key>}  →  {ok, to, sent, results:[…]}
// ============================================================
require_once __DIR__ . '/db.php';

// Build + send the samples. Returns the JSON-ready result array.
// $prefix is prepended to every subject line so samples are unmistakable.
function chb_send_sample_emails($which = 'all', $prefix = '[SAMPLE] ') {
    require_once __DIR__ . '/mailer.php';
    if (!defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) return ['ok' => false, 'error' => 'No owner email is set in config.php (OWNER_NOTIFY_EMAIL).'];
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) return ['ok' => false, 'error' => 'Email is switched off (MAIL_ENABLED is false).'];

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
        'held' => 75.0, 'manual' => false, 'reason' => 'Sample reason (sample email only)',
        'refund' => 119.18, 'card' => true,
        'fully_paid' => false, 'balance' => 357.52, 'paid_so_far' => 119.18,
        'reviewUrl' => $base . 'index.html', 'googleUrl' => '',
    ];
    $g = ['id' => 0, 'name' => 'Test Guest', 'email' => $owner];
    $payUrl   = $base . 'index.html?pay=SAMPLE&b=0&k=deposit';
    $magicUrl = $base . 'index.html?magic=SAMPLE';

    // which => [human label, sender closure]
    $senders = [
        'confirmation'    => ['Booking confirmation',    fn() => send_booking_emails($b)],
        'arrival'         => ['Arrival information',     fn() => send_arrival_email($b)],
        'payment_request' => ['Payment request',         fn() => send_payment_request($b, $payUrl)],
        'payment_reminder'=> ['Balance reminder',        fn() => send_payment_reminder($b, $payUrl)],
        'payment_receipt' => ['Payment receipt',         fn() => send_payment_receipt($b)],
        'review_request'  => ['Review request',          fn() => send_review_request_email($b)],
        'magic_link'      => ['Sign-in (magic) link',    fn() => send_magic_link_email($g, $magicUrl)],
        'refund'          => ['Refund notice',           fn() => send_refund_email($b)],
        'deposit_return'  => ['Damage deposit return',   fn() => send_deposit_return_email($b)],
        'cancellation'    => ['Booking cancelled',       fn() => send_cancellation_email($b)],
        'anniversary'     => ['Anniversary re-invite',   fn() => send_anniversary_email($b)],
        'owner_notice'    => ['Owner: payment received', fn() => send_owner_payment_notice(array_merge($b, ['status' => 'deposit']))],
    ];

    $GLOBALS['__chb_test_prefix'] = $prefix;
    $results = [];
    $todo = ($which === 'all') ? array_keys($senders) : (isset($senders[$which]) ? [$which] : []);
    if (!$todo) { unset($GLOBALS['__chb_test_prefix']); return ['ok' => false, 'error' => 'Unknown email type']; }
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
    return ['ok' => true, 'to' => $owner, 'sent' => $sent, 'results' => $results];
}

// ---- Endpoint (only when this file is hit directly, not when included) ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') === 'email-samples.php') {
    require_admin();
    $in = body();
    if (($in['action'] ?? '') === 'send') {
        json_out(chb_send_sample_emails(clean($in['which'] ?? 'all')));
    }
    json_out(['error' => 'Unknown action'], 400);
}
