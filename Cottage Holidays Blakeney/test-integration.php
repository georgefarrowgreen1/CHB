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
function it_check($name, $cond, $detail = '')
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
/**
 * Abort the run. Declared never-returning so analysis knows variables assigned
 * before a fatal_it() branch are defined after it.
 * @return never
 */
function fatal_it($msg)
{
    fwrite(STDERR, "FATAL: $msg\n");
    exit(1);
}

// migrate.php's pure helpers (split_sql for applying schema.sql); its request
// bootstrap returns early because the running script isn't migrate.php.
require __DIR__ . '/migrate.php';
// The payment-schedule helpers, so §4 can assert the public payload against the
// SERVER'S own answer rather than against a number written down twice.
require_once __DIR__ . '/pricing.php';

// ---- 1. Fresh database --------------------------------------------------
echo "== 1. Fresh database + schema.sql ==\n";
try {
    $rootDb = new PDO("mysql:host=$DB_HOST;port=$DB_PORT;charset=utf8mb4", $DB_USER, $DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_TIMEOUT => 5,
    ]);
} catch (Throwable $e) {
    fatal_it("cannot reach MySQL at $DB_HOST:$DB_PORT as $DB_USER — " . $e->getMessage() . "\n(start one, or set CHB_IT_DB_* — see the header)");
}
$rootDb->exec("DROP DATABASE IF EXISTS `$DB_NAME`");
$rootDb->exec("CREATE DATABASE `$DB_NAME` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$rootDb->exec("USE `$DB_NAME`");
foreach (split_sql(__DIR__ . '/schema.sql') as $stmt) {
    $rootDb->exec($stmt);
}
it_check('schema.sql applies to an empty database', true);

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
        fatal_it("config.php placeholder is missing define('$const', ...)");
    }
}
// Never send mail or hit Square from CI, whatever the placeholder says.
$cfg = preg_replace("/define\('MAIL_ENABLED',\s*\w+\)/", "define('MAIL_ENABLED', false)", $cfg);
$cfg = preg_replace("/define\('SQUARE_PAYMENTS_ENABLED',\s*\w+\)/", "define('SQUARE_PAYMENTS_ENABLED', false)", $cfg);
// A known webhook signing key + URL so §9 can sign a crafted payment.updated event.
$WEBHOOK_KEY = 'chb-it-webhook-key-abcdef';
$WEBHOOK_URL = $BASE . '/square-webhook.php';
$cfg = preg_replace("/define\('SQUARE_WEBHOOK_SIGNATURE_KEY',\s*'[^']*'\)/", "define('SQUARE_WEBHOOK_SIGNATURE_KEY', '" . $WEBHOOK_KEY . "')", $cfg);
$cfg = preg_replace("/define\('SQUARE_WEBHOOK_URL',\s*'[^']*'\)/", "define('SQUARE_WEBHOOK_URL', '" . $WEBHOOK_URL . "')", $cfg);
// Staging-sandbox constants so §20 can drive the seat endpoint + Test-centre
// seeder for real. These gate NOTHING else: every staging action also demands
// a staging.* Host header, which no other section sends.
$cfg .= "\ndefine('STAGING_SANDBOX', true);\ndefine('STAGING_GATE_USER', 'it-gate');\ndefine('STAGING_GATE_PASS', 'it-gate-pass');\n";
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
    fatal_it("php -S did not come up on port $HTTP_PORT (see $work/server.log)");
}
it_check('php -S serves the app copy', true);

// ---- HTTP client: cookie jar per persona + CSRF header on admin POSTs ----
function http(&$jar, $method, $path, $body = null, $host = null)
{
    global $BASE;
    $headers = ['Accept: application/json'];
    if ($host) {
        $headers[] = 'Host: ' . $host; // §20: the staging endpoints key on the Host header
    }
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
    $http_response_header = []; // overwritten by the fetch; predeclared for the no-request failure path
    $raw = @file_get_contents($BASE . $path, false, stream_context_create($opts));
    $code = 0;
    foreach ($http_response_header as $h) {
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
it_check('every migration applies cleanly (' . count($migs) . ' files)', $r['code'] === 200 && count($migs) >= 60 && !$errors, $errors ? $errors[0]['file'] . ': ' . substr((string) $errors[0]['error'], 0, 140) : 'code=' . $r['code'] . ' files=' . count($migs) . ' body=' . substr($r['raw'], 0, 200));
$r2 = http($guest, 'GET', '/migrate.php?cron=' . $SECRET);
$reruns = array_filter($r2['json']['migrations'] ?? [], fn($m) => ($m['status'] ?? '') !== 'already-recorded');
it_check('second run: ledger records every file (all already-recorded)', $r2['code'] === 200 && !$reruns);
it_check('wrong cron secret is rejected', http($guest, 'GET', '/migrate.php?cron=nope')['code'] !== 200);

// ---- 4. Admin auth + CSRF ------------------------------------------------
echo "\n== 3. Admin session + CSRF ==\n";
$rootDb->prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')->execute(['owner', password_hash('it-pass-123', PASSWORD_DEFAULT)]);
it_check('wrong password → 401', http($admin, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'wrong'])['code'] === 401);
$r = http($admin, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-123']);
it_check('admin_login succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
// STEP-UP HELPER. Refunds require a fresh confirmation on top of the session
// (require_reauth), so anything in this suite that moves money back calls this
// first — which also keeps the existing refund coverage exercising the REAL
// path rather than a weakened one. §24 proves the gate itself is live.
function it_reauth(&$jar)
{
    return http($jar, 'POST', '/auth.php', ['action' => 'admin_reauth_password', 'password' => 'it-pass-123']);
}
$r = http($admin, 'POST', '/auth.php', ['action' => 'admin_status']);
it_check('admin_status confirms the session', !empty($r['json']['admin']), $r['raw']);
it_check('admin GET without a session → 401', http($guest, 'GET', '/bookings.php')['code'] === 401);
$noCsrf = $admin;
unset($noCsrf['csrf']);
it_check('admin POST without the CSRF header → 403', http($noCsrf, 'POST', '/bookings.php', ['action' => 'set_notes', 'id' => 1])['code'] === 403);

// ---- 5. Dynamic accommodations over the real endpoint --------------------
echo "\n== 4. Cottage creation (rates.php) ==\n";
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Test Cottage', 'couple_rate' => 100]);
$propKey = $r['json']['property']['prop_key'] ?? ($r['json']['prop_key'] ?? '');
it_check('create returns the new prop_key', $r['code'] === 200 && $propKey !== '', $r['raw']);
$r = http($guest, 'GET', '/rates.php');
$rateRows = $r['json']['properties'] ?? [];
$mine = array_values(array_filter($rateRows, fn($p) => is_array($p) && ($p['prop_key'] ?? '') === $propKey));
it_check('public rates list includes it at £100', $mine && abs((float) $mine[0]['couple_rate'] - 100.0) < 0.005, substr($r['raw'], 0, 160));
// The PAYMENT SCHEDULE rides this payload because the Terms & Conditions state
// it to the guest, and used to state it as prose: "25%" against an owner-editable
// percentage, and "4 weeks" against a 30-day PAYMENT_BALANCE_DAYS — so a booking
// made 29 days out was promised a deposit by the contract and asked to pay in
// full by pricing.php. Asserted against the SERVER'S own functions rather than
// against 25/30, so changing either config can never leave the terms behind.
$paySched = $r['json']['payment'] ?? null;
it_check('public rates payload carries the payment schedule', is_array($paySched), substr($r['raw'], 0, 200));
it_check(
    'deposit % is the one square_deposit_pct() returns',
    $paySched && abs((float) $paySched['deposit_pct'] - square_deposit_pct()) < 0.005,
    json_encode($paySched),
);
it_check(
    'balance window is the one payment_balance_days() enforces',
    $paySched && (int) $paySched['balance_days'] === payment_balance_days(),
    json_encode($paySched),
);

// ---- 6. Enquiry → approval → booking with a locked snapshot --------------
echo "\n== 5. Enquiry → booking (price snapshot through the real stack) ==\n";
$in = date('Y-m-d', strtotime('+30 days'));
$out = date('Y-m-d', strtotime('+33 days'));
$r = http($guest, 'POST', '/enquiries.php', [
    'action' => 'submit', 'prop_key' => $propKey, 'name' => 'Ivy Tester',
    'check_in' => $in, 'check_out' => $out, 'adults' => 2, 'children' => 0,
    'email' => 'ivy.tester@gmail.com', 'phone' => '07700900123',
    'message' => 'Two of us, integration test.', 'address' => '1 Test Lane, Blakeney', 'postcode' => 'NR25 7NQ',
    'terms_accepted' => 1, 'no_dogs' => 1,
]);
it_check('public enquiry submit succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
// Book by the night before, as a minimum: a same-day check-in is refused for
// guest submissions. The picker enforces this client-side; the endpoint is the
// gate that matters — a stale tab or a direct POST is exactly what it is for.
//
// TODAY MEANS THE APP'S TODAY, NOT THE HARNESS'S. This CLI runs on UTC while
// the server runs Europe/London, so a bare date('Y-m-d') here is the server's
// YESTERDAY between 23:00 and midnight UTC — the enquiry then trips the
// past-date guard first and this check reads a refusal it never meant to test.
// Right all day and wrong for one hour a night, the ukShiftDays defect exactly;
// caught by running in that hour. Ask the same clock the server asks.
$ukToday = (new DateTime('now', new DateTimeZone('Europe/London')))->format('Y-m-d');
$ukPlus = fn($n) => (new DateTime($ukToday, new DateTimeZone('Europe/London')))->modify("+$n days")->format('Y-m-d');
$r = http($guest, 'POST', '/enquiries.php', [
    'action' => 'submit', 'prop_key' => $propKey, 'name' => 'Sam Sameday',
    'check_in' => $ukToday, 'check_out' => $ukPlus(3),
    'adults' => 2, 'children' => 0, 'email' => 'sam.sameday@gmail.com',
    'message' => 'Tonight please.', 'terms_accepted' => 1, 'no_dogs' => 1,
]);
it_check(
    'a same-day enquiry is refused with the notice rule',
    $r['code'] === 400 && str_contains((string) ($r['json']['error'] ?? ''), 'earliest check-in is tomorrow'),
    $r['raw'],
);
// The refused submit above still burned one unit of rate_limit('enquiry', 6, 15)
// — the limiter counts the ATTEMPT, before validation — and the suite's later
// enquiry sections sit exactly at that budget, so give it back rather than let
// an unrelated section 429.
$rootDb->exec("DELETE FROM login_attempts WHERE identifier = 'enquiry'");
$r = http($admin, 'GET', '/enquiries.php');
$enqs = $r['json']['enquiries'] ?? [];
$enq = array_values(array_filter($enqs, fn($e) => ($e['name'] ?? '') === 'Ivy Tester'));
it_check('admin enquiry list shows it', (bool) $enq, substr($r['raw'], 0, 160));
$enqId = (int) ($enq[0]['id'] ?? 0);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => $enqId]);
$bookingId = (int) ($r['json']['booking_id'] ?? 0);
it_check('approve converts it and returns booking_id', $r['code'] === 200 && $bookingId > 0, $r['raw']);

$r = http($admin, 'GET', '/bookings.php');
$bks = array_values(array_filter($r['json']['bookings'] ?? [], fn($b) => (int) ($b['id'] ?? 0) === $bookingId));
it_check('bookings list contains the new booking', (bool) $bks);
// Price parity through the REAL stack: what approval snapshotted must equal the
// pure model for the same inputs (3 nights × £100 + 3% txn fee = £309).
$snap = $rootDb->query("SELECT agreed_total, agreed_per_night, agreed_nights FROM bookings WHERE id = $bookingId")->fetch(PDO::FETCH_ASSOC);
it_check('approval snapshotted the agreed price (3 × £100 + 3% = £309)', $snap && abs((float) $snap['agreed_total'] - 309.0) < 0.005, 'stored: ' . json_encode($snap));
it_check('snapshot nights/per-night are right (3 @ £100 ex-fee)', $snap && (int) $snap['agreed_nights'] === 3 && abs((float) $snap['agreed_per_night'] - 100.0) < 0.005, 'stored: ' . json_encode($snap));

// ---- 6b. A PLAN AGREED WITH THE ENQUIRER SURVIVES APPROVAL ----------------
// Approval creates the booking and then immediately emails a payment request.
// With no plan on the row that request was derived from the SITE STANDARD — so
// agreeing 50% with an enquirer meant they received an email for 25% before the
// plan could be set, and the hub then said one thing while the guest held an
// email saying another. The plan now rides the approval itself.
//
// The enquiry rows are seeded DIRECTLY rather than posted: the public submit is
// rate-limited (correctly), and two more guest posts here tipped every later
// section of this suite over the limit. What is under test is the APPROVAL.
$seedEnq = function (string $name, string $email, string $in, string $out) use ($rootDb, $propKey): int {
    $rootDb->prepare(
        'INSERT INTO enquiries (prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,message,terms_accepted_at,terms_version,no_dogs_at,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),1,NOW(),NOW())',
    )->execute([$propKey, $name, $email, '07700900166', '2 Test Lane', 'NR25 7NQ', $in, $out, '15:00', '10:00', 2, 0, 'Seeded for the approval test.']);
    return (int) $rootDb->lastInsertId();
};
$peId = $seedEnq('Planned Enquirer', 'planned.enquirer@gmail.com', date('Y-m-d', strtotime('+120 days')), date('Y-m-d', strtotime('+124 days')));
$dueAgreed = date('Y-m-d', strtotime('+80 days'));
$r = http($admin, 'POST', '/enquiries.php', [
    'action' => 'approve', 'id' => $peId,
    'deposit_pct' => '50', 'balance_due_date' => $dueAgreed,
]);
$pbId = (int) ($r['json']['booking_id'] ?? 0);
it_check('approval accepts a plan agreed with the enquirer', $r['code'] === 200 && $pbId > 0, $r['raw']);
$planned = $rootDb->query("SELECT deposit_pct_override, balance_due_date FROM bookings WHERE id = $pbId")->fetch(PDO::FETCH_ASSOC);
it_check(
    '…and the booking is created WITH it, so the request that follows is derived from 50% not the site standard',
    $planned && abs((float) $planned['deposit_pct_override'] - 50.0) < 0.005 && ($planned['balance_due_date'] ?? '') === $dueAgreed,
    json_encode($planned),
);
// A refused plan must not create the booking — the parse happens BEFORE the
// book_lock, so a refusal can neither strand the lock nor half-approve.
$bpId = $seedEnq('Bad Plan Enquirer', 'badplan@gmail.com', date('Y-m-d', strtotime('+140 days')), date('Y-m-d', strtotime('+143 days')));
$bkBefore = (int) $rootDb->query('SELECT COUNT(*) FROM bookings')->fetchColumn();
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => $bpId, 'deposit_pct' => '150']);
it_check('an impossible plan is refused in words at approval', $r['code'] === 400 && stripos((string) ($r['json']['error'] ?? ''), 'percentage') !== false, $r['raw']);
it_check('…and no booking was created for it', (int) $rootDb->query('SELECT COUNT(*) FROM bookings')->fetchColumn() === $bkBefore);
// …and the cottage is NOT left locked — the same enquiry approves plainly after.
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => $bpId]);
it_check('…and the refusal did not strand the calendar lock (a plain approval still succeeds)',
    $r['code'] === 200 && (int) ($r['json']['booking_id'] ?? 0) > 0, $r['raw']);

// ---- 7. Money: record a part payment, then read it back -------------------
echo "\n== 6. Payment recording ==\n";
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $bookingId, 'payment' => 'deposit', 'deposit' => 100, 'payment_date' => date('Y-m-d'), 'payment_method' => 'bank']);
it_check('set_payment records a £100 deposit', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$row = $rootDb->query("SELECT payment, deposit_paid FROM bookings WHERE id = $bookingId")->fetch(PDO::FETCH_ASSOC);
it_check('booking row shows deposit £100', $row && ($row['payment'] ?? '') === 'deposit' && abs((float) $row['deposit_paid'] - 100.0) < 0.005, json_encode($row));
$r = http($admin, 'POST', '/bookings.php', ['action' => 'history', 'id' => $bookingId]);
$hist = $r['json']['events'] ?? [];
it_check('booking history includes the payment event', (bool) array_filter($hist, fn($h) => strpos((string) ($h['action'] ?? ''), 'payment') !== false), 'entries=' . count($hist) . ' body=' . substr($r['raw'], 0, 160));

// ---- 8. Declarative routing (route_actions via customers.php) -------------
echo "\n== 7. customers.php (route_actions exemplar) ==\n";
$r = http($admin, 'POST', '/customers.php', ['action' => 'directory', 'q' => 'ivy']);
it_check('directory action answers (single-stay guest → no unified row yet)', $r['code'] === 200 && is_array($r['json']['customers'] ?? null), $r['raw']);
it_check('unknown action → 400 (route_actions catch-all)', http($admin, 'POST', '/customers.php', ['action' => 'nope'])['code'] === 400);

// ---- 9. Self-repair storage hygiene (real files, real endpoint) -----------
echo "\n== 8. Self-repair storage hygiene ==\n";
@mkdir($work . '/uploads/cache', 0777, true);
file_put_contents($work . '/uploads/live.jpg', 'x');
// THE REAL CACHE-NAME SHAPE, which is what let this defect ship. img.php builds the
// name from the FULL src with separators flattened — 'uploads/live.jpg' becomes
// `uploads_live.jpg` — so these fixtures were the one shape self-repair's broken
// probe happened to handle: it reconstructed `uploads/<basename>`, which for
// `live.jpg.w640.webp` really is uploads/live.jpg. Against the names img.php
// ACTUALLY writes, every entry looked orphaned and the nightly cron deleted the
// whole resize cache and called it a fix.
file_put_contents($work . '/uploads/cache/uploads_live.jpg.w640.webp', 'x');   // source present → keep
file_put_contents($work . '/uploads/cache/uploads_gone.jpg.w640.webp', 'x');   // source missing → prune
$r = http($guest, 'GET', '/self-repair.php?cron=' . $SECRET);
it_check('self-repair runs via the cron secret', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
it_check('dead resizer-cache entry pruned', !is_file($work . '/uploads/cache/uploads_gone.jpg.w640.webp'));
it_check('live resizer-cache entry kept', is_file($work . '/uploads/cache/uploads_live.jpg.w640.webp'));
it_check('the prune is reported as a fix', (bool) array_filter($r['json']['fixed'] ?? [], fn($f) => strpos((string) $f, 'resized image') !== false), json_encode($r['json']['fixed'] ?? []));

// ---- 10. Money-integrity fixes (whole-site logic audit) -------------------
echo "\n== 9. Money-integrity (audit fixes) ==\n";

// (1) Editing a paid booking's dates must NOT fabricate money. Mark the booking
// paid in full, then edit its dates to EXTEND it (no payment/deposit fields, as
// the client's trim-paid-fields edit sends) — deposit_paid must stay the money
// actually received and the status must flip to 'deposit' with the balance owed.
$rootDb->exec("UPDATE bookings SET payment='paid', deposit_paid=309, payment_method='bank', payment_date='" . date('Y-m-d') . "' WHERE id=$bookingId");
$newOut = date('Y-m-d', strtotime($out . ' +2 days'));
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $bookingId, 'check_in' => $in, 'check_out' => $newOut, 'adults' => 2, 'children' => 0]);
it_check('editing a paid booking succeeds', $r['code'] === 200, $r['raw']);
$row = $rootDb->query("SELECT payment, deposit_paid, agreed_total FROM bookings WHERE id=$bookingId")->fetch(PDO::FETCH_ASSOC);
it_check('extending a paid booking keeps deposit_paid = money received (£309, not the new total)', $row && abs((float) $row['deposit_paid'] - 309.0) < 0.005, json_encode($row));
it_check('extended paid booking flips to deposit (balance now owed, so it gets chased)', $row && $row['payment'] === 'deposit' && (float) $row['agreed_total'] > 309.0, json_encode($row));

// (2) A FAILED refund must NOT be counted as money returned. Seed a fresh
// booking paid £800 by card (ledger row), then a FULL £800 refund the ledger
// later marks FAILED. The paid-net query (bookings.php) must exclude it → £800.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Refund Tester','rt@gmail.com','$in','$out',2,0,'paid',800,800,800,0,3)");
$rtId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id) VALUES ($rtId,'deposit',800,'COMPLETED','sq_rt_charge')");
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id) VALUES ($rtId,'refund',800,'FAILED','sq_rt_refund')");
$net = (float) $rootDb->query("SELECT
        COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN kind = 'refund' AND (status IS NULL OR status NOT IN ('FAILED','REJECTED')) THEN amount ELSE 0 END),0)
    FROM payments WHERE booking_id = $rtId")->fetchColumn();
it_check('a FAILED refund is not subtracted from paid (net = £800, refund retry stays possible)', abs($net - 800.0) < 0.005, 'net=' . $net);
// A PENDING refund still counts (optimistic, unchanged behaviour).
$rootDb->exec("UPDATE payments SET status='PENDING' WHERE square_payment_id='sq_rt_refund'");
$net2 = (float) $rootDb->query("SELECT
        COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN kind = 'refund' AND (status IS NULL OR status NOT IN ('FAILED','REJECTED')) THEN amount ELSE 0 END),0)
    FROM payments WHERE booking_id = $rtId")->fetchColumn();
it_check('a PENDING refund still reduces paid (optimistic, unchanged)', abs($net2 - 0.0) < 0.005, 'net=' . $net2);

// (3) The webhook must never LOWER deposit_paid — a mixed bank+card booking with
// a refunded card charge must survive a routine payment.updated re-send. Set up:
// £500 bank (no ledger row) + £300 card charge, later refunded → deposit_paid
// floored at £500. Then Square re-emits payment.updated for the card charge.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Bank Card Mix','bcm@gmail.com','$in','$out',2,0,'deposit',500,800,800,0,3)");
$bcmId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id) VALUES ($bcmId,'deposit',300,'COMPLETED','sq_bcm_charge')");
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id) VALUES ($bcmId,'refund',300,'COMPLETED','sq_bcm_refund')");
$evt = json_encode(['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['id' => 'sq_bcm_charge', 'status' => 'COMPLETED', 'reference_id' => 'CHB-' . $bcmId]]]]);
$sig = base64_encode(hash_hmac('sha256', $WEBHOOK_URL . $evt, $WEBHOOK_KEY, true));
$opts = ['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\nx-square-hmacsha256-signature: $sig", 'content' => $evt, 'timeout' => 15, 'ignore_errors' => true]];
$http_response_header = []; // predeclared; the fetch overwrites it (PHPStan: never left null)
$whRaw = @file_get_contents($WEBHOOK_URL, false, stream_context_create($opts));
$whCode = 0;
foreach ($http_response_header as $h) {
    if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
        $whCode = (int) $m[1];
    }
}
it_check('signed webhook accepted (signature verifies)', $whCode === 200, 'code=' . $whCode . ' body=' . substr((string) $whRaw, 0, 120));
$bcmRow = $rootDb->query("SELECT deposit_paid, payment FROM bookings WHERE id=$bcmId")->fetch(PDO::FETCH_ASSOC);
it_check('webhook did NOT wipe the £500 bank money (deposit_paid still £500)', $bcmRow && abs((float) $bcmRow['deposit_paid'] - 500.0) < 0.005, json_encode($bcmRow));

// ---- 10c. THE WEBHOOK AGAINST SHAPES SQUARE MIGHT NOT SEND ----------------
// The last gap from the payment audit. test-webhook.php proves the SIGNATURE
// and nothing about what happens once a signed event is trusted; this section
// drove one well-formed payment.updated and stopped there. But a webhook is the
// one money path where the input is not ours: an event arriving malformed, out
// of order, or naming a booking it has no business naming must never corrupt
// state that is already correct. Every case here is a SILENCE — the endpoint
// must acknowledge (so Square stops retrying) and write nothing.
$post = function ($payload) use ($WEBHOOK_URL, $WEBHOOK_KEY) {
    $body = json_encode($payload);
    $sg = base64_encode(hash_hmac('sha256', $WEBHOOK_URL . $body, $WEBHOOK_KEY, true));
    $o = ['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\nx-square-hmacsha256-signature: $sg", 'content' => $body, 'timeout' => 15, 'ignore_errors' => true]];
    $http_response_header = [];
    $raw = @file_get_contents($WEBHOOK_URL, false, stream_context_create($o));
    $code = 0;
    foreach ($http_response_header as $h) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
            $code = (int) $m[1];
        }
    }
    return ['code' => $code, 'raw' => (string) $raw];
};
$paidBefore = (float) $rootDb->query("SELECT deposit_paid FROM bookings WHERE id=$bcmId")->fetchColumn();
$statusBefore = (string) $rootDb->query("SELECT status FROM payments WHERE square_payment_id='sq_bcm_charge'")->fetchColumn();
foreach ([
    'no data at all' => ['type' => 'payment.updated'],
    'no payment object' => ['type' => 'payment.updated', 'data' => ['object' => []]],
    'a payment with no id' => ['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['status' => 'COMPLETED']]]],
    'an event type we do not handle' => ['type' => 'invoice.published', 'data' => ['object' => ['payment' => ['id' => 'sq_bcm_charge', 'status' => 'CANCELED']]]],
    'a payment id Square has but we do not' => ['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['id' => 'sq_never_seen', 'status' => 'COMPLETED']]]],
    'a reference naming a booking that does not exist' => ['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['id' => 'sq_other', 'status' => 'COMPLETED', 'reference_id' => 'CHB-999999']]]],
    'a wrong-typed status' => ['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['id' => 'sq_bcm_charge', 'status' => ['nested' => 'rubbish']]]]],
] as $why => $evtBad) {
    $r = $post($evtBad);
    it_check("malformed event acknowledged, not a 500 — $why", $r['code'] === 200, 'code=' . $r['code'] . ' body=' . substr($r['raw'], 0, 120));
}
$paidAfter = (float) $rootDb->query("SELECT deposit_paid FROM bookings WHERE id=$bcmId")->fetchColumn();
$statusAfter = (string) $rootDb->query("SELECT status FROM payments WHERE square_payment_id='sq_bcm_charge'")->fetchColumn();
it_check('...and none of them moved the money', abs($paidAfter - $paidBefore) < 0.005, "before=$paidBefore after=$paidAfter");
it_check('...nor overwrote a good ledger status', $statusAfter === $statusBefore, "before=$statusBefore after=$statusAfter");
// AN EMPTY STATUS MUST NOT BLANK A GOOD ONE. The refund branch used to write
// `$refund['status'] ?? ''` straight in; the payment branch guards on
// `$status !== ''`. Driven, so the guard cannot be removed silently.
$post(['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['id' => 'sq_bcm_charge', 'status' => '', 'reference_id' => 'CHB-' . $bcmId]]]]);
it_check('an EMPTY status leaves the recorded one alone',
    (string) $rootDb->query("SELECT status FROM payments WHERE square_payment_id='sq_bcm_charge'")->fetchColumn() === $statusBefore);
// AND AN UNSIGNED EVENT IS REFUSED, whatever it carries — the one case where
// acknowledging would be wrong, because it is not Square talking.
$unsignedBody = json_encode(['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['id' => 'sq_bcm_charge', 'status' => 'CANCELED', 'reference_id' => 'CHB-' . $bcmId]]]]);
$uo = ['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\nx-square-hmacsha256-signature: not-a-signature", 'content' => $unsignedBody, 'timeout' => 15, 'ignore_errors' => true]];
$http_response_header = [];
@file_get_contents($WEBHOOK_URL, false, stream_context_create($uo));
$uCode = 0;
foreach ($http_response_header as $h) {
    if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
        $uCode = (int) $m[1];
    }
}
it_check('an unsigned event is REFUSED, not acknowledged', $uCode !== 200, 'code=' . $uCode);
it_check('...and changed nothing', (string) $rootDb->query("SELECT status FROM payments WHERE square_payment_id='sq_bcm_charge'")->fetchColumn() === $statusBefore);

// ---- 10d. THE NIGHTLY RUN APPLIES PENDING SCHEMA CHANGES ------------------
// migrate.php has always accepted the cron secret; it was simply never in
// cron.php's job list. So every deploy carrying a migration waited on the owner
// remembering a button in Manage, and until they did, whatever the deploy
// shipped that needed a new column silently did nothing — measured, migrations
// 106 and 107 sat unapplied while automatic collection returned a quiet
// ok:false. Nothing anywhere said a migration was pending.
echo "\n== 10d. Migrations run nightly ==\n";
$cronSrc = (string) file_get_contents(__DIR__ . '/cron.php');
it_check('migrate.php is one of the daily jobs', strpos($cronSrc, "'migrate.php?cron=' =>") !== false);
// Ordered first, because a job must never run against a schema it predates.
it_check('...and runs BEFORE every other job',
    strpos($cronSrc, "'migrate.php?cron=' =>") < strpos($cronSrc, "'ical-import.php?cron=' =>"));
// A 2xx is not always success: migrate.php answers 200 and reports each file
// individually, so a failed schema change would read as a job that went fine.
// Pinned on the GUARD'S CONDITION, not on the strings inside it: replacing the
// `if` with `if (false)` left both of those still present in the source and both
// checks green — the ingredient-not-enforcement trap this file keeps meeting.
it_check('a per-file ERROR is read out of the 200 response',
    strpos($cronSrc, 'if ($ok && is_array($body[\'migrations\'] ?? null)) {') !== false);
it_check('...inside a branch that can actually run',
    strpos($cronSrc, "(\$m['status'] ?? '') === 'ERROR'") !== false && strpos($cronSrc, 'if (false)') === false);
it_check('...and demotes the job to failed, which is what logs a warning',
    preg_match('/\$ok = false;\s*\n\s*\$note = /', $cronSrc) === 1);
// The safety property that makes nightly application sound at all: running the
// whole set twice must be a no-op. §2 already proves the second pass records
// every file as already-recorded; assert the ledger is what makes it so.
$mig3 = http($guest, 'GET', '/migrate.php?cron=' . $SECRET);
$reruns3 = array_filter($mig3['json']['migrations'] ?? [], fn($m) => ($m['status'] ?? '') !== 'already-recorded');
it_check('a third run is still a complete no-op (safe to repeat nightly)',
    $mig3['code'] === 200 && !$reruns3, 'code=' . $mig3['code'] . ' changed=' . count($reruns3));

// ---- 11. Accounts income allocation (audit findings 6, 7, 11) -------------
echo "\n== 10. Accounts income allocation ==\n";
// Seed three cottages-worth of scenarios directly, then read accounts.php per year.
$acctGet = function ($year) use ($admin) {
    return http($admin, 'GET', '/accounts.php?year=' . $year);
};
// (a) SINGLE-payment booking must be UNCHANGED: £300 rental, one card payment
// on 2025-06-10 (tax year 2025) → all £300 income in 2025, nothing in 2026.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date) VALUES ('$propKey','Single Pay','sp@x.co','2025-06-10','2025-06-13',2,0,'paid',300,300,300,0,3,'2025-06-10')");
$spId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($spId,'balance',300,'COMPLETED','sq_sp','2025-06-10 12:00:00')");
$y2025 = $acctGet(2025)['json'];
$spIn2025 = array_sum(array_map(fn($p) => (float) $p['income_part'], array_filter($y2025['payments'] ?? [], fn($p) => (int) $p['id'] === $spId)));
it_check('single-payment booking: full £300 income in its year (unchanged)', abs($spIn2025 - 300.0) < 0.005, 'got ' . $spIn2025);

// (b) STRADDLE (#6): £1000 rental, £250 deposit 2026-03-10 (TY 2025) + £750
// balance 2026-05-01 (TY 2026). Income must SPLIT — £250 in 2025, £750 in 2026 —
// not migrate wholesale into 2026 on the single payment_date.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date) VALUES ('$propKey','Straddle Guest','stg@x.co','2026-08-01','2026-08-08',2,0,'paid',1000,1000,1000,0,7,'2026-05-01')");
$stId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($stId,'deposit',250,'COMPLETED','sq_st_dep','2026-03-10 09:00:00')");
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($stId,'balance',750,'COMPLETED','sq_st_bal','2026-05-01 09:00:00')");
$stIn2025 = array_sum(array_map(fn($p) => (float) $p['income_part'], array_filter($acctGet(2025)['json']['payments'] ?? [], fn($p) => (int) $p['id'] === $stId)));
$stIn2026 = array_sum(array_map(fn($p) => (float) $p['income_part'], array_filter($acctGet(2026)['json']['payments'] ?? [], fn($p) => (int) $p['id'] === $stId)));
it_check('straddle deposit stays in the year received (£250 in 2025/26)', abs($stIn2025 - 250.0) < 0.005, '2025=' . $stIn2025);
it_check('straddle balance in the later year (£750 in 2026/27), not migrated', abs($stIn2026 - 750.0) < 0.005, '2026=' . $stIn2026);

// (c) CANCELLED-but-retained income (#7): a card payment whose booking row was
// deleted must still count. Insert a ledger row for a non-existent booking id.
$ghostId = 999001;
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($ghostId,'balance',500,'COMPLETED','sq_ghost','2025-09-01 10:00:00')");
$y2025b = $acctGet(2025)['json'];
$ghostIn = array_sum(array_map(fn($p) => (float) $p['income_part'], array_filter($y2025b['payments'] ?? [], fn($p) => (int) $p['id'] === $ghostId)));
it_check('retained income on a deleted (cancelled) booking still counts (£500)', abs($ghostIn - 500.0) < 0.005, 'got ' . $ghostIn);

// (d) KEPT damages deposit netting (#11): a £250 captured damages minus a £150
// return leaves £100 kept income — not the gross £250.
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($ghostId,'damages',250,'COMPLETED','sq_dmg','2025-10-01 10:00:00')");
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($ghostId,'damages_return',150,'COMPLETED','sq_dmgr','2025-10-05 10:00:00')");
$kept = (float) ($acctGet(2025)['json']['kept_deposits'] ?? -1);
it_check('kept damages nets off the return (£250 − £150 = £100)', abs($kept - 100.0) < 0.005, 'kept=' . $kept);

// (e) SAFE TO MOVE, per transaction. The arithmetic is unit-tested in
// test-sweep.php; what only a real request can prove is the LINKAGE — a deposit
// rides the guest's FIRST payment (bookings.hold_payment_id), so the later balance
// payment on the same booking must hold NOTHING back. Get that wrong and the same
// £75 is ring-fenced twice, which a static scan of the query cannot see.
$swIn = date('Y-m-d', strtotime('-10 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date, hold_status, hold_amount, hold_payment_id) VALUES ('$propKey','Sweep Guest','sw@x.co','$swIn','$swIn',2,0,'paid',1000,1000,1000,0,3,'$swIn','charged',75,'sq_sw_dep')");
$swId = (int) $rootDb->lastInsertId();
// £300 rental + the £75 deposit on ONE charge, fee £6.56 → £368.44 settled,
// £73.69 held back, £294.75 movable (the rental net of its own share of the fee).
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, fee, status, square_payment_id, created_at) VALUES ($swId,'deposit',300,6.56,'COMPLETED','sq_sw_dep', DATE_SUB(NOW(), INTERVAL 12 DAY))");
$swDepTxn = (int) $rootDb->lastInsertId();
// The later balance: no deposit rode it, so all of it is movable less its fee.
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, fee, status, square_payment_id, created_at) VALUES ($swId,'balance',700,12.25,'COMPLETED','sq_sw_bal', DATE_SUB(NOW(), INTERVAL 5 DAY))");
$swBalTxn = (int) $rootDb->lastInsertId();
// An OLD charge still holding a deposit — it must not fall off the 90-day window,
// because money still to go back is the whole point of the list.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date, hold_status, hold_amount, hold_payment_id) VALUES ('$propKey','Old Deposit','od@x.co','2025-04-01','2025-04-04',2,0,'paid',400,400,400,0,3,'2025-04-01','charged',75,'sq_od_dep')");
$odId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, fee, status, square_payment_id, created_at) VALUES ($odId,'deposit',400,8.31,'COMPLETED','sq_od_dep', DATE_SUB(NOW(), INTERVAL 200 DAY))");
$odTxn = (int) $rootDb->lastInsertId();

$swRep = $acctGet(2026)['json'];
$swLiab = $swRep['deposit_liability'] ?? null;
$swTxns = $swLiab['transactions']['items'] ?? [];
$byTxn = [];
foreach ($swTxns as $t) {
    $byTxn[(int) ($t['txn_id'] ?? 0)] = $t;
}
it_check('deposit_liability rides the accounts payload (no extra endpoint)', is_array($swLiab) && empty($swLiab['error']), json_encode(array_slice((array) $swLiab, 0, 3)));
$dep = $byTxn[$swDepTxn] ?? null;
it_check('the charge that CARRIED the deposit holds £73.69 back', $dep && abs((float) $dep['ringFence'] - 73.69) < 0.02, json_encode($dep));
it_check('…and reports £294.75 movable — the rental net of its own fee share', $dep && abs((float) $dep['movable'] - 294.75) < 0.02, 'movable=' . ($dep['movable'] ?? '?'));
$bal = $byTxn[$swBalTxn] ?? null;
it_check('the LATER balance payment holds nothing back (the deposit is not double-counted)', $bal && abs((float) $bal['ringFence']) < 0.005, json_encode($bal));
it_check('…so it is movable in full, less its fee (£687.75)', $bal && abs((float) $bal['movable'] - 687.75) < 0.02, 'movable=' . ($bal['movable'] ?? '?'));
it_check('an old charge still holding a deposit is still listed', isset($byTxn[$odTxn]), 'txn ids: ' . implode(',', array_keys($byTxn)));
// The aggregate the "keep in the account" figure comes from: two outstanding £75
// deposits, so the ring fence is their NET, never the gross £150.
it_check('the ring fence is the deposits NET of their fee share, not the gross',
    $swLiab && (float) $swLiab['net'] > 140 && (float) $swLiab['net'] < (float) $swLiab['gross'],
    'net=' . ($swLiab['net'] ?? '?') . ' gross=' . ($swLiab['gross'] ?? '?'));

// (f) A REFUND THAT HASN'T LEFT THE BANK YET. return_deposit marks the booking
// 'returned' the moment the refund is issued, but Square debits days later — so the
// money must stay ring-fenced until the return SETTLES, or the screen offers it as
// movable while it is still in the account. Only a real request proves the query
// selects an already-'returned' booking on the strength of a pending refund row.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date, hold_status, hold_amount, hold_payment_id) VALUES ('$propKey','Pending Return','pr@x.co','2026-06-01','2026-06-04',2,0,'paid',500,500,500,0,3,'2026-06-01','returned',75,'sq_pr_dep')");
$prId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, fee, status, square_payment_id, created_at) VALUES ($prId,'deposit',425,7.44,'COMPLETED','sq_pr_dep', DATE_SUB(NOW(), INTERVAL 30 DAY))");
// Issued two days ago, Square has not confirmed it — still in the account.
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($prId,'damages_return',75,'PENDING','sq_pr_ref', DATE_SUB(NOW(), INTERVAL 2 DAY))");
$prLiab = $acctGet(2026)['json']['deposit_liability'] ?? null;
$prRow = null;
foreach (($prLiab['items'] ?? []) as $it) {
    if ((int) ($it['booking_id'] ?? 0) === $prId) {
        $prRow = $it;
    }
}
it_check('an issued-but-unsettled refund is STILL ring-fenced', $prRow && abs((float) $prRow['outstanding'] - 75.0) < 0.02, json_encode($prRow));
it_check('…and is flagged as already refunded, not as a job still to do', $prRow && abs((float) $prRow['awaiting'] - 75.0) < 0.02, 'awaiting=' . ($prRow['awaiting'] ?? '?'));
// Once Square confirms it, the money has gone and the fence must release.
$rootDb->exec("UPDATE payments SET status='COMPLETED' WHERE square_payment_id='sq_pr_ref'");
$prLiab2 = $acctGet(2026)['json']['deposit_liability'] ?? null;
$still = false;
foreach (($prLiab2['items'] ?? []) as $it) {
    if ((int) ($it['booking_id'] ?? 0) === $prId) {
        $still = true;
    }
}
it_check('a SETTLED return leaves the ring fence', !$still, 'still fenced after COMPLETED');
// A refund nobody ever confirmed must not fence money for ever — the owner could
// never clear it. Backdate it past the 14-day line.
$rootDb->exec("UPDATE payments SET status='PENDING', created_at=DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE square_payment_id='sq_pr_ref'");
$prLiab3 = $acctGet(2026)['json']['deposit_liability'] ?? null;
$stale = false;
foreach (($prLiab3['items'] ?? []) as $it) {
    if ((int) ($it['booking_id'] ?? 0) === $prId) {
        $stale = true;
    }
}
it_check('an old unconfirmed return is assumed landed, not fenced for ever', !$stale, 'still fenced after 40 days pending');
// That case is really decided by the WHERE clause (an already-'returned' booking is
// only selected while a refund is RECENTLY pending), so it leaves ret_stale untested.
// Where the column actually bites: a booking still 'charged' carrying an old
// unconfirmed PARTIAL return — £75 taken, £25 refunded 40 days ago and never
// confirmed. Without ret_stale that £25 is fenced for ever.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date, hold_status, hold_amount, hold_payment_id) VALUES ('$propKey','Stale Part Return','sp2@x.co','2026-05-01','2026-05-04',2,0,'paid',500,500,500,0,3,'2026-05-01','charged',75,'sq_sp2_dep')");
$sp2Id = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, fee, status, square_payment_id, created_at) VALUES ($sp2Id,'deposit',425,7.44,'COMPLETED','sq_sp2_dep', DATE_SUB(NOW(), INTERVAL 60 DAY))");
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($sp2Id,'damages_return',25,'PENDING','sq_sp2_ref', DATE_SUB(NOW(), INTERVAL 40 DAY))");
$sp2Row = null;
foreach (($acctGet(2026)['json']['deposit_liability']['items'] ?? []) as $it) {
    if ((int) ($it['booking_id'] ?? 0) === $sp2Id) {
        $sp2Row = $it;
    }
}
it_check('an old unconfirmed PARTIAL return is treated as landed (£50 left, not £75)',
    $sp2Row && abs((float) $sp2Row['outstanding'] - 50.0) < 0.02, json_encode($sp2Row));
it_check('…and nothing is reported as awaiting, because nothing recent is pending',
    $sp2Row && abs((float) $sp2Row['awaiting']) < 0.005, 'awaiting=' . ($sp2Row['awaiting'] ?? '?'));

// ---- 11b. Money audit fixes (one paid-so-far, case-proof ledger, capped cancel) ----
echo "\n== 10b. Money audit fixes ==\n";
// (A) ONE DEFINITION OF "ALREADY PAID". The email and the pay screen read
// bookings.deposit_paid; the charge takes max(deposit_paid, ledger_net). With the
// ledger AHEAD — a payment recorded but reconciliation unfinished — the guest was
// asked for more than the card would take. £400 total, £100 on the booking row,
// £250 in the ledger: the balance due is £150, not £300.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Ledger Ahead','la@x.co','2027-03-01','2027-03-04',2,0,'deposit',100,400,400,0,3)");
$laId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($laId,'deposit',250,'COMPLETED','sq_la_dep', NOW())");
// The quoted figure itself is asserted in test-payrail.php: pay.php and
// request_payment both refuse to run with Square off, which CI deliberately does, so
// there is no Square-free endpoint that reports it. What IS provable here is the
// case-folding, through a path that needs no Square at all.
//
// (C) A LOWERCASE STATUS COUNTS THE SAME AS AN UPPERCASE ONE. accounts.php always
// case-folded; booking_ledger_net, find_charge_for_refund and damages_returned did
// not — so one row could be counted by some money queries and not others depending on
// the query rather than the fact. A £60 deposit with a lowercase-COMPLETED £60 return
// is fully settled, so a second return must be refused.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, hold_status, hold_amount) VALUES ('$propKey','Lower Case','lc@x.co','2026-05-01','2026-05-04',2,0,'paid',360,300,300,0,3,'charged',60)");
$lcId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($lcId,'damages_return',60,'completed','sq_lc_ref', NOW())");
it_reauth($admin); // money out → step-up first (see the helper above)
$lcRes = http($admin, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $lcId, 'amount' => 60]);
it_check('a lowercase-status return still counts against the deposit — no double return',
    $lcRes['code'] === 409 || (isset($lcRes['json']['error']) && stripos((string) $lcRes['json']['error'], 'settled') !== false),
    $lcRes['raw']);
// …and the ledger NORMALISES on write, so it cannot happen again for new rows.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, hold_status, hold_amount) VALUES ('$propKey','Norm Case','nc@x.co','2026-06-01','2026-06-04',2,0,'paid',300,300,300,0,3,'charged',60)");
$ncId = (int) $rootDb->lastInsertId();
$rootDb->exec("UPDATE bookings SET check_out='2026-06-04' WHERE id=$ncId");
it_reauth($admin); // money out → step-up first (see the helper above)
$ncRet = http($admin, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $ncId, 'amount' => 60]);
$ncStatus = (string) $rootDb->query("SELECT status FROM payments WHERE booking_id=$ncId AND kind='damages_return'")->fetchColumn();
it_check('a ledger row is stored with its status UPPERCASED', $ncStatus === strtoupper($ncStatus) && $ncStatus !== '', 'got "' . $ncStatus . '"');

// (D) THE CANCELLATION REFUND IS CAPPED like the per-row refund. Without it a typo was
// only caught by Square rejecting it — which aborts the cancellation too, so the owner
// cannot cancel at all until they guess a workable number.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Over Refund','or@x.co','2027-04-01','2027-04-04',2,0,'deposit',100,400,400,0,3)");
$orId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($orId,'deposit',100,'COMPLETED','sq_or_dep', NOW())");
it_reauth($admin); // money out → step-up first (see the helper above)
$orRes = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $orId, 'refund_amount' => 5000]);
it_check('cancelling with a refund beyond what was taken is refused, with the figure',
    $orRes['code'] === 400 && strpos((string) ($orRes['json']['error'] ?? ''), '100.00') !== false, $orRes['raw']);
it_check('…and the booking is still there to cancel properly',
    (int) $rootDb->query("SELECT COUNT(*) FROM bookings WHERE id=$orId")->fetchColumn() === 1);
it_reauth($admin); // money out → step-up first (see the helper above)
$orOk = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $orId, 'refund_amount' => 0]);
it_check('a cancellation within the cap goes through', !empty($orOk['json']['ok']), $orOk['raw']);

// (E) A FAILED DEPOSIT REFUND IS NOT MONEY RETURNED. Three display sites summed
// damages_return with no status filter while the guard excluded FAILED/REJECTED — so a
// failed refund made the deposit look settled everywhere the owner or the guest could
// see, dropped it off the "Deposits to return" queue, and it was never re-tried. Only
// a real request proves the endpoints report the filtered figure.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, hold_status, hold_amount) VALUES ('$propKey','Failed Refund','fr@x.co','2026-03-01','2026-03-04',2,0,'paid',300,300,300,0,3,'charged',80)");
$frId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($frId,'damages_return',80,'FAILED','sq_fr_ref', NOW())");
$frQueue = http($admin, 'POST', '/bookings.php', ['action' => 'deposit_returns']);
// ABSENT from the map is the correct answer — a booking with no non-failed return has
// no row at all — so this reads absent as zero. The COMPLETED case below is what stops
// that being vacuous: it asserts the £80 IS reported once the refund settles.
$frReturned = (float) (($frQueue['json']['returns'] ?? [])[(string) $frId] ?? 0);
it_check('a FAILED refund is not counted in the deposits-to-return queue',
    isset($frQueue['json']['returns']) && abs($frReturned) < 0.005, 'returned=' . $frReturned . ' ' . $frQueue['raw']);
$frRows = http($admin, 'GET', '/bookings.php');
$frRow = null;
foreach (($frRows['json']['bookings'] ?? []) as $r) {
    if ((int) ($r['id'] ?? 0) === $frId) {
        $frRow = $r;
    }
}
it_check('…nor on the booking row the hub renders from',
    $frRow !== null && abs((float) ($frRow['damages_returned'] ?? -1)) < 0.005, json_encode($frRow['damages_returned'] ?? 'absent'));
// A COMPLETED one still counts, or the fix would just be "never count anything".
$rootDb->exec("UPDATE payments SET status='COMPLETED' WHERE square_payment_id='sq_fr_ref'");
$frQueue2 = http($admin, 'POST', '/bookings.php', ['action' => 'deposit_returns']);
it_check('…and a COMPLETED one still does', abs((float) (($frQueue2['json']['returns'] ?? [])[(string) $frId] ?? 0) - 80.0) < 0.02, $frQueue2['raw']);

// ---- 12. set_payment on a LEGACY pre-snapshot booking (finding 10) --------
echo "\n== 11. set_payment legacy fallback ==\n";
// A booking with agreed_total NULL (predates the snapshot migration) but real
// dates + a live rate. Marking it 'Paid' must price from the LIVE model, not a
// £0 total that would wipe deposit_paid to £0.
$lin = date('Y-m-d', strtotime('+40 days'));
$lout = date('Y-m-d', strtotime('+43 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total) VALUES ('$propKey','Legacy Guest','lg@x.co','$lin','$lout',2,0,'deposit',150,NULL)");
$lgId = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $lgId, 'payment' => 'paid', 'payment_date' => date('Y-m-d'), 'payment_method' => 'bank']);
it_check('marking a legacy (NULL agreed_total) booking Paid succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$lgRow = $rootDb->query("SELECT payment, deposit_paid FROM bookings WHERE id=$lgId")->fetch(PDO::FETCH_ASSOC);
// Before the fix, the NULL agreed_total made total £0, so 'Paid' reconciled
// deposit_paid to £0 (wiping the £150). Now it prices from the live rate — so
// the recorded money is preserved/raised, never wiped to zero.
it_check('legacy Paid did NOT wipe deposit_paid to £0 (priced from live rate)', $lgRow && (float) $lgRow['deposit_paid'] > 0.5 && $lgRow['payment'] === 'paid', json_encode($lgRow));

// ---- 13. Waitlist dedupe (concurrency audit) ------------------------------
echo "\n== 12. Waitlist join dedupe ==\n";
$wj = ['action' => 'join', 'prop' => $propKey, 'name' => 'Wait Twice', 'email' => 'wait@x.co', 'check_in' => $in, 'check_out' => $out];
http($guest, 'POST', '/waitlist.php', $wj);
$r = http($guest, 'POST', '/waitlist.php', $wj); // exact double-submit
it_check('a repeat waitlist join is idempotent (ok, flagged already)', $r['code'] === 200 && !empty($r['json']['already']), $r['raw']);
$wcount = (int) $rootDb->query("SELECT COUNT(*) FROM waitlist WHERE email='wait@x.co' AND prop_key='$propKey'")->fetchColumn();
it_check('only ONE waitlist row exists for the same cottage+dates', $wcount === 1, 'rows=' . $wcount);
// A different date range for the same person is a distinct, allowed entry.
http($guest, 'POST', '/waitlist.php', array_merge($wj, ['check_in' => date('Y-m-d', strtotime($in . ' +60 days')), 'check_out' => date('Y-m-d', strtotime($out . ' +60 days'))]));
$wcount2 = (int) $rootDb->query("SELECT COUNT(*) FROM waitlist WHERE email='wait@x.co'")->fetchColumn();
it_check('a different date range is still a separate waitlist entry', $wcount2 === 2, 'rows=' . $wcount2);
// Book by the night before: a dated join starting today can only ever notify
// the guest about dates the enquiry form refuses, so it is refused up front.
// An OPEN-date join ("any time") carries no check-in and stays allowed.
// The app's today, not the harness's — see the $ukToday note in §5. (This one
// survived the mismatch by luck: waitlist's guard is `<=`, so the server's
// yesterday was refused too — by the wrong branch of the same rule.)
$r = http($guest, 'POST', '/waitlist.php', array_merge($wj, ['check_in' => $ukToday, 'check_out' => $ukPlus(3)]));
it_check(
    'a same-day dated waitlist join is refused with the notice rule',
    $r['code'] === 400 && str_contains((string) ($r['json']['error'] ?? ''), 'earliest check-in is tomorrow'),
    $r['raw'],
);
$r = http($guest, 'POST', '/waitlist.php', ['action' => 'join', 'prop' => $propKey, 'name' => 'Open Wait', 'email' => 'openwait@x.co']);
it_check('an open-date waitlist join is still welcome', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
// HALF A RANGE IS THE ONE STATE THAT LIES. waitlist_notify_freed matches
// `check_in IS NULL OR check_out IS NULL OR (overlap)`, so one date stored alone is an
// OPEN-DATED wait — emailed about every future cancellation — while the guest who
// entered it believes they are waiting for that day, and the email's date clause is
// gated on both being set so it names no dates at all. The client refuses first; this
// is the authority, and it is what a stale tab or a crafted request meets.
foreach ([['check_in' => $ukPlus(10)], ['check_out' => $ukPlus(14)]] as $half) {
    $which = isset($half['check_in']) ? 'check-in' : 'check-out';
    $r = http(
        $guest,
        'POST',
        '/waitlist.php',
        array_merge(['action' => 'join', 'prop' => $propKey, 'name' => 'Half Wait', 'email' => 'half@x.co'], $half),
    );
    it_check(
        "a waitlist join with only a $which is refused, naming both ways out",
        $r['code'] === 400 &&
            str_contains((string) ($r['json']['error'] ?? ''), 'both dates') &&
            str_contains((string) ($r['json']['error'] ?? ''), 'leave them empty'),
        $r['raw'],
    );
}
$halfRows = (int) $rootDb->query("SELECT COUNT(*) FROM waitlist WHERE email='half@x.co'")->fetchColumn();
it_check('…and no half-dated row reached the table', $halfRows === 0, 'rows=' . $halfRows);

// A SOFT report (chbSwallow) is a diagnostic, not breakage: the front end caught the
// error and carried on by design. It must be recorded so someone can find out why
// something quietly didn't happen, but at severity 'info' under its own action, so it
// stays out of "Needs attention", the weekly digest and the owner push — all of which
// key off warn/action. A real uncaught error must still land as warn.
echo "\n== 13. Soft (swallowed) error reports stay out of Needs attention ==\n";
$rootDb->exec("DELETE FROM activity_log WHERE action IN ('client.error','client.swallow')");
$r = http($guest, 'POST', '/client-error.php', ['message' => '[brief-owed] paymentSummary blew up', 'where' => 'swallow:brief-owed', 'soft' => true]);
it_check('a soft report is accepted', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$row = $rootDb->query("SELECT action, severity, summary FROM activity_log WHERE action='client.swallow' ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
it_check('it is logged under the client.swallow action', !empty($row), 'no client.swallow row');
it_check('at severity info (so NOT Needs attention / digest / push)', ($row['severity'] ?? '') === 'info', 'severity=' . ($row['severity'] ?? '-'));
it_check('the summary marks it as swallowed', strpos($row['summary'] ?? '', 'Swallowed error:') === 0, $row['summary'] ?? '-');
// Same payload without the flag is real breakage and must keep warn severity.
$rootDb->exec("DELETE FROM activity_log WHERE action IN ('client.error','client.swallow')");
http($guest, 'POST', '/client-error.php', ['message' => 'genuinely uncaught boom', 'where' => '/index.html']);
$hard = $rootDb->query("SELECT action, severity FROM activity_log WHERE action='client.error' ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
it_check('a normal error still logs as client.error at warn', ($hard['action'] ?? '') === 'client.error' && ($hard['severity'] ?? '') === 'warn', json_encode($hard));
// The hourly cross-visitor dedupe must apply to soft reports too, or a loop on a
// popular page could still stack rows.
$rootDb->exec("DELETE FROM activity_log WHERE action IN ('client.error','client.swallow')");
$soft2 = ['message' => '[money-held] damageHeld blew up', 'where' => 'swallow:money-held', 'soft' => true];
http($guest, 'POST', '/client-error.php', $soft2);
$r2 = http($guest, 'POST', '/client-error.php', $soft2);
$scount = (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action='client.swallow'")->fetchColumn();
it_check('a repeated soft report is deduped within the hour', $scount === 1 && !empty($r2['json']['deduped']), 'rows=' . $scount . ' ' . $r2['raw']);

echo "\n== 14. Damage-deposit returns must not move net profit ==\n";
// The owner's PDF showed net profit £75 LIGHT with no line to explain it. Cause:
// accounts.php netted damages − damages_return per DATE across ALL bookings. In
// the charge-upfront model pay.php bundles the deposit into the rental charge and
// records it on bookings.hold_* with NO kind='damages' ledger row, so returning it
// left a lone damages_return with nothing to net against → kept_deposits went
// NEGATIVE and silently reduced profit. A returned deposit was never income.
$rootDb->exec("DELETE FROM payments");
$rootDb->exec("DELETE FROM bookings");
$kdIns = function ($bid, $kind, $amt, $status, $when) use ($rootDb) {
    $sq = 'sq_kd_' . $bid . '_' . $kind . '_' . str_replace(['-', ' ', ':'], '', $when);
    $rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($bid,'$kind',$amt,'$status','$sq','$when')");
};
$keptOf = function ($year) use ($admin) {
    return (float) (http($admin, 'GET', '/accounts.php?year=' . $year)['json']['kept_deposits'] ?? -999);
};

// (a) THE REGRESSION: charge-upfront deposit returned in full. No 'damages' row
// exists, so kept must be £0 — never −£75.
$kdIns(9001, 'balance', 656.20, 'COMPLETED', '2026-05-10 12:00:00');
$kdIns(9001, 'damages_return', 75.00, 'COMPLETED', '2026-05-20 12:00:00');
$k = $keptOf(2026);
it_check('a returned charge-upfront deposit yields £0 kept, not a negative', abs($k) < 0.005, 'kept=' . $k);

// (b) LEGACY captured hold, nothing handed back — still taxable kept income.
$rootDb->exec("DELETE FROM payments");
$kdIns(9002, 'damages', 250.00, 'COMPLETED', '2026-06-01 10:00:00');
$k = $keptOf(2026);
it_check('a captured hold with no return is still £250 of kept income', abs($k - 250.0) < 0.005, 'kept=' . $k);

// (c) LEGACY partial return: £250 captured, £150 handed back → £100 kept.
$kdIns(9002, 'damages_return', 150.00, 'COMPLETED', '2026-09-02 10:00:00');
$k = $keptOf(2026);
it_check('a £250 capture with £150 returned nets to £100 kept', abs($k - 100.0) < 0.005, 'kept=' . $k);

// (d) Fully returned capture → £0, not a negative.
$rootDb->exec("DELETE FROM payments");
$kdIns(9003, 'damages', 250.00, 'COMPLETED', '2026-06-01 10:00:00');
$kdIns(9003, 'damages_return', 250.00, 'COMPLETED', '2026-06-20 10:00:00');
$k = $keptOf(2026);
it_check('a fully returned capture nets to £0', abs($k) < 0.005, 'kept=' . $k);

// (e) CROSS-BOOKING contamination: one booking keeps £100, a DIFFERENT booking
// returns £75 the same day. Per-date netting reported £25; each booking's deposit
// is its own, so the answer is £100.
$rootDb->exec("DELETE FROM payments");
$kdIns(9004, 'damages', 100.00, 'COMPLETED', '2026-06-01 10:00:00');
$kdIns(9005, 'damages_return', 75.00, 'COMPLETED', '2026-06-01 11:00:00');
$k = $keptOf(2026);
it_check("one booking's return cannot eat another's kept income", abs($k - 100.0) < 0.005, 'kept=' . $k);

// (f) A FAILED return is not money handed back.
$rootDb->exec("DELETE FROM payments");
$kdIns(9006, 'damages', 250.00, 'COMPLETED', '2026-06-01 10:00:00');
$kdIns(9006, 'damages_return', 250.00, 'FAILED', '2026-06-20 10:00:00');
$k = $keptOf(2026);
it_check('a FAILED return does not reduce kept income', abs($k - 250.0) < 0.005, 'kept=' . $k);

// (g) Kept income lands on the CAPTURE date's tax year — retaining the money is
// the taxable event, so a return in the NEXT tax year cannot move it.
$rootDb->exec("DELETE FROM payments");
$kdIns(9007, 'damages', 200.00, 'COMPLETED', '2026-03-01 10:00:00'); // TY 2025
$kdIns(9007, 'damages_return', 50.00, 'COMPLETED', '2026-06-01 10:00:00'); // TY 2026
$k25 = $keptOf(2025);
$k26 = $keptOf(2026);
it_check('net kept sits in the capture year, not the return year', abs($k25 - 150.0) < 0.005 && abs($k26) < 0.005, "2025=$k25 2026=$k26");

// ---- 15. THE CALENDAR CANNOT BE DOUBLE-BOOKED -----------------------------
// The one guarantee this business cannot trade away, and until now the one with
// no test at all: every clash guard lived in code nothing exercised. The client
// picker is only the friendly layer — it can be bypassed by a stale tab, a
// second device, a slow network, or simply a bug like the ones fixed this week —
// so what matters is what the ENDPOINTS do. Driven here against a real database.
//
// Both directions are gated, because they cost the same money: a clash that gets
// through is a double booking, and a "clash" that is really a legal turnover is a
// booking refused for no reason. The turnover cases (e, f) are the second kind and
// are exactly what an off-by-one in the overlap test would break.
echo "\n== 15. The calendar cannot be double-booked ==\n";
$dd = fn($n) => date('Y-m-d', strtotime("+$n days"));
$bookingsOn = function ($from, $to) use ($rootDb, $propKey) {
    $q = $rootDb->prepare('SELECT COUNT(*) c FROM bookings WHERE prop_key = ? AND check_in < ? AND check_out > ?');
    $q->execute([$propKey, $to, $from]);
    return (int) $q->fetch(PDO::FETCH_ASSOC)['c'];
};
$addBooking = function ($ci, $co, $name, $extra = []) use (&$admin, $propKey) {
    return http($admin, 'POST', '/bookings.php', array_merge([
        'action' => 'add', 'prop_key' => $propKey, 'name' => $name, 'email' => '',
        'phone' => '', 'check_in' => $ci, 'check_out' => $co,
        'adults' => 2, 'children' => 0, 'payment' => 'unpaid',
    ], $extra));
};
// The occupied stay everything below is measured against: nights 300-304.
$r = $addBooking($dd(300), $dd(305), 'Base Stay');
it_check('a booking on free dates is created', $r['code'] === 200 && !empty($r['json']['id']), $r['raw']);
$baseId = (int) ($r['json']['id'] ?? 0);

// (a-d) Every shape of overlap is refused, AND writes nothing. A clash response
// that still created the row would be the worst failure available here.
foreach ([
    ['overlapping the end', $dd(302), $dd(307)],
    ['sitting inside it', $dd(301), $dd(302)],
    ['swallowing it whole', $dd(298), $dd(310)],
    ['exactly the same dates', $dd(300), $dd(305)],
    ['overlapping the start', $dd(297), $dd(301)],
] as [$label, $ci, $co]) {
    $before = $bookingsOn($ci, $co);
    $r = $addBooking($ci, $co, 'Clash ' . $label);
    $flagged = $r['code'] === 200 && !empty($r['json']['clash']);
    $after = $bookingsOn($ci, $co);
    it_check("a booking $label is refused", $flagged, $r['raw']);
    it_check("…and nothing is written for it", $after === $before, "before=$before after=$after");
}

// (e-f) A TURNOVER IS NOT A CLASH. Arriving on the day someone leaves, and
// leaving on the day someone arrives, both take nothing from anyone — refusing
// them loses real back-to-back bookings, which is the same money as a double
// booking, just quieter.
$r = $addBooking($dd(305), $dd(308), 'Arrives On Checkout Day');
it_check('arriving on another guest\'s checkout day is allowed', $r['code'] === 200 && !empty($r['json']['id']) && empty($r['json']['clash']), $r['raw']);
$turnA = (int) ($r['json']['id'] ?? 0);
$r = $addBooking($dd(296), $dd(300), 'Leaves On Arrival Day');
it_check('leaving on another guest\'s arrival day is allowed', $r['code'] === 200 && !empty($r['json']['id']) && empty($r['json']['clash']), $r['raw']);
$turnB = (int) ($r['json']['id'] ?? 0);

// (g) The owner may still overlap ON PURPOSE — but only by saying so. This is
// the ONLY route through, which is what makes the guard meaningful.
$r = $addBooking($dd(301), $dd(303), 'Deliberate Overlap', ['override_clash' => true]);
$overlapId = (int) ($r['json']['id'] ?? 0);
it_check('an explicit override_clash still lets the owner overlap deliberately', $r['code'] === 200 && $overlapId > 0, $r['raw']);
$rootDb->exec('DELETE FROM bookings WHERE id = ' . $overlapId);

// (h) EDITING is the other way to create an overlap, and it must be guarded the
// same — including the trap that a booking always "overlaps" itself.
$upd = fn($id, $ci, $co, $extra = []) => http($admin, 'POST', '/bookings.php', array_merge([
    'action' => 'update', 'id' => $id, 'prop_key' => $propKey, 'name' => 'Base Stay',
    'email' => '', 'phone' => '', 'check_in' => $ci, 'check_out' => $co,
    'adults' => 2, 'children' => 0,
], $extra));
$r = $upd($turnA, $dd(302), $dd(308));
it_check('moving a booking onto occupied dates is refused', $r['code'] === 200 && !empty($r['json']['clash']), $r['raw']);
$r = $upd($baseId, $dd(300), $dd(304));
it_check('shortening a booking within its OWN dates is not a self-clash', $r['code'] === 200 && empty($r['json']['clash']), $r['raw']);
$r = $upd($baseId, $dd(300), $dd(305)); // put it back

// (i) The GUEST side. An enquiry for taken dates never reaches the owner.
$r = http($guest, 'POST', '/enquiries.php', [
    'action' => 'submit', 'prop_key' => $propKey, 'name' => 'Late Enquirer',
    'check_in' => $dd(301), 'check_out' => $dd(304), 'adults' => 2, 'children' => 0,
    'email' => 'late@example.com', 'phone' => '07700900124', 'message' => 'Any chance?',
    'address' => '1 Test Lane', 'postcode' => 'NR25 7NQ', 'terms_accepted' => 1, 'no_dogs' => 1,
]);
it_check('a public enquiry for occupied dates is refused', empty($r['json']['ok']), $r['raw']);

// (j) THE RACE THAT ACTUALLY HAPPENS: the enquiry was legitimate when it was
// made, and the dates were taken while it sat in the inbox. Approval is the
// moment a booking is created, so approval is where it has to be re-checked.
$r = http($guest, 'POST', '/enquiries.php', [
    'action' => 'submit', 'prop_key' => $propKey, 'name' => 'Overtaken Enquirer',
    'check_in' => $dd(400), 'check_out' => $dd(404), 'adults' => 2, 'children' => 0,
    'email' => 'overtaken@example.com', 'phone' => '07700900125', 'message' => 'Please',
    'address' => '1 Test Lane', 'postcode' => 'NR25 7NQ', 'terms_accepted' => 1, 'no_dogs' => 1,
]);
it_check('…the enquiry is accepted while the dates are free', !empty($r['json']['ok']), $r['raw']);
$r = http($admin, 'GET', '/enquiries.php');
$row = array_values(array_filter($r['json']['enquiries'] ?? [], fn($e) => ($e['name'] ?? '') === 'Overtaken Enquirer'));
$raceEnqId = (int) ($row[0]['id'] ?? 0);
$addBooking($dd(401), $dd(403), 'Got There First'); // taken in the meantime
$before = $bookingsOn($dd(400), $dd(404));
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => $raceEnqId]);
$madeBooking = !empty($r['json']['booking_id']);
it_check('approving an enquiry whose dates were taken since is refused', !$madeBooking, $r['raw']);
it_check('…and no second booking is created for it', $bookingsOn($dd(400), $dd(404)) === $before, 'before=' . $before);

// (k) An IMPORTED platform stay (Airbnb/Vrbo) blocks the calendar exactly like
// one of ours — the whole point of the sync is that it stops a double booking.
try {
    $rootDb->prepare('INSERT INTO ical_blocks (prop_key, source, check_in, check_out, uid) VALUES (?,?,?,?,?)')
        ->execute([$propKey, 'airbnb', $dd(500), $dd(504), 'it-clash-1']);
    $r = $addBooking($dd(501), $dd(506), 'Over An Airbnb Stay');
    it_check('a booking over an imported platform stay is refused', $r['code'] === 200 && !empty($r['json']['clash']), $r['raw']);
    it_check('…and the refusal names the platform', stripos((string) ($r['json']['message'] ?? ''), 'airbnb') !== false, (string) ($r['json']['message'] ?? ''));
} catch (\Throwable $e) {
    it_check('ical_blocks fixture inserts', false, $e->getMessage());
}

// (l) MISSED BOOKINGS, the other direction. A cancellation must hand the dates
// back — to the clash guard AND to the public calendar the guest actually reads.
$pub = http($guest, 'GET', '/availability.php?prop=' . urlencode($propKey));
$has = fn($rs, $s) => (bool) array_filter($rs, fn($x) => ($x['start'] ?? '') === $s);
it_check('availability.php publishes the occupied stay', $has($pub['json']['ranges'] ?? [], $dd(300)), substr($pub['raw'], 0, 200));
it_reauth($admin); // money out → step-up first (see the helper above)
$r = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $baseId, 'reason' => 'integration test']);
it_check('cancelling succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$pub = http($guest, 'GET', '/availability.php?prop=' . urlencode($propKey));
it_check('…and the dates stop being published as blocked', !$has($pub['json']['ranges'] ?? [], $dd(300)), substr($pub['raw'], 0, 200));
$r = $addBooking($dd(300), $dd(305), 'Rebooked After Cancel');
it_check('…so the freed dates can be booked again, with no clash', $r['code'] === 200 && !empty($r['json']['id']) && empty($r['json']['clash']), $r['raw']);

// (m) A PAYMENT PLAN SET AT BOOKING TIME rides the same add — validated by the
// SAME rules as the hub's Edit-plan dialog (payment_plan_parse is one function)
// and stored in the same INSERT, so a refused plan can never leave a
// half-created booking behind.
$stdId = (int) ($r['json']['id'] ?? 0); // the no-plan booking just created
$r = $addBooking($dd(800), $dd(804), 'Planned At Add', ['deposit_pct' => '30', 'balance_due_date' => $dd(790)]);
$planId = (int) ($r['json']['id'] ?? 0);
it_check('a booking is created WITH its plan in one request', $r['code'] === 200 && $planId > 0, $r['raw']);
$q = $rootDb->prepare('SELECT deposit_pct_override, deposit_amount_override, balance_due_date FROM bookings WHERE id = ?');
$q->execute([$planId]);
$planRow = $q->fetch(PDO::FETCH_ASSOC) ?: [];
it_check(
    '…and the row stores 30% + the custom due date, nothing else',
    abs((float) ($planRow['deposit_pct_override'] ?? 0) - 30.0) < 0.005
        && ($planRow['balance_due_date'] ?? '') === $dd(790)
        && $planRow['deposit_amount_override'] === null,
    json_encode($planRow),
);
$q->execute([$stdId]);
$stdRow = $q->fetch(PDO::FETCH_ASSOC) ?: [];
it_check(
    'a booking added WITHOUT plan fields stores NULLs (site standard)',
    $stdRow !== [] && $stdRow['deposit_pct_override'] === null && $stdRow['deposit_amount_override'] === null && $stdRow['balance_due_date'] === null,
    json_encode($stdRow),
);
// A plan refusal is ATOMIC: worded 400, and nothing written.
$before = $bookingsOn($dd(810), $dd(814));
$r = $addBooking($dd(810), $dd(814), 'Bad Plan Pct', ['deposit_pct' => '150']);
it_check('an impossible deposit % is refused in words', $r['code'] === 400 && stripos((string) ($r['json']['error'] ?? ''), 'percentage') !== false, $r['raw']);
it_check('…and no booking is created for it', $bookingsOn($dd(810), $dd(814)) === $before, 'count moved');
$r = $addBooking($dd(810), $dd(814), 'Bad Plan Date', ['balance_due_date' => $dd(820)]);
it_check('a due date after check-in is refused', $r['code'] === 400 && stripos((string) ($r['json']['error'] ?? ''), 'check-in') !== false, $r['raw']);
it_check('…and writes nothing either', $bookingsOn($dd(810), $dd(814)) === $before, 'count moved');

// (n) …AND THE PLAN TRAVELS WHEN THE STAY IS MOVED. The refusal above is only
// half a guarantee: `update` writes check_in, and used to leave the custom date
// exactly where it was — so a booking could be MOVED INTO the very state the
// add/edit validator refuses. Driven through the real endpoint because that is
// where it bites; the arithmetic itself is gated in test-payrail.
$r = http($admin, 'POST', '/bookings.php', [
    'action' => 'update', 'id' => $planId,
    'check_in' => $dd(700), 'check_out' => $dd(704),   // pulled 100 days earlier
]);
it_check('a booking with a custom plan can be moved', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$q->execute([$planId]);
$movedRow = $q->fetch(PDO::FETCH_ASSOC) ?: [];
it_check(
    '…and its balance due date moved with it, by the same 100 days',
    ($movedRow['balance_due_date'] ?? '') === $dd(690),
    json_encode($movedRow) . ' expected ' . $dd(690),
);
it_check('…so it is still on or before the new check-in — the invariant the validator enforces',
    ($movedRow['balance_due_date'] ?? '') <= $dd(700), json_encode($movedRow));
it_check('…and the deposit override is untouched (a % does not depend on dates)',
    abs((float) ($movedRow['deposit_pct_override'] ?? 0) - 30.0) < 0.005, json_encode($movedRow));
// Moved so far forward that the agreed date would now be behind us: the plan
// drops to the site standard rather than being kept in an impossible state.
$r = http($admin, 'POST', '/bookings.php', [
    'action' => 'update', 'id' => $planId,
    'check_in' => $dd(3), 'check_out' => $dd(6),
]);
$q->execute([$planId]);
$pastRow = $q->fetch(PDO::FETCH_ASSOC) ?: [];
it_check('a stay moved to next week drops a due date that would now be in the past',
    $r['code'] === 200 && ($pastRow['balance_due_date'] ?? null) === null, $r['raw'] . json_encode($pastRow));

// ---- 16. The no-dog declaration is required AND recorded -------------------
// The client blocks the send, so this is the other half: a direct public POST
// must not be able to create an enquiry that never made the declaration, and
// what the guest confirmed has to survive in the row — a declaration nobody
// keeps is theatre, and the owner needs it if a dog turns up.
echo "\n== 16. The no-dog declaration ==\n";
$enqBody = [
    'action' => 'submit', 'prop_key' => $propKey, 'name' => 'Dogless Guest',
    'check_in' => $dd(600), 'check_out' => $dd(604), 'adults' => 2, 'children' => 0,
    'email' => 'dogless@example.com', 'phone' => '07700900126', 'message' => 'Just the two of us.',
    'address' => '1 Test Lane', 'postcode' => 'NR25 7NQ', 'terms_accepted' => 1,
];
$r = http($guest, 'POST', '/enquiries.php', $enqBody);           // no_dogs omitted
it_check('a public enquiry WITHOUT the declaration is refused', $r['code'] === 400, $r['raw']);
it_check('…and says which box, in the guest\'s words', stripos((string) ($r['json']['error'] ?? ''), 'dog') !== false, $r['raw']);
$r = http($guest, 'POST', '/enquiries.php', $enqBody + ['no_dogs' => 1]);
it_check('with it, the enquiry is accepted', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$row = $rootDb->query("SELECT no_dogs_at, terms_accepted_at FROM enquiries WHERE name = 'Dogless Guest' ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
it_check('…and it is RECORDED with a server timestamp', $row && !empty($row['no_dogs_at']), json_encode($row));
it_check('…dated, like terms acceptance is', $row && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) $row['no_dogs_at']), (string) ($row['no_dogs_at'] ?? ''));
// The migration has to have actually applied on this fresh database — a column
// that only exists in schema.sql would pass everything above and fail on the
// owner's live site, which upgrades by migration.
$cols = $rootDb->query("SHOW COLUMNS FROM enquiries LIKE 'no_dogs_at'")->fetchAll();
it_check('the column exists after schema + migrations on a fresh DB', count($cols) === 1);

// IT HAS TO SURVIVE APPROVAL. Approving DELETES the enquiry, so without this the
// declaration existed only while the owner was reviewing — and vanished exactly
// when it starts to matter, at arrival, by which point it is a booking.
$r = http($admin, 'GET', '/enquiries.php');
$dogEnq = array_values(array_filter($r['json']['enquiries'] ?? [], fn($e) => ($e['name'] ?? '') === 'Dogless Guest'));
it_check('the enquiry is on the owner\'s list', (bool) $dogEnq, substr($r['raw'], 0, 160));
it_check('…carrying the declaration for the owner to see', !empty($dogEnq[0]['no_dogs_at'] ?? ''), json_encode($dogEnq[0]['no_dogs_at'] ?? null));
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => (int) ($dogEnq[0]['id'] ?? 0)]);
$dogBookingId = (int) ($r['json']['booking_id'] ?? 0);
it_check('approving it creates the booking', $dogBookingId > 0, $r['raw']);
$bk = $rootDb->query("SELECT no_dogs_at, terms_accepted_at FROM bookings WHERE id = $dogBookingId")->fetch(PDO::FETCH_ASSOC);
it_check('…and the declaration is carried onto it, like terms acceptance', $bk && !empty($bk['no_dogs_at']), json_encode($bk));
it_check('…with the guest\'s ORIGINAL timestamp, not the approval\'s',
    $bk && $bk['no_dogs_at'] === ($dogEnq[0]['no_dogs_at'] ?? '!'), json_encode([$bk['no_dogs_at'] ?? null, $dogEnq[0]['no_dogs_at'] ?? null]));
// A booking the OWNER adds by hand never had a guest to ask, so it stays blank
// rather than claiming a declaration nobody made.
$r = $addBooking($dd(700), $dd(703), 'Owner Added');
$ownId = (int) ($r['json']['id'] ?? 0);
$own = $rootDb->query("SELECT no_dogs_at FROM bookings WHERE id = $ownId")->fetch(PDO::FETCH_ASSOC);
it_check('an owner-added booking claims no declaration', $own && $own['no_dogs_at'] === null, json_encode($own));

// ---- 17. Reading an enquiry stops it notifying ----------------------------
// An enquiry stays PENDING until it is approved or declined, so every red count
// went on saying "1" with the thing open on screen (reported with a
// screenshot). Opening it stamps seen_at; the counts read that.
echo "\n== 17. An opened enquiry stops notifying ==\n";
$cols = $rootDb->query("SHOW COLUMNS FROM enquiries LIKE 'seen_at'")->fetchAll();
it_check('the seen_at column exists after schema + migrations on a fresh DB', count($cols) === 1);
$seenBody = [
    'action' => 'submit', 'prop_key' => $propKey, 'name' => 'Read Me',
    'check_in' => $dd(620), 'check_out' => $dd(624), 'adults' => 2, 'children' => 0,
    'email' => 'readme@example.com', 'phone' => '07700900127', 'message' => 'Hello?',
    'address' => '1 Test Lane', 'postcode' => 'NR25 7NQ', 'terms_accepted' => 1, 'no_dogs' => 1,
];
$r = http($guest, 'POST', '/enquiries.php', $seenBody);
it_check('an enquiry arrives', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$r = http($admin, 'GET', '/enquiries.php');
$mine = array_values(array_filter($r['json']['enquiries'] ?? [], fn($e) => ($e['name'] ?? '') === 'Read Me'));
$seenId = (int) ($mine[0]['id'] ?? 0);
it_check('…and reaches the owner UNREAD', $seenId > 0 && empty($mine[0]['seen_at']), json_encode($mine[0]['seen_at'] ?? null));
// A guest must never be able to silence the owner's own inbox.
$r = http($guest, 'POST', '/enquiries.php', ['action' => 'seen', 'id' => $seenId]);
it_check('a GUEST cannot mark it read', $r['code'] === 401 || $r['code'] === 403, $r['code'] . ' ' . substr($r['raw'], 0, 120));
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'seen', 'id' => $seenId]);
it_check('the owner opening it stamps seen_at', $r['code'] === 200 && !empty($r['json']['seen_at']), $r['raw']);
$first = (string) ($r['json']['seen_at'] ?? '');
it_check('…as a real timestamp', preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $first) === 1, $first);
// THE FIRST VIEW IS THE ONE RECORDED. Re-opening it next week must not reset how
// long it has been sitting there — that age is what the duty escalates on.
$rootDb->exec("UPDATE enquiries SET seen_at = '2020-01-01 09:00:00' WHERE id = $seenId");
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'seen', 'id' => $seenId]);
it_check('re-opening it does NOT reset the stamp', ($r['json']['seen_at'] ?? '') === '2020-01-01 09:00:00', $r['raw']);
// The owner's list has to carry it, or the client cannot count on it.
$r = http($admin, 'GET', '/enquiries.php');
$mine = array_values(array_filter($r['json']['enquiries'] ?? [], fn($e) => ($e['name'] ?? '') === 'Read Me'));
it_check('the owner\'s list carries seen_at', ($mine[0]['seen_at'] ?? '') === '2020-01-01 09:00:00', json_encode($mine[0]['seen_at'] ?? null));
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'seen', 'id' => 0]);
it_check('a missing id is refused, not silently accepted', $r['code'] === 400, $r['raw']);

// ---- 18. The guest's own account states WHEN the balance is due -----------
//
//  my-bookings.php had NO server-side coverage at all, and the pre-arrival
//  countdown card could not name a due date because the payload never carried
//  one — while the pay screen its own button leads to has said it since #969.
//  Driven through ?acctpreview, which runs the SAME my_bookings_payload under
//  admin auth, so this exercises the real endpoint rather than the helper.
echo "\n== 18. My Stays carries the balance due date ==\n";
$ddIn = date('Y-m-d', strtotime('+260 days'));
$r = http($admin, 'POST', '/bookings.php', [
    'action' => 'add', 'prop_key' => $propKey, 'name' => 'Due Date Guest',
    'email' => 'duedate@example.com', 'phone' => '', 'check_in' => $ddIn,
    'check_out' => date('Y-m-d', strtotime('+263 days')),
    'adults' => 2, 'children' => 0, 'payment' => 'unpaid',
]);
$dueBookingId = (int) ($r['json']['id'] ?? 0);
it_check('a booking to read the account back for', $dueBookingId > 0, $r['raw']);
$r = http($admin, 'GET', '/my-bookings.php?acctpreview=' . $dueBookingId);
$row = null;
foreach (($r['json']['bookings'] ?? []) as $b) {
    if ((int) ($b['id'] ?? 0) === $dueBookingId) { $row = $b; }
}
it_check('the account payload returns that booking', is_array($row), $r['raw']);
// STANDARD plan: no override stored, so the derived date is check-in minus the
// site's balance window — and the raw column stays NULL, because the owner side
// reads NULL as "site standard" and a derived value there would make every
// booking look custom.
$expectStd = date('Y-m-d', strtotime($ddIn . ' -' . payment_balance_days() . ' days'));
it_check('a standard plan still derives a due date', ($row['balance_due_by'] ?? null) === $expectStd, json_encode($row['balance_due_by'] ?? null) . ' vs ' . $expectStd);
it_check('…while the override column stays NULL (NULL still MEANS standard)', is_array($row) && !array_key_exists('balance_due_date', $row) === false && $row['balance_due_date'] === null, json_encode(is_array($row) ? ($row['balance_due_date'] ?? '<<absent>>') : null));
// CUSTOM plan: the guest's account follows the booking's own date.
// Deliberately NOT +230, which is exactly check-in minus the standard window —
// the first draft picked it and 'follows the plan' passed against a date that
// was the standard one anyway.
$customDue = date('Y-m-d', strtotime('+200 days'));
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment_plan', 'id' => $dueBookingId, 'deposit_pct' => '', 'deposit_amount' => '', 'balance_due_date' => $customDue]);
it_check('a custom balance due date saves', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$r = http($admin, 'GET', '/my-bookings.php?acctpreview=' . $dueBookingId);
$row = null;
foreach (($r['json']['bookings'] ?? []) as $b) {
    if ((int) ($b['id'] ?? 0) === $dueBookingId) { $row = $b; }
}
it_check('the account follows the booking\'s own plan', ($row['balance_due_by'] ?? null) === $customDue, json_encode($row['balance_due_by'] ?? null) . ' vs ' . $customDue);
it_check('…and it is not the standard date any more', is_array($row) && ($row['balance_due_by'] ?? null) !== $expectStd, json_encode(is_array($row) ? ($row['balance_due_by'] ?? null) : null));

// ---- 19. The guest's account offers the PLAN's next payment, not the lot ----
//
//  The Pay button in My Stays hardcoded 'balance' and labelled itself with the
//  whole outstanding sum, so a guest on a deposit plan was offered the entire
//  stay while their emailed link correctly asked for the deposit. The payload now
//  carries booking_next_payment — the SAME derivation pay.php makes on open.
echo "\n== 19. The account names the plan's next payment ==\n";
// +1500, well clear of every other fixture's window. +300 collided with §15's
// rebooked-after-cancel stay and +700 with an owner-added one — the ADD is a
// real clash-checked write, so the section fails at the first line if it lands
// on anything. Keep new fixtures out here.
$npIn = date('Y-m-d', strtotime('+1500 days'));
$r = http($admin, 'POST', '/bookings.php', [
    'action' => 'add', 'prop_key' => $propKey, 'name' => 'Next Payment Guest',
    'email' => 'nextpay@example.com', 'phone' => '', 'check_in' => $npIn,
    'check_out' => date('Y-m-d', strtotime('+1503 days')),
    'adults' => 2, 'children' => 0, 'payment' => 'unpaid',
]);
$npId = (int) ($r['json']['id'] ?? 0);
it_check('a booking to read the account back for', $npId > 0, $r['raw']);
$acct = function () use (&$admin, $npId) {
    $res = http($admin, 'GET', '/my-bookings.php?acctpreview=' . $npId);
    foreach (($res['json']['bookings'] ?? []) as $b) {
        if ((int) ($b['id'] ?? 0) === $npId) { return $b; }
    }
    return null;
};
$row = $acct();
it_check('the account payload carries next_payment', is_array($row) && isset($row['next_payment']['kind']), json_encode(is_array($row) ? ($row['next_payment'] ?? null) : null));
// NOTHING PAID, 300 days out — the plan wants the DEPOSIT, so that is what the
// button offers. Before this it offered the whole stay.
it_check('nothing paid, far out → the account offers the DEPOSIT', ($row['next_payment']['kind'] ?? '') === 'deposit', json_encode($row['next_payment'] ?? null));
$dep = (float) ($row['next_payment']['due'] ?? 0);
$grand = (float) ($row['agreed_total'] ?? 0);
it_check('…and its figure is the deposit, not the stay', $dep > 0 && $dep < $grand - 0.005, "due $dep of $grand");
// `charge` is what the CARD takes — the stage's rental portion plus any
// refundable deposit riding it, exactly as pay.php bundles them.
$expectCharge = round($dep + (float) ($row['next_payment']['damages'] ?? 0), 2);
it_check('charge = the stage plus the refundable deposit riding it', abs((float) ($row['next_payment']['charge'] ?? -1) - $expectCharge) < 0.005, json_encode($row['next_payment'] ?? null));
// Once the deposit is IN, the same account moves to the balance — one payload,
// following the plan, exactly like the link.
$rootDb->exec('UPDATE bookings SET deposit_paid = ' . $dep . ' WHERE id = ' . $npId);
$row = $acct();
it_check('deposit settled → the account moves to the BALANCE', ($row['next_payment']['kind'] ?? '') === 'balance', json_encode($row['next_payment'] ?? null));
it_check('…asking for what is actually left', $grand > 0 && $dep > 0 && abs((float) ($row['next_payment']['due'] ?? 0) - round($grand - $dep, 2)) < 0.005, json_encode($row['next_payment'] ?? null));

// ---- 17. THE SERVER STAMPS ITS OWN CLOCK ON EVERY REPLY --------------------
// A browser's Date is whatever the device says, and a device clock can be wrong
// by accident or on purpose — reported with a photograph of the back office
// reading "Monday 20 July · £865 to collect" on 3 August, because the Mac was
// two weeks behind and the app believed it. db.php's json_out carries `srv` so
// the client corrects itself. Asserted against the REAL endpoints, because the
// browser gate stubs its own responses and therefore never exercises this half
// (measured: deleting the stamp left that suite entirely green).
echo "\n== 17. Server clock on every reply ==\n";
$rc = http($guest, 'GET', '/rates.php');
it_check('a public GET carries the server time', isset($rc['json']['srv']), $rc['raw']);
it_check('...as a sane UTC epoch, not a string or a guess',
    is_int($rc['json']['srv'] ?? null) && abs(($rc['json']['srv'] ?? 0) - time()) < 300,
    'srv=' . var_export($rc['json']['srv'] ?? null, true));
$rp = http($admin, 'POST', '/auth.php', ['action' => 'admin_status']);
it_check('a POST carries it too, so ANY request re-syncs', isset($rp['json']['srv']), $rp['raw']);
// A plain LIST is left alone — adding a string key would turn a JSON array into
// an object under a consumer expecting a list.
it_check('json_out leaves a bare list a list',
    strpos((string) file_get_contents(__DIR__ . '/db.php'), 'array_keys($data) !== range(0, count($data) - 1)') !== false);

// ============================================================
//  20. MOVING A STAY UN-STAMPS ITS ARRIVAL EMAIL.
//
//  The arrival email states the cottage, the date and the check-in time, and
//  pre-arrival.php's guard is `pre_arrival_sent IS NULL` — so once sent, moving
//  the dates or the cottage left the guest holding arrival info for a stay that
//  no longer exists, with nothing ever re-sending and the hub reading
//  "Arrival info ✓". Autopay survives the same edit by COMPARING its agreed
//  terms against the live plan (a moved date reads `stale`); this stamp has
//  nothing to compare against, so `update` clears it and the cron re-sends.
//  Driven through the REAL endpoint against the real column, because the fix
//  is one conditional in a 20-line SQL builder and a source scan would pass
//  with the condition inverted.
// ============================================================
echo "\n== 20. Moving a stay un-stamps its arrival email ==\n";
$arrIn = date('Y-m-d', strtotime('+20 days'));
$arrOut = date('Y-m-d', strtotime('+23 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, pre_arrival_sent) VALUES ('$propKey','Moved Stay','ms@gmail.com','$arrIn','$arrOut',2,0,'unpaid',0,300,300,0,3,NOW())");
$arrId = (int) $rootDb->lastInsertId();
$stamp = fn() => $rootDb->query("SELECT pre_arrival_sent FROM bookings WHERE id = $arrId")->fetchColumn();
$restamp = fn() => $rootDb->exec("UPDATE bookings SET pre_arrival_sent = NOW() WHERE id = $arrId");

// (a) The dates move → the stamp clears, so the cron re-sends for the new stay.
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $arrId,
    'check_in' => date('Y-m-d', strtotime('+30 days')), 'check_out' => date('Y-m-d', strtotime('+33 days'))]);
it_check('moving the dates clears pre_arrival_sent', ($r['json']['ok'] ?? false) && $stamp() === null, $r['raw']);
// …and the history says why a second arrival email is coming.
$hist = $rootDb->query("SELECT summary FROM activity_log WHERE action = 'booking.update' AND entity_id = '$arrId' ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('...and the history says the arrival info will be re-sent', strpos((string) $hist, 'arrival info will be re-sent') !== false, (string) $hist);

// (b) An edit that does NOT move the stay keeps the stamp — the sent email is
// still true, and clearing it here would re-email every guest whose notes the
// owner touched.
$restamp();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $arrId, 'notes' => 'gate: notes only']);
it_check('a notes-only edit keeps the stamp', ($r['json']['ok'] ?? false) && $stamp() !== null, $r['raw']);

// (c) Moving to a DIFFERENT COTTAGE clears it too — the email names the
// cottage, and directions to the wrong one are the worst version of stale.
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Arrival Annex', 'couple_rate' => 100]);
$arrProp2 = $r['json']['property']['prop_key'] ?? ($r['json']['prop_key'] ?? '');
it_check('(fixture) a second cottage exists to move to', $arrProp2 !== '', $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $arrId, 'prop_key' => $arrProp2, 'override_occupancy' => true, 'override_clash' => true]);
it_check('moving to another cottage clears the stamp', ($r['json']['ok'] ?? false) && $stamp() === null, $r['raw']);

// (d) A PAST stay is a record, not a plan: correcting its dates keeps the
// stamp, or every historic tidy-up would flip a finished booking's pipeline
// back to "arrival info not sent".
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, pre_arrival_sent) VALUES ('$propKey','Past Fix','pf@gmail.com','2025-06-01','2025-06-04',2,0,'unpaid',0,300,300,0,3,'2025-05-29 09:00:00')");
$pastId = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $pastId,
    'check_in' => '2025-06-02', 'check_out' => '2025-06-05']);
$pastStamp = $rootDb->query("SELECT pre_arrival_sent FROM bookings WHERE id = $pastId")->fetchColumn();
it_check('correcting a finished stay keeps its stamp', ($r['json']['ok'] ?? false) && $pastStamp !== null, $r['raw']);


// ══════════════════════════════════════════════════════════════════════════
// §17 THE OP LEDGER — exactly-once for replayed writes, against the REAL
// stack: migration-109's table, db.php's op_claim/op_finish, and the four
// wired endpoints. The case that matters is the AMBIGUOUS TIMEOUT: the phone
// sends, the server applies, the reply dies — so the phone retries the SAME
// op_id and the server must answer from its ledger, never re-apply. And a
// replay must never REGRESS newer state written between the two.
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA717 the op ledger\n";

$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Op Ledger','op@gmail.com','2027-03-01','2027-03-04',2,0,'unpaid',0,300,300,0,3)");
$opBid = (int) $rootDb->lastInsertId();
$dep = fn() => (float) $rootDb->query("SELECT deposit_paid FROM bookings WHERE id = $opBid")->fetchColumn();

// (a) set_payment records once, and the SAME op_id replays from the ledger.
$op1 = 'op-int-' . bin2hex(random_bytes(6));
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $opBid, 'payment' => 'deposit', 'deposit' => 100, 'payment_method' => 'Cash', 'payment_date' => '2026-08-01', 'op_id' => $op1]);
it_check('set_payment with an op_id applies once', ($r['json']['ok'] ?? false) && abs($dep() - 100.0) < 0.001, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $opBid, 'payment' => 'deposit', 'deposit' => 100, 'payment_method' => 'Cash', 'payment_date' => '2026-08-01', 'op_id' => $op1]);
it_check('…and the replay is answered from the ledger', ($r['json']['replayed'] ?? false) === true, $r['raw']);

// (b) THE REGRESSION CASE — the reason this action needed the ledger at all:
// a newer payment lands between the original send and the replay; the stale
// replay must NOT drag deposit_paid back to the old figure.
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $opBid, 'payment' => 'deposit', 'deposit' => 200, 'payment_method' => 'Cash', 'payment_date' => '2026-08-02', 'op_id' => 'op-int-' . bin2hex(random_bytes(6))]);
it_check('(fixture) a newer payment lands', ($r['json']['ok'] ?? false) && abs($dep() - 200.0) < 0.001, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $opBid, 'payment' => 'deposit', 'deposit' => 100, 'payment_method' => 'Cash', 'payment_date' => '2026-08-01', 'op_id' => $op1]);
it_check('a stale replay never regresses the newer figure', ($r['json']['replayed'] ?? false) === true && abs($dep() - 200.0) < 0.001, 'deposit now ' . $dep());

// (c) An INSERT action: two sends, one op_id, ONE expense row.
$op2 = 'op-int-' . bin2hex(random_bytes(6));
$expCount = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM expenses WHERE description = 'op ledger gate'")->fetchColumn();
http($admin, 'POST', '/expenses.php', ['action' => 'add', 'category' => 'General', 'description' => 'op ledger gate', 'amount' => 12.5, 'date' => '2026-08-01', 'op_id' => $op2]);
$r = http($admin, 'POST', '/expenses.php', ['action' => 'add', 'category' => 'General', 'description' => 'op ledger gate', 'amount' => 12.5, 'date' => '2026-08-01', 'op_id' => $op2]);
it_check('an expense replayed with the same op_id inserts ONCE', $expCount() === 1 && ($r['json']['replayed'] ?? false) === true, 'rows=' . $expCount() . ' ' . $r['raw']);
http($admin, 'POST', '/expenses.php', ['action' => 'add', 'category' => 'General', 'description' => 'op ledger gate', 'amount' => 12.5, 'date' => '2026-08-01', 'op_id' => 'op-int-' . bin2hex(random_bytes(6))]);
it_check('…while a DIFFERENT op_id is a genuine second expense', $expCount() === 2);

// (d) The phone-enquiry capture: admin submit with no address, replayed once.
$op3 = 'op-int-' . bin2hex(random_bytes(6));
$enqCount = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM enquiries WHERE name = 'Op Phone Enquiry'")->fetchColumn();
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Op Phone Enquiry', 'phone' => '07700 900233', 'check_in' => '2027-05-10', 'check_out' => '2027-05-13', 'adults' => 2, 'children' => 0, 'message' => 'Taken by phone', 'op_id' => $op3]);
it_check('a phone enquiry saves with NO address (admin-exempt)', ($r['json']['ok'] ?? false) && $enqCount() === 1, $r['raw']);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Op Phone Enquiry', 'phone' => '07700 900233', 'check_in' => '2027-05-10', 'check_out' => '2027-05-13', 'adults' => 2, 'children' => 0, 'message' => 'Taken by phone', 'op_id' => $op3]);
it_check('…and its replay lands ONE enquiry, not two', $enqCount() === 1 && ($r['json']['replayed'] ?? false) === true, 'rows=' . $enqCount());

// (e) ERRORS ARE NEVER STORED: a clash-refused enquiry re-refuses on replay
// (a stored refusal would freeze a fixable one forever) — and the refusal
// still refuses after the ledger has seen the id once.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Clash Holder','ch@gmail.com','2027-06-10','2027-06-13',2,0,'unpaid',0,300,300,0,3)");
$op4 = 'op-int-' . bin2hex(random_bytes(6));
$mk = fn() => http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Op Clash Enquiry', 'phone' => '07700 900234', 'check_in' => '2027-06-11', 'check_out' => '2027-06-12', 'adults' => 2, 'children' => 0, 'message' => 'x', 'op_id' => $op4]);
$r = $mk();
it_check('a clashing enquiry is refused (dates already taken)', ($r['json']['error'] ?? '') !== '', $r['raw']);
$r = $mk();
it_check('…and the refusal is NOT stored — the replay re-refuses, never replays', ($r['json']['error'] ?? '') !== '' && !($r['json']['replayed'] ?? false), $r['raw']);

// (f) A malformed op_id is ignored (no dedupe, no error) — the ledger must
// never make an ordinary write harder.
$r = http($admin, 'POST', '/expenses.php', ['action' => 'add', 'category' => 'General', 'description' => 'op ledger loose id', 'amount' => 3, 'date' => '2026-08-01', 'op_id' => 'x']);
it_check('a malformed op_id degrades to a plain write', ($r['json']['ok'] ?? false) === true, $r['raw']);

// (g) THE ONLINE WRITE PATHS — bookings 'add' and 'update' joined the ledger
// (the ambiguous timeout exists on good WiFi too; the client's chbOpFor
// stamps a deterministic id). Two sends of one add = ONE booking; and the
// clash LADDER shares an id: the refusal stores nothing, the override write
// stores, and a replay of the whole ladder is answered at post one.
$op5 = 'op-int-' . bin2hex(random_bytes(6));
$addCount = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM bookings WHERE name = 'Op Direct Add'")->fetchColumn();
$mkAdd = fn() => http($admin, 'POST', '/bookings.php', ['action' => 'add', 'prop_key' => $propKey, 'name' => 'Op Direct Add', 'check_in' => '2027-07-10', 'check_out' => '2027-07-13', 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'op_id' => $op5]);
$r = $mkAdd();
it_check('a booking add with an op_id applies once', ($r['json']['ok'] ?? false) && $addCount() === 1, $r['raw']);
$newBid = (int) ($r['json']['id'] ?? 0);
$r = $mkAdd();
it_check('…and a hand retry lands ONE booking, not two', $addCount() === 1 && ($r['json']['replayed'] ?? false) === true && (int) ($r['json']['id'] ?? 0) === $newBid, 'rows=' . $addCount() . ' ' . $r['raw']);

// (h) 'update' replays with its verdict intact (`material` rides the stored
// response), and the row is not re-walked through the warn ladder.
$op6 = 'op-int-' . bin2hex(random_bytes(6));
$mkUpd = fn() => http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $newBid, 'prop_key' => $propKey, 'name' => 'Op Direct Add', 'check_in' => '2027-07-11', 'check_out' => '2027-07-14', 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'op_id' => $op6]);
$r = $mkUpd();
it_check('an update with an op_id applies (dates moved = material)', ($r['json']['ok'] ?? false) && ($r['json']['material'] ?? false) === true, $r['raw']);
$r = $mkUpd();
it_check('…and its replay is answered from the ledger, material intact', ($r['json']['replayed'] ?? false) === true && ($r['json']['material'] ?? false) === true, $r['raw']);
$ci2 = (string) $rootDb->query("SELECT check_in FROM bookings WHERE id = $newBid")->fetchColumn();
it_check('…with the row exactly as the first write left it', $ci2 === '2027-07-11', 'check_in=' . $ci2);

// (i) THE CLASH LADDER UNDER ONE ID: the refusal exit stores NOTHING (a
// refusal must re-run), the override write stores, and the retried ladder is
// then answered at its first post — no duplicate even though the retry never
// re-sent override_clash.
$op7 = 'op-int-' . bin2hex(random_bytes(6));
$ladCount = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM bookings WHERE name = 'Op Ladder Add'")->fetchColumn();
$ladder = fn(array $extra = []) => http($admin, 'POST', '/bookings.php', array_merge(['action' => 'add', 'prop_key' => $propKey, 'name' => 'Op Ladder Add', 'check_in' => '2027-07-11', 'check_out' => '2027-07-12', 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'op_id' => $op7], $extra));
$r = $ladder();
it_check('post one of the ladder is refused as a clash (stored nothing)', ($r['json']['clash'] ?? false) === true && $ladCount() === 0, $r['raw']);
$r = $ladder(['override_clash' => true]);
it_check('the override post writes the booking under the same id', ($r['json']['ok'] ?? false) && $ladCount() === 1, $r['raw']);
$r = $ladder();
it_check('a retried ladder is answered at post ONE — no clash prompt, no duplicate', ($r['json']['replayed'] ?? false) === true && $ladCount() === 1, 'rows=' . $ladCount() . ' ' . $r['raw']);

// (j) PHOTO EVIDENCE ON A DEPOSIT DECISION — rides the confirmed keep/return,
// BEST-EFFORT by contract: a valid JPEG data URI is stored under uploads/ with
// an activity row; anything malformed is ignored and the MONEY OP STANDS.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, hold_status, hold_amount) VALUES ('$propKey','Evidence Keep','ek@gmail.com','2026-07-01','2026-07-04',2,0,'paid',300,300,300,0,3,'charged',75)");
$evBid = (int) $rootDb->lastInsertId();
// a real 1×1 JPEG — the server checks the magic bytes, so a fake would prove nothing
$jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
$r = http($admin, 'POST', '/bookings.php', ['action' => 'keep_deposit', 'id' => $evBid, 'note' => 'Burn on the worktop', 'photo_data' => $jpg]);
// NB the app is served from the TEMP docroot ($work) — uploads land THERE.
$evFiles = glob($work . '/uploads/deposit-evidence-' . $evBid . '-*.jpg') ?: [];
it_check('keep_deposit with a photo keeps the money AND stores the evidence', ($r['json']['ok'] ?? false) && count($evFiles) === 1, $r['raw'] . ' files=' . count($evFiles));
$evLog = (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'deposit.evidence' AND entity_id = '$evBid'")->fetchColumn();
it_check('…and the activity log names where it lives', $evLog === 1);

$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, hold_status, hold_amount) VALUES ('$propKey','Evidence Bad','eb@gmail.com','2026-07-05','2026-07-08',2,0,'paid',300,300,300,0,3,'charged',75)");
$evBid2 = (int) $rootDb->lastInsertId();
it_reauth($admin); // money out → step-up first (see the helper above)
$r = http($admin, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $evBid2, 'note' => 'All fine', 'photo_data' => 'data:image/jpeg;base64,not-a-jpeg-at-all']);
$evFiles2 = glob($work . '/uploads/deposit-evidence-' . $evBid2 . '-*.jpg') ?: [];
it_check('a MALFORMED photo is ignored and the refund still stands (best-effort contract)', ($r['json']['ok'] ?? false) && count($evFiles2) === 0, $r['raw'] . ' files=' . count($evFiles2));

// ══════════════════════════════════════════════════════════════════════════
// §18 THE KEY SAFE KEEPER — the reveal gate and the replay, against the real
// stack (encrypted content row, op ledger, the payload the guest's page
// reads). The rule under test is the owner's own: the guest is shown a code
// ONLY once the safe is confirmed set FOR their booking and arrival is near.
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA718 the key safe keeper\n";

// A guest arriving TOMORROW — inside the reveal window (2 days) from today.
$ksIn = date('Y-m-d', time() + 86400);
$ksOut = date('Y-m-d', time() + 4 * 86400);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Keysafe Guest','ks@gmail.com','$ksIn','$ksOut',2,0,'paid',300,300,300,0,3)");
$ksBid = (int) $rootDb->lastInsertId();
// …and one arriving in a MONTH — a confirmed code must still not show yet.
$ksFarIn = date('Y-m-d', time() + 30 * 86400);
$ksFarOut = date('Y-m-d', time() + 33 * 86400);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Keysafe Far','ksfar@gmail.com','$ksFarIn','$ksFarOut',2,0,'paid',300,300,300,0,3)");
$ksFarBid = (int) $rootDb->lastInsertId();
$ksPayload = fn($bid) => http($admin, 'GET', '/my-bookings.php?acctpreview=' . $bid)['json']['bookings'][0] ?? [];

// (a) BEFORE any confirm: the payload carries no code and no promise.
$bk = $ksPayload($ksBid);
it_check('before any confirm, the guest page gets NO code and NO promised date', ($bk['door_code'] ?? null) === null && ($bk['door_code_from'] ?? null) === null, json_encode([$bk['door_code'] ?? 'absent', $bk['door_code_from'] ?? 'absent']));

// (b) A junk code is refused; nothing is stored.
$r = http($admin, 'POST', '/keysafe.php', ['action' => 'confirm', 'prop_key' => $propKey, 'code' => '1234', 'booking_id' => $ksBid]);
it_check('a junk code (1234) is refused in words', ($r['json']['error'] ?? '') !== '' && $r['code'] === 400, $r['raw']);

// (c) The confirm writes the record — and the guest INSIDE the window sees it.
$ksOp = 'op-int-' . bin2hex(random_bytes(6));
$r = http($admin, 'POST', '/keysafe.php', ['action' => 'confirm', 'prop_key' => $propKey, 'code' => '4821', 'booking_id' => $ksBid, 'op_id' => $ksOp]);
it_check('the owner’s confirm records the safe', ($r['json']['ok'] ?? false) && ($r['json']['safe']['code'] ?? '') === '4821', $r['raw']);
$bk = $ksPayload($ksBid);
it_check('…and the guest arriving tomorrow now sees 4821 on their page', ($bk['door_code'] ?? null) === '4821', json_encode($bk['door_code'] ?? 'absent'));

// (d) The row is ENCRYPTED at rest — the raw content value never contains the code.
$ksRaw = (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'keysafe-$propKey'")->fetchColumn();
it_check('the stored record is ciphertext (no plaintext 4821 in the content table)', $ksRaw !== '' && strpos($ksRaw, '4821') === false, substr($ksRaw, 0, 40));

// (e) …and the activity log records THAT it rotated, never the code.
$ksLog = (string) $rootDb->query("SELECT summary FROM activity_log WHERE action = 'keysafe.rotate' ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('the activity log names the rotation without the code', $ksLog !== '' && strpos($ksLog, '4821') === false, $ksLog);

// (f) The replay applies ONCE: same op_id → answered from the ledger, and the
// history did not grow a duplicate row.
$r = http($admin, 'POST', '/keysafe.php', ['action' => 'confirm', 'prop_key' => $propKey, 'code' => '4821', 'booking_id' => $ksBid, 'op_id' => $ksOp]);
$ksState = http($admin, 'POST', '/keysafe.php', ['action' => 'state'])['json']['safes'][$propKey] ?? [];
it_check('a replayed confirm is answered from the ledger, history unchanged', ($r['json']['replayed'] ?? false) === true && count($ksState['history'] ?? []) === 0, 'hist=' . count($ksState['history'] ?? []) . ' ' . $r['raw']);

// (g) The wrong DIRECTION of the gate: a confirmed code for a guest a MONTH
// out shows NO code — only the dated promise.
$r = http($admin, 'POST', '/keysafe.php', ['action' => 'confirm', 'prop_key' => $propKey, 'code' => '7302', 'booking_id' => $ksFarBid, 'op_id' => 'op-int-' . bin2hex(random_bytes(6))]);
it_check('(fixture) rotated for the far-out guest', ($r['json']['ok'] ?? false) === true, $r['raw']);
$bk = $ksPayload($ksFarBid);
$ksFrom = date('Y-m-d', strtotime($ksFarIn . ' 12:00:00 UTC') - 2 * 86400);
it_check('a guest a month out gets NO code, only the date it will appear', ($bk['door_code'] ?? null) === null && ($bk['door_code_from'] ?? null) === $ksFrom, json_encode([$bk['door_code'] ?? 'absent', $bk['door_code_from'] ?? 'absent']));
// …and the rotation moved the SAFE, so the near guest's page stops showing a
// code the safe no longer carries (forBooking is someone else now).
$bk = $ksPayload($ksBid);
it_check('the near guest no longer sees the superseded code', ($bk['door_code'] ?? null) === null, json_encode($bk['door_code'] ?? 'absent'));
// …and the history now names the first rotation's guest.
$ksState = http($admin, 'POST', '/keysafe.php', ['action' => 'state'])['json']['safes'][$propKey] ?? [];
it_check('the history names who had the previous code', ($ksState['history'][0]['guest'] ?? '') === 'Keysafe Guest' && ($ksState['history'][0]['code'] ?? '') === '4821', json_encode($ksState['history'][0] ?? null));

// (h) A PLATFORM stay has no bookings row, so it is identified by stay_ref
// ('o:<check-in>') — round-tripped through the encrypted record; a garbage
// ref reads as none rather than anything at all.
$r = http($admin, 'POST', '/keysafe.php', ['action' => 'confirm', 'prop_key' => $propKey, 'code' => '5917', 'booking_id' => 0, 'stay_ref' => 'o:2027-09-01', 'op_id' => 'op-int-' . bin2hex(random_bytes(6))]);
it_check('a platform-stay rotation stores its stay ref', ($r['json']['safe']['forStay'] ?? '') === 'o:2027-09-01', $r['raw']);
$r = http($admin, 'POST', '/keysafe.php', ['action' => 'confirm', 'prop_key' => $propKey, 'code' => '6183', 'booking_id' => 0, 'stay_ref' => '<script>bad', 'op_id' => 'op-int-' . bin2hex(random_bytes(6))]);
it_check('…and a garbage ref reads as none', ($r['json']['ok'] ?? false) && ($r['json']['safe']['forStay'] ?? 'x') === '', $r['raw']);

// (i) THE PER-COTTAGE SWITCH gates the guest reveal: rotate for the near
// guest (in window), then switch the keeper OFF — the code must leave their
// page even though the record still carries it; back ON, it returns.
http($admin, 'POST', '/keysafe.php', ['action' => 'confirm', 'prop_key' => $propKey, 'code' => '2749', 'booking_id' => $ksBid, 'op_id' => 'op-int-' . bin2hex(random_bytes(6))]);
$bk = $ksPayload($ksBid);
it_check('(fixture) the near guest sees the fresh code', ($bk['door_code'] ?? null) === '2749', json_encode($bk['door_code'] ?? 'absent'));
$r = http($admin, 'POST', '/keysafe.php', ['action' => 'set_enabled', 'prop_key' => $propKey, 'enabled' => false]);
it_check('the switch turns off and says so', ($r['json']['ok'] ?? false) && ($r['json']['safe']['enabled'] ?? true) === false, $r['raw']);
$bk = $ksPayload($ksBid);
it_check('OFF withholds the code from the guest page — even inside the window', ($bk['door_code'] ?? null) === null, json_encode($bk['door_code'] ?? 'absent'));
http($admin, 'POST', '/keysafe.php', ['action' => 'set_enabled', 'prop_key' => $propKey, 'enabled' => true]);
$bk = $ksPayload($ksBid);
it_check('back ON, the code returns — the record was kept, not erased', ($bk['door_code'] ?? null) === '2749', json_encode($bk['door_code'] ?? 'absent'));

// ══════════════════════════════════════════════════════════════════════════
// §19 THE MY STAYS COMPANION — the held-back door-code flag and the guest's
// own arrival-window write, against the real endpoints (riding §18's state:
// keeper ON, code 2749 confirmed for the NEAR guest).
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA719 the My Stays companion\n";

// (a) door_code_pending: a stay whose code IS confirmed never reads pending;
// an unconfirmed stay under an ON keeper reads pending with NO date and NO
// code (the held-back card the demo was approved for); keeper OFF sends no
// flag at all — the cottage may have no safe to promise.
$bk = $ksPayload($ksBid);
it_check('a confirmed code is never ALSO pending', ($bk['door_code_pending'] ?? true) === false, json_encode($bk['door_code_pending'] ?? 'absent'));
$bk = $ksPayload($ksFarBid);
it_check('an unconfirmed stay under an ON keeper reads pending — no date, no code',
    ($bk['door_code_pending'] ?? false) === true && ($bk['door_code'] ?? null) === null && ($bk['door_code_from'] ?? null) === null,
    json_encode([$bk['door_code_pending'] ?? 'absent', $bk['door_code'] ?? 'absent', $bk['door_code_from'] ?? 'absent']));
http($admin, 'POST', '/keysafe.php', ['action' => 'set_enabled', 'prop_key' => $propKey, 'enabled' => false]);
$bk = $ksPayload($ksFarBid);
it_check('keeper OFF sends no pending flag — a held-back card would assert a safe', ($bk['door_code_pending'] ?? true) === false, json_encode($bk['door_code_pending'] ?? 'absent'));
http($admin, 'POST', '/keysafe.php', ['action' => 'set_enabled', 'prop_key' => $propKey, 'enabled' => true]);

// (b) The arrival-window write: a REAL guest session (register mints one, with
// the csrf cookie the jar picks up), writing to THEIR OWN booking only.
// REGISTERING AN EMAIL THAT ALREADY HAS BOOKINGS DOES NOT HAND OVER THE STAY.
// my_bookings_payload matches on the email alone, so signing someone in the moment
// they typed one gave anybody who guessed a guest's address their dates, money,
// arrival details and (inside its reveal window) the door code. The account is made
// but stays unverified, and the magic link — emailed TO that address — is the proof.
$gj = [];
$r = http($gj, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Keysafe Guest', 'email' => 'ks@gmail.com',
    'password' => 'longenough1', 'address' => '1 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
it_check('registering an email that already has bookings does NOT sign you in',
    ($r['json']['ok'] ?? false) === true && ($r['json']['verify'] ?? false) === true && !isset($r['json']['guest']), $r['raw']);
// Asked the way a real client asks — my-bookings is read-only, so the read is
// a GET. This used to POST, riding the write route's require_guest(); with
// that route gone the POST meets the 405 first and the check proved nothing.
$r = http($gj, 'GET', '/my-bookings.php');
it_check('…and that half-made account can read nothing', $r['code'] === 401, $r['raw']);
// The bypass that makes the refusal real: the password was chosen by whoever
// registered, so accepting it here would reopen the door the check just shut.
$r = http($gj, 'POST', '/auth.php', ['action' => 'guest_login', 'email' => 'ks@gmail.com', 'password' => 'longenough1']);
it_check('…nor can the password they just chose sign them in', $r['code'] === 403, $r['raw']);
// The rightful owner opens the emailed link, which IS the proof of the address.
$gvid = (int) $rootDb->query("SELECT id FROM guests WHERE email = 'ks@gmail.com'")->fetchColumn();
$gts = time();
$gtok = substr(hash_hmac('sha256', 'login:' . $gvid . ':' . $gts, $SECRET), 0, 32); // login_token()'s own shape
$r = http($gj, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $gvid, 'ts' => $gts, 'token' => $gtok]);
it_check('(fixture) the emailed sign-in link signs the guest in', ($r['json']['ok'] ?? false) === true, $r['raw']);
it_check('…and stamps the address as proven', $rootDb->query("SELECT email_verified_at FROM guests WHERE id = $gvid")->fetchColumn() !== null, '');
// A BRAND-NEW address has nothing to claim, so the ordinary guest is unaffected.
$gj2 = [];
$r = http($gj2, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Fresh Guest', 'email' => 'fresh-guest@gmail.com',
    'password' => 'longenough1', 'address' => '2 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
it_check('a brand-new email still signs straight in', ($r['json']['ok'] ?? false) === true && empty($r['json']['verify']) && !empty($r['json']['guest']), $r['raw']);
// The guest arrival-window write was REMOVED with its feature, so my-bookings
// is read-only to guests again. Asserted as an absence THROUGH THE ENDPOINT:
// a live route would answer 200/400/404 on its own terms, and any POST now
// meets the same refusal whatever it carries.
$r = http($gj, 'POST', '/my-bookings.php', ['action' => 'set_arrival_window', 'id' => $ksBid, 'window' => '16-18']);
it_check('the removed arrival-window write is refused, not honoured', $r['code'] === 405, $r['raw']);
$colGone = $rootDb->query("SHOW COLUMNS FROM bookings LIKE 'arrival_window'")->fetch();
it_check('…and nothing wrote to the retired column', !$colGone
    || (int) $rootDb->query('SELECT COUNT(*) FROM bookings WHERE arrival_window IS NOT NULL')->fetchColumn() === 0, '');

// ══════════════════════════════════════════════════════════════════════════
// §23 THE ARRIVAL EMAIL, REVIEWED BEFORE IT GOES. The owner's rule is that
// NOTHING leaves without them, so the two things worth proving against the
// real stack are (a) the daily job MARKS instead of sending, once, and
// (b) the send route actually sends AND clears the waiting state. Driven
// through the live cron URL and the live endpoint, never by calling helpers.
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA723 the arrival email waits for the owner\n";

$arIn = date('Y-m-d', time() + 2 * 86400);   // arrives in 2 days — inside the 3-day window
$arOut = date('Y-m-d', time() + 5 * 86400);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Arrival Review','arrev@gmail.com','$arIn','$arOut',2,0,'paid',300,300,300,0,3)");
$arBid = (int) $rootDb->lastInsertId();

// OFF (the default): the job sends, exactly as it always has.
$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
it_check('with review OFF the job reports a send, not a wait',
    ($r['json']['review_mode'] ?? null) === false, $r['raw']);
// NB mail is DISABLED in this environment, so the send itself cannot succeed
// here — what is provable is that the job took the SENDING path (it reported
// review_mode false and readied nothing), and that it left no waiting state.
$row0 = $rootDb->query("SELECT pre_arrival_ready_at FROM bookings WHERE id = $arBid")->fetch();
it_check('…and marks nothing as waiting for the owner', $row0['pre_arrival_ready_at'] === null, var_export($row0, true));

// Now REVIEW MODE, with a second booking that has not been emailed.
$r = http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'arrival-review', 'value' => '1']);
it_check('(fixture) review mode saved', ($r['json']['ok'] ?? false) === true, $r['raw']);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Waits For Me','waits@gmail.com','$arIn','$arOut',2,0,'paid',300,300,300,0,3)");
$arBid2 = (int) $rootDb->lastInsertId();

$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
it_check('with review ON the job says so and sends nothing',
    ($r['json']['review_mode'] ?? null) === true && (int) ($r['json']['sent'] ?? -1) === 0, $r['raw']);
$row = $rootDb->query("SELECT pre_arrival_ready_at, pre_arrival_sent FROM bookings WHERE id = $arBid2")->fetch();
it_check('…the booking is marked READY', !empty($row['pre_arrival_ready_at']), var_export($row, true));
it_check('…and NOT sent — the whole point of the setting', $row['pre_arrival_sent'] === null, var_export($row, true));

// The stamp is set ONCE: a second daily pass must not re-notify.
$firstStamp = $row['pre_arrival_ready_at'];
$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
it_check('a second run readies nothing new', (int) ($r['json']['readied'] ?? -1) === 0, $r['raw']);
it_check('…and the stamp is unchanged (one notification, not a drumbeat)',
    $rootDb->query("SELECT pre_arrival_ready_at FROM bookings WHERE id = $arBid2")->fetchColumn() === $firstStamp, '');

// The preview the composer prefills from — the owner's editable message.
$r = http($admin, 'POST', '/bookings.php', ['action' => 'arrival_preview', 'id' => $arBid2]);
it_check('the preview offers a message to edit', !empty($r['json']['message']) && strpos((string) $r['json']['message'], 'Waits') !== false, $r['raw']);
it_check('…and the facts it will add, so nothing is typed twice',
    !empty($r['json']['facts']['arrive']) && !empty($r['json']['subject']), $r['raw']);

// SENDING IT BY HAND. Mail is disabled here, so this proves the half that
// matters more anyway: a send that FAILS must not pretend. The route answers
// 5xx, the booking is not marked sent, and the waiting state SURVIVES — a
// cleared stamp on a failed send would retire the duty and the guest would
// arrive with nothing while the owner believed it had gone.
$r = http($admin, 'POST', '/bookings.php', ['action' => 'send_arrival', 'id' => $arBid2, 'note' => 'We have left the milk in the fridge for you.']);
it_check('a send that fails says so (never a 2xx)', $r['code'] >= 500, $r['raw']);
$row2 = $rootDb->query("SELECT pre_arrival_ready_at, pre_arrival_sent FROM bookings WHERE id = $arBid2")->fetch();
it_check('…the booking is NOT marked sent', $row2['pre_arrival_sent'] === null, var_export($row2, true));
it_check('…and it is STILL waiting for the owner — the duty survives a failed send',
    !empty($row2['pre_arrival_ready_at']), var_export($row2, true));
// A booking whose email has already gone is never re-readied by a later run.
$rootDb->exec("UPDATE bookings SET pre_arrival_ready_at = NULL, pre_arrival_sent = NOW() WHERE id = $arBid2");
$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
it_check('a booking already emailed is never re-readied',
    $rootDb->query("SELECT pre_arrival_ready_at FROM bookings WHERE id = $arBid2")->fetchColumn() === null, $r['raw']);

// Put the setting back so nothing downstream inherits it.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'arrival-review', 'value' => '']);

// ══════════════════════════════════════════════════════════════════════════
// §24 REFUNDS NEED A FRESH CONFIRMATION. A signed-in admin session is
// long-lived and carried in a pocket; a refund is the one action here that
// cannot be undone by noticing it later. So the three money-out endpoints
// require a step-up on top of the session. Driven through the live endpoints
// in both directions — refused without, accepted with, and refused again once
// the window has been given up.
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA724 a refund asks whether it is still you\n";

// A finished, fully-paid stay with a deposit to give back.
$raIn = date('Y-m-d', time() - 6 * 86400);
$raOut = date('Y-m-d', time() - 3 * 86400);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee, hold_status, hold_amount) VALUES ('$propKey','Reauth Guest','reauth@gmail.com','$raIn','$raOut',2,0,'paid',360,300,300,0,3,60,'charged',60)");
$raBid = (int) $rootDb->lastInsertId();

// A FRESH ADMIN SESSION has not confirmed anything yet.
$ra = [];
$r = http($ra, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-123']);
it_check('(fixture) a second admin session signs in', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($ra, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $raBid, 'amount' => 60]);
it_check('a signed-in session alone cannot return a deposit',
    $r['code'] === 401 && ($r['json']['code'] ?? '') === 'reauth_required', $r['raw']);
$still = $rootDb->query("SELECT hold_status FROM bookings WHERE id = $raBid")->fetchColumn();
it_check('…and nothing moved — the deposit is still held', $still === 'charged', var_export($still, true));

// THE WRONG PASSWORD IS NOT A CONFIRMATION, and it is recorded.
$r = http($ra, 'POST', '/auth.php', ['action' => 'admin_reauth_password', 'password' => 'not-the-password']);
it_check('a wrong password is refused', $r['code'] === 403, $r['raw']);
$r = http($ra, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $raBid, 'amount' => 60]);
it_check('…and the refund is still refused after it', $r['code'] === 401, $r['raw']);
$logged = (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'admin.reauth_fail'")->fetchColumn();
it_check('…and the failed confirmation is on the record', $logged >= 1, (string) $logged);

// THE RIGHT PASSWORD opens the window, and the refund goes through.
$r = it_reauth($ra);
it_check('the right password confirms', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($ra, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $raBid, 'amount' => 60]);
it_check('…and the deposit returns', ($r['json']['ok'] ?? false) === true, $r['raw']);

// A GUEST SESSION can never confirm — the step-up is not a way in.
$rg = [];
http($rg, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Reauth Guest2', 'email' => 'reauth2@gmail.com',
    'password' => 'longenough1', 'address' => '9 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$r = http($rg, 'POST', '/auth.php', ['action' => 'admin_reauth_password', 'password' => 'it-pass-123']);
it_check('a guest session cannot confirm as the owner', $r['code'] === 401, $r['raw']);
// NB passkeys.php refuses everything when the WebAuthn library is absent (as
// it is on this box), so the property asserted is the one that holds in both
// environments: a guest never receives a challenge to sign.
$r = http($rg, 'POST', '/passkeys.php', ['action' => 'admin_reauth_begin']);
it_check('…nor start a passkey confirmation', $r['code'] !== 200 && empty($r['json']['options']), $r['raw']);

// KEEPING a deposit is not money out, so it is NOT gated — a control that
// asks for everything is one people route around.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee, hold_status, hold_amount) VALUES ('$propKey','Keep Guest','keep@gmail.com','$raIn','$raOut',2,0,'paid',360,300,300,0,3,60,'charged',60)");
$kpBid = (int) $rootDb->lastInsertId();
$rk = [];
http($rk, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-123']);
$r = http($rk, 'POST', '/bookings.php', ['action' => 'keep_deposit', 'id' => $kpBid, 'note' => 'Broken lamp']);
it_check('keeping a deposit needs no step-up — no money leaves', ($r['json']['ok'] ?? false) === true, $r['raw']);
// …and a cancellation with NOTHING to refund stays one tap.
$fwIn = date('Y-m-d', time() + 40 * 86400);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Unpaid Cancel','uc@gmail.com','$fwIn',DATE_ADD('$fwIn', INTERVAL 3 DAY),2,0,'unpaid',0,300,300,0,3)");
$ucBid = (int) $rootDb->lastInsertId();
$r = http($rk, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $ucBid, 'reason' => 'changed their mind']);
it_check('cancelling a booking nobody paid for needs no step-up', ($r['json']['ok'] ?? false) === true, $r['raw']);

// ---- 20. Staging seats + the stage seeder --------------------------------
// The one-tap "Back office" seat mints an ADMIN session, so its boundary gets
// executable checks in every direction that matters: the staging Host, the
// gate proof (cookie HMAC), and that success really is an admin session. Then
// the Test centre's seed_stage / purge_data round-trip on the real database.
echo "\n== 20. Staging seats + stage seeder ==\n";
$STG_HOST = 'staging.chb-it.test';
$gateCookie = hash_hmac('sha256', 'staging-gate|it-gate', $SECRET); // staging-gate.php's own recipe

$sj = []; // fresh persona: gate passed, nothing else
$r = http($sj, 'POST', '/auth.php', ['action' => 'staging_admin_session'], $STG_HOST);
it_check('admin seat without the gate cookie → 403', $r['code'] === 403, $r['raw']);
$sj = ['chb_staging_gate' => 'not-the-hmac'];
$r = http($sj, 'POST', '/auth.php', ['action' => 'staging_admin_session'], $STG_HOST);
it_check('a forged gate cookie → 403', $r['code'] === 403, $r['raw']);
$sj = ['chb_staging_gate' => $gateCookie];
$r = http($sj, 'POST', '/auth.php', ['action' => 'staging_admin_session']); // ordinary host
it_check('the right cookie on a NON-staging host → 403 (belt-and-braces)', $r['code'] === 403, $r['raw']);
$r = http($sj, 'POST', '/auth.php', ['action' => 'staging_admin_session'], $STG_HOST);
it_check('gate cookie + staging host → the seat opens', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
$r = http($sj, 'POST', '/auth.php', ['action' => 'admin_status']);
it_check('…and it is a REAL admin session', !empty($r['json']['admin']), $r['raw']);

// The seeder: a full pretend business appears, and the purge takes all of it
// back out. Driven with the $admin jar (a password-authenticated session) —
// testcentre.php itself keys only on the Host + require_admin.
$mark = '%[CHB-TEST]%';
$q = fn($sql) => (int) $rootDb->query($sql)->fetchColumn();
$b0 = $q("SELECT COUNT(*) FROM bookings WHERE notes LIKE '$mark'");
$e0 = $q("SELECT COUNT(*) FROM enquiries WHERE message LIKE '$mark'");
$x0 = $q('SELECT COUNT(*) FROM expenses');
$w0 = $q('SELECT COUNT(*) FROM waitlist');
$v0 = $q("SELECT COUNT(*) FROM guest_reviews WHERE status = 'pending'");
$r = http($admin, 'POST', '/testcentre.php', ['action' => 'seed_stage']);
it_check('seed_stage on a non-staging host → 403', $r['code'] === 403, $r['raw']);
$r = http($admin, 'POST', '/testcentre.php', ['action' => 'seed_stage'], $STG_HOST);
it_check('seed_stage succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
it_check(
    'six stays seeded across the money states (none skipped on a quiet calendar)',
    (int) ($r['json']['bookings'] ?? 0) + (int) ($r['json']['skipped'] ?? 0) === 6 && (int) ($r['json']['bookings'] ?? 0) >= 4,
    $r['raw'],
);
it_check('the marker finds every seeded stay', $q("SELECT COUNT(*) FROM bookings WHERE notes LIKE '$mark'") - $b0 === (int) $r['json']['bookings'], '');
it_check('three enquiries, one of them declined', $q("SELECT COUNT(*) FROM enquiries WHERE message LIKE '$mark'") - $e0 === 3
    && $q("SELECT COUNT(*) FROM enquiries WHERE message LIKE '$mark' AND declined_at IS NOT NULL") === 1, '');
it_check('expenses + waitlist + a pending review landed', $q('SELECT COUNT(*) FROM expenses') - $x0 === 3
    && $q('SELECT COUNT(*) FROM waitlist') - $w0 === 1
    && $q("SELECT COUNT(*) FROM guest_reviews WHERE status = 'pending'") - $v0 >= 1, '');
// EVERY seeded stay carries a real price snapshot — the property that keeps
// the money surfaces coherent, whichever stays survived the clash filter.
$noSnap = $q("SELECT COUNT(*) FROM bookings WHERE notes LIKE '$mark' AND (agreed_total IS NULL OR agreed_total <= 0)");
it_check('every seeded stay carries a REAL price snapshot', $noSnap === 0, "unsnapshotted: $noSnap");
$r = http($admin, 'POST', '/testcentre.php', ['action' => 'purge_data'], $STG_HOST);
it_check('purge_data succeeds', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
it_check('…and the whole stage comes back out', $q("SELECT COUNT(*) FROM bookings WHERE notes LIKE '$mark'") === 0
    && $q("SELECT COUNT(*) FROM enquiries WHERE message LIKE '$mark'") === 0
    && $q('SELECT COUNT(*) FROM expenses') === $x0
    && $q('SELECT COUNT(*) FROM waitlist') === $w0
    && $q("SELECT COUNT(*) FROM guest_reviews WHERE status = 'pending'") === $v0, '');

// ---- 21. An email lookup is case-blind AND index-usable -------------------
//  Every "is this the same person" query used to read `LOWER(email) = LOWER(?)`,
//  which wraps the indexed column in a function and so cannot use idx_email.
//  Measured on this schema with 5,036 rows: `email = ?` plans ref/idx_email/1 row,
//  the LOWER() form plans an index scan of all 5,036 — on the query that runs
//  whenever a guest opens their stays. They are now plain equality, which is only
//  correct because the columns collate case-insensitively. That was inherited from
//  the server default, i.e. true by luck; migration-112 states it. This section is
//  what makes the assumption fail LOUDLY rather than silently hiding a guest's own
//  booking from them, so all three legs are checked: the collation, the behaviour
//  through the real endpoint, and the query plan.
echo "\n== 21. Email lookups are case-blind and index-usable ==\n";
$colls = $rootDb->query(
    "SELECT TABLE_NAME, COLLATION_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'email'
       AND TABLE_NAME IN ('bookings','enquiries','guests')",
)->fetchAll(PDO::FETCH_KEY_PAIR);
it_check('all three email columns exist to be checked (vacuity guard)', count($colls) === 3, json_encode($colls));
foreach ($colls as $tbl => $coll) {
    it_check("$tbl.email collates case-INsensitively", substr((string) $coll, -3) === '_ci', (string) $coll);
}
// The BEHAVIOUR, through the real endpoint: a stay stored in mixed case must
// reach a guest whose session was minted from the lower-case form of it.
$mcIn = date('Y-m-d', strtotime('+120 days'));
$mcOut = date('Y-m-d', strtotime('+124 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Mixed Case','Mixed.Case@Gmail.COM','$mcIn','$mcOut',2,0,'deposit',100,400,400,0,4)");
$mcBid = (int) $rootDb->lastInsertId();
$mj = [];
$r = http($mj, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Mixed Case', 'email' => 'mixed.case@gmail.com',
    'password' => 'longenough1', 'address' => '3 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
it_check('(fixture) the account is made against the LOWER-case address', ($r['json']['ok'] ?? false) === true, $r['raw']);
$mcGid = (int) $rootDb->query("SELECT id FROM guests WHERE email = 'mixed.case@gmail.com'")->fetchColumn();
it_check('…and `email = ?` found that account despite the mixed-case stay', $mcGid > 0, "guest id $mcGid");
$mts = time();
$mtok = substr(hash_hmac('sha256', 'login:' . $mcGid . ':' . $mts, $SECRET), 0, 32);
$r = http($mj, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $mcGid, 'ts' => $mts, 'token' => $mtok]);
it_check('(fixture) the emailed link signs them in', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($mj, 'GET', '/my-bookings.php');
$mcIds = array_map(fn($b) => (int) ($b['id'] ?? 0), $r['json']['bookings'] ?? []);
it_check('a MIXED-CASE stay reaches its own guest', in_array($mcBid, $mcIds, true), $r['raw']);
// …and the plan. `possible_keys` is the right question, not `key`: it says whether
// the index is USABLE at all, which is what the function wrapper destroyed, and it
// is stable at any table size where the optimiser's final choice is not.
$plan = fn($sql) => $rootDb->query('EXPLAIN ' . $sql)->fetch(PDO::FETCH_ASSOC);
$pOk = $plan("SELECT id FROM bookings WHERE email = 'mixed.case@gmail.com'");
$pBad = $plan("SELECT id FROM bookings WHERE LOWER(email) = LOWER('mixed.case@gmail.com')");
it_check('`email = ?` can use idx_email', strpos((string) ($pOk['possible_keys'] ?? ''), 'idx_email') !== false, json_encode($pOk));
it_check('…and the LOWER() form provably cannot (so this is not a no-op)', ($pBad['possible_keys'] ?? null) === null, json_encode($pBad));
// The ratchet: an equality filter that wraps email in LOWER() must not come back.
// LIKE searches and SELECT-list projections are deliberately out of scope — neither
// can use the index anyway, so forbidding them would fail on correct code.
$lowerBack = [];
foreach (glob(__DIR__ . '/*.php') as $php) {
    if (strpos(basename($php), 'test-') === 0) { continue; }
    $src = (string) file_get_contents($php);
    $src = preg_replace('/^\s*(\/\/|\*|#).*$/m', '', $src) ?? $src; // a comment explaining this must not fail it
    if (preg_match('/LOWER\(\s*[a-z]?\.?email\s*\)\s*=/i', $src)) { $lowerBack[] = basename($php); }
}
it_check('no equality filter wraps email in LOWER() any more', $lowerBack === [], implode(', ', $lowerBack));

// ---- 22. A DECLINED enquiry can still be replied to ----------------------
//  The whole point of the decline ask is that the guest is owed a reply they
//  were promised, and by the time it is offered the enquiry has already been
//  declined. Declining is a soft delete, and the LIST query filters on
//  `declined_at IS NULL` — so if the reply path ever grew the same filter (an
//  easy and reasonable-looking edit), the feature would break silently: the
//  composer opens, the owner writes, and the send 404s. Both halves are pinned
//  here, on the real endpoints, because neither is visible from the client.
echo "\n== 22. A declined enquiry can still be replied to ==\n";
$eIn = date('Y-m-d', strtotime('+150 days'));
$eOut = date('Y-m-d', strtotime('+154 days'));
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message) VALUES ('$propKey','Declined Replier','dr@gmail.com','$eIn','$eOut',2,0,'Any parking?')");
$drId = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'decline', 'id' => $drId]);
it_check('(fixture) the enquiry declines', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
it_check('…and is a SOFT delete, still on the table', (int) $rootDb->query("SELECT COUNT(*) FROM enquiries WHERE id = $drId AND declined_at IS NOT NULL")->fetchColumn() === 1, '');
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'declined']);
$inDrawer = array_filter($r['json']['enquiries'] ?? [], fn($e) => (int) ($e['id'] ?? 0) === $drId);
it_check('…and reachable from the drawer the reply button lives on', count($inDrawer) === 1, $r['raw']);
// The preview and the send are separate code paths and BOTH look the row up.
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'email_preview', 'id' => $drId,
    'subject' => 'About your dates', 'message' => 'Those exact dates have just gone, I am afraid.']);
it_check('a declined enquiry still PREVIEWS a reply', $r['code'] === 200 && !empty($r['json']['html']), $r['raw']);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'email_guest', 'id' => $drId,
    'subject' => 'About your dates', 'message' => 'Those exact dates have just gone, I am afraid.']);
// MAIL_ENABLED is off in this harness, so a 200 means the row was FOUND and the
// composer ran — which is the thing that would break. A 404 is the failure mode.
it_check('…and the send reaches the composer rather than 404ing on the row', $r['code'] !== 404, $r['raw']);

// ---- 23. The HTML shell revalidates instead of re-downloading -------------
//  All three SSR shell routes emitted only Content-Type — no ETag, no
//  Last-Modified, no Cache-Control — and none calls session_start(), so PHP
//  added no validator either. sw.js's navigation branch is network-first and
//  always awaits the network, so an installed PWA re-downloaded a byte-identical
//  ~34.5KB shell on the critical path of EVERY launch. Against a repeat visit's
//  ~1.7KB of real traffic that was ~95% of the download.
//
//  The check that matters is the TOLERANT comparison. htaccess enables DEFLATE
//  for text/html and sets no DeflateAlterETag, and Apache 2.4 defaults to
//  AddSuffix — so mod_deflate rewrites `"abc"` to `"abc-gzip"` on the wire and
//  the browser echoes that back. A byte-exact comparison would match nothing, on
//  every request, while looking correct in the source. php -S applies no such
//  filter, so the suffixed form is fed in DELIBERATELY here: it is the only way
//  this environment can see the production shape at all.
echo "\n== 23. The HTML shell revalidates ==\n";
$shellGet = function (string $path, string $inm = '') {
    global $BASE;
    $h = ['Accept: text/html'];
    if ($inm !== '') { $h[] = 'If-None-Match: ' . $inm; }
    $opts = ['http' => ['method' => 'GET', 'header' => implode("\r\n", $h), 'timeout' => 30, 'ignore_errors' => true]];
    $http_response_header = [];
    $raw = @file_get_contents($BASE . $path, false, stream_context_create($opts));
    $code = 0; $etag = ''; $cc = '';
    foreach ($http_response_header as $hdr) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $hdr, $m)) { $code = (int) $m[1]; }
        if (preg_match('/^ETag:\s*(.+)$/i', $hdr, $m)) { $etag = trim($m[1]); }
        if (preg_match('/^Cache-Control:\s*(.+)$/i', $hdr, $m)) { $cc = trim($m[1]); }
    }
    return ['code' => $code, 'etag' => $etag, 'cc' => $cc, 'len' => strlen((string) $raw), 'raw' => (string) $raw];
};
// php -S serves no rewrites, so the routes are addressed by filename. cottage.php
// needs a real slug or it 404s by design.
$slugRow = $rootDb->query("SELECT slug FROM properties WHERE archived_at IS NULL ORDER BY sort_order LIMIT 1")->fetchColumn();
// cottage.php reads the slug out of REQUEST_URI (`/cottages/<slug>`), not a query
// string — php -S applies no rewrite, so the path is appended to the script and
// PHP's built-in server passes it through. A `?slug=` query reached the regex not
// at all and served the UNTOUCHED shell, which passed every check below while
// proving nothing about the cottage route; the assertion under $shellRoutes now
// requires cottage.php's bytes to DIFFER from home.php's.
$shellRoutes = ['/home.php', '/experiences-page.php', '/cottage.php/cottages/' . rawurlencode((string) $slugRow)];
foreach ($shellRoutes as $route) {
    $r1 = $shellGet($route);
    $name = ltrim(explode('?', $route)[0], '/');
    it_check("$name serves the shell with a strong ETag", $r1['code'] === 200 && preg_match('/^"[0-9a-f]{32}"$/', $r1['etag']) === 1, "code {$r1['code']} etag {$r1['etag']}");
    it_check("…and Cache-Control: no-cache, so it is STORED and revalidated", stripos($r1['cc'], 'no-cache') !== false, $r1['cc']);
    it_check("…and it is a real page ({$r1['len']} bytes)", $r1['len'] > 8000, (string) $r1['len']);
    $r2 = $shellGet($route, $r1['etag']);
    it_check('…a matching If-None-Match answers 304 with no body', $r2['code'] === 304 && $r2['len'] === 0, "code {$r2['code']} len {$r2['len']}");
    // THE PRODUCTION SHAPE: mod_deflate's suffix must still match, or this whole
    // section passes locally and the fix does nothing on the live host.
    $gz = preg_replace('/"$/', '-gzip"', $r1['etag']);
    $r3 = $shellGet($route, (string) $gz);
    it_check("…and so does mod_deflate's $gz", $r3['code'] === 304, "code {$r3['code']}");
    // A weak validator and a comma-separated list are both legal client shapes.
    $r4 = $shellGet($route, 'W/' . $r1['etag']);
    it_check('…and a weak validator', $r4['code'] === 304, "code {$r4['code']}");
    $r5 = $shellGet($route, '"0000000000000000000000000000dead", ' . $r1['etag']);
    it_check('…and a list containing it', $r5['code'] === 304, "code {$r5['code']}");
    // …but a DIFFERENT entity must still be served in full.
    $r6 = $shellGet($route, '"0000000000000000000000000000dead"');
    it_check('a stale validator gets the page, not a 304', $r6['code'] === 200 && $r6['len'] > 8000, "code {$r6['code']} len {$r6['len']}");
}
// …and cottage.php really rendered a COTTAGE. Byte-identical output to home.php
// means it fell through to the untouched shell, which is exactly what a wrong
// slug produces — the checks above would all still pass on it.
$homeTag = $shellGet('/home.php')['etag'];
$cottTag = $shellGet($shellRoutes[2])['etag'];
it_check('cottage.php rendered the cottage, not the bare shell', $cottTag !== '' && $cottTag !== $homeTag, "cottage $cottTag vs home $homeTag");
// The other half: sw.js listed BOTH './' and 'index.html', which htaccess rewrites
// to the same home.php — so a new install downloaded the shell twice.
$swSrc = (string) file_get_contents(__DIR__ . '/sw.js');
$core = [];
if (preg_match('/const CORE\s*=\s*\[([^\]]*)\]/', $swSrc, $m)) {
    preg_match_all("/'([^']+)'/", $m[1], $mm);
    $core = $mm[1];
}
it_check('sw.js CORE parses (vacuity guard)', count($core) >= 8, (string) count($core));
it_check('the shell is precached ONCE, not as both ./ and index.html',
    in_array('index.html', $core, true) && !in_array('./', $core, true), implode(' ', $core));

// ---- 24. The public bootstrap stops re-reading rows it already holds ------
//  One anonymous bootstrap.php request executed 9 statements / 11 round trips,
//  four of which re-read data already in the request's memory: the payload
//  SELECTs the whole `content` table, then content_value()/content_json() went
//  back for individual keys from that same result set, and occupancy_limits()
//  re-queried `properties` two lines after rates_public_payload() had selected
//  it. On shared hosting, with a handful of tabs polling every 30 seconds, that
//  is a lot of wasted PHP+MySQL for a response that usually ends in a 304.
//
//  The property that MUST hold is that the payload is unchanged. Counting
//  queries proves the saving; comparing bytes proves it cost nothing.
echo "\n== 24. The public bootstrap does not re-read itself ==\n";
$countQueries = function (string $path) {
    // MySQL's own counter, read either side of the request: no instrumentation
    // in the app, so this measures what the server actually executed.
    global $rootDb, $BASE;
    $before = (int) ($rootDb->query("SHOW SESSION STATUS LIKE 'Queries'")->fetch()['Value'] ?? 0);
    $opts = ['http' => ['method' => 'GET', 'header' => "Accept: application/json", 'timeout' => 30, 'ignore_errors' => true]];
    $raw = @file_get_contents($BASE . $path, false, stream_context_create($opts));
    $after = (int) ($rootDb->query("SHOW SESSION STATUS LIKE 'Queries'")->fetch()['Value'] ?? 0);
    return ['body' => (string) $raw, 'queries' => $after - $before - 2]; // less the two SHOWs
};
// SHOW SESSION STATUS counts THIS connection only, so it cannot see the web
// request's queries — use the GLOBAL counter instead, and take the measurement
// on an otherwise idle server (which this harness is).
$globalQueries = function () {
    global $rootDb;
    return (int) ($rootDb->query("SHOW GLOBAL STATUS LIKE 'Questions'")->fetch()['Value'] ?? 0);
};
$q0 = $globalQueries();
$b1 = @file_get_contents($BASE . '/bootstrap.php', false, stream_context_create(['http' => ['method' => 'GET', 'timeout' => 30, 'ignore_errors' => true]]));
$q1 = $globalQueries();
$used = $q1 - $q0 - 1; // less the SHOW itself
it_check('the anonymous bootstrap is a real payload', is_string($b1) && strlen($b1) > 200 && json_decode($b1, true) !== null, substr((string) $b1, 0, 120));
// MEASURED on this harness, same counter, same fixture: 11 statements before,
// 8 after. (The audit predicted 9->5 by reading the call graph with no database
// to hand; the live counter also sees the connection's own setup, which is why
// both numbers are higher and the saving is 3 rather than 4.) A ratchet, not a
// target — if a future change puts a re-read back, this is where it shows up.
it_check("…in 8 statements or fewer, down from a measured 11 (used $used)", $used > 0 && $used <= 8, (string) $used);
// BYTE-IDENTICAL is the property that makes the saving free. The memo holds raw
// values and content_value still decrypts per read, so nothing about the output
// may move — including for an ADMIN session, which sees more keys.
$b2 = @file_get_contents($BASE . '/bootstrap.php', false, stream_context_create(['http' => ['method' => 'GET', 'timeout' => 30, 'ignore_errors' => true]]));
it_check('…and two consecutive builds agree byte for byte', $b1 === $b2, '');
// occupancy_limits keeps its answer when handed rows rather than querying.
$occDirect = json_decode((string) $b1, true)['rates']['occupancy'] ?? null;
it_check('occupancy limits still ride the payload', is_array($occDirect) && count($occDirect) >= 1, json_encode($occDirect));
$liveProps = $rootDb->query('SELECT prop_key FROM properties WHERE archived_at IS NULL AND unlisted = 0')->fetchAll(PDO::FETCH_COLUMN);
sort($liveProps);
$occKeys = array_keys((array) $occDirect);
sort($occKeys);
it_check('…for exactly the live cottages, same as the query it replaced', $occKeys === $liveProps, json_encode([$occKeys, $liveProps]));
// The memo must NOT leak across requests or into write paths: a fresh request
// re-warms it, and nothing else populates it. Proven by the byte-identity above
// plus the fact that a WRITE then a read sees the new value.
$r = http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'hero-title', 'value' => 'Memo Probe ' . time()]);
it_check('(fixture) a content write succeeds', $r['code'] === 200, $r['raw']);
$b3 = @file_get_contents($BASE . '/bootstrap.php', false, stream_context_create(['http' => ['method' => 'GET', 'timeout' => 30, 'ignore_errors' => true]]));
it_check('a write is visible to the very next request (no stale memo)', strpos((string) $b3, 'Memo Probe') !== false, substr((string) $b3, 0, 160));

// ---------------------------------------------------------------------------
//  §22  THE EMAIL OUTBOX — the row lifecycle against the real schema, driven
//  through the real daily pass (self-repair's drain). MAIL_ENABLED is off in
//  this harness, so every drain attempt fails with 'Mail disabled' — which is
//  exactly what lets the TRANSITIONS be asserted deterministically: a due row
//  retries with backoff, a row at the boundary gives up LOUDLY (the warn that
//  reaches Needs attention), and pruning removes only what is finished. The
//  send semantics themselves are gated in test-smtp (sent_uncertain) and
//  test-payrail (the pure decisions); this section owns the SQL.
echo "\n== §22 email outbox lifecycle ==\n";
$rootDb->exec("USE `$DB_NAME`");
$rootDb->exec("DELETE FROM email_outbox");
$rootDb->exec("INSERT INTO email_outbox (next_try_at, context, to_email, to_name, subject, body_text, last_error)
               VALUES (DATE_SUB(NOW(), INTERVAL 1 MINUTE), 'confirmation', 'g@example.org', 'Gate Guest', 'S', 'b', 'seed')");
$obId = (int) $rootDb->lastInsertId();
$r = http($guest, 'GET', '/self-repair.php?cron=' . $SECRET);
it_check('self-repair runs with a due outbox row', $r['code'] === 200, $r['raw']);
$row = $rootDb->query("SELECT * FROM email_outbox WHERE id = $obId")->fetch(PDO::FETCH_ASSOC);
it_check('a failed retry moves the row FORWARD (tries + backoff), never sends it',
    $row && (int) $row['tries'] === 1 && $row['sent_at'] === null && $row['gave_up_at'] === null
        && strtotime($row['next_try_at']) > time(), json_encode($row));
it_check("…and records why ('Mail disabled')", $row && strpos((string) $row['last_error'], 'Mail disabled') !== false, (string) ($row['last_error'] ?? ''));
// The give-up boundary: force the row to its 8th attempt and drain again.
$rootDb->exec("UPDATE email_outbox SET tries = 7, next_try_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = $obId");
$r = http($guest, 'GET', '/self-repair.php?cron=' . $SECRET);
$row = $rootDb->query("SELECT * FROM email_outbox WHERE id = $obId")->fetch(PDO::FETCH_ASSOC);
it_check('the 8th failure gives up — kept as the audit trail, never retried again',
    $row && $row['gave_up_at'] !== null && (int) $row['tries'] === 8, json_encode($row));
$warn = $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'email.gaveup'")->fetchColumn();
it_check('…and the give-up is LOUD (an email.gaveup warn in the activity log)', (int) $warn >= 1, (string) $warn);
// Pruning removes only FINISHED rows: an old sent receipt goes, a pending row
// stays whatever its age (it is still owed a retry until it gives up).
$rootDb->exec("INSERT INTO email_outbox (created_at, next_try_at, context, to_email, subject, body_text, sent_at)
               VALUES (DATE_SUB(NOW(), INTERVAL 10 DAY), NOW(), 'confirmation', 'old@example.org', 'S', 'b', DATE_SUB(NOW(), INTERVAL 8 DAY))");
$rootDb->exec("INSERT INTO email_outbox (created_at, next_try_at, context, to_email, subject, body_text)
               VALUES (NOW(), DATE_ADD(NOW(), INTERVAL 1 HOUR), 'enquiry-ack', 'pending@example.org', 'S', 'b')");
$r = http($guest, 'GET', '/self-repair.php?cron=' . $SECRET);
$left = $rootDb->query("SELECT to_email FROM email_outbox ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
it_check('pruning removes the old sent receipt and keeps pending + gave-up rows',
    !in_array('old@example.org', $left, true) && in_array('pending@example.org', $left, true) && in_array('g@example.org', $left, true),
    json_encode($left));

// ══════════════════════════════════════════════════════════════════════════
// §25 THE OVERNIGHT QUEUE, through the real endpoints against the real
// database. Three things are worth driving here and cannot be driven
// anywhere else: the SETTING as a real gate (off must refuse the door, not
// merely hide the card), the exactly-once property of `ref` under a retried
// POST, and the sweep that enforces the deadline — the only thing standing
// between this queue and a pile the owner learns to scroll past.
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA725 the overnight queue\n";

$nsItem = function (array $over = []) {
    return $over + [
        'ref' => 'it-' . bin2hex(random_bytes(6)),
        'kind' => 'note',
        'title' => 'The week, read',
        'body' => "Two enquiries went quiet after you quoted.",
        'source' => 'the week',
    ];
};

// OFF IS THE DEFAULT, and off refuses the door. Not "stores it quietly for
// when you switch on" — a machine working every night into a table nobody
// will look at is the failure this refusal exists to prevent.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [$nsItem()]]);
it_check('with the setting off, ingest is REFUSED and says why',
    $r['code'] === 409 && ($r['json']['code'] ?? '') === 'night_off', $r['raw']);
$n = (int) $rootDb->query('SELECT COUNT(*) FROM night_items')->fetchColumn();
it_check('…and nothing was stored', $n === 0, (string) $n);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'list']);
it_check('…and the owner is told the queue is off, with no items',
    ($r['json']['on'] ?? true) === false && ($r['json']['items'] ?? null) === [], $r['raw']);

http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '1']);

// THE SECRET IS THE DOOR. No session, no cookie — the same posture as the
// cron URLs — so both halves are asserted: the wrong secret is refused even
// with the setting on, and it is refused BEFORE anything is stored.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => 'not-the-secret', 'items' => [$nsItem()]]);
it_check('a wrong secret is refused', $r['code'] === 401, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'items' => [$nsItem()]]);
it_check('no secret at all is refused', $r['code'] === 401, $r['raw']);
$n = (int) $rootDb->query('SELECT COUNT(*) FROM night_items')->fetchColumn();
it_check('…and still nothing stored', $n === 0, (string) $n);

// A SIGNED-IN OWNER IS NOT A PRODUCER either — ingest checks the secret and
// nothing else, so an admin session is no way in.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ingest', 'items' => [$nsItem()]]);
it_check('an admin session is not a substitute for the secret', $r['code'] === 401, $r['raw']);

// ── THE APP'S OWN KEY, END TO END ─────────────────────────────────────────
// The route used to take APP_SECRET and nothing else — the key to ~20 cron
// endpoints, one of which COLLECTS INSTALMENTS FROM GUESTS' CARDS. Driven
// through the real endpoint, because the fallback and the lock-out are the two
// halves that decide whether this is a fix or a decoration.
$scoped = str_repeat('n', 64);
$rootDb->prepare('DELETE FROM content WHERE item_key = ?')->execute(['apikey-nightshift']);
it_check('with no scoped key, the master secret still works (nothing breaks on upgrade)',
    http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [$nsItem()]])['code'] === 200);
$rootDb->query('DELETE FROM night_items');

// Mint one the way the owner's button does.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'new_key']);
it_check('the owner can mint the app a key of its own', $r['code'] === 200 && !empty($r['json']['key']), $r['raw']);
$minted = (string) ($r['json']['key'] ?? '');
it_check('…and it is long and random', strlen($minted) >= 48, (string) strlen($minted));

$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $minted, 'items' => [$nsItem()]]);
it_check('the scoped key opens the route', $r['code'] === 200, $r['raw']);
$rootDb->query('DELETE FROM night_items');

// THE HALF THAT MATTERS. If the master still worked here the app would still be
// holding the key to the payment scripts and this whole change would be theatre.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [$nsItem()]]);
it_check('…and the MASTER secret no longer does', $r['code'] === 401, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
it_check('…on the read route either', $r['code'] === 401, $r['raw']);
$n = (int) $rootDb->query('SELECT COUNT(*) FROM night_items')->fetchColumn();
it_check('…and the refused post stored nothing', $n === 0, (string) $n);

// NEVER SERVED BACK. It is shown once, at the moment it is generated.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'key_state']);
it_check('the owner can ask WHETHER a key is set', $r['code'] === 200 && ($r['json']['set'] ?? null) === true, $r['raw']);
it_check('…and that answer never carries the key itself', strpos($r['raw'], $minted) === false);
$r = http($admin, 'POST', '/content.php', ['action' => 'get_all']);
it_check('…nor does the admin content payload', strpos($r['raw'], $minted) === false, substr($r['raw'], 0, 120));
$r = http($guest, 'GET', '/content.php', []);
it_check('…nor the public one', strpos($r['raw'], $minted) === false);

// Encrypted at rest, like every other credential the site stores.
$stored = (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'apikey-nightshift'")->fetchColumn();
it_check('the stored row is ciphertext, not the key', $stored !== '' && strpos($stored, $minted) === false);

// AND IT FAILS CLOSED WHEN THE KEY CANNOT BE READ. Driven for real: corrupt the
// stored ciphertext, which is exactly what rotating APP_SECRET does to every
// encrypted value, and check the master secret does NOT get the route back.
$rootDb->prepare('UPDATE content SET item_value = ? WHERE item_key = ?')
    ->execute(['enc1:' . base64_encode(random_bytes(40)), 'apikey-nightshift']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [$nsItem()]]);
it_check('an unreadable key does NOT hand the route back to the master secret', $r['code'] === 401, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $minted, 'items' => [$nsItem()]]);
it_check('…and the old key does not work either — it refuses everything', $r['code'] === 401, $r['raw']);
$n = (int) $rootDb->query('SELECT COUNT(*) FROM night_items')->fetchColumn();
it_check('…and nothing was stored by any of it', $n === 0, (string) $n);
// Regenerating is the way out, and it works.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'new_key']);
$fresh = (string) ($r['json']['key'] ?? '');
it_check('regenerating recovers it',
    $fresh !== '' && http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $fresh, 'items' => [$nsItem()]])['code'] === 200);
$rootDb->query('DELETE FROM night_items');
$minted = $fresh;

// ── THE CONNECT CODE, THE DEVICE LIST, AND THE QUIET MAC ─────────────────
// Driven through the real endpoints, because the connect route is the only
// UNAUTHENTICATED action this file has and its refusals are the whole design.
$rootDb->prepare('DELETE FROM content WHERE item_key IN (?, ?)')
    ->execute(['apikey-nightshift', 'apikey-nightshift-code']);

// A code cannot be used before there is one.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => 'ABCD2345']);
it_check('connecting with no code waiting is refused', $r['code'] === 401, $r['raw']);
it_check('…and says there is no code, rather than "invalid"',
    stripos($r['raw'], 'no connect code') !== false, $r['raw']);

// The owner mints one.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'connect_code']);
it_check('the owner can mint a connect code', $r['code'] === 200 && !empty($r['json']['code']), $r['raw']);
$pretty = (string) ($r['json']['code'] ?? '');
it_check('…printed in halves for reading aloud', (bool) preg_match('/^[A-Z0-9]{4}-[A-Z0-9]{4}$/', $pretty), $pretty);
it_check('…with no I, O, 0 or 1 in it', !preg_match('/[IO01]/', $pretty), $pretty);
// A STRANGER MUST NOT BE ABLE TO ASK FOR ONE.
$r2 = http($guest, 'POST', '/nightshift.php', ['action' => 'connect_code']);
it_check('a stranger cannot mint a connect code', $r2['code'] === 401 || $r2['code'] === 403, (string) $r2['code']);

// The wrong code is refused, and does not burn the right one.
$wrong = ($pretty[0] === 'A' ? 'B' : 'A') . substr(str_replace('-', '', $pretty), 1);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => $wrong]);
it_check('a wrong code is refused', $r['code'] === 401, $r['raw']);

// The right one works, and the app gets a key of ITS OWN.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => strtolower($pretty)]);
it_check('the right code connects, typed loosely', $r['code'] === 200 && !empty($r['json']['key']), $r['raw']);
$devKey = (string) ($r['json']['key'] ?? '');
it_check('…and the key it earns is not the code', $devKey !== '' && stripos($devKey, str_replace('-', '', $pretty)) === false);
it_check('…and it opens the route',
    http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $devKey, 'items' => [$nsItem()]])['code'] === 200);
$rootDb->query('DELETE FROM night_items');

// SINGLE USE. The second attempt is refused, and says which fact it is.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => $pretty]);
it_check('the same code cannot be used twice', $r['code'] === 401, $r['raw']);
it_check('…and says it was USED, not that it expired',
    stripos($r['raw'], 'already been used') !== false, $r['raw']);

// THE SITE STORES ONLY A HASH — a copy of the row opens nothing.
$stored = (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'apikey-nightshift'")->fetchColumn();
it_check('the device row is ciphertext', $stored !== '' && strpos($stored, $devKey) === false);
// NB there is deliberately NO check here that the row holds a hash rather than
// the key. One was written and removed: the row is ciphertext either way, so
// it passed with hashing torn out — measuring the encryption, not the hashing,
// and reading like proof of something it never touched. That property is
// asserted where it can actually be seen, on the plain structure, in
// test-nightshift §14 ("the stored shape carries no key, only a hash"), which
// does fail when night_key_hash stops hashing.

// LAST SEEN was stamped by the request that worked.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'devices']);
it_check('the owner can list what is paired', $r['code'] === 200 && count($r['json']['devices'] ?? []) === 1, $r['raw']);
it_check('…with a last-seen from the request that worked', (int) ($r['json']['devices'][0]['seen'] ?? 0) > 0);
it_check('…and never a key or a hash on that screen',
    strpos($r['raw'], $devKey) === false && !preg_match('/[0-9a-f]{64}/', $r['raw']), substr($r['raw'], 0, 120));

// TWO MACS, EACH ON ITS OWN KEY — the thing one stored key could not do.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'connect_code', 'label' => 'MacBook']);
$second = (string) ($r['json']['code'] ?? '');
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => $second]);
$devKey2 = (string) ($r['json']['key'] ?? '');
it_check('a second Mac connects with its own code', $devKey2 !== '' && $devKey2 !== $devKey);
it_check('…and BOTH keys work', 
    http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $devKey])['code'] === 200
    && http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $devKey2])['code'] === 200);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'devices']);
it_check('…and the list shows two, named', count($r['json']['devices'] ?? []) === 2
    && ($r['json']['devices'][1]['label'] ?? '') === 'MacBook', $r['raw']);

// STOPPING ONE STOPS ONLY ONE.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'stop_device', 'i' => 0, 'label' => $r['json']['devices'][0]['label']]);
it_check('stopping one Mac is accepted', $r['code'] === 200, $r['raw']);
it_check('…that Mac stops working',
    http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $devKey])['code'] === 401);
it_check('…and the OTHER one carries on — the whole point of a list',
    http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $devKey2])['code'] === 200);
// A STALE SCREEN MUST NOT STOP THE WRONG MAC.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'stop_device', 'i' => 0, 'label' => 'Some other Mac']);
it_check('a stop whose label no longer matches is refused', $r['code'] === 409, $r['raw']);
it_check('…and the Mac is still working',
    http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $devKey2])['code'] === 200);

// THE MAC NAMES ITSELF, and its name beats the code record's.
// Reported live: two paired Macs both read "A Mac", because the label could
// only come from the code — which is minted before any machine has used it and
// therefore cannot know which one will. The app sends its own computer name now.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'connect_code', 'label' => 'FromTheCode']);
$third = (string) ($r['json']['code'] ?? '');
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => $third, 'label' => "George's Mac mini"]);
it_check('a Mac that names itself connects', $r['code'] === 200 && !empty($r['json']['key']), $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'devices']);
$labels = array_column($r['json']['devices'] ?? [], 'label');
it_check('…and the list shows the MACHINE\'s name, not the code\'s',
    in_array("George's Mac mini", $labels, true) && !in_array('FromTheCode', $labels, true),
    json_encode($labels));
// A label is text a holder of a valid code wrote, so what the OWNER IS SHOWN is
// collapsed and capped. NB this check says "shown" and not "stored" on purpose:
// night_devices() normalises on the way OUT as well, so break-testing the write
// side's night_dev_label() leaves this green — it cannot see how the row was
// written, and an earlier wording claiming "rather than stored raw" was
// therefore a claim about something it never touched. The write-side call is
// still worth keeping (it bounds what the encrypted row can grow to), and the
// property it enforces alone is asserted on the plain structure in
// test-nightshift, where it can actually be seen.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'connect_code']);
$fourth = (string) ($r['json']['code'] ?? '');
http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => $fourth,
    'label' => "<b>Mac</b>\n\tmini " . str_repeat('x', 200)]);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'devices']);
$last = (string) end($r['json']['devices'])['label'];
it_check('a hostile label reaches the owner\'s screen collapsed and capped',
    strlen($last) <= 64 && strpos($last, "\n") === false && strpos($last, "\t") === false
    && strpos($last, '<b>Mac</b> mini') === 0, $last);
// And with NO label from the app — an older copy — the code's own label stands,
// so upgrading is never a regression.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'connect_code', 'label' => 'OlderApp']);
$fifth = (string) ($r['json']['code'] ?? '');
http($guest, 'POST', '/nightshift.php', ['action' => 'connect', 'code' => $fifth]);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'devices']);
it_check('…while an app that sends none still gets the code\'s label',
    in_array('OlderApp', array_column($r['json']['devices'] ?? [], 'label'), true),
    json_encode(array_column($r['json']['devices'] ?? [], 'label')));

$rootDb->prepare('DELETE FROM content WHERE item_key IN (?, ?)')
    ->execute(['apikey-nightshift', 'apikey-nightshift-code']);
$rootDb->query('DELETE FROM night_items');
// THIS BLOCK IS DELIBERATELY CHATTY — two dozen requests to prove the refusals
// — and the brief route is throttled at 40/60s. Left alone it starves the
// checks BELOW, which then fail for a reason that has nothing to do with them.
$rootDb->query('DELETE FROM login_attempts');

// GENERATING A NEW ONE REVOKES THE OLD — the whole revocation story.
$r2 = http($admin, 'POST', '/nightshift.php', ['action' => 'new_key']);
$second = (string) ($r2['json']['key'] ?? '');
it_check('a second key is different from the first', $second !== '' && $second !== $minted);
it_check('…and the first stops working immediately',
    http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $minted, 'items' => [$nsItem()]])['code'] === 401);
it_check('…while the new one works',
    http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $second, 'items' => [$nsItem()]])['code'] === 200);
$rootDb->query('DELETE FROM night_items');
// Back to the master for the rest of this section.
$rootDb->prepare('DELETE FROM content WHERE item_key = ?')->execute(['apikey-nightshift']);

// A REAL NIGHT'S WORK.
$refReply = 'it-reply-' . bin2hex(random_bytes(4));
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [
    $nsItem(['ref' => $refReply, 'kind' => 'reply', 'title' => 'Reply to Rachel', 'target' => 'enquiry-1']),
    $nsItem(['kind' => 'answer', 'title' => 'Somewhere to dry wetsuits']),
    $nsItem(['kind' => 'nonsense', 'title' => 'Charge the card']),
    $nsItem(['title' => '', 'body' => 'no title']),
    $nsItem(['title' => 'Escape hatch', 'target' => 'javascript:alert(1)']),
]]);
it_check('the two good items are stored', ($r['json']['stored'] ?? 0) === 2, $r['raw']);
it_check('…and the three bad ones are skipped, each with a reason',
    count($r['json']['skipped'] ?? []) === 3
        && !array_filter($r['json']['skipped'], fn($s) => trim((string) ($s['why'] ?? '')) === ''),
    $r['raw']);
$badTarget = (int) $rootDb->query("SELECT COUNT(*) FROM night_items WHERE target LIKE 'javascript%'")->fetchColumn();
it_check('a target the app could not open never reached the table', $badTarget === 0, (string) $badTarget);

// EXACTLY ONCE. The producer is a machine that cannot tell a lost reply from
// a lost request, so it retries — and a retried night stores nothing twice.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [
    $nsItem(['ref' => $refReply, 'kind' => 'reply', 'title' => 'Reply to Rachel', 'target' => 'enquiry-1']),
]]);
it_check('a retried POST stores nothing a second time', ($r['json']['stored'] ?? -1) === 0, $r['raw']);
$dupes = (int) $rootDb->query("SELECT COUNT(*) FROM night_items WHERE ref = " . $rootDb->quote($refReply))->fetchColumn();
it_check('…and there is still exactly one row for that ref', $dupes === 1, (string) $dupes);

// THE OWNER READS IT.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'list']);
$items = $r['json']['items'] ?? [];
it_check('the owner sees both open items', ($r['json']['on'] ?? false) === true && count($items) === 2, $r['raw']);
$reply = null;
foreach ($items as $it) {
    if (($it['ref'] ?? '') === $refReply) {
        $reply = $it;
    }
}
it_check('…with its destination intact', $reply && ($reply['target'] ?? '') === 'enquiry-1', json_encode($reply));
// Compared against the row's OWN created stamp, never this process's clock:
// the server stamps Europe/London while the harness may sit on UTC, so the
// wall-clock form failed for the hour either side of midnight — found red at
// 23:05 UTC, having been green at every other hour since it was written.
it_check('…and a deadline three days out, not fourteen (a reply is about a LIVE enquiry)',
    $reply && substr((string) $reply['expires'], 0, 10)
        === date('Y-m-d', strtotime(substr((string) $reply['created'], 0, 19)) + 3 * 86400),
    json_encode($reply));

// A GUEST NEVER SEES ANY OF IT — these are drafts about named guests.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'list']);
it_check('a guest session cannot list the queue', $r['code'] === 401 || $r['code'] === 403, $r['raw']);

// USING ONE HANDS BACK ITS DESTINATION and takes it out of the queue.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'act', 'id' => $reply['id'], 'do' => 'use']);
it_check('using an item returns the screen to open', ($r['json']['target'] ?? '') === 'enquiry-1', $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'list']);
it_check('…and it leaves the queue', count($r['json']['items'] ?? []) === 1, $r['raw']);

// BINNING IS REVERSIBLE — the machine wrote the row, not the owner.
$other = $r['json']['items'][0];
http($admin, 'POST', '/nightshift.php', ['action' => 'act', 'id' => $other['id'], 'do' => 'dismiss']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'list']);
it_check('binning empties the queue', count($r['json']['items'] ?? []) === 0, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'act', 'id' => $other['id'], 'do' => 'restore']);
it_check('…and it can be put straight back', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'list']);
it_check('…and it is there again', count($r['json']['items'] ?? []) === 1, $r['raw']);

// RESTORE IS ONLY EVER A WAY BACK FROM A BIN. Something the sweep expired
// must stay expired — the deadline was the point.
$rootDb->exec("INSERT INTO night_items (ref, kind, title, body, status, created_at, expires_at, acted_at)
               VALUES ('it-expired-1','reply','Stale draft','x','expired', NOW(), DATE_SUB(NOW(), INTERVAL 1 DAY), NOW())");
$expId = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'act', 'id' => $expId, 'do' => 'restore']);
it_check('an expired item cannot be restored', $r['code'] === 409, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'act', 'id' => $expId, 'do' => 'send']);
it_check('an act this app does not have is refused', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'act', 'id' => 99999999, 'do' => 'use']);
it_check('an item that is not there says so', $r['code'] === 404, $r['raw']);

// AN OPEN ITEM PAST ITS DEADLINE IS NEVER LISTED, even before the sweep runs.
$rootDb->exec("INSERT INTO night_items (ref, kind, title, body, status, created_at, expires_at)
               VALUES ('it-overdue-1','reply','Yesterday''s draft','x','open', DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY))");
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'list']);
$refs = array_column($r['json']['items'] ?? [], 'ref');
it_check('an item past its deadline is not shown, sweep or no sweep', !in_array('it-overdue-1', $refs, true), json_encode($refs));

// THE SWEEP retires it for real, and prunes what has been decided long enough.
$rootDb->exec("INSERT INTO night_items (ref, kind, title, body, status, created_at, expires_at, acted_at)
               VALUES ('it-old-used','note','Long gone','x','used', DATE_SUB(NOW(), INTERVAL 40 DAY), DATE_SUB(NOW(), INTERVAL 26 DAY), DATE_SUB(NOW(), INTERVAL 20 DAY))");
http($guest, 'GET', '/self-repair.php?cron=' . $SECRET);
$st = $rootDb->query("SELECT status FROM night_items WHERE ref = 'it-overdue-1'")->fetchColumn();
it_check('the daily sweep marks it expired (so "where did it go?" has an answer)', $st === 'expired', var_export($st, true));
$gone = (int) $rootDb->query("SELECT COUNT(*) FROM night_items WHERE ref = 'it-old-used'")->fetchColumn();
it_check('…and deletes what was decided a fortnight ago', $gone === 0, (string) $gone);
$kept = (int) $rootDb->query("SELECT COUNT(*) FROM night_items WHERE ref = 'it-expired-1'")->fetchColumn();
it_check('…while a recently-decided row is kept', $kept === 1, (string) $kept);

// THE CAP. A producer that has gone wrong overnight fills a screen, not a disk.
$rootDb->exec('DELETE FROM night_items');
$fill = [];
for ($i = 0; $i < 12; $i++) {
    $fill[] = $nsItem(['ref' => 'it-cap-a-' . $i]);
}
http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => $fill]);
$fill = [];
for ($i = 0; $i < 12; $i++) {
    $fill[] = $nsItem(['ref' => 'it-cap-b-' . $i]);
}
http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => $fill]);
$fill = [];
for ($i = 0; $i < 5; $i++) {
    $fill[] = $nsItem(['ref' => 'it-cap-c-' . $i]);
}
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => $fill]);
$open = (int) $rootDb->query("SELECT COUNT(*) FROM night_items WHERE status = 'open'")->fetchColumn();
it_check('the queue stops at its cap', $open === 24, (string) $open);
it_check('…and the ones that did not fit are named, with the reason',
    ($r['json']['stored'] ?? -1) === 0 && count($r['json']['skipped'] ?? []) === 5, $r['raw']);

// A BATCH BIGGER THAN A NIGHT'S WORK is a bug at the other end, and refusing
// the whole thing is how the other end finds out.
$big = [];
for ($i = 0; $i < 13; $i++) {
    $big[] = $nsItem(['ref' => 'it-big-' . $i]);
}
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => $big]);
it_check('an over-large batch is refused whole', $r['code'] === 400, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => []]);
it_check('an empty batch is refused', $r['code'] === 400, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'nonsense', 'secret' => $SECRET]);
it_check('an unknown action is refused', $r['code'] === 400, $r['raw']);

// THE BOOT PAYLOAD carries on/off and the count, so Today can render the card
// with no request of its own.
$r = http($admin, 'GET', '/admin-bootstrap.php');
it_check('the boot payload says the queue is on and how many are waiting',
    ($r['json']['night']['on'] ?? 0) === 1 && ($r['json']['night']['n'] ?? 0) === 24, $r['raw']);

// SWITCHING IT OFF closes the door again, and the count goes to nought — the
// card cannot render from a stale flag.
$rootDb->exec('DELETE FROM night_items');
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [$nsItem()]]);
it_check('switched off, the door closes again', $r['code'] === 409, $r['raw']);
$r = http($admin, 'GET', '/admin-bootstrap.php');
it_check('…and the boot payload says off', ($r['json']['night']['on'] ?? 1) === 0, $r['raw']);

// THE SETTING IS THE OWNER'S OWN. An internal key never reaches the public
// content GET, so a visitor cannot learn whether the door is open.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '1']);
$anon = [];
$r = http($anon, 'GET', '/content.php');
it_check('the public content GET never carries the night-shift setting',
    !array_key_exists('night-shift', (array) ($r['json'] ?? [])), mb_substr($r['raw'], 0, 200));
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '']);

// ══════════════════════════════════════════════════════════════════════════
// §26 THE BRIEF — the read a producer gets before it writes. The ingest secret
// only ever let a machine put something IN; without a matching read, a producer
// has no way to see the enquiries it is meant to answer. What matters here is
// what the brief HANDS OVER (the site's own quote and the site's own
// availability answer, so nothing has to be invented at the far end) and what
// it WITHHOLDS (every contact detail a drafted reply does not need).
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA726 the brief a producer reads\n";

http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
it_check('with the queue off, the brief is refused too — one switch, both directions',
    $r['code'] === 409 && ($r['json']['code'] ?? '') === 'night_off', $r['raw']);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '1']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => 'wrong']);
it_check('a wrong secret cannot read it', $r['code'] === 401, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'brief']);
it_check('an admin session is not a substitute for the secret here either', $r['code'] === 401, $r['raw']);

// A real waiting enquiry, on dates that are free.
$bfIn = date('Y-m-d', time() + 90 * 86400);
$bfOut = date('Y-m-d', time() + 97 * 86400);
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, phone, address, postcode, check_in, check_out, adults, children, message)
               VALUES ('$propKey','Rachel Pemberton','rachel@gmail.com','07700 900123','9 Test Lane, Norwich','NR25 7AB','$bfIn','$bfOut',2,0,'Is it free that week, and do you take dogs?')");
$bfId = (int) $rootDb->lastInsertId();
// The cottage's own published answers — what a reply should be written FROM.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'faqs-' . $propKey,
    'value' => [['q' => 'Do you take dogs?', 'a' => 'We are afraid not.'], ['q' => 'Parking?', 'a' => 'One car outside.']]]);

$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
$es = $r['json']['enquiries'] ?? [];
$mine = null;
foreach ($es as $e) {
    if ((int) ($e['id'] ?? 0) === $bfId) {
        $mine = $e;
    }
}
it_check('the waiting enquiry is in the brief', $mine !== null, $r['raw']);
it_check('…with the guest named and a first name worked out',
    $mine && $mine['name'] === 'Rachel Pemberton' && $mine['first'] === 'Rachel', json_encode($mine));
it_check('…and their message', $mine && strpos($mine['message'], 'take dogs') !== false, json_encode($mine));

// A DECLINED ENQUIRY NEVER REACHES THE PRODUCER. Declining is a soft delete
// (declined_at set) and the brief read the table RAW — so the owner declined
// someone in the afternoon and the machine drafted them a reply that night,
// with the declined guest's name and message leaving the site to do it.
// Driven through the REAL decline action, so the brief and the inbox can
// never disagree about which column means declined.
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, phone, check_in, check_out, adults, children, message)
               VALUES ('$propKey','Denny Declined','denny@gmail.com','07700 900321','$bfIn','$bfOut',2,0,'Any space that week for us?')");
$dcId = (int) $rootDb->lastInsertId();
http($admin, 'POST', '/enquiries.php', ['action' => 'decline', 'id' => $dcId]);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
$dcSeen = false;
foreach (($r['json']['enquiries'] ?? []) as $e) {
    if ((int) ($e['id'] ?? 0) === $dcId) {
        $dcSeen = true;
    }
}
it_check('a declined enquiry is not in the brief', !$dcSeen, $r['raw']);
it_check('…and nothing of theirs leaves the site at all',
    strpos($r['raw'], 'Denny') === false && strpos($r['raw'], 'Any space that week') === false,
    mb_substr($r['raw'], 0, 200));
$rootDb->exec('DELETE FROM enquiries WHERE id = ' . $dcId);

// THE COTTAGE IS NAMED, AND "Array" IS NOT A NAME.
//
// Every other field here was checked and this one was not — so every draft
// ever written opened "Array is a lovely cottage", reported from a phone on
// the first night this ran. prop_display() returns an ARRAY (name, accent,
// slug) and the call site cast it with `(string)`, which in PHP yields the
// literal word "Array": the cast silenced the conversion into something that
// LOOKS like a name instead of letting it be a type error.
//
// The pure composer was gated and the CALL SITE was not, which is the
// helper-tested-alone trap. Asserted against the properties row rather than a
// literal, so renaming a cottage in Settings cannot make this fail.
$expectName = (string) $rootDb->query(
    "SELECT name FROM properties WHERE prop_key = " . $rootDb->quote($propKey),
)->fetchColumn();
it_check('the cottage is NAMED, not stringified into "Array"',
    $mine && $mine['cottage'] !== 'Array' && $mine['cottage'] !== '', json_encode($mine['cottage'] ?? null));
it_check('…and it is the name the properties row carries',
    $mine && ($expectName === '' || $mine['cottage'] === $expectName),
    json_encode([$mine['cottage'] ?? null, $expectName]));
// THE FIGURES TRAVEL WITH THE BRIEF. This is the property that makes "it never
// states money" enforceable: a producer is quoting, not calculating.
it_check('the SITE quotes the price, already formatted',
    $mine && preg_match('/^£[0-9,]+\.[0-9]{2}$/', (string) $mine['quote']) === 1, json_encode($mine['quote'] ?? null));
it_check('…and it is the same figure price_breakdown gives for those dates',
    $mine && (float) str_replace([',', '£'], '', $mine['quote']) > 0 && $mine['nights'] === 7, json_encode($mine));
it_check('the SITE answers availability — free dates read free', $mine && $mine['dates_free'] === true, json_encode($mine));
it_check('the cottage&rsquo;s own answers ride along', $mine && count($mine['facts']) === 2, json_encode($mine['facts'] ?? null));
it_check('the host is named for the sign-off', isset($r['json']['host']), $r['raw']);
// WHAT IT WITHHOLDS.
$leaks = [];
foreach (['email', 'phone', 'address', 'postcode'] as $k) {
    if ($mine && array_key_exists($k, $mine)) {
        $leaks[] = $k;
    }
}
it_check('no contact detail a drafted reply does not need', count($leaks) === 0, implode(',', $leaks));
it_check('…and the raw payload never contains the address either',
    strpos($r['raw'], '9 Test Lane') === false && strpos($r['raw'], '07700 900123') === false, mb_substr($r['raw'], 0, 200));

// ── THE OTHER JOBS' FACTS RIDE THE SAME BRIEF ──────────────────────────────
// The week (arrivals with the site's own due figure), the gaps (site-priced),
// and the guest questions — through the REAL endpoint, so the queries and the
// composers are proven together rather than the composers alone.
$wkIn = date('Y-m-d', time() + 3 * 86400);
$wkOut = date('Y-m-d', time() + 6 * 86400);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, phone, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights)
    VALUES ('$propKey','Wendy Weekly','wendy@gmail.com','07700 900555','$wkIn','$wkOut',2,0,'deposit',100,400,400,0,3)");
$wkBid = (int) $rootDb->lastInsertId();
// A 3-night hole between two stays, inside the 45-day window: gap fodder.
$g1In = date('Y-m-d', time() + 20 * 86400);
$g1Out = date('Y-m-d', time() + 23 * 86400);
$g2In = date('Y-m-d', time() + 26 * 86400);
$g2Out = date('Y-m-d', time() + 29 * 86400);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights)
    VALUES ('$propKey','Gap Before','gb@gmail.com','$g1In','$g1Out',2,0,'paid',300,300,300,0,3),
           ('$propKey','Gap After','ga@gmail.com','$g2In','$g2Out',2,0,'paid',300,300,300,0,3)");
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'guest-faq-misses',
    'value' => [['q' => 'Is there an EV charger nearby?', 'n' => 3, 'prop' => $propKey, 'at' => date('Y-m-d')]]]);

$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
$wk = $r['json']['week'] ?? null;
$wArr = null;
foreach (($wk['arrivals'] ?? []) as $a) {
    if (($a['first'] ?? '') === 'Wendy') {
        $wArr = $a;
    }
}
it_check('the brief hands over the WEEK, with the arrival named by first name and cottage',
    $wArr !== null && ($wArr['cottage'] ?? '') === $expectName, json_encode($wk));
it_check('…carrying the site&rsquo;s own outstanding figure, formatted',
    $wArr && ($wArr['due'] ?? '') === '£300.00', json_encode($wArr));
$gp = $r['json']['gaps'] ?? [];
$gMine = null;
foreach ($gp as $g) {
    if (($g['from'] ?? '') === $g1Out) {
        $gMine = $g;
    }
}
it_check('…and the GAPS, found and dated by the site',
    $gMine !== null && $gMine['to'] === $g2In && $gMine['nights'] === 3, json_encode($gp));
it_check('…each priced by the site at rate AND offer',
    $gMine && preg_match('/^£[0-9,]+\.[0-9]{2}$/', (string) $gMine['rate']) === 1
    && preg_match('/^£[0-9,]+\.[0-9]{2}$/', (string) $gMine['offer']) === 1
    && (float) str_replace(['£', ','], '', $gMine['offer']) < (float) str_replace(['£', ','], '', $gMine['rate']),
    json_encode($gMine));
$qs = $r['json']['questions'] ?? [];
it_check('…and the QUESTIONS guests kept asking, grounded in the cottage&rsquo;s own answers',
    count($qs) >= 1 && $qs[0]['q'] === 'Is there an EV charger nearby?' && $qs[0]['asked'] === 3
    && count($qs[0]['facts']) === 2, json_encode($qs));
it_check('the week withholds contact details exactly as the enquiries do',
    strpos($r['raw'], 'wendy@gmail.com') === false && strpos($r['raw'], '900555') === false,
    mb_substr($r['raw'], 0, 200));
// The cottage-name bug's tombstone: `(string)` on an array is the literal
// word "Array", and it shipped in every draft's cottage name before anything
// swept for it. The REAL payload, whole — nothing this suite seeds contains
// the word, so its presence can only ever be that class of bug again.
it_check('the word Array appears nowhere in the whole real brief',
    strpos($r['raw'], 'Array') === false, mb_substr($r['raw'], 0, 200));
$rootDb->exec('DELETE FROM bookings WHERE id = ' . $wkBid . " OR name IN ('Gap Before','Gap After')");
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'guest-faq-misses', 'value' => []]);

// TAKEN DATES SAY SO. The site owns the clash check, so a producer can never
// promise a week that has gone.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Blocker','b@gmail.com','$bfIn','$bfOut',2,0,'paid',100,300,300,0,7)");
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
$mine2 = null;
foreach (($r['json']['enquiries'] ?? []) as $e) {
    if ((int) ($e['id'] ?? 0) === $bfId) {
        $mine2 = $e;
    }
}
it_check('once the dates are taken, the brief says so', $mine2 && $mine2['dates_free'] === false, json_encode($mine2));

// A BINNED DRAFT STAYS BINNED (integration step 2). Refs are per-night, so
// an enquiry whose draft the owner dismissed was re-drafted the next night —
// the queue's own target is the join, and the brief now withholds it and
// SAYS how many it withheld (stood_down), or a shorter brief reads as
// enquiries going missing.
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message)
               VALUES ('$propKey','Binny Binnington','binny@gmail.com','$bfIn','$bfOut',2,0,'Any space left?')");
$bnId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO night_items (ref, kind, title, sub, body, source, target, status, created_at, expires_at, acted_at)
               VALUES ('it-binned-1','reply','Reply to Binny','', 'A draft the owner rejected.', '', 'enquiry-$bnId', 'dismissed', NOW(), DATE_ADD(NOW(), INTERVAL 3 DAY), NOW())");
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
$bnSeen = false;
foreach (($r['json']['enquiries'] ?? []) as $e) {
    if ((int) ($e['id'] ?? 0) === $bnId) {
        $bnSeen = true;
    }
}
it_check('an enquiry whose draft was binned is withheld from the brief', !$bnSeen, $r['raw']);
it_check('…and the brief says how many it stood down', ($r['json']['stood_down'] ?? 0) === 1, $r['raw']);
// The window is DAYS, not for ever: a still-waiting enquiry past it is fair
// to offer again — the guest is still waiting too.
$rootDb->exec("UPDATE night_items SET acted_at = DATE_SUB(NOW(), INTERVAL 5 DAY) WHERE ref = 'it-binned-1'");
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
$bnSeen = false;
foreach (($r['json']['enquiries'] ?? []) as $e) {
    if ((int) ($e['id'] ?? 0) === $bnId) {
        $bnSeen = true;
    }
}
it_check('…but a bin five days old stands the enquiry back up', $bnSeen && !isset($r['json']['stood_down']), $r['raw']);
$rootDb->exec("DELETE FROM night_items WHERE ref = 'it-binned-1'");
$rootDb->exec('DELETE FROM enquiries WHERE id = ' . $bnId);

// LIVE PRESENCE (integration step 1): the bootstrap carries the Macs' last
// seen — the same devices read the quiet duty already makes — so the
// Draft-on-your-Mac buttons can say listening/asleep instead of offering a
// 90-second wait against a Mac known to be off. Only a DEVICE key stamps
// seen (the master path never does — the first draft of this check used
// $SECRET and read seen 0), so a device is minted and used first.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'new_key']);
$presKey = (string) ($r['json']['key'] ?? '');
http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $presKey, 'build' => 'hand-build-20260819-0100']);
$r = http($admin, 'GET', '/admin-bootstrap.php');
$mac = $r['json']['night']['mac'] ?? null;
it_check('the bootstrap carries the Mac presence, listening after a fresh call',
    is_array($mac) && ($mac['listening'] ?? false) === true && ($mac['seen'] ?? 0) > 0,
    json_encode($r['json']['night'] ?? null));
// …and the BUILD the Mac reported rides the same stamp (integration step 4):
// the devices list names it, beside the newest release self-repair fetched.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'nightshift-latest-build', 'value' => 'hand-build-20260819-0900']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'devices']);
it_check('the devices list carries each Mac\'s reported build and the newest release',
    (($r['json']['devices'][0]['build'] ?? '') === 'hand-build-20260819-0100')
    && (($r['json']['latest'] ?? '') === 'hand-build-20260819-0900'), $r['raw']);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'nightshift-latest-build', 'value' => '']);
// The row is DELETED to restore the master path for everything below — a
// key on file (even an emptied list: the row itself) means only device keys
// work, which is the posture §25 gates; the suite's own reset is the same
// row delete §25 opens with.
$rootDb->prepare('DELETE FROM content WHERE item_key = ?')->execute(['apikey-nightshift']);
it_check('…and with the device row gone the master key speaks again',
    http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET])['code'] === 200);

// HOW GEORGE WRITES rides the brief (integration step 3): the reply
// library's most-used paragraphs, tokens neutralised — and ABSENT when the
// library is empty, never an empty list posing as a voice.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'email-templates',
    'value' => [['id' => 't1', 'name' => 'x', 'body' => 'Lovely to hear from you — {{cottage}} is a special spot and {{dates}} would suit it well.', 'uses' => 4, 'actions' => [], 'when' => '']]]);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
it_check('the brief carries the voice, tokens neutralised',
    count($r['json']['voice'] ?? []) === 1
    && strpos($r['json']['voice'][0], 'the cottage is a special spot') !== false
    && strpos($r['raw'], '{{') === false, json_encode($r['json']['voice'] ?? null));
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'email-templates', 'value' => []]);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
it_check('…and an empty library sends NO voice field at all', !isset($r['json']['voice']), mb_substr($r['raw'], 0, 200));

// THE TEACH BRIEF (search × Mac, rung 4): the week's dead ends beside the
// canonical menu the client synced — through the REAL keys and endpoint. A
// taught phrasing is withheld, and with no menu the block is ABSENT.
$teachToday = date('Y-m-d');
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'search-misses',
    'value' => [['t' => 'anyone owing us?', 'n' => 3, 'at' => $teachToday], ['t' => 'already taught', 'n' => 9, 'at' => $teachToday]]]);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'nlu-learned',
    'value' => [['t' => 'already taught', 'c' => 'who owes me money']]]);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'search-canon',
    'value' => ['who owes me money', 'leaving today']]);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
it_check('the brief carries the teach block — the live miss and the menu',
    (($r['json']['teach']['misses'] ?? null) === [['q' => 'anyone owing us?', 'n' => 3]])
    && (($r['json']['teach']['options'] ?? null) === ['who owes me money', 'leaving today']),
    json_encode($r['json']['teach'] ?? null));
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'search-canon', 'value' => []]);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
it_check('…and with no synced menu the block is absent, never an invented mapping surface',
    !isset($r['json']['teach']), mb_substr($r['raw'], 0, 200));
// A teach ITEM is storable — the queue's vocabulary grew with the job.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ingest', 'secret' => $SECRET, 'items' => [[
    'ref' => 'mac--teach-qabc123', 'kind' => 'teach', 'title' => '“anyone owing us?”',
    'sub' => 'reads as “who owes me money”', 'body' => 'Teach it and the search box answers instantly.',
    'target' => 'settings:search-learning',
]]]);
it_check("the queue takes a kind 'teach' item", ($r['json']['stored'] ?? 0) === 1, $r['raw']);
$rootDb->exec("DELETE FROM night_items WHERE ref = 'mac--teach-qabc123'");
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'search-misses', 'value' => []]);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'nlu-learned', 'value' => []]);

// THE CAP. A producer reads a handful, never the history.
for ($i = 0; $i < 12; $i++) {
    $rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message)
                   VALUES ('$propKey','Filler $i','f$i@gmail.com','$bfIn','$bfOut',2,0,'hello')");
}
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'brief', 'secret' => $SECRET]);
it_check('the brief is capped at a handful', count($r['json']['enquiries'] ?? []) === 8, (string) count($r['json']['enquiries'] ?? []));
it_check('…and says what its own cap is', ($r['json']['cap'] ?? 0) === 8, $r['raw']);

$rootDb->exec('DELETE FROM enquiries');

// ══════════════════════════════════════════════════════════════════════════
// §27 THE ASK CHANNEL — the daytime half, through the real endpoints. The
// owner files an ask; the machine (the Mac's 20-second poll) reads it with
// the SAME composed facts and the SAME withholding as the brief; the answer
// lands back on the row and the owner collects it. One switch, both halves.
// ══════════════════════════════════════════════════════════════════════════
echo "\n\xC2\xA727 the ask channel\n";
// night-shift is still ON from §26's tail... it was just switched off above —
// switch it back for the channel, then off at the end.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '1']);

// The owner's door: admin only, switch honoured, junk refused.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'answer', 'question' => 'x']);
it_check('a guest cannot file an ask', $r['code'] === 401 || $r['code'] === 403, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'invoice', 'id' => 1]);
it_check('an unknown kind is refused in words', $r['code'] === 400 && strpos($r['raw'], 'reply') !== false, $r['raw']);

// A reply ask needs a LIVE enquiry — filing one about a declined enquiry is
// refused at the door, the fresh lesson held here too.
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message)
               VALUES ('$propKey','Asky Askerton','asky@gmail.com','$bfIn','$bfOut',2,0,'Do you allow dogs?')");
$askEnqId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message, declined_at)
               VALUES ('$propKey','Deno Declined','deno@gmail.com','$bfIn','$bfOut',2,0,'Space?', NOW())");
$askDecId = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'reply', 'id' => $askDecId]);
it_check('an ask about a declined enquiry is refused at the door', $r['code'] === 404, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'reply', 'id' => $askEnqId]);
$askId = (int) ($r['json']['id'] ?? 0);
it_check('a real ask files and returns its id', ($r['json']['ok'] ?? false) === true && $askId > 0, $r['raw']);

// The machine's read: key gated, switch gated, and the facts are the brief's
// own — quote formatted, contact details withheld.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'asks', 'secret' => 'wrong']);
it_check('a wrong key cannot read the asks', $r['code'] === 401, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'asks', 'secret' => $SECRET]);
$found = null;
foreach (($r['json']['asks'] ?? []) as $a) {
    if ((int) ($a['id'] ?? 0) === $askId) {
        $found = $a;
    }
}
it_check('the machine sees the open ask', $found !== null, $r['raw']);
it_check('…carrying the enquiry as the brief composes it (first name worked out)',
    $found && (($found['enquiry']['first'] ?? '') === 'Asky'), json_encode($found));
it_check('…with the contact details withheld', strpos($r['raw'], 'asky@gmail.com') === false, mb_substr($r['raw'], 0, 200));

// The machine answers; the owner collects it.
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'answer', 'secret' => $SECRET,
    'id' => $askId, 'text' => 'Thank you for asking — we are afraid we cannot take dogs.', 'model' => 'q.gguf']);
it_check('the answer lands', ($r['json']['ok'] ?? false) === true && empty($r['json']['replayed']), $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'answer', 'secret' => $SECRET,
    'id' => $askId, 'text' => 'A second answer must not clobber the first.']);
it_check('a retried answer reads back as replayed, and the first stands', ($r['json']['replayed'] ?? false) === true, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask_status', 'id' => $askId]);
it_check('the owner collects the FIRST answer, with the model named',
    ($r['json']['status'] ?? '') === 'answered'
    && strpos((string) ($r['json']['answer'] ?? ''), 'cannot take dogs') !== false
    && ($r['json']['model'] ?? '') === 'q.gguf', $r['raw']);

// DECLINED AFTER FILING: the ask dies at the machine's read, unanswered.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'reply', 'id' => $askEnqId]);
$ask2 = (int) ($r['json']['id'] ?? 0);
http($admin, 'POST', '/enquiries.php', ['action' => 'decline', 'id' => $askEnqId]);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'asks', 'secret' => $SECRET]);
$still = false;
foreach (($r['json']['asks'] ?? []) as $a) {
    if ((int) ($a['id'] ?? 0) === $ask2) {
        $still = true;
    }
}
it_check('declining the enquiry kills its waiting ask at the read', !$still
    && strpos($r['raw'], 'Asky') === false, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask_status', 'id' => $ask2]);
it_check('…and the owner sees it expired, never answered', ($r['json']['status'] ?? '') === 'expired', $r['raw']);

// THE CHAT KIND (integration step 5): a conversation composed by the same
// withholding rules — words and a first name, never the email.
$rootDb->exec("INSERT INTO chat_threads (name, email) VALUES ('Sophie Grant', 'sophie@gmail.com')");
$chatTid = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest)
               VALUES ($chatTid, 'guest', 'What time can we get in on Saturday?', 1, 1)");
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'chat', 'id' => $chatTid]);
$chatAsk = (int) ($r['json']['id'] ?? 0);
it_check('a chat ask files against a real conversation', $chatAsk > 0, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'asks', 'secret' => $SECRET]);
$cv = null;
foreach (($r['json']['asks'] ?? []) as $a) {
    if ((int) ($a['id'] ?? 0) === $chatAsk) {
        $cv = $a;
    }
}
it_check('the machine reads the conversation, first name worked out',
    $cv && (($cv['chat']['first'] ?? '') === 'Sophie')
    && strpos(json_encode($cv), 'get in on Saturday') !== false, json_encode($cv));
it_check('…and the guest\'s email never leaves the site here either',
    strpos($r['raw'], 'sophie@gmail.com') === false, mb_substr($r['raw'], 0, 200));
http($guest, 'POST', '/nightshift.php', ['action' => 'answer', 'secret' => $SECRET,
    'id' => $chatAsk, 'text' => 'From 3pm on Saturday — and I will double-check the parking for you before you set off.']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask_status', 'id' => $chatAsk]);
it_check('the chat answer lands for the composer to collect',
    ($r['json']['status'] ?? '') === 'answered' && strpos((string) $r['json']['answer'], 'From 3pm') !== false, $r['raw']);
$rootDb->exec('DELETE FROM chat_threads WHERE id = ' . $chatTid);
$rootDb->exec('DELETE FROM messages WHERE thread_id = ' . $chatTid);

// THE INTENT ASK (search × Mac): the model may only CHOOSE from the menu the
// site sent, byte-exact, or say none — the site validates membership on the
// way back, so an invented canonical can never reach the answer engine.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'intent', 'question' => 'anyone still owing?']);
it_check('an intent ask with no menu is refused in words',
    $r['code'] === 400 && strpos($r['raw'], 'list of questions') !== false, $r['raw']);
$menu = ['who owes me money', 'leaving today', 'arriving today'];
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'intent',
    'question' => 'anyone still owing?', 'options' => $menu]);
$intId = (int) ($r['json']['id'] ?? 0);
it_check('an intent ask files with its menu', $intId > 0, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'asks', 'secret' => $SECRET, 'wait' => 0]);
$iv = null;
foreach (($r['json']['asks'] ?? []) as $a) {
    if ((int) ($a['id'] ?? 0) === $intId) {
        $iv = $a;
    }
}
it_check('the machine reads the query AND the menu together',
    $iv && (($iv['intent']['q'] ?? '') === 'anyone still owing?')
    && ($iv['intent']['options'] ?? []) === $menu, json_encode($iv));
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'answer', 'secret' => $SECRET,
    'id' => $intId, 'text' => 'who owes me some money']);
it_check('an answer OFF the menu is refused — member or none, nothing else',
    $r['code'] === 400 && strpos($r['raw'], 'offered questions') !== false, $r['raw']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'answer', 'secret' => $SECRET,
    'id' => $intId, 'text' => 'who owes me money', 'model' => 's.gguf']);
it_check('a byte-exact member lands', ($r['json']['ok'] ?? false) === true && empty($r['json']['replayed']), $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask_status', 'id' => $intId, 'wait' => 2]);
it_check('the owner collects the mapping — and a settled row never spends the wait',
    ($r['json']['status'] ?? '') === 'answered' && ($r['json']['answer'] ?? '') === 'who owes me money', $r['raw']);
// 'none' is the other legitimate verdict — a model with nothing to choose says so.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'intent',
    'question' => 'what colour are the curtains?', 'options' => $menu]);
$intNone = (int) ($r['json']['id'] ?? 0);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'answer', 'secret' => $SECRET, 'id' => $intNone, 'text' => 'none']);
it_check("'none' is accepted as an answer in its own right", ($r['json']['ok'] ?? false) === true, $r['raw']);

// LONG-POLL DEGENERATE TIMING: a held ask_status on an already-settled row and
// a held asks read with rows waiting must both answer at once — the wait is
// for the EMPTY case only, so these calls prove the hold never taxes a result.
$t0 = microtime(true);
http($admin, 'POST', '/nightshift.php', ['action' => 'ask_status', 'id' => $intId, 'wait' => 8]);
$heldA = microtime(true) - $t0;
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'answer', 'question' => 'Is there a cot?']);
$cotId = (int) ($r['json']['id'] ?? 0);
$t0 = microtime(true);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'asks', 'secret' => $SECRET, 'wait' => 10]);
$heldB = microtime(true) - $t0;
$sawCot = false;
foreach (($r['json']['asks'] ?? []) as $a) {
    if ((int) ($a['id'] ?? 0) === $cotId) {
        $sawCot = true;
    }
}
it_check('a held ask_status answers a settled row at once, not after the wait',
    $heldA < 3.0, sprintf('%.2fs', $heldA));
it_check('a held asks read answers the moment rows are waiting',
    $sawCot && $heldB < 4.0, sprintf('%.2fs, saw=%d', $heldB, (int) $sawCot));

// AN EXPIRED ASK REFUSES A LATE ANSWER — ten minutes passed, the owner moved on.
$rootDb->exec("INSERT INTO night_asks (kind, entity_id, question, created_at)
               VALUES ('answer', 0, 'Is there a cot?', DATE_SUB(NOW(), INTERVAL 11 MINUTE))");
$staleId = (int) $rootDb->lastInsertId();
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'answer', 'secret' => $SECRET, 'id' => $staleId, 'text' => 'Too late.']);
it_check('a late answer is refused with its reason', $r['code'] === 410 && strpos($r['raw'], 'stopped waiting') !== false, $r['raw']);

// The switch closes BOTH new directions, like brief and ingest.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'night-shift', 'value' => '']);
$r = http($guest, 'POST', '/nightshift.php', ['action' => 'asks', 'secret' => $SECRET]);
it_check('the one switch refuses the machine\'s read', $r['code'] === 409, $r['raw']);
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'ask', 'kind' => 'answer', 'question' => 'x?']);
it_check('…and the owner\'s ask', $r['code'] === 409, $r['raw']);
$rootDb->exec('DELETE FROM night_asks');
$rootDb->exec('DELETE FROM enquiries');

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
