<?php
// ============================================================
//  test-integration.php — REAL-STACK integration test (dev/CI only).
//
//      php test-integration.php
//
//  Everything else in CI tests pure functions; this is the one suite that
//  exercises the REAL stack end to end: a FRESH MySQL database, schema.sql,
//  every migration applied by migrate.php over HTTP, then the actual JSON
//  endpoints served by PHP's built-in server — admin session + CSRF, cottage
//  creation, a public enquiry, approval → booking with a locked price
//  snapshot, a recorded payment. It catches the classes nothing else can:
//  migration ordering/SQL that only breaks on a fresh DB, endpoint auth
//  regressions, and money maths drifting between the price model and what a
//  booking actually stores.
//
//  Self-orchestrating: copies the app folder to a temp dir (the repo's
//  config.php is never touched), writes test credentials, creates the
//  database, boots `php -S`, runs the flow, tears everything down.
//
//  Environment (all optional):
//      CHB_IT_DB_HOST  default 127.0.0.1      CHB_IT_DB_PORT  default 3306
//      CHB_IT_DB_USER  default root           CHB_IT_DB_PASS  default root
//      CHB_IT_HTTP_PORT default 8189
//  GitHub Actions: ubuntu-latest's preinstalled MySQL (root/root) works as-is
//  after `sudo systemctl start mysql`. Locally: any MySQL/MariaDB you can
//  reach over TCP. Excluded from deploy like every test-*.php.
// ============================================================
error_reporting(E_ALL);

$DB_HOST = getenv('CHB_IT_DB_HOST') ?: '127.0.0.1';
$DB_PORT = (int) (getenv('CHB_IT_DB_PORT') ?: 3306);
$DB_USER = getenv('CHB_IT_DB_USER') ?: 'root';
$DB_PASS = getenv('CHB_IT_DB_PASS') !== false ? getenv('CHB_IT_DB_PASS') : 'root';
// Port: honour CHB_IT_HTTP_PORT, else grab a free one from the kernel — a
// fixed default collides with a leftover server from an aborted earlier run.
$HTTP_PORT = (int) (getenv('CHB_IT_HTTP_PORT') ?: 0);
if (!$HTTP_PORT) {
    $sock = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
    $HTTP_PORT = (int) explode(':', stream_socket_get_name($sock, false))[1];
    fclose($sock);
}
$DB_NAME = 'chb_it_test';
$SECRET = 'chb-integration-secret-0123456789abcdef';
$BASE = "http://127.0.0.1:$HTTP_PORT";

$fail = 0;
$pass = 0;
function check($name, $cond, $detail = '')
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name" . ($detail !== '' ? " — " . mb_substr($detail, 0, 200) : '') . "\n";
    }
}
function fatal($msg)
{
    fwrite(STDERR, "FATAL: $msg\n");
    exit(1);
}

// migrate.php's pure helpers (split_sql for applying schema.sql); its request
// bootstrap returns early because the running script isn't migrate.php.
require __DIR__ . '/migrate.php';

// ---- 1. Fresh database --------------------------------------------------
echo "== 1. Fresh database + schema.sql ==\n";
try {
    $rootDb = new PDO("mysql:host=$DB_HOST;port=$DB_PORT;charset=utf8mb4", $DB_USER, $DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_TIMEOUT => 5,
    ]);
} catch (Throwable $e) {
    fatal("cannot reach MySQL at $DB_HOST:$DB_PORT as $DB_USER — " . $e->getMessage() . "\n(start one, or set CHB_IT_DB_* — see the header)");
}
$rootDb->exec("DROP DATABASE IF EXISTS `$DB_NAME`");
$rootDb->exec("CREATE DATABASE `$DB_NAME` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$rootDb->exec("USE `$DB_NAME`");
foreach (split_sql(__DIR__ . '/schema.sql') as $stmt) {
    $rootDb->exec($stmt);
}
check('schema.sql applies to an empty database', true);

// ---- 2. App copy with test config, served by php -S ---------------------
$work = sys_get_temp_dir() . '/chb-it-' . getmypid();
exec('rm -rf ' . escapeshellarg($work));
mkdir($work, 0777, true);
// Only what the server needs: PHP + SQL + the HTML the SEO routes read
// (not the multi-MB model binaries, screenshots or node_modules).
foreach (glob(__DIR__ . '/*.{php,sql,html,txt,json}', GLOB_BRACE) as $f) {
    copy($f, $work . '/' . basename($f));
}
$cfg = (string) file_get_contents($work . '/config.php');
$dbHostForDsn = $DB_PORT === 3306 ? $DB_HOST : "$DB_HOST;port=$DB_PORT"; // db.php's DSN has no port slot — ride the host string
foreach (
    [
        'DB_HOST' => $dbHostForDsn,
        'DB_NAME' => $DB_NAME,
        'DB_USER' => $DB_USER,
        'DB_PASS' => $DB_PASS,
        'APP_SECRET' => $SECRET,
    ]
    as $const => $val
) {
    $n = 0;
    $cfg = preg_replace("/define\('$const',\s*'[^']*'\)/", "define('$const', '" . $val . "')", $cfg, 1, $n);
    if (!$n) {
        fatal("config.php placeholder is missing define('$const', ...)");
    }
}
// Never send mail or hit Square from CI, whatever the placeholder says.
$cfg = preg_replace("/define\('MAIL_ENABLED',\s*\w+\)/", "define('MAIL_ENABLED', false)", $cfg);
$cfg = preg_replace("/define\('SQUARE_PAYMENTS_ENABLED',\s*\w+\)/", "define('SQUARE_PAYMENTS_ENABLED', false)", $cfg);
file_put_contents($work . '/config.php', $cfg);

// `exec` so php replaces the sh -c wrapper — proc_terminate must reach the
// server itself, or an orphaned php -S squats the port for the next run.
$server = proc_open("exec php -S 127.0.0.1:$HTTP_PORT -t " . escapeshellarg($work) . ' 2>' . escapeshellarg($work . '/server.log'), [], $pipes);
register_shutdown_function(function () use ($server, $rootDb, $DB_NAME, $work) {
    if (is_resource($server)) {
        proc_terminate($server);
    }
    try {
        $rootDb->exec("DROP DATABASE IF EXISTS `$DB_NAME`");
    } catch (Throwable $e) {
    }
    exec('rm -rf ' . escapeshellarg($work));
});
$up = false;
for ($i = 0; $i < 50; $i++) {
    usleep(100000);
    // A real 200 from OUR docroot — a body alone could be another server's 404.
    @file_get_contents("$BASE/version.php", false, stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true]]));
    if (preg_match('#^HTTP/\S+ 200#', $http_response_header[0] ?? '')) {
        $up = true;
        break;
    }
}
if (!$up) {
    fatal("php -S did not come up on port $HTTP_PORT (see $work/server.log)");
}
check('php -S serves the app copy', true);

// ---- HTTP client: cookie jar per persona + CSRF header on admin POSTs ----
function http(&$jar, $method, $path, $body = null)
{
    global $BASE;
    $headers = ['Accept: application/json'];
    if ($jar) {
        $headers[] = 'Cookie: ' . implode('; ', array_map(fn($k) => "$k={$jar[$k]}", array_keys($jar)));
    }
    if (isset($jar['csrf']) && $method === 'POST') {
        $headers[] = 'X-CSRF-Token: ' . $jar['csrf'];
    }
    $opts = ['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'timeout' => 30, 'ignore_errors' => true]];
    if ($body !== null) {
        $opts['http']['header'] .= "\r\nContent-Type: application/json";
        $opts['http']['content'] = json_encode($body);
    }
    $raw = @file_get_contents($BASE . $path, false, stream_context_create($opts));
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
            $code = (int) $m[1];
        }
        if (preg_match('/^Set-Cookie:\s*([^=]+)=([^;]*)/i', $h, $m)) {
            $jar[trim($m[1])] = trim($m[2]);
        }
    }
    return ['code' => $code, 'json' => json_decode((string) $raw, true), 'raw' => (string) $raw];
}
$admin = [];  // owner session jar
$guest = [];  // anonymous public jar

// ---- 3. migrate.php applies EVERY migration on the fresh DB -------------
echo "\n== 2. migrate.php on a fresh database (cron auth) ==\n";
$r = http($guest, 'GET', '/migrate.php?cron=' . $SECRET);
$migs = $r['json']['migrations'] ?? [];
$errors = array_values(array_filter($migs, fn($m) => ($m['status'] ?? '') === 'ERROR'));
check('every migration applies cleanly (' . count($migs) . ' files)', $r['code'] === 200 && count($migs) >= 60 && !$errors, $errors ? $errors[0]['file'] . ': ' . substr((string) $errors[0]['error'], 0, 140) : 'code=' . $r['code'] . ' files=' . count($migs) . ' body=' . substr($r['raw'], 0, 200));
$r2 = http($guest, 'GET', '/migrate.php?cron=' . $SECRET);
$reruns = array_filter($r2['json']['migrations'] ?? [], fn($m) => ($m['status'] ?? '') !== 'already-recorded');
check('second run: ledger records every file (all already-recorded)', $r2['code'] === 200 && !$reruns);
check('wrong cron secret is rejected', http($guest, 'GET', '/migrate.php?cron=nope')['code'] !== 200);

// ---- 4. Admin auth + CSRF ------------------------------------------------
echo "\n== 3. Admin session + CSRF ==\n";
$rootDb->prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')->execute(['owner', password_hash('it-pass-123', PASSWORD_DEFAULT)]);
check('wrong password → 401', http($admin, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'wrong'])['code'] === 401);
$r = http($admin, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-123']);
check('admin_login succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$r = http($admin, 'POST', '/auth.php', ['action' => 'admin_status']);
check('admin_status confirms the session', !empty($r['json']['admin']), $r['raw']);
check('admin GET without a session → 401', http($guest, 'GET', '/bookings.php')['code'] === 401);
$noCsrf = $admin;
unset($noCsrf['csrf']);
check('admin POST without the CSRF header → 403', http($noCsrf, 'POST', '/bookings.php', ['action' => 'set_notes', 'id' => 1])['code'] === 403);

// ---- 5. Dynamic accommodations over the real endpoint --------------------
echo "\n== 4. Cottage creation (rates.php) ==\n";
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Test Cottage', 'couple_rate' => 100]);
$propKey = $r['json']['property']['prop_key'] ?? ($r['json']['prop_key'] ?? '');
check('create returns the new prop_key', $r['code'] === 200 && $propKey !== '', $r['raw']);
$r = http($guest, 'GET', '/rates.php');
$rateRows = $r['json']['properties'] ?? [];
$mine = array_values(array_filter($rateRows, fn($p) => is_array($p) && ($p['prop_key'] ?? '') === $propKey));
check('public rates list includes it at £100', $mine && abs((float) $mine[0]['couple_rate'] - 100.0) < 0.005, substr($r['raw'], 0, 160));

// ---- 6. Enquiry → approval → booking with a locked snapshot --------------
echo "\n== 5. Enquiry → booking (price snapshot through the real stack) ==\n";
$in = date('Y-m-d', strtotime('+30 days'));
$out = date('Y-m-d', strtotime('+33 days'));
$r = http($guest, 'POST', '/enquiries.php', [
    'action' => 'submit', 'prop_key' => $propKey, 'name' => 'Ivy Tester',
    'check_in' => $in, 'check_out' => $out, 'adults' => 2, 'children' => 0,
    'email' => 'ivy.tester@gmail.com', 'phone' => '07700900123',
    'message' => 'Two of us, integration test.', 'address' => '1 Test Lane, Blakeney', 'postcode' => 'NR25 7NQ',
    'terms_accepted' => 1,
]);
check('public enquiry submit succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$r = http($admin, 'GET', '/enquiries.php');
$enqs = $r['json']['enquiries'] ?? [];
$enq = array_values(array_filter($enqs, fn($e) => ($e['name'] ?? '') === 'Ivy Tester'));
check('admin enquiry list shows it', (bool) $enq, substr($r['raw'], 0, 160));
$enqId = (int) ($enq[0]['id'] ?? 0);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => $enqId]);
$bookingId = (int) ($r['json']['booking_id'] ?? 0);
check('approve converts it and returns booking_id', $r['code'] === 200 && $bookingId > 0, $r['raw']);

$r = http($admin, 'GET', '/bookings.php');
$bks = array_values(array_filter($r['json']['bookings'] ?? [], fn($b) => (int) ($b['id'] ?? 0) === $bookingId));
check('bookings list contains the new booking', (bool) $bks);
// Price parity through the REAL stack: what approval snapshotted must equal the
// pure model for the same inputs (3 nights × £100 + 3% txn fee = £309).
$snap = $rootDb->query("SELECT agreed_total, agreed_per_night, agreed_nights FROM bookings WHERE id = $bookingId")->fetch(PDO::FETCH_ASSOC);
check('approval snapshotted the agreed price (3 × £100 + 3% = £309)', $snap && abs((float) $snap['agreed_total'] - 309.0) < 0.005, 'stored: ' . json_encode($snap));
check('snapshot nights/per-night are right (3 @ £100 ex-fee)', $snap && (int) $snap['agreed_nights'] === 3 && abs((float) $snap['agreed_per_night'] - 100.0) < 0.005, 'stored: ' . json_encode($snap));

// ---- 7. Money: record a part payment, then read it back -------------------
echo "\n== 6. Payment recording ==\n";
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $bookingId, 'payment' => 'deposit', 'deposit' => 100, 'payment_date' => date('Y-m-d'), 'payment_method' => 'bank']);
check('set_payment records a £100 deposit', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$row = $rootDb->query("SELECT payment, deposit_paid FROM bookings WHERE id = $bookingId")->fetch(PDO::FETCH_ASSOC);
check('booking row shows deposit £100', $row && ($row['payment'] ?? '') === 'deposit' && abs((float) $row['deposit_paid'] - 100.0) < 0.005, json_encode($row));
$r = http($admin, 'POST', '/bookings.php', ['action' => 'history', 'id' => $bookingId]);
$hist = $r['json']['events'] ?? [];
check('booking history includes the payment event', (bool) array_filter($hist, fn($h) => strpos((string) ($h['action'] ?? ''), 'payment') !== false), 'entries=' . count($hist) . ' body=' . substr($r['raw'], 0, 160));

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
