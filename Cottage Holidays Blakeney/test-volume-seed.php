<?php
// ============================================================
//  test-volume-seed.php — five years of a three-cottage business, for volume-test.js
//  (dev only: the deploy strips test-*.php and .htaccess refuses them).
//
//      php test-volume-seed.php <database>
//
//  Fills an EMPTY, fully migrated database (volume-test.js makes it: schema.sql, then
//  the app's own migrate.php) with what five years of trading leave behind: about
//  1,400 bookings across three cottages with their payments, refunds and returned
//  deposits, 40,000 activity rows, 800 chat threads, 3,000 enquiries, 6,000 bank
//  lines, half a year of page views, reviews, registrations, waitlist entries,
//  platform blocks and the content keys that grow with use (the mailbox's handled
//  list, the payout cache, the Inbox's record).
//
//  DETERMINISTIC AND DATED FROM TODAY: mt_srand(7), no random_bytes, and every date
//  counted from today's UK date (or CHB_VOLUME_TODAY=YYYY-MM-DD), so each run has the
//  same shape relative to the day it runs. That is what the gate's budgets measure:
//  a fixed calendar would drift until every stay was in the past.
//
//  Connects as root through CHB_IT_DB_* (as test-integration.php does) and prints one
//  JSON line: the date it seeded from and how many rows each table took.
// ============================================================
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
error_reporting(E_ALL);
date_default_timezone_set('UTC');
const VS_PASSWORD = 'volume-pass-123';

$VS_DB = (string) ($argv[1] ?? '');
if (!preg_match('/^[a-z0-9_]{1,40}$/', $VS_DB)) {
    fwrite(STDERR, "usage: php test-volume-seed.php <database>\n");
    exit(2);
}
$vsHost = getenv('CHB_IT_DB_HOST') ?: '127.0.0.1';
$vsPort = (int) (getenv('CHB_IT_DB_PORT') ?: 3306);
$vsUser = getenv('CHB_IT_DB_USER') ?: 'root';
$vsPass = getenv('CHB_IT_DB_PASS') !== false ? (string) getenv('CHB_IT_DB_PASS') : 'root';
$db = new PDO("mysql:host=$vsHost;port=$vsPort;dbname=$VS_DB;charset=utf8mb4", $vsUser, $vsPass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

mt_srand(7);
$TODAY = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) getenv('CHB_VOLUME_TODAY'))
    ? (string) getenv('CHB_VOLUME_TODAY')
    : (new DateTime('now', new DateTimeZone('Europe/London')))->format('Y-m-d');
$VS_COUNTS = [];

function vs_d($s, $n) { return date('Y-m-d', (int) strtotime($s . ' ' . ($n >= 0 ? '+' : '') . $n . ' days')); }
function vs_dt($s, $n, $h = 12) { return date('Y-m-d H:i:s', (int) strtotime($s . ' ' . ($n >= 0 ? '+' : '') . $n . ' days') + $h * 3600 + mt_rand(0, 3599)); }
function vs_pick($a) { return $a[mt_rand(0, count($a) - 1)]; }
function vs_wpick($w) { $t = array_sum($w); $r = mt_rand(1, $t); foreach ($w as $k => $v) { $r -= $v; if ($r <= 0) { return $k; } } return array_key_first($w); }
// Hex from the seeded generator, so a token or an id is the same every run.
function vs_hex($n) { $s = ''; while (strlen($s) < $n) { $s .= hash('sha256', mt_rand() . '|' . mt_rand()); } return substr($s, 0, $n); }
function vs_ins(PDO $db, $table, array $cols, array $rows, $chunk = 400)
{
    $n = 0;
    foreach (array_chunk($rows, $chunk) as $ch) {
        $ph = '(' . implode(',', array_fill(0, count($cols), '?')) . ')';
        $sql = 'INSERT INTO ' . $table . ' (' . implode(',', $cols) . ') VALUES ' . implode(',', array_fill(0, count($ch), $ph));
        $vals = [];
        foreach ($ch as $r) { foreach ($r as $v) { $vals[] = $v; } }
        $db->prepare($sql)->execute($vals);
        $n += count($ch);
    }
    return $n;
}
function vs_words($n)
{
    static $w = ['lovely','cottage','stay','thank','you','for','the','wonderful','time','we','had','beach','walk','seals','harbour','quay','dog','parking','wifi','check','in','out','early','late','arrive','leave','key','safe','code','towels','heating','boiler','kitchen','garden','pub','marsh','tide','boat','trip','weekend','week','family','friends','anniversary','birthday','quiet','cosy','clean','spotless','comfortable','bed','view','window','light','fire','log','burner','coffee','milk','bread','welcome','hamper','directions','postcode','sat','nav','train','station','norwich','sheringham','holt','cley','morston','wells','return','again','next','year','summer','winter','spring','autumn','christmas','easter','half','term','availability','price','discount','deposit','balance','refund','question','please','could','would','is','there','any','chance'];
    $o = [];
    for ($i = 0; $i < $n; $i++) { $o[] = $w[mt_rand(0, count($w) - 1)]; }
    return ucfirst(implode(' ', $o)) . '.';
}

$START = vs_d($TODAY, -1826);
$END = vs_d($TODAY, 294);
$Y1 = (int) substr($TODAY, 0, 4);
$Y0 = $Y1 - 1;
$Y2 = $Y1 + 1;
$FIRST = ['Sarah','James','Emma','Oliver','Sophie','Harry','Charlotte','George','Amelia','Jack','Olivia','Thomas','Lucy','William','Hannah','Daniel','Grace','Samuel','Chloe','Benjamin','Ella','Joseph','Megan','Alexander','Laura','Matthew','Rebecca','Edward','Katie','Henry','Jessica','Luke','Rachel','Adam','Helen','Richard','Claire','Peter','Alice','David','Ruth','Michael','Fiona','Andrew','Jane','Paul','Tina','Mark','Wren','Priya'];
$LAST = ['Smith','Jones','Taylor','Brown','Williams','Wilson','Johnson','Davies','Robinson','Wright','Thompson','Evans','Walker','White','Roberts','Green','Hall','Wood','Jackson','Clarke','Patel','Hughes','Edwards','Turner','Harris','Martin','Cooper','Hill','Ward','Morris','Moore','Clark','Lee','King','Baker','Harrison','Morgan','Allen','James','Scott','Phillips','Watson','Davis','Parker','Price','Bennett','Young','Griffiths','Mitchell','Kelly'];
$TOWNS = ['London','Norwich','Cambridge','Leeds','York','Bristol','Oxford','Nottingham','Leicester','Ipswich','Colchester','Peterborough','Reading','Bath','Manchester'];
$PC = ['NR2 1AB','CB1 2CD','LS1 3EF','YO1 4GH','BS1 5IJ','OX1 6KL','NG1 7MN','LE1 8OP','IP1 9QR','CO1 1ST','PE1 2UV','RG1 3WX','BA1 4YZ','M1 5AB','SW1A 1AA'];

// ---- identities -------------------------------------------------------------
$ids = [];
for ($i = 0; $i < 1250; $i++) {
    $f = vs_pick($FIRST); $l = vs_pick($LAST);
    $ids[] = [
        'name' => "$f $l",
        'email' => strtolower($f . '.' . $l . $i . '@' . vs_pick(['gmail.com','hotmail.co.uk','outlook.com','icloud.com','btinternet.com','yahoo.co.uk'])),
        'phone' => '077009' . str_pad((string) mt_rand(0, 99999), 5, '0', STR_PAD_LEFT),
        'address' => mt_rand(1, 120) . ' ' . vs_pick(['High Street','Church Lane','Mill Road','Station Road','The Green','Park Avenue','Queens Road']) . ', ' . vs_pick($TOWNS),
        'postcode' => vs_pick($PC),
    ];
}

// ---- admins ----------------------------------------------------------------
$hash = password_hash(VS_PASSWORD, PASSWORD_DEFAULT);
$db->exec('DELETE FROM admins');
vs_ins($db, 'admins', ['id','username','password_hash','name','email','full_access','caps','created_at','last_seen_at'], [
    [1, 'owner', $hash, 'George', 'george@example.co.uk', 1, '', '2021-10-01 10:00:00', $TODAY . ' 09:00:00'],
    [2, 'sophia', $hash, 'Sophia', 'sophia@example.co.uk', 0, '', '2022-03-01 10:00:00', $TODAY . ' 08:00:00'],
]);

// ---- bookings --------------------------------------------------------------
$PROPS = ['21a' => 130, 'jollyboat' => 110, 'pimpernel' => 120];
$bookings = [];
$bid = 0;
$used = []; // identity index -> count
foreach ($PROPS as $pk => $rate) {
    $cur = vs_d($START, mt_rand(0, 3));
    while ($cur < $END) {
        $future = $cur > $TODAY;
        $nights = vs_wpick([2 => 30, 3 => 35, 4 => 20, 5 => 7, 7 => 8]);
        $gap = vs_wpick([0 => 50, 1 => 30, 2 => 12, 3 => 5, 5 => 3]);
        if ($future) { $gap += mt_rand(0, 9); }
        $ci = $cur; $co = vs_d($ci, $nights);
        $cur = vs_d($co, $gap);
        if ($future && $ci > vs_d($TODAY, 290)) { continue; }
        $bid++;
        // 30% repeat guests
        if (mt_rand(1, 100) <= 30 && $used) {
            $gi = array_rand($used);
        } else {
            $gi = mt_rand(0, count($ids) - 1);
        }
        $used[$gi] = ($used[$gi] ?? 0) + 1;
        $g = $ids[$gi];
        $lead = vs_wpick([7 => 10, 21 => 20, 45 => 25, 90 => 25, 150 => 15, 240 => 5]) + mt_rand(0, 14);
        $created = vs_dt($ci, -$lead, 10);
        if ($created > $TODAY . ' 09:00:00') { $created = vs_dt($TODAY, -mt_rand(1, 60), 10); }
        $m = (int) substr($ci, 5, 2);
        $factor = in_array($m, [7, 8], true) ? 1.35 : (in_array($m, [6, 9, 12], true) ? 1.15 : 1.0);
        $perNight = round($rate * $factor, 2);
        $nightly = round($perNight * $nights, 2);
        $txn = round($nightly * 0.03, 2);
        $total = round($nightly + $txn, 2);
        $method = vs_wpick(['Square card' => 70, 'Bank transfer' => 20, 'Cash' => 10]);
        $past = $co <= $TODAY;
        $soon = !$past && $ci <= vs_d($TODAY, 30);
        if ($past) { $pay = 'paid'; }
        elseif ($soon) { $pay = mt_rand(1, 100) <= 85 ? 'paid' : 'deposit'; }
        else { $pay = mt_rand(1, 100) <= 75 ? 'deposit' : 'unpaid'; }
        $dep = round($total * 0.25, 2);
        if ($pay === 'paid') { $paid = $total; } elseif ($pay === 'deposit') { $paid = $dep; } else { $paid = 0.0; }
        $hold = 'none'; $holdAmt = null; $holdPid = null; $holdSettled = null; $last4 = null; $brand = null;
        if ($method === 'Square card' && $paid > 0) {
            $holdPid = 'sqdep_' . $bid; $holdAmt = 75.0; $last4 = (string) mt_rand(1000, 9999); $brand = vs_pick(['VISA','MASTERCARD','AMEX']);
            if ($past) {
                if ($co >= vs_d($TODAY, -5)) { $hold = 'charged'; }
                else { $r = mt_rand(1, 100); $hold = $r <= 96 ? 'returned' : 'kept'; $holdSettled = vs_dt($co, 3, 11); }
            } else { $hold = 'charged'; }
        } elseif ($paid > 0 && $pay === 'paid') {
            $paid = round($total + 75, 2); // cash/bank: deposit above the rental
        }
        $payDate = $paid > 0 ? ($pay === 'paid' ? vs_d($ci, -30 > -$lead ? -30 : -max(1, (int) ($lead / 2))) : substr($created, 0, 10)) : null;
        if ($payDate && $payDate > $TODAY) { $payDate = $TODAY; }
        $autopay = mt_rand(1, 100) <= 20 && $method === 'Square card';
        $b = [
            'id' => $bid, 'prop_key' => $pk, 'name' => $g['name'], 'email' => mt_rand(1, 100) <= 96 ? $g['email'] : null,
            'phone' => $g['phone'], 'address' => $g['address'], 'postcode' => $g['postcode'],
            'check_in' => $ci, 'check_out' => $co, 'adults' => $pk === 'pimpernel' ? mt_rand(1, 3) : mt_rand(1, 2), 'children' => $pk === 'pimpernel' ? mt_rand(0, 1) : 0,
            'notes' => mt_rand(1, 100) <= 30 ? vs_words(mt_rand(8, 30)) : null,
            'payment' => $pay, 'deposit_paid' => $paid, 'payment_method' => $paid > 0 ? $method : null, 'payment_date' => $payDate,
            'agreed_total' => $total, 'agreed_per_night' => $perNight, 'agreed_nights' => $nights, 'agreed_nightly' => $nightly,
            'agreed_booking_fee' => 75.00, 'agreed_txn_pct' => 3.00, 'agreed_txn_fee' => $txn, 'agreed_on' => substr($created, 0, 10),
            'price_override' => mt_rand(1, 100) <= 4 ? round($total * 0.9, 2) : null,
            'terms_accepted_at' => $created, 'terms_version' => '2026-08b', 'no_dogs_at' => $created,
            'hold_payment_id' => $holdPid, 'hold_status' => $hold, 'hold_amount' => $holdAmt, 'hold_settled_at' => $holdSettled,
            'card_last4' => $last4, 'card_brand' => $brand, 'created_at' => $created,
            'deposit_requested_at' => $created,
            'balance_requested_at' => ($past || $soon) ? vs_dt($ci, -30, 9) : null,
            'pre_arrival_sent' => $past ? vs_dt($ci, -7, 8) : null,
            'review_request_sent' => $past ? vs_dt($co, 2, 10) : null,
            'thankyou_sent' => $past ? vs_dt($co, 1, 10) : null,
            'guest_checked_out_at' => ($past && mt_rand(1, 100) <= 30) ? $co . ' 09:4' . mt_rand(0, 9) . ':00' : null,
            'autopay_consent_at' => $autopay ? $created : null,
            'autopay_card_id' => $autopay ? 'ccof:' . md5((string) $bid) : null,
            'autopay_amount' => $autopay ? round($total - $dep, 2) : null,
            'autopay_due' => $autopay ? vs_d($ci, -30) : null,
            'autopay_customer_id' => $autopay ? 'CUST' . $bid : null,
            'autopay_collected_for' => ($autopay && vs_d($ci, -30) <= $TODAY) ? vs_d($ci, -30) : null,
            'sms_opt_in' => mt_rand(0, 1),
        ];
        $bookings[] = $b;
    }
}
usort($bookings, fn($a, $b) => strcmp($a['check_in'], $b['check_in']));
$cols = array_keys($bookings[0]);
$rows = array_map(fn($b) => array_values($b), $bookings);
$VS_COUNTS['bookings'] = vs_ins($db, 'bookings', $cols, $rows);

// ---- payments ----------------------------------------------------------------
$pay = [];
foreach ($bookings as $b) {
    if ($b['deposit_paid'] <= 0) { continue; }
    $isCard = $b['payment_method'] === 'Square card';
    $dep = round($b['agreed_total'] * 0.25, 2);
    $c0 = $b['created_at'];
    if ($isCard) {
        $pay[] = [$b['id'], 'sqdep_' . $b['id'], 'deposit', $dep, round(($dep + 75) * 0.0175, 2), 'COMPLETED', date('Y-m-d H:i:s', strtotime($c0) + 3600), null, $b['name'], $b['prop_key']];
        if ($b['payment'] === 'paid') {
            $bal = round($b['agreed_total'] - $dep, 2);
            $when = min(vs_dt($b['check_in'], -30, 12), $b['check_in'] . ' 08:00:00');
            if ($when < $c0) { $when = date('Y-m-d H:i:s', strtotime($c0) + 7200); }
            $pay[] = [$b['id'], 'sqbal_' . $b['id'], 'balance', $bal, round($bal * 0.0175, 2), 'COMPLETED', $when, null, $b['name'], $b['prop_key']];
        }
        if ($b['hold_status'] === 'returned') {
            $pay[] = [$b['id'], 'sqret_' . $b['id'], 'damages_return', 75.00, null, 'COMPLETED', $b['hold_settled_at'], 'Deposit returned', $b['name'], $b['prop_key']];
        }
    } else {
        $pay[] = [$b['id'], 'manual-' . substr(md5('m1' . $b['id']), 0, 16), 'manual', $b['payment'] === 'paid' ? $b['agreed_total'] : $dep, null, 'MANUAL', $b['payment_date'] . ' 12:00:00', $b['payment_method'], $b['name'], $b['prop_key']];
    }
}
// cancelled stays: ledger rows for bookings no longer in the table
$maxId = $bid;
for ($i = 0; $i < 70; $i++) {
    $cid = $maxId + 1000 + $i;
    $when = vs_dt($START, mt_rand(10, 1800), 12);
    $amt = round(mt_rand(80, 300), 2);
    $pk = vs_pick(array_keys($PROPS));
    $nm = vs_pick($ids)['name'];
    $pay[] = [$cid, 'sqdep_c' . $cid, 'deposit', $amt, round(($amt + 75) * 0.0175, 2), 'COMPLETED', $when, null, $nm, $pk];
    $pay[] = [$cid, 'sqref_c' . $cid, 'refund', round($amt * (mt_rand(0, 1) ? 1 : 0.5), 2), null, 'COMPLETED', date('Y-m-d H:i:s', strtotime($when) + 86400 * mt_rand(3, 60)), 'Cancellation refund', $nm, $pk];
}
$VS_COUNTS['payments'] = vs_ins($db, 'payments', ['booking_id','square_payment_id','kind','amount','fee','status','created_at','note','guest_name','prop_key'], $pay);

// ---- guests (accounts) -----------------------------------------------------
$gRows = [];
$guestIdByEmail = [];
$gid = 0;
foreach ($ids as $i => $g) {
    if (!isset($used[$i]) && mt_rand(1, 100) > 15) { continue; }
    if (mt_rand(1, 100) > 75) { continue; }
    $gid++;
    $guestIdByEmail[$g['email']] = $gid;
    $gRows[] = [$gid, $g['name'], $g['email'], $g['phone'], $g['address'], $g['postcode'], $hash, vs_dt($START, mt_rand(0, 1800), 10), vs_dt($START, mt_rand(0, 1800), 9), mt_rand(1, 100) <= 15 ? substr(md5((string) $gid), 0, 10) : null];
}
$VS_COUNTS['guests'] = vs_ins($db, 'guests', ['id','name','email','phone','address','postcode','password_hash','email_verified_at','created_at','avatar'], $gRows);

// ---- activity_log (3 years kept) -----------------------------------------
$al = [];
$since3 = vs_d($TODAY, -1095);
foreach ($bookings as $b) {
    if ($b['created_at'] < $since3 . ' 00:00:00') { continue; }
    $e = ['entity' => 'booking', 'id' => (string) $b['id'], 'pk' => $b['prop_key']];
    $al[] = [$b['created_at'], 'admin:1', 'booking', 'booking.add', 'Booking added — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
    $al[] = [date('Y-m-d H:i:s', strtotime($b['created_at']) + 60), 'admin:1', 'comms', 'email.confirmation', 'Booking confirmation emailed — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
    $al[] = [date('Y-m-d H:i:s', strtotime($b['created_at']) + 120), 'admin:1', 'payment', 'payment.request', 'Deposit request emailed — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
    if ($b['deposit_paid'] > 0) {
        $al[] = [date('Y-m-d H:i:s', strtotime($b['created_at']) + 3600), 'guest:0', 'payment', 'payment.card', 'Card payment received — £' . $b['agreed_total'], $b['prop_key'], 'booking', (string) $b['id'], json_encode(['amount' => $b['agreed_total']]), 'info'];
    }
    if ($b['pre_arrival_sent']) {
        $al[] = [$b['pre_arrival_sent'], 'cron', 'comms', 'email.arrival', 'Arrival info emailed — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
        $al[] = [$b['review_request_sent'], 'cron', 'comms', 'email.review', 'Review request emailed — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
        $al[] = [$b['thankyou_sent'], 'cron', 'comms', 'email.thankyou', 'Thank-you emailed — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
    }
    if ($b['hold_status'] === 'returned' && $b['hold_settled_at']) {
        $al[] = [$b['hold_settled_at'], 'admin:1', 'payment', 'deposit.return', 'Damage deposit returned — £75.00', $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
    }
    if (mt_rand(1, 100) <= 25) {
        $al[] = [date('Y-m-d H:i:s', strtotime($b['created_at']) + 86400 * mt_rand(1, 20)), 'admin:1', 'comms', 'booking.email', 'Emailed guest — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], json_encode(['subject' => 'Your stay at ' . $b['prop_key'], 'body' => vs_words(mt_rand(40, 160))]), 'info'];
    }
    if (mt_rand(1, 100) <= 40) {
        $al[] = [date('Y-m-d H:i:s', strtotime($b['created_at']) + 86400 * mt_rand(1, 30)), 'admin:1', 'booking', 'booking.update', 'Booking updated — ' . $b['name'], $b['prop_key'], 'booking', (string) $b['id'], null, 'info'];
    }
}
// Background activity to reach ~40k rows over 3 years.
$other = [
    ['account', 'admin.login', 'Signed in', 'admin', '1'],
    ['calendar', 'ical.sync', 'Calendar synced', null, null],
    ['system', 'cron.run', 'Daily jobs ran', null, null],
    ['content', 'content.set', 'Website content updated: hero-title', 'content', 'hero-title'],
    ['comms', 'message.guest', 'New chat message from a visitor', 'thread', '12'],
    ['enquiry', 'enquiry.submit', 'New enquiry', 'enquiry', '55'],
    ['enquiry', 'enquiry.decline', 'Enquiry declined', 'enquiry', '56'],
    ['system', 'email.outbox', 'Queued email retried', null, null],
    ['account', 'customer.lookup', 'Looked up a customer', 'customer', 'x'],
    ['system', 'selfrepair.cache_pruned', 'Image cache pruned', null, null],
];
$target = 40000;
$need = $target - count($al) - 1800;
for ($i = 0; $i < $need; $i++) {
    $o = vs_pick($other);
    $sev = mt_rand(1, 1000) <= 15 ? 'warn' : 'info';
    $al[] = [vs_dt($since3, mt_rand(0, 1094), mt_rand(7, 22)), $o[0] === 'account' ? 'admin:1' : 'system', $o[0], $o[1], $o[2], null, $o[3], $o[4] === '12' ? (string) mt_rand(1, 800) : ($o[4] === '55' || $o[4] === '56' ? (string) mt_rand(1, 3000) : $o[4]), null, $sev];
}
// noise within 30 days (cap 2000)
for ($i = 0; $i < 1800; $i++) {
    $act = vs_pick(['csp.violation', 'request.blocked', 'client.error', 'client.swallow']);
    $al[] = [vs_dt($TODAY, -mt_rand(0, 29), mt_rand(0, 23)), 'system', 'system', $act, 'CSP blocked connect-src → https://x' . mt_rand(1, 40) . '.example', null, null, null, json_encode(['ua' => 'Mozilla/5.0', 'uri' => 'https://example/' . mt_rand(1, 999)]), mt_rand(1, 10) <= 3 ? 'warn' : 'info'];
}
usort($al, fn($a, $b) => strcmp($a[0], $b[0]));
$VS_COUNTS['activity_log'] = vs_ins($db, 'activity_log', ['created_at','actor','category','action','summary','prop_key','entity','entity_id','meta','severity'], $al, 500);

// ---- chat threads + messages ------------------------------------------------
$threads = []; $msgs = [];
$gEmails = array_keys($guestIdByEmail);
for ($t = 1; $t <= 800; $t++) {
    $start = vs_dt($START, mt_rand(0, 1825), mt_rand(8, 22));
    $isGuest = mt_rand(1, 100) <= 40;
    $em = $isGuest ? vs_pick($gEmails) : (mt_rand(1, 100) <= 70 ? vs_pick($ids)['email'] : '');
    $gidT = $isGuest ? $guestIdByEmail[$em] : null;
    $n = mt_rand(2, 12);
    $at = strtotime($start);
    $last = $start;
    for ($k = 0; $k < $n; $k++) {
        $role = $k % 2 === 0 ? 'guest' : 'admin';
        $at += mt_rand(60, 86400);
        $last = date('Y-m-d H:i:s', min($at, strtotime($TODAY . ' 08:00:00')));
        $recent = $last > vs_d($TODAY, -3);
        $msgs[] = [$t, $gidT, $role, vs_words(mt_rand(6, 50)), ($role === 'guest' && $recent && $k === $n - 1) ? 0 : 1, 1, $last];
    }
    $threads[] = [$t, $gidT, $isGuest ? null : vs_hex(32), vs_pick($FIRST) . ' ' . vs_pick($LAST), $em, vs_pick(['google', 'direct', 'airbnb', '']), vs_pick(['Norwich, GB', 'London, GB', '']), 'Mozilla/5.0 (iPhone)', $start, $last, $last < vs_d($TODAY, -120) && mt_rand(1, 100) <= 50 ? 1 : 0];
}
$VS_COUNTS['chat_threads'] = vs_ins($db, 'chat_threads', ['id','guest_id','token','name','email','source','location','user_agent','created_at','updated_at','archived'], $threads);
$VS_COUNTS['messages'] = vs_ins($db, 'messages', ['thread_id','guest_id','sender_role','body','read_by_admin','read_by_guest','created_at'], $msgs, 500);

// ---- enquiries (declined history + pending) ---------------------------------
$enq = [];
for ($i = 0; $i < 3000; $i++) {
    $pending = $i >= 2980;
    $c = $pending ? vs_dt($TODAY, -mt_rand(0, 6), 10) : vs_dt($START, mt_rand(0, 1820), 10);
    $ci = vs_d(substr($c, 0, 10), mt_rand(10, 200));
    $g = vs_pick($ids);
    $enq[] = [vs_pick(array_keys($PROPS)), $g['name'], $g['email'], $g['phone'], $g['address'], $g['postcode'], $ci, vs_d($ci, mt_rand(2, 7)), mt_rand(1, 2), 0, vs_words(mt_rand(10, 60)), $c, '2026-08b', $c, $c, $pending ? null : date('Y-m-d H:i:s', strtotime($c) + 86400 * mt_rand(0, 3)), $pending ? null : $c];
}
$VS_COUNTS['enquiries'] = vs_ins($db, 'enquiries', ['prop_key','name','email','phone','address','postcode','check_in','check_out','adults','children','message','terms_accepted_at','terms_version','no_dogs_at','created_at','declined_at','seen_at'], $enq);

// ---- bank imports + lines --------------------------------------------------
$imps = []; $lines = [];
for ($m = 0; $m < 60; $m++) {
    $from = date('Y-m-01', strtotime($START . " +$m months"));
    $to = date('Y-m-t', strtotime($from));
    $imps[] = [$m + 1, "monzo-$from.csv", $from, $to, 100, 100, 0, 5000, 3000, 2500 + mt_rand(0, 5000), $to . ' 23:00:00', 1, $to . ' 23:30:00'];
    for ($k = 0; $k < 100; $k++) {
        $day = vs_d($from, mt_rand(0, 27));
        $kind = vs_wpick(['square' => 45, 'expense' => 25, 'pot' => 10, 'payment' => 10, 'person' => 5, 'ignore' => 5]);
        $amt = $kind === 'square' ? mt_rand(150, 1500) : ($kind === 'expense' ? -mt_rand(5, 400) : ($kind === 'pot' ? (mt_rand(0, 1) ? 1 : -1) * mt_rand(100, 2000) : ($kind === 'payment' ? mt_rand(100, 900) : -mt_rand(200, 1200))));
        $sorted = ($m >= 58 && mt_rand(1, 100) <= 10) ? null : $kind;
        $lines[] = ['m:tx_' . $m . '_' . $k . '_' . mt_rand(1000, 9999), $m + 1, $day, sprintf('%02d:%02d:00', mt_rand(0, 23), mt_rand(0, 59)), $kind === 'square' ? 'Faster payment' : 'Card payment', $kind === 'square' ? 'SQUARE' : vs_pick(['Tesco', 'Screwfix', 'Anglian Water', 'EDF', 'Laundry Co', 'G Farrow-Green', 'Savings pot']), vs_pick(['general', 'bills', 'shopping', 'income']), 'Ref ' . mt_rand(10000, 99999), '', $amt, 1000 + mt_rand(0, 9000), $sorted, $sorted === 'payment' ? mt_rand(1, $bid) : null, null, $sorted ? ucfirst($kind) : null, $sorted ? $day . ' 20:00:00' : null, $sorted === 'person' ? 2 : null, $sorted === 'payment' ? vs_pick(array_keys($PROPS)) : null];
    }
}
vs_ins($db, 'bank_imports', ['id','filename','from_date','to_date','rows_in_file','added','skipped','money_in','money_out','closing_balance','closing_at','admin_id','created_at'], $imps);
$VS_COUNTS['bank_lines'] = vs_ins($db, 'bank_lines', ['ext_key','import_id','txn_date','txn_time','kind','name','category','description','notes','amount','balance','sorted_as','booking_id','expense_id','sorted_label','sorted_at','admin_id','prop_key'], $lines);

// ---- expenses ----------------------------------------------------------------
$ex = [];
for ($i = 0; $i < 400; $i++) {
    $ex[] = [vs_pick(['Cleaning', 'Laundry', 'Repairs', 'Utilities', 'Insurance', 'Supplies', 'Marketing']), vs_words(4), mt_rand(10, 800), mt_rand(1, 100) <= 70 ? vs_pick(array_keys($PROPS)) : null, vs_d($START, mt_rand(0, 1825)), mt_rand(1, 100) <= 10 ? 1 : 0];
}
$VS_COUNTS['expenses'] = vs_ins($db, 'expenses', ['category','description','amount','prop_key','expense_date','recurring'], $ex);

// ---- mail_sent + outbox -----------------------------------------------------
$ms = [];
for ($i = 0; $i < 2000; $i++) {
    $ms[] = [vs_pick($ids)['email'], null, 'Re: your stay ' . mt_rand(1, 999), vs_words(mt_rand(30, 200)), vs_dt($START, mt_rand(0, 1825), mt_rand(8, 21))];
}
usort($ms, fn($a, $b) => strcmp($a[4], $b[4]));
$VS_COUNTS['mail_sent'] = vs_ins($db, 'mail_sent', ['to_email','cc_email','subject','body','sent_at'], $ms);
$ob = [];
for ($i = 0; $i < 60; $i++) {
    $c = vs_dt($TODAY, -mt_rand(0, 6), 10);
    $ob[] = [$c, $c, 1, 'owner-alert', vs_pick($ids)['email'], 'Guest', 'Subject ' . $i, vs_words(80), '<p>' . vs_words(80) . '</p>', null, null, null, null, '', null, mt_rand(1, 100) <= 90 ? $c : null, null];
}
vs_ins($db, 'email_outbox', ['created_at','next_try_at','tries','context','to_email','to_name','subject','body_text','body_html','reply_to','message_id','extra_headers','attachments','last_error','ref','sent_at','gave_up_at'], $ob);

// ---- reviews, leads, ratings, registrations, waitlist ----------------------
$gr = [];
$seen = [];
foreach ($bookings as $b) {
    if ($b['check_out'] > $TODAY || !$b['email'] || !isset($guestIdByEmail[$b['email']])) { continue; }
    $k = $guestIdByEmail[$b['email']] . '|' . $b['prop_key'];
    if (isset($seen[$k]) || mt_rand(1, 100) > 45) { continue; }
    $seen[$k] = 1;
    $gr[] = [$guestIdByEmail[$b['email']], $b['prop_key'], mt_rand(4, 5), vs_words(mt_rand(20, 70)), mt_rand(1, 100) <= 85 ? 'approved' : 'pending', vs_dt($b['check_out'], 3, 10)];
}
$VS_COUNTS['guest_reviews'] = vs_ins($db, 'guest_reviews', ['guest_id','prop_key','stars','review_text','status','created_at'], $gr);
$dl = [];
for ($i = 0; $i < 150; $i++) {
    $g = vs_pick($ids);
    $dl[] = [vs_pick(array_keys($PROPS)), $g['name'], $g['email'], mt_rand(4, 5), vs_words(mt_rand(20, 70)), 'direct', mt_rand(1, 100) <= 70 ? 'approved' : 'pending', vs_dt($START, mt_rand(0, 1825), 10)];
}
$VS_COUNTS['direct_leads'] = vs_ins($db, 'direct_leads', ['prop_key','name','email','stars','review_text','source','status','created_at'], $dl);
$rt = []; $rg = [];
foreach ($bookings as $b) {
    if ($b['check_out'] <= $TODAY && mt_rand(1, 100) <= 50) {
        $rt[] = [$b['id'], mt_rand(3, 5), vs_pick(['', 'good', 'poor']), vs_pick(['', 'good']), vs_pick(['', 'good']), mt_rand(1, 100) <= 30 ? vs_words(10) : null, vs_dt($b['check_out'], 2, 10)];
    }
    if ($b['check_out'] >= vs_d($TODAY, -365) && $b['check_in'] <= vs_d($TODAY, 60)) {
        $rg[] = [$b['id'], base64_encode(str_repeat(vs_hex(40), 4)), $b['adults'], vs_dt($b['check_in'], -5, 10), vs_dt($b['check_in'], -5, 10), vs_d($b['check_out'], 365)];
    }
}
$VS_COUNTS['guest_ratings'] = vs_ins($db, 'guest_ratings', ['booking_id','overall','clean','rules','comms','note','rated_at'], $rt);
$VS_COUNTS['guest_registrations'] = vs_ins($db, 'guest_registrations', ['booking_id','party_enc','guest_count','submitted_at','updated_at','expires_at'], $rg);
$wl = [];
$wk = [];
for ($i = 0; $i < 400; $i++) {
    $g = vs_pick($ids);
    $ci = vs_d($START, mt_rand(30, 2050));
    $pk = vs_pick(array_keys($PROPS));
    $k = "$pk|{$g['email']}|$ci";
    if (isset($wk[$k])) { continue; }
    $wk[$k] = 1;
    $wl[] = [$pk, $g['name'], $g['email'], $ci, vs_d($ci, mt_rand(2, 7)), null, $ci < $TODAY && mt_rand(1, 100) <= 40 ? vs_dt($ci, -20, 9) : null, vs_dt($ci, -mt_rand(20, 120), 10)];
}
$VS_COUNTS['waitlist'] = vs_ins($db, 'waitlist', ['prop_key','name','email','check_in','check_out','note','notified_at','created_at'], $wl);

// ---- ical blocks (feed window) ---------------------------------------------
$ib = [];
foreach (array_keys($PROPS) as $pk) {
    foreach (['airbnb', 'bookingcom'] as $src) {
        for ($i = 0; $i < 40; $i++) {
            $ci = vs_d($TODAY, mt_rand(-60, 330));
            $ib[] = [$pk, $src, 'uid-' . md5($pk . $src . $i) . '@airbnb.com', $ci, vs_d($ci, mt_rand(2, 6)), vs_pick(['booking', 'blocked']), 'Reserved'];
        }
    }
    for ($i = 0; $i < 6; $i++) {
        $ci = vs_d($TODAY, mt_rand(0, 300));
        $ib[] = [$pk, 'owner', null, $ci, vs_d($ci, mt_rand(1, 4)), 'blocked', 'Maintenance'];
    }
}
$VS_COUNTS['ical_blocks'] = vs_ins($db, 'ical_blocks', ['prop_key','source','uid','check_in','check_out','kind','label'], $ib);

// ---- seasons (pruned to a year back) ----------------------------------------
$rs = [];
foreach (array_keys($PROPS) as $pk) {
    foreach (["$Y0-12-20|$Y1-01-03|Christmas", "$Y1-07-15|$Y1-09-01|Summer", "$Y1-12-19|$Y2-01-02|Christmas", "$Y2-03-28|$Y2-04-11|Easter", "$Y2-07-14|$Y2-08-31|Summer", "$Y2-05-22|$Y2-05-31|Half term"] as $s) {
        [$a, $bb, $l] = explode('|', $s);
        $rs[] = [$pk, $l, $a, $bb, mt_rand(140, 200)];
    }
    for ($i = 0; $i < 8; $i++) {
        $a = vs_d($TODAY, mt_rand(-300, 200));
        $rs[] = [$pk, vs_pick(['Gap offer', 'Busy week', 'Sunny weekend']), $a, vs_d($a, mt_rand(2, 5)), mt_rand(90, 180)];
    }
}
$VS_COUNTS['rate_seasons'] = vs_ins($db, 'rate_seasons', ['prop_key','label','start_date','end_date','couple_rate'], $rs);

// ---- analytics (180 days kept) -----------------------------------------------
$pv = [];
for ($i = 0; $i < 54000; $i++) {
    $pv[] = [mt_rand(1, 100) <= 40 ? vs_pick(array_keys($PROPS)) : null, vs_pick(['/', '/cottages/jollyboat', '/cottages/21a-westgate', '/cottages/pimpernel', '/experiences']), vs_pick(['google.com', 'airbnb.co.uk', null, null, 'facebook.com']), hash('sha256', (string) mt_rand(1, 9000)), vs_dt($TODAY, -mt_rand(0, 179), mt_rand(0, 23)), mt_rand(1, 100) <= 10 ? vs_pick(['enquiry_submit', 'chat_open', 'date_search']) : null, vs_pick(['google', 'direct', 'social']), vs_pick(['mobile', 'desktop'])];
}
$VS_COUNTS['pageviews'] = vs_ins($db, 'pageviews', ['prop_key','path','referrer_host','ip_hash','created_at','event','source','device'], $pv, 1000);
$sl = [];
for ($i = 0; $i < 5400; $i++) {
    $c = vs_dt($TODAY, -mt_rand(0, 179), mt_rand(0, 23));
    $sl[] = [vs_pick(['exact', 'flex']), 2, 0, mt_rand(2, 7), date('Y-m', strtotime($c . ' +' . mt_rand(0, 8) . ' months')), vs_d(substr($c, 0, 10), mt_rand(5, 200)), mt_rand(0, 3), mt_rand(0, 1), hash('sha256', (string) mt_rand(1, 9000)), $c];
}
$VS_COUNTS['search_log'] = vs_ins($db, 'search_log', ['mode','adults','children','nights','month','check_in','results','found','ip_hash','created_at'], $sl, 1000);


// ---- newsletter, push, photos, op ledger -------------------------------------
$nl = [];
$nk = [];
for ($i = 0; $i < 900; $i++) {
    $e = vs_pick($ids)['email'];
    if (isset($nk[$e])) { continue; }
    $nk[$e] = 1;
    $nl[] = [$e, null, vs_hex(32), 'footer', vs_dt($START, mt_rand(0, 1825), 10), mt_rand(1, 100) <= 10 ? vs_dt($TODAY, -mt_rand(1, 400), 10) : null];
}
$VS_COUNTS['newsletter'] = vs_ins($db, 'newsletter_subscribers', ['email','name','token','source','created_at','unsubscribed_at'], $nl);
$ps = [];
for ($i = 1; $i <= 300; $i++) { $ps[] = [mt_rand(1, $gid), 'https://web.push.apple.com/' . vs_hex(40), 'p', 'a', vs_dt($START, mt_rand(0, 1825), 10), 'guest', null]; }
$ps[] = [null, 'https://web.push.apple.com/owner1', 'p', 'a', vs_dt($TODAY, -100, 10), 'admin', 1];
vs_ins($db, 'push_subscriptions', ['guest_id','endpoint','p256dh','auth','created_at','role','admin_id'], $ps);
$ph = [];
for ($i = 0; $i < 120; $i++) { $ph[] = [vs_pick(array_keys($PROPS)), mt_rand(1, $gid), vs_pick($FIRST), 'uploads/gp_' . $i . '.jpg', vs_words(5), vs_pick(['approved', 'approved', 'pending', 'rejected']), vs_dt($START, mt_rand(0, 1825), 10)]; }
vs_ins($db, 'guest_photos', ['prop_key','guest_id','guest_name','url','caption','status','created_at'], $ph);
$ol = [];
for ($i = 0; $i < 300; $i++) { $ol[] = ['k' . vs_hex(40), json_encode(['ok' => true]), vs_dt($TODAY, -mt_rand(0, 29), 10)]; }
vs_ins($db, 'op_ledger', ['op_id','response','created_at'], $ol);

// ---- content -----------------------------------------------------------------
$c = [];
$put = function ($k, $v) use (&$c) { $c[] = [$k, is_string($v) ? $v : json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]; };
foreach (array_keys($PROPS) as $pk) {
    $put("images-$pk", array_map(fn($i) => "uploads/$pk-$i.jpg", range(1, 16)));
    $put("faqs-$pk", array_map(fn($i) => ['icon' => '🅿️', 'q' => vs_words(6) . '?', 'a' => vs_words(25)], range(1, 10)));
    $put("amenities-$pk", array_map(fn($i) => vs_words(2), range(1, 14)));
    $put("houserules-$pk", array_map(fn($i) => vs_words(8), range(1, 6)));
    $put("rules-$pk", ['minNights' => 2, 'maxNights' => 14, 'arrivalDays' => [1, 2, 3, 4, 5, 6, 0]]);
    $put("$pk-desc", vs_words(120));
    $put("$pk-title", ucfirst($pk));
    $put("ical-status-$pk", ['at' => date('Y-m-d H:i:s', strtotime($TODAY . ' 08:00:00')), 'sources' => [['src' => 'airbnb', 'ok' => true, 'events' => 40, 'ok_at' => $TODAY . ' 08:00:00'], ['src' => 'bookingcom', 'ok' => true, 'events' => 40, 'ok_at' => $TODAY . ' 08:00:00']]]);
}
$put('hero-title', 'Three cottages by the Blakeney marshes');
$put('hero-sub', 'Book direct with the owner');
$put('hero-bg', 'uploads/hero-1.jpg');
$put('host-name', 'George');
$put('contact-phone', '07700900000');
$put('google-review-url', 'https://g.page/r/x');
$put('reviews', array_map(fn($i) => ['name' => vs_pick($FIRST), 'stars' => 5, 'text' => vs_words(mt_rand(30, 90)), 'prop' => vs_pick(array_keys($PROPS)), 'date' => vs_d($START, $i * 12)], range(1, 150)));
// growing internal keys
$put('anniv-sent', (function () use ($bookings, $TODAY) { $o = []; foreach ($bookings as $b) { if ($b['check_out'] < $TODAY) { $o[(string) $b['id']] = vs_d($b['check_out'], 300); } } return (object) $o; })());
$put('mailbox-poll', ['at' => time(), 'uids' => array_map(fn($i) => sprintf('%08X%08X.%d', $i, crc32((string) $i), $i), range(1, 6000)), 'error' => null]);
$put('mailbox-seen', ['uids' => array_map(fn($i) => sprintf('%08X%08X.%d', $i, crc32((string) $i), $i), range(5001, 6000))]);
$put('mailbox-new', array_map(fn($i) => ['uid' => sprintf('%08X%08X.%d', $i, crc32((string) $i), $i), 'from' => 'g' . $i . '@gmail.com', 'name' => 'Guest ' . $i, 'subject' => 'Question ' . $i, 'at' => time() - $i * 3600], range(5990, 6000)));
$charges = [];
for ($i = 0; $i < 700; $i++) { $charges['sq' . vs_hex(20)] = ['payout_id' => 'po' . ($i % 60), 'status' => 'PAID', 'arrival' => vs_d($TODAY, -mt_rand(0, 399)), 'landed' => true, 'fee' => mt_rand(100, 2500) / 100]; }
$payouts = [];
for ($i = 0; $i < 60; $i++) { $payouts[] = ['id' => 'po' . $i, 'status' => 'PAID', 'arrival_date' => vs_d($TODAY, -$i), 'amount' => mt_rand(200, 3000), 'landed_at' => strtotime(vs_d($TODAY, -$i) . ' 12:00:00'), 'entries_read' => true]; }
$put('square-payouts', ['at' => time() - 3600, 'checked' => time() - 3600, 'error' => null, 'payouts' => $payouts, 'charges' => $charges, 'refunds' => [], 'disputes' => ['amount' => 0, 'count' => 0, 'items' => [], 'error' => null], 'payoutFees' => 0, 'truncated' => false, 'location' => 'L1']);
$put('inbox-state', ['since' => (time() - 400 * 86400) * 1000, 'at' => time() * 1000, 'done' => (object) array_combine(array_map(fn($i) => 'e:guest' . $i . '@gmail.com', range(1, 800)), array_fill(0, 800, (time() - 86400) * 1000)), 'remind' => (object) [], 'reminded' => (object) [], 'unread' => (object) [], 'cleared' => (object) [], 'links' => (object) []]);
$put('duty-dismissed', (object) array_combine(array_map(fn($i) => 'register:' . $i, range(1, 150)), array_fill(0, 150, ['sev' => 'warn', 'at' => time()])));
$put('activity-seen', range(1, 400));
$put('email-optout', array_map(fn($i) => $ids[$i]['email'], range(0, 199)));
$put('search-misses', array_map(fn($i) => ['q' => 'query ' . $i, 'n' => mt_rand(1, 5), 'at' => time() - $i * 3600], range(1, 100)));
$put('guest-faq-misses', array_map(fn($i) => ['q' => vs_words(6) . '?', 'n' => mt_rand(1, 5), 'at' => time() - $i * 3600, 'prop' => '21a'], range(1, 40)));
$put('uptime-history', array_map(fn($i) => ['d' => vs_d($TODAY, -$i), 'ok' => 1440, 'bad' => 0], range(0, 89)));
$put('mail-sent-days', (object) array_combine(array_map(fn($i) => vs_d($TODAY, -$i), range(0, 13)), array_fill(0, 14, 9)));
$put('notify-emails', ['owner2@example.co.uk']);
$put('chat-chips', ['hide' => [], 'extra' => array_map(fn($i) => ['id' => 'x' . $i, 'q' => vs_words(5) . '?', 'chip' => 'Q' . $i, 'a' => vs_words(20), 'btn' => true, 'prop' => ''], range(1, 12))]);
$put('bank-statements', ['on' => true, 'remind' => true, 'reminded' => substr($TODAY, 0, 7)]);
$put('cron-last-run', (string) (time() - 3600));
// guest-ping rows: one per guest who ever got a push (never deleted)
for ($i = 1; $i <= 400; $i++) { $put('guest-ping-' . $i, ['title' => 'Your stay', 'body' => vs_words(12), 'url' => './?open=stay', 'at' => time() - mt_rand(86400, 86400 * 900)]); }
$VS_COUNTS['content'] = vs_ins($db, 'content', ['item_key','item_value'], $c, 50);

// ---- real visitors' speed (perf-lib.php: 30 days kept) -----------------------
// About what 300 page views a day send: three in four carry the load figures, the rest
// are later visible stretches (a tap, a shift); one in seven is the back office. LAST, so
// its draws from the seeded generator move nothing seeded before it.
$ps = [];
for ($i = 0; $i < 10500; $i++) {
    $load = mt_rand(1, 100) <= 75;
    $ps[] = [vs_dt($TODAY, -mt_rand(0, 29), mt_rand(0, 23)), mt_rand(1, 100) <= 15 ? 'o' : (mt_rand(1, 100) <= 20 ? 'g' : 'v'), vs_pick(['p', 'p', 'p', 't', 'd']), vs_pick(['s', 's', 'c', 'c', 'f', 'e', 'a']), vs_pick(['h', 'c', 'o']), mt_rand(0, 1), mt_rand(1, 100) <= 10 ? 1 : 0,
        $load ? mt_rand(80, 900) : null, $load ? mt_rand(400, 2600) : null, $load ? mt_rand(600, 4200) : null, $load ? mt_rand(400, 3000) : null, $load ? mt_rand(900, 6000) : null,
        mt_rand(1, 100) <= 60 ? mt_rand(24, 700) : null, $load ? mt_rand(0, 300) : null];
}
$VS_COUNTS['perf_samples'] = vs_ins($db, 'perf_samples', ['created_at', 'kind', 'device', 'browser', 'land', 'early', 'pwa', 'ttfb', 'fcp', 'lcp', 'shown', 'ready', 'inp', 'cls'], $ps, 1000);

echo json_encode(['ok' => true, 'today' => $TODAY, 'counts' => $VS_COUNTS]), "\n";
