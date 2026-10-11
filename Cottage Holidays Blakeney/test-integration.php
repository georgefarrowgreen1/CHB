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
//      CHB_IT_DB_NAME  default chb_it_test. A second name runs a second copy against
//                      the same server, for break-testing one section; the lock checks
//                      (§32: GET_LOCK names are server-wide) and the statement budget
//                      (a global counter) then fail from the cross-talk, not the code.
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
// §54's fake Monzo API listens here (the app copy's config points MONZO_API_BASE at it).
$sock = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
$MONZO_PORT = (int) explode(':', stream_socket_get_name($sock, false))[1];
fclose($sock);
// §77's fake POP3 mailbox listens here (MAIL_POP_HOST / MAIL_POP_PORT in the app copy's config).
$sock = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
$POP_PORT = (int) explode(':', stream_socket_get_name($sock, false))[1];
fclose($sock);
$DB_NAME = preg_match('/^[a-z0-9_]{1,40}$/', (string) getenv('CHB_IT_DB_NAME')) ? (string) getenv('CHB_IT_DB_NAME') : 'chb_it_test';
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
$cfg .= "\ndefine('MONZO_API_BASE', 'http://127.0.0.1:$MONZO_PORT');\ndefine('MONZO_AUTH_BASE', 'http://127.0.0.1:$MONZO_PORT/auth/');\n";
// §17(k) holds an op's lock to prove a repeat is refused; a short wait keeps it quick.
$cfg .= "\ndefine('CHB_OP_LOCK_WAIT', 2);\n";
// …and the Monzo link's: §54 holds the sync's lock to show a disconnect waits for it.
$cfg .= "\ndefine('CHB_MONZO_LOCK_WAIT', 2);\n";
$cfg .= "\ndefine('MAIL_POP_HOST', '127.0.0.1');\ndefine('MAIL_POP_PORT', $POP_PORT);\n";
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
// A COTTAGE'S COLOUR IS ONLY EVER #RRGGBB. It is painted into style attributes on
// every staff member's Today and into the stylesheet every visitor loads, so a
// quote or a brace in it breaks out of both — and `save` took any string, from
// anyone with the prices permission (prop_accent_ok).
$accentOf = function () use ($guest, $propKey) {
    $rows = http($guest, 'GET', '/rates.php')['json']['properties'] ?? [];
    foreach ($rows as $p) {
        if (is_array($p) && ($p['prop_key'] ?? '') === $propKey) {
            return (string) ($p['accent'] ?? '');
        }
    }
    return null;
};
$before = $accentOf();
$r = http($admin, 'POST', '/rates.php', ['action' => 'save', 'prop_key' => $propKey, 'accent' => '#8fb3c7" data-act="x']);
it_check('§4 a colour that is not #RRGGBB is refused', $r['code'] === 400, $r['raw']);
it_check('§4 …and the stored colour is unchanged', $accentOf() === $before, (string) $accentOf());
$r = http($admin, 'POST', '/rates.php', ['action' => 'save', 'prop_key' => $propKey, 'accent' => '#12ab34']);
it_check('§4 a real colour saves (normalised to upper case)', $r['code'] === 200 && $accentOf() === '#12AB34', (string) $accentOf());
// 16 characters: the column is VARCHAR(16), which still fits a break-out.
$rootDb->exec("UPDATE properties SET accent = 'red;}*{color:red' WHERE prop_key = " . $rootDb->quote($propKey));
it_check('§4 a bad colour already stored is never served', $accentOf() === '', (string) $accentOf());
$rootDb->exec("UPDATE properties SET accent = '#12AB34' WHERE prop_key = " . $rootDb->quote($propKey));

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
// The verdict is jobs-lib.php's cron_result_ok (test-jobs drives it in full); here
// the REAL function is asked, and cron.php is held to taking its answer.
require_once __DIR__ . '/jobs-lib.php';
$mv10d = cron_result_ok(200, ['migrations' => [['file' => 'a.sql', 'status' => 'OK'], ['file' => 'b.sql', 'status' => 'ERROR']]]);
it_check('a per-file ERROR is read out of the 200 response', $mv10d['ok'] === false && strpos($mv10d['note'], 'b.sql') !== false, json_encode($mv10d));
it_check('...while a clean run of migrations is a success', cron_result_ok(200, ['migrations' => [['file' => 'a.sql', 'status' => 'OK']]])['ok'] === true);
it_check('...and cron.php takes that verdict as the job\'s, which is what logs a warning',
    strpos($cronSrc, '$verdict = cron_result_ok($status, $body);') !== false && preg_match('/\$ok = \$verdict\[\'ok\'\];\s*\n\s*\$note = \$verdict\[\'note\'\];/', $cronSrc) === 1);
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
// Hoisted: fixtures ABOVE the old definition site now use it too. A fixture
// date must move with the clock — a fixed one is eventually swept by a
// relative one and the collision fails a check for a few days, then heals.
$dd = fn($n) => date('Y-m-d', strtotime("+$n days"));
$dLedgerIn = $dd(840);
$dLedgerOut = $dd(843);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Ledger Ahead','la@x.co','$dLedgerIn','$dLedgerOut',2,0,'deposit',100,400,400,0,3)");
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
$dOverIn = $dd(850);
$dOverOut = $dd(853);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Over Refund','or@x.co','$dOverIn','$dOverOut',2,0,'deposit',100,400,400,0,3)");
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

// (h) CHARGE-UPFRONT partial-return-then-keep. keep_deposit writes a 'kept-…'
// damages row that is ALREADY net of the return (£75 collected, £25 returned →
// a £50 kept- row), so accounts.php must NOT subtract the £25 return a second
// time. The legacy cases above use a gross 'damages' row where the netting IS
// correct — this case is the one the double-netting under-reported (£50 → £25).
$rootDb->exec("DELETE FROM payments");
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES (9008,'damages_return',25.00,'COMPLETED','sq_h_ret','2026-06-05 10:00:00')");
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES (9008,'damages',50.00,'COMPLETED','kept-abc123def456','2026-06-10 10:00:00')");
$kH = $keptOf(2026);
it_check('a kept- net row is counted at face value, not double-netted (£50, not £25)', abs($kH - 50.0) < 0.005, 'kept=' . $kH);

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

// (h2) A two-way platform sync re-imports our own bookings as ical_blocks, so a
// booking has a MIRROR of itself at its own dates. Editing that booking must not
// false-clash against its own mirror — a phone-number fix (no date change) must
// not even run the clash check, and re-saving the same dates must ignore the
// mirror. Left unfixed this trained reflexive override, which skips every check.
$rootDb->exec("INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES ('$propKey','airbnb','mirror-base','" . $dd(300) . "','" . $dd(305) . "')");
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $baseId, 'prop_key' => $propKey, 'name' => 'Base Stay', 'email' => '', 'phone' => '07700900999', 'check_in' => $dd(300), 'check_out' => $dd(305), 'adults' => 2, 'children' => 0]);
it_check('a no-date-change edit of a mirrored booking does not false-clash', $r['code'] === 200 && empty($r['json']['clash']), $r['raw']);
$r = $upd($baseId, $dd(300), $dd(305));
it_check('re-saving a mirrored booking\'s own dates ignores its mirror block', $r['code'] === 200 && empty($r['json']['clash']), $r['raw']);
$rootDb->exec("DELETE FROM ical_blocks WHERE uid = 'mirror-base'");

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
// CLEAN UP the Due Date Guest, whose dates are RELATIVE (+260 days). This
// delete was the NARROW fix for one instance of a general defect: a fixed
// fixture date is eventually swept by a relative one, and whichever of the two
// goes through a clash-checked endpoint then fails for a few days and heals
// itself — green one day, red the next, for reasons nothing to do with the
// code under test. The general fix is above: every fixture a booking endpoint
// touches is relative now, so the two can never converge. The delete stays as
// tidiness, not as the guard.
if ($dueBookingId > 0) { $rootDb->exec('DELETE FROM bookings WHERE id = ' . $dueBookingId); }

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
// (e) The email also states when they leave and the times: a new leaving date or a
// new check-in time makes it untrue as surely as a move.
$restamp();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $arrId, 'check_out' => date('Y-m-d', strtotime('+34 days')), 'override_clash' => true, 'override_occupancy' => true]);
it_check('a new leaving date clears the stamp', ($r['json']['ok'] ?? false) && $stamp() === null, $r['raw']);
$restamp();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $arrId, 'check_in_time' => '16:00']);
it_check('a new check-in time clears it too', ($r['json']['ok'] ?? false) && $stamp() === null, $r['raw']);
$restamp();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $arrId, 'check_in_time' => '16:00', 'notes' => 'gate: same time again']);
it_check('…while the same time sent again changes nothing', ($r['json']['ok'] ?? false) && $stamp() !== null, $r['raw']);
// An older row can hold a blank time, which every reader takes as the default:
// it is not a change, so a notes edit must not re-send the email over it.
$rootDb->exec("UPDATE bookings SET check_out_time = '' WHERE id = $arrId");
$restamp();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $arrId, 'notes' => 'gate: a blank stored time']);
it_check('…and a blank stored time read as the default is not a change', ($r['json']['ok'] ?? false) && $stamp() !== null, $r['raw']);

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

$dOpLedIn = $dd(860);
$dOpLedOut = $dd(863);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Op Ledger','op@gmail.com','$dOpLedIn','$dOpLedOut',2,0,'unpaid',0,300,300,0,3)");
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
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Op Phone Enquiry', 'phone' => '07700 900233', 'check_in' => $dd(880), 'check_out' => $dd(883), 'adults' => 2, 'children' => 0, 'message' => 'Taken by phone', 'op_id' => $op3]);
it_check('a phone enquiry saves with NO address (admin-exempt)', ($r['json']['ok'] ?? false) && $enqCount() === 1, $r['raw']);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Op Phone Enquiry', 'phone' => '07700 900233', 'check_in' => $dd(880), 'check_out' => $dd(883), 'adults' => 2, 'children' => 0, 'message' => 'Taken by phone', 'op_id' => $op3]);
it_check('…and its replay lands ONE enquiry, not two', $enqCount() === 1 && ($r['json']['replayed'] ?? false) === true, 'rows=' . $enqCount());

// (e) ERRORS ARE NEVER STORED: a clash-refused enquiry re-refuses on replay
// (a stored refusal would freeze a fixable one forever) — and the refusal
// still refuses after the ledger has seen the id once.
$clashIn = $dd(890);
$clashOut = $dd(893);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Clash Holder','ch@gmail.com','$clashIn','$clashOut',2,0,'unpaid',0,300,300,0,3)");
$op4 = 'op-int-' . bin2hex(random_bytes(6));
$mk = fn() => http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Op Clash Enquiry', 'phone' => '07700 900234', 'check_in' => $dd(891), 'check_out' => $dd(892), 'adults' => 2, 'children' => 0, 'message' => 'x', 'op_id' => $op4]);
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
$mkAdd = fn() => http($admin, 'POST', '/bookings.php', ['action' => 'add', 'prop_key' => $propKey, 'name' => 'Op Direct Add', 'check_in' => $dd(900), 'check_out' => $dd(903), 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'op_id' => $op5]);
$r = $mkAdd();
it_check('a booking add with an op_id applies once', ($r['json']['ok'] ?? false) && $addCount() === 1, $r['raw']);
$newBid = (int) ($r['json']['id'] ?? 0);
$r = $mkAdd();
it_check('…and a hand retry lands ONE booking, not two', $addCount() === 1 && ($r['json']['replayed'] ?? false) === true && (int) ($r['json']['id'] ?? 0) === $newBid, 'rows=' . $addCount() . ' ' . $r['raw']);

// (h) 'update' replays with its verdict intact (`material` rides the stored
// response), and the row is not re-walked through the warn ladder.
$op6 = 'op-int-' . bin2hex(random_bytes(6));
$mkUpd = fn() => http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $newBid, 'prop_key' => $propKey, 'name' => 'Op Direct Add', 'check_in' => $dd(901), 'check_out' => $dd(904), 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'op_id' => $op6]);
$r = $mkUpd();
it_check('an update with an op_id applies (dates moved = material)', ($r['json']['ok'] ?? false) && ($r['json']['material'] ?? false) === true, $r['raw']);
$r = $mkUpd();
it_check('…and its replay is answered from the ledger, material intact', ($r['json']['replayed'] ?? false) === true && ($r['json']['material'] ?? false) === true, $r['raw']);
$ci2 = (string) $rootDb->query("SELECT check_in FROM bookings WHERE id = $newBid")->fetchColumn();
it_check('…with the row exactly as the first write left it', $ci2 === $dd(901), 'check_in=' . $ci2);

// (i) THE CLASH LADDER UNDER ONE ID: the refusal exit stores NOTHING (a
// refusal must re-run), the override write stores, and the retried ladder is
// then answered at its first post — no duplicate even though the retry never
// re-sent override_clash.
$op7 = 'op-int-' . bin2hex(random_bytes(6));
$ladCount = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM bookings WHERE name = 'Op Ladder Add'")->fetchColumn();
$ladder = fn(array $extra = []) => http($admin, 'POST', '/bookings.php', array_merge(['action' => 'add', 'prop_key' => $propKey, 'name' => 'Op Ladder Add', 'check_in' => $dd(901), 'check_out' => $dd(902), 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'op_id' => $op7], $extra));
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

// (k) A REPEAT THAT ARRIVES WHILE THE FIRST IS STILL RUNNING IS REFUSED, NOT RUN.
// The first may be stuck in a slow email after the money has moved; running the
// repeat would move it again (a refund's Square key changes once money has gone
// back). The op's lock is held here on another connection, as a still-running
// first request would hold it.
$opK = 'op-int-' . bin2hex(random_bytes(6));
$opKAdmin = (int) $rootDb->query("SELECT MIN(id) FROM admins")->fetchColumn();
$opKLock = 'chb_op_k' . substr(hash('sha256', 'a:' . $opKAdmin . '|bookings.php|' . $opK), 0, 46);
$hold = $rootDb->prepare('SELECT GET_LOCK(?, 0)');
$hold->execute([$opKLock]);
it_check('(fixture) the first request\'s lock is held', (int) $hold->fetchColumn() === 1);
$before = $dep();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $opBid, 'payment' => 'deposit', 'deposit' => 250, 'payment_method' => 'Cash', 'payment_date' => '2026-08-03', 'op_id' => $opK]);
it_check('a repeat while the first still runs is refused as in flight', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'in_flight', $r['raw']);
it_check('…and it changed nothing', abs($dep() - $before) < 0.001, 'deposit now ' . $dep());
$rootDb->prepare('SELECT RELEASE_LOCK(?)')->execute([$opKLock]);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $opBid, 'payment' => 'deposit', 'deposit' => 250, 'payment_method' => 'Cash', 'payment_date' => '2026-08-03', 'op_id' => $opK]);
it_check('…and once the first has finished, the same op applies normally', ($r['json']['ok'] ?? false) && abs($dep() - 250.0) < 0.001, $r['raw']);

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
// ── REGISTERING IS NOT OWNING, EVEN FOR A BRAND-NEW ADDRESS (migration-127) ──
// The account signs in but is UNPROVEN: a booking made against that address
// later must not land in a squatter's My Stays.
$squatEmail = 'squat-' . bin2hex(random_bytes(3)) . '@gmail.com';
$sqA = []; // the squatter's browser
$r = http($sqA, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Squat Ter', 'email' => $squatEmail,
    'password' => 'squatpass1', 'address' => '3 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
it_check('§19b a fresh registration signs in', !empty($r['json']['guest']), $r['raw']);
it_check('…but is NOT stamped proven', $rootDb->query("SELECT email_verified_at FROM guests WHERE email = " . $rootDb->quote($squatEmail))->fetchColumn() === null, '');
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, notes) VALUES ('$propKey','Real Owner'," . $rootDb->quote($squatEmail) . ",'2031-03-02','2031-03-05',2,0,'paid',300,300,300,0,3,'OWNER-PRIVATE-NOTE')");
$sqBid = (int) $rootDb->lastInsertId();
$r = http($sqA, 'GET', '/my-bookings.php');
it_check('…and a booking made later against that address is NOT shown to it', $r['code'] === 200 && ($r['json']['unproven'] ?? false) === true
    && empty($r['json']['bookings']) && strpos($r['raw'], 'Real Owner') === false, $r['raw']);
$r = http($sqA, 'POST', '/welcome.php', ['action' => 'get', 'prop' => $propKey]);
it_check('…nor any stay-scoped endpoint (welcome book refuses it in words)', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'email_unproven', $r['raw']);
// A chat someone started on the website under that address, before any account.
$rootDb->prepare("INSERT INTO chat_threads (guest_id, token, name, email) VALUES (NULL, ?, 'Real Owner', ?)")->execute(['sq19-' . bin2hex(random_bytes(6)), $squatEmail]);
$sqTid = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO messages (guest_id, thread_id, sender_role, body) VALUES (NULL, ?, 'guest', 'SQUAT-ANON-CHAT')")->execute([$sqTid]);
$r = http($sqA, 'POST', '/auth.php', ['action' => 'guest_export_data']);
it_check('…and its data export carries no bookings', ($r['json']['ok'] ?? false) === true && empty($r['json']['data']['bookings']), $r['raw']);
it_check('…nor a chat filed under the address it has not proven', strpos($r['raw'], 'SQUAT-ANON-CHAT') === false, '');
// The rightful owner proves the address from THEIR browser: the squatter's password
// is cleared, its session revoked, and the stay is theirs alone.
$sqGid = (int) $rootDb->query("SELECT id FROM guests WHERE email = " . $rootDb->quote($squatEmail))->fetchColumn();
$sqEpoch0 = (int) $rootDb->query("SELECT auth_epoch FROM guests WHERE id = $sqGid")->fetchColumn();
$sqB = []; // the owner's browser
$sts = time();
$stok = substr(hash_hmac('sha256', 'login:' . $sqGid . ':' . $sts, $SECRET), 0, 32);
$r = http($sqB, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $sqGid, 'ts' => $sts, 'token' => $stok]);
it_check('§19b confirming from another browser signs in and says the password was reset', ($r['json']['ok'] ?? false) === true && ($r['json']['reset'] ?? false) === true, $r['raw']);
it_check('…clears the unproven password and bumps the epoch', (string) $rootDb->query("SELECT password_hash FROM guests WHERE id = $sqGid")->fetchColumn() === ''
    && (int) $rootDb->query("SELECT auth_epoch FROM guests WHERE id = $sqGid")->fetchColumn() === $sqEpoch0 + 1, '');
$r = http($sqA, 'GET', '/my-bookings.php');
it_check('…the squatter\'s live session is signed out', $r['code'] === 401, $r['raw']);
$r = http($sqA, 'POST', '/auth.php', ['action' => 'guest_login', 'email' => $squatEmail, 'password' => 'squatpass1']);
it_check('…and the password it chose no longer works', $r['code'] === 401, $r['raw']);
$r = http($sqB, 'GET', '/my-bookings.php');
it_check('…while the owner now sees their stay', $r['code'] === 200 && empty($r['json']['unproven']) && strpos($r['raw'], 'Real Owner') !== false, $r['raw']);
$r = http($sqB, 'POST', '/auth.php', ['action' => 'guest_export_data']);
it_check('§19b the export carries the stay but never the owner\'s private note', ($r['json']['ok'] ?? false) === true
    && count($r['json']['data']['bookings'] ?? []) >= 1 && strpos($r['raw'], 'OWNER-PRIVATE-NOTE') === false, '');
it_check('§19b …and the chat filed under the address it has now proven', strpos($r['raw'], 'SQUAT-ANON-CHAT') !== false, '');
$rootDb->exec("DELETE FROM messages WHERE thread_id = $sqTid");
$rootDb->exec("DELETE FROM chat_threads WHERE id = $sqTid");
$r = http($sqB, 'POST', '/auth.php', ['action' => 'guest_change_password', 'current' => '', 'next' => 'ownerpass2']);
it_check('§19b with no password left, a new one is set without a current one', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($sqB, 'POST', '/auth.php', ['action' => 'guest_change_password', 'current' => 'wrongpass', 'next' => 'ownerpass3']);
it_check('…but once set, the current one is required again', $r['code'] === 403, $r['raw']);
$rootDb->exec("DELETE FROM bookings WHERE id = $sqBid");
// The SAME browser that registered keeps its password on confirming (the ordinary
// guest who reads their email on the device they signed up with).
$keepEmail = 'keep-' . bin2hex(random_bytes(3)) . '@gmail.com';
$kp = [];
http($kp, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Keep Me', 'email' => $keepEmail,
    'password' => 'keeppass12', 'address' => '4 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$kpGid = (int) $rootDb->query("SELECT id FROM guests WHERE email = " . $rootDb->quote($keepEmail))->fetchColumn();
$kts = time();
$r = http($kp, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $kpGid, 'ts' => $kts, 'token' => substr(hash_hmac('sha256', 'login:' . $kpGid . ':' . $kts, $SECRET), 0, 32)]);
it_check('§19b confirming in the browser that registered keeps the password', ($r['json']['reset'] ?? true) === false
    && (string) $rootDb->query("SELECT password_hash FROM guests WHERE id = $kpGid")->fetchColumn() !== '', $r['raw']);
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

// AND THE PREVIEW IS THE EMAIL THAT SENDS. Reported from a phone: the review
// screen promised "this is exactly what your guest will receive" and rendered
// the ENQUIRY-REPLY shell — "About your booking", plus its own "Hello <name>,"
// above a prefilled message that already greets, so the guest's name appeared
// twice. The send had always routed to the arrival template; only the preview
// had not. This is the WIRING check: test-emails-render drives the builder and
// passes with this route deleted, which is exactly the helper-tested-alone trap.
$prevMsg = (string) ($r['json']['message'] ?? '');
$r = http($admin, 'POST', '/bookings.php', ['action' => 'email_preview', 'id' => $arBid2, 'arrival' => true, 'subject' => 'You arrive', 'message' => $prevMsg]);
$prevHtml = (string) ($r['json']['html'] ?? '');
it_check('the arrival preview renders the ARRIVAL template',
    strpos($prevHtml, 'See you') !== false && strpos($prevHtml, 'About your booking') === false, substr($prevHtml, 0, 300));
// The name appears (it is in the message) — what must not happen is a GREETING
// of it twice. Counted the way the render gate counts, on the tags-to-spaces text.
$prevPlain = preg_replace('/\s+/', ' ', html_entity_decode(preg_replace('/<[^>]*>/', ' ', $prevHtml), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
$prevGreets = preg_match_all('/\b(?:Hello|Hi|Dear)\s+Waits\b/i', $prevPlain);
it_check('…and greets the guest exactly once (' . $prevGreets . ')', $prevGreets === 1, substr($prevPlain, 0, 240));
// Without the flag the SAME request is still the reply composer — so the flag
// is what routes it, and the two templates really are different.
$r = http($admin, 'POST', '/bookings.php', ['action' => 'email_preview', 'id' => $arBid2, 'subject' => 'You arrive', 'message' => $prevMsg]);
$ordHtml = (string) ($r['json']['html'] ?? '');
it_check('…while the ordinary preview is still the reply email (the flag is the switch)',
    strpos($ordHtml, 'See you') === false && strpos($ordHtml, 'comes straight to') !== false, substr($ordHtml, 0, 300));
// THE ROUTE FILLS THE BUILDER (the email-guest sheet's two switches and the booking's
// payment facts): test-emails drives the builder with them already on its payload, so
// only a real request through the endpoint shows that anything puts them there.
it_check('the reply states where the booking\'s money stands (the route fills the pay facts)',
    preg_match('/Paid in full|Still to pay/', $ordHtml) === 1 && strpos($ordHtml, 'Arrive') !== false, substr(strip_tags($ordHtml), 0, 400));
$r = http($admin, 'POST', '/bookings.php', ['action' => 'email_preview', 'id' => $arBid2, 'subject' => 'S', 'message' => $prevMsg, 'include_stay' => 0, 'include_money' => 0]);
$offHtml = (string) ($r['json']['html'] ?? '');
it_check('…and switching both off leaves just the message',
    $offHtml !== '' && preg_match('/Paid in full|Still to pay|Paid so far/', $offHtml) === 0 && strpos($offHtml, 'Arrive') === false, substr(strip_tags($offHtml), 0, 400));

// THE HOUSE RULES RIDE THE ARRIVAL EMAIL — the WIRING half. test-emails-render
// drives the composer with rules ON its payload and passes whether or not
// anything ever reads the content key; this saves real rules through the real
// endpoint and reads them back out of the real rendered email.
$r = http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'houserules-' . $propKey,
    'value' => ['No smoking indoors', 'Quiet after 10pm']]);
it_check('(fixture) house rules saved for the cottage', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'arrival_preview', 'id' => $arBid2]);
it_check('the review screen NAMES the rules among the facts it adds',
    ($r['json']['facts']['rules'] ?? []) === ['No smoking indoors', 'Quiet after 10pm'], $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'email_preview', 'id' => $arBid2, 'arrival' => true, 'message' => $prevMsg]);
$hrHtml = (string) ($r['json']['html'] ?? '');
it_check('…and the email itself carries them',
    strpos($hrHtml, 'A few house rules') !== false && strpos($hrHtml, 'No smoking indoors') !== false
    && strpos($hrHtml, 'Quiet after 10pm') !== false, substr($hrHtml, -600));
// With none saved the block is absent — not an empty heading.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'houserules-' . $propKey, 'value' => []]);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'email_preview', 'id' => $arBid2, 'arrival' => true, 'message' => $prevMsg]);
it_check('…and with none saved there is no block at all',
    stripos((string) ($r['json']['html'] ?? ''), 'house rules') === false, substr((string) ($r['json']['html'] ?? ''), -400));

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

// THE SIGN-IN ITSELF IS GATED TOO. Changing the sign-in email, turning two-step
// off or adding a passkey would turn a few minutes on a borrowed session into
// the account for good, so each asks for the same fresh proof.
$rs = [];
http($rs, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-123']);
$r = http($rs, 'POST', '/auth.php', ['action' => 'admin_email_begin', 'email' => 'taken-over@gmail.com']);
it_check('§24 a fresh session cannot change the sign-in email', $r['code'] === 401 && ($r['json']['code'] ?? '') === 'reauth_required', $r['raw']);
$r = http($rs, 'POST', '/auth.php', ['action' => 'admin_twofa_set', 'on' => false]);
it_check('§24 …nor turn two-step off', $r['code'] === 401 && ($r['json']['code'] ?? '') === 'reauth_required', $r['raw']);
// The WebAuthn library may be absent here (then passkeys.php refuses everything),
// so assert what holds either way: no registration options for a fresh session.
$r = http($rs, 'POST', '/passkeys.php', ['action' => 'admin_register_begin']);
it_check('§24 …nor start adding a passkey', $r['code'] !== 200 && empty($r['json']['options']), $r['raw']);
$r = http($rs, 'POST', '/auth.php', ['action' => 'admin_twofa_set', 'on' => true]);
it_check('§24 turning two-step ON asks for nothing extra (it only adds protection)', ($r['json']['ok'] ?? false) === true, $r['raw']);
it_reauth($rs);
$r = http($rs, 'POST', '/auth.php', ['action' => 'admin_twofa_set', 'on' => false]);
it_check('§24 …and once confirmed, two-step can be turned off again', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($rs, 'POST', '/auth.php', ['action' => 'admin_email_begin', 'email' => 'owner-new-it@gmail.com']);
it_check('§24 …and the email change goes ahead to its code', $r['code'] !== 401, $r['raw']);
// The password change guesses on the same counter as sign-in, and says so.
$r = http($rs, 'POST', '/auth.php', ['action' => 'admin_change_password', 'current' => 'wrong-wrong-wrong', 'next' => 'a-long-new-password-1']);
$pcSev = $rootDb->query("SELECT severity FROM activity_log WHERE action = 'admin.password_change_fail' ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('§24 a wrong current password is refused and logged as a warning', $r['code'] === 403 && $pcSev === 'warn', $r['raw'] . ' severity=' . var_export($pcSev, true));
$rfSev = $rootDb->query("SELECT severity FROM activity_log WHERE action = 'admin.reauth_fail' ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('§24 a failed confirmation is recorded as a warning (it was an info row)', $rfSev === 'warn', var_export($rfSev, true));
$rootDb->exec("DELETE FROM login_attempts WHERE identifier = 'admin:owner'");

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
$gateCookie = hash_hmac('sha256', 'staging-gate|it-gate|' . hash('sha256', 'it-gate-pass'), $SECRET); // staging-gate.php's own recipe (user + the password's hash)

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
// THE 304 FIRES BEHIND APACHE'S DEFLATE. htaccess compresses application/json,
// and Apache then sends the tag as "<md5>-gzip" and gets it back that way, so the
// byte-exact comparison bootstrap.php used never matched in production: every
// 30-second poll downloaded the whole payload. php -S compresses nothing, so the
// forms a browser really sends back are sent here by hand.
$bootGet = function (array $extra = []) {
    global $BASE;
    $http_response_header = [];
    $raw = @file_get_contents($BASE . '/bootstrap.php', false, stream_context_create(['http' => ['method' => 'GET', 'header' => implode("\r\n", array_merge(['Accept: application/json'], $extra)), 'timeout' => 30, 'ignore_errors' => true]]));
    $code = 0;
    $hdr = [];
    foreach ($http_response_header as $h) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
            $code = (int) $m[1];
        } elseif (strpos($h, ':') !== false) {
            [$k, $v] = explode(':', $h, 2);
            $hdr[strtolower(trim($k))] = trim($v);
        }
    }
    return ['code' => $code, 'raw' => (string) $raw, 'h' => $hdr];
};
$bt = $bootGet();
$btTag = (string) ($bt['h']['etag'] ?? '');
$btMd5 = trim($btTag, '"');
it_check('the public payload carries a strong ETag and varies by encoding',
    preg_match('/^"[0-9a-f]{32}"$/', $btTag) === 1 && stripos((string) ($bt['h']['vary'] ?? ''), 'accept-encoding') !== false, json_encode($bt['h']));
foreach ([
    'the tag as sent' => $btTag,
    'Apache\'s deflated form ("…-gzip")' => '"' . $btMd5 . '-gzip"',
    'a weak validator (W/"…")' => 'W/"' . $btMd5 . '"',
    'a list that holds it' => '"' . str_repeat('0', 32) . '", "' . $btMd5 . '-gzip"',
] as $what => $inm) {
    $r = $bootGet(['If-None-Match: ' . $inm]);
    it_check("…answers 304 to $what", $r['code'] === 304 && $r['raw'] === '', $r['code'] . ' / ' . strlen($r['raw']) . ' bytes');
}
$r = $bootGet(['If-None-Match: "' . str_repeat('0', 32) . '-gzip"']);
it_check('…and a stale tag still gets the payload', $r['code'] === 200 && strlen($r['raw']) > 200, (string) $r['code']);
// An owner's copy carries internal settings and is asked for only at boot, so it
// is never stored and never offered a 304.
$r = $bootGet(['Cookie: ' . implode('; ', array_map(fn($k) => "$k={$admin[$k]}", array_keys($admin)))]);
it_check('an owner\'s copy is never stored (no-store, no ETag)',
    $r['code'] === 200 && stripos((string) ($r['h']['cache-control'] ?? ''), 'no-store') !== false && !isset($r['h']['etag']), json_encode($r['h']));

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

// ── §28 The federated search never matches on nothing ────────────────────
// The quick-mode booking-ref probe strips the query to [0-9a-z]; a query of
// pure punctuation stripped to '' and '%%' LIKE-matched EVERY booking's
// synthesized ref — six arbitrary bookings ranked as matches for "££".
echo "\n== §28 search never matches on nothing ==\n";
$dRefIn = $dd(870);
$dRefOut = $dd(873);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, deposit_paid) VALUES ('jollyboat', 'Ref Probe Guest', 'refprobe@x.test', '$dRefIn', '$dRefOut', 2, 0)");
$r = http($admin, 'POST', '/search.php', ['q' => '££']);
$s28 = array_filter(is_array($r['json']['results'] ?? null) ? $r['json']['results'] : [], function ($x) { return ($x['type'] ?? '') === 'booking'; });
it_check('a pure-punctuation query returns NO booking rows', $r['code'] === 200 && count($s28) === 0, $r['raw']);
$r = http($admin, 'POST', '/search.php', ['q' => 'Ref Probe']);
$s28b = array_filter(is_array($r['json']['results'] ?? null) ? $r['json']['results'] : [], function ($x) { return ($x['type'] ?? '') === 'booking'; });
it_check('…while a real name still finds its booking', count($s28b) >= 1, $r['raw']);
$rootDb->exec("DELETE FROM bookings WHERE email = 'refprobe@x.test'");

// ── §30 The check-out tap — the guest's own "we've left", through the real door ──
// guest-checkout.php in every direction: ownership, the last-morning window
// both ways, exactly-once (op-ledger replay AND a fresh second tap), and that
// the owner is told ONCE — the activity row is the observable half of the tell,
// written beside alert_owner in the same try.
echo "\n== \u{00A7}30 the check-out tap ==\n";
// THE SERVER'S TODAY, not the harness's ($ukToday, the rule stated at the top):
// guest-checkout.php judges the last morning on Europe/London, and between
// 23:00 and midnight UTC a bare date() here is a day behind it — measured, the
// window checks read "already ended" for a stay that leaves today.
$coToday = $ukToday;
$coYest = $ukPlus(-1);
$coTom = $ukPlus(1);
$coIn = $ukPlus(-3);
// Three stays on one guest email: leaving TODAY (the live one), leaving
// tomorrow (button locked), left yesterday (moot).
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Tap Guest','tapguest@gmail.com','$coIn','$coToday',2,0,'paid',400,400,400,0,3)");
$coId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Tap Guest','tapguest@gmail.com','$coYest','$coTom',2,0,'paid',400,400,400,0,2)");
$coTomId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Tap Guest','tapguest@gmail.com','2026-01-02','$coYest',2,0,'paid',400,400,400,0,2)");
$coPastId = (int) $rootDb->lastInsertId();
// Sign the guest in the real way (register → unverified → magic link, the §19 recipe).
$coJar = [];
http($coJar, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Tap Guest', 'email' => 'tapguest@gmail.com',
    'password' => 'longenough1', 'address' => '1 Tap Lane', 'postcode' => 'NR25 7AB']);
$coGid = (int) $rootDb->query("SELECT id FROM guests WHERE email = 'tapguest@gmail.com'")->fetchColumn();
$coTs = time();
$coTok = substr(hash_hmac('sha256', 'login:' . $coGid . ':' . $coTs, $SECRET), 0, 32);
http($coJar, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $coGid, 'ts' => $coTs, 'token' => $coTok]);
// No session at all → 401 before anything is looked at.
$anon = [];
$r = http($anon, 'POST', '/guest-checkout.php', ['action' => 'left', 'booking_id' => $coId, 'op_id' => 'gco-anon-000001']);
it_check('§30 no session → 401', $r['code'] === 401, $r['raw']);
// Another guest's session cannot tap someone else's stay. (A CONFIRMED other
// guest — an unconfirmed one is refused one step earlier, at the email proof.)
$rootDb->exec("UPDATE guests SET email_verified_at = NOW() WHERE email = 'fresh-guest@gmail.com'");
$r = http($gj2, 'POST', '/guest-checkout.php', ['action' => 'left', 'booking_id' => $coId, 'op_id' => 'gco-wrong-000001']);
it_check('§30 someone else\'s booking → 404, nothing recorded', $r['code'] === 404
    && $rootDb->query("SELECT guest_checked_out_at FROM bookings WHERE id = $coId")->fetchColumn() === null, $r['raw']);
// The window, both ways — a stale tab cannot check out on the wrong day.
$r = http($coJar, 'POST', '/guest-checkout.php', ['action' => 'left', 'booking_id' => $coTomId, 'op_id' => 'gco-early-000001']);
it_check('§30 before the last morning → 409, the button hasn\'t unlocked',
    $r['code'] === 409 && strpos((string) ($r['json']['error'] ?? ''), 'last morning') !== false, $r['raw']);
$r = http($coJar, 'POST', '/guest-checkout.php', ['action' => 'left', 'booking_id' => $coPastId, 'op_id' => 'gco-late-0000001']);
it_check('§30 after the stay → 409, already ended', $r['code'] === 409
    && strpos((string) ($r['json']['error'] ?? ''), 'already ended') !== false, $r['raw']);
// THE LEDGER IS NOT A POISON PILL: the tap's op id is guessable by design
// (gco-<booking>-<date>), so a stranger pre-stores a SUCCESS under it on another
// endpoint. Scoped to caller + endpoint, the guest's real tap must still record.
$poison = [];
$rootDb->exec('DELETE FROM login_attempts');
$r = http($poison, 'POST', '/messages.php', ['action' => 'send', 'token' => bin2hex(random_bytes(16)), 'body' => 'hello',
    'name' => 'Pois Oner', 'email' => 'poison@example.com', 'op_id' => 'gco-' . $coId . '-' . $coToday]);
it_check('§30 (fixture) a stranger stores a success under the guest\'s op id', ($r['json']['ok'] ?? false) === true, $r['raw']);
// The real tap: recorded, timestamped, and the owner told once (the activity
// row is written in the same breath as alert_owner).
$r = http($coJar, 'POST', '/guest-checkout.php', ['action' => 'left', 'booking_id' => $coId, 'op_id' => 'gco-' . $coId . '-' . $coToday]);
$coAt = (string) ($r['json']['at'] ?? '');
it_check('§30 the last-morning tap records and answers the time', ($r['json']['ok'] ?? false) === true && $coAt !== ''
    && (string) $rootDb->query("SELECT guest_checked_out_at FROM bookings WHERE id = $coId")->fetchColumn() === $coAt, $r['raw']);
$coActs = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'guest.checkout' AND entity_id = '$coId'")->fetchColumn();
it_check('§30 …and the owner is told (one activity row beside the alert)', $coActs() === 1);
// Exactly-once, both shapes: the SAME op id replays the stored answer, and a
// FRESH second tap is answered gracefully with the original time — neither
// re-notifies (the already/replay branches exit before the tell).
$r = http($coJar, 'POST', '/guest-checkout.php', ['action' => 'left', 'booking_id' => $coId, 'op_id' => 'gco-' . $coId . '-' . $coToday]);
it_check('§30 a poor-signal retry replays the stored success (same time, no second alert)',
    ($r['json']['ok'] ?? false) === true && ($r['json']['at'] ?? '') === $coAt
    && ($r['json']['replayed'] ?? false) === true && $coActs() === 1, $r['raw']);
$r = http($coJar, 'POST', '/guest-checkout.php', ['action' => 'left', 'booking_id' => $coId, 'op_id' => 'gco-fresh-000002']);
it_check('§30 a fresh second tap is a graceful "already" with the ORIGINAL time, still one alert',
    ($r['json']['ok'] ?? false) === true && ($r['json']['already'] ?? false) === true
    && ($r['json']['at'] ?? '') === $coAt && $coActs() === 1, $r['raw']);

// ── §31 The Guest Book — owner-only in every direction ──────────────────────
// The write validated, re-rate a REPLACE, delete a real delete — and the two
// absences asserted rather than assumed: a GUEST session cannot write, and the
// guest's own my-bookings payload never carries a byte of the rating.
echo "\n== \u{00A7}31 the guest book ==\n";
$gbNote = 'Spotless stay; GBNOTE-MARKER left the beds stripped.';
$r = http($coJar, 'POST', '/bookings.php', ['action' => 'rate_guest', 'id' => $coId, 'overall' => 5]);
it_check('§31 a guest session cannot write to the book', $r['code'] === 401, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'rate_guest', 'id' => $coId, 'overall' => 7]);
it_check('§31 overall is 1–5, refused in words', $r['code'] === 400 && strpos((string) ($r['json']['error'] ?? ''), '1 to 5') !== false, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'rate_guest', 'id' => $coId, 'overall' => 4, 'clean' => 'meh']);
it_check('§31 a category mark is good, poor, or unset — nothing else', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'rate_guest', 'id' => $coId, 'overall' => 4, 'note' => str_repeat('x', 501)]);
it_check('§31 the note is capped', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'rate_guest', 'id' => $coId, 'overall' => 5, 'clean' => 'good', 'rules' => 'good', 'note' => $gbNote]);
it_check('§31 the owner writes the rating, dated', ($r['json']['ok'] ?? false) === true && ($r['json']['at'] ?? '') !== '', $r['raw']);
$row = $rootDb->query("SELECT * FROM guest_ratings WHERE booking_id = $coId")->fetch();
it_check('§31 …stored as written', $row && (int) $row['overall'] === 5 && $row['clean'] === 'good' && strpos((string) $row['note'], 'GBNOTE-MARKER') !== false);
// Re-rate REPLACES — one row per stay, nothing accumulates behind your back.
http($admin, 'POST', '/bookings.php', ['action' => 'rate_guest', 'id' => $coId, 'overall' => 2, 'rules' => 'poor', 'note' => 'GBNOTE-MARKER second thoughts']);
$gbCount = (int) $rootDb->query("SELECT COUNT(*) FROM guest_ratings WHERE booking_id = $coId")->fetchColumn();
$row = $rootDb->query("SELECT * FROM guest_ratings WHERE booking_id = $coId")->fetch();
it_check('§31 re-rating replaces the one row', $gbCount === 1 && (int) $row['overall'] === 2 && $row['rules'] === 'poor');
// THE STRIP: the guest's own payload never carries the book. Raw-text search,
// so a renamed field can't dodge it — neither the marker text nor any gr_ key.
$r = http($coJar, 'GET', '/my-bookings.php');
it_check('§31 the guest payload carries not a byte of it',
    strpos($r['raw'], 'GBNOTE-MARKER') === false && strpos($r['raw'], 'gr_overall') === false && strpos($r['raw'], 'guest_ratings') === false, substr($r['raw'], 0, 200));
// …while the OWNER'S payload does (the surfaces read gr_* off the admin list).
$r = http($admin, 'GET', '/bookings.php');
$gbMine = null;
foreach (($r['json']['bookings'] ?? []) as $bk) {
    if ((int) $bk['id'] === $coId) { $gbMine = $bk; }
}
it_check('§31 the owner\'s payload carries it as gr_*', $gbMine && (int) ($gbMine['gr_overall'] ?? 0) === 2 && ($gbMine['gr_rules'] ?? '') === 'poor');
// Deleting really deletes.
$r = http($admin, 'POST', '/bookings.php', ['action' => 'rate_guest', 'id' => $coId, 'overall' => 0]);
it_check('§31 overall 0 removes the rating outright',
    ($r['json']['removed'] ?? false) === true
    && (int) $rootDb->query("SELECT COUNT(*) FROM guest_ratings WHERE booking_id = $coId")->fetchColumn() === 0, $r['raw']);

// ── §32 races the sweep closed: the edit that regressed money, the cancel
//     that refunded twice, and the orphan flag's one tap ────────────────────
echo "\n== \u{00A7}32 write races ==\n";

// (a) An edit that BLOCKS on the booking lock while a payment lands must write
// the post-payment money back, not its pre-lock snapshot. Reproduced for real:
// hold the prop's book_lock on a second connection, fire the edit in a child
// process (it parks at book_lock AFTER its first read), land the "charge" via
// SQL, release the lock, and assert the edit's write kept the money. Reverting
// the under-lock re-read in bookings.php `update` fails the last check.
$rIn = date('Y-m-d', strtotime('+40 days'));
$rOut = date('Y-m-d', strtotime('+43 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Race Guest','','$rIn','$rOut',2,0,'unpaid',0,400,400,0,3)");
$raceId = (int) $rootDb->lastInsertId();
$lockName = 'chb_book_' . preg_replace('/[^a-z0-9_]/i', '', $propKey);
$slot2 = new PDO("mysql:host=$DB_HOST;port=$DB_PORT;dbname=$DB_NAME;charset=utf8mb4", $DB_USER, $DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$st = $slot2->prepare('SELECT GET_LOCK(?, 0)');
$st->execute([$lockName]);
it_check('§32a the booking lock can be held on a second connection', (int) $st->fetchColumn() === 1);
$raceCookie = implode('; ', array_map(fn($k) => "$k={$admin[$k]}", array_keys($admin)));
$racePayload = json_encode(['action' => 'update', 'id' => $raceId, 'notes' => 'phone-number-style edit while a charge lands']);
$raceScript = sys_get_temp_dir() . '/chb-it-race-' . getmypid() . '.php';
file_put_contents($raceScript, '<?php $o = ["http" => ["method" => "POST", "header" => "Content-Type: application/json\r\nAccept: application/json\r\nCookie: ' . $raceCookie . '\r\nX-CSRF-Token: ' . ($admin['csrf'] ?? '') . '", "content" => ' . var_export($racePayload, true) . ', "timeout" => 40, "ignore_errors" => true]]; echo file_get_contents(' . var_export($BASE . '/bookings.php', true) . ', false, stream_context_create($o));');
$rp = [];
$raceProc = proc_open('exec php ' . escapeshellarg($raceScript), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $rp);
// Wait until the edit is genuinely PARKED at book_lock (i.e. past its pre-lock
// read) — visible as a waiting GET_LOCK in the processlist — then land the
// charge and let it through. A time-based sleep alone would let a slow child
// start after the charge, which passes either way and proves nothing.
$parked = false;
for ($i = 0; $i < 100; $i++) {
    // Probe the WAIT STATE, not the query text: db.php uses real server-side
    // prepares, so processlist info shows `GET_LOCK(?, 30)` with no lock name —
    // and a text probe's own literal matched itself on iteration 0, letting the
    // charge land before the child had read (both code variants then pass and
    // the break-test proves nothing — measured). A session blocked in GET_LOCK
    // sits in state 'User lock', which nothing else in this suite does.
    $n = (int) $rootDb->query("SELECT COUNT(*) FROM information_schema.processlist WHERE state = 'User lock'")->fetchColumn();
    if ($n > 0) { $parked = true; break; }
    usleep(100000);
}
it_check('§32a the edit parks at the lock (past its first read)', $parked);
// The full shape a real pay.php charge writes (payment_date included — the
// update path validates it whenever money is present on the fresh row).
$rootDb->exec("UPDATE bookings SET deposit_paid = 225, payment = 'deposit', payment_date = CURDATE(), payment_method = 'Square card' WHERE id = $raceId");
$slot2->prepare('SELECT RELEASE_LOCK(?)')->execute([$lockName]);
$raceOut = stream_get_contents($rp[1]);
proc_close($raceProc);
@unlink($raceScript);
$raceJson = json_decode((string) $raceOut, true);
it_check('§32a the parked edit completes ok', ($raceJson['ok'] ?? ($raceJson['success'] ?? false)) || isset($raceJson['booking']) || ($raceJson['updated'] ?? false) || (is_array($raceJson) && !isset($raceJson['error'])), substr((string) $raceOut, 0, 200));
$raceRow = $rootDb->query("SELECT deposit_paid, payment, notes FROM bookings WHERE id = $raceId")->fetch();
it_check('§32a …and the money that landed while it waited SURVIVES the write (£225, deposit)',
    round((float) $raceRow['deposit_paid'], 2) === 225.00 && $raceRow['payment'] === 'deposit',
    'deposit_paid=' . $raceRow['deposit_paid'] . ' payment=' . $raceRow['payment']);
it_check('§32a …while the edit itself applied', strpos((string) $raceRow['notes'], 'phone-number-style') !== false);
$slot2 = null;

// (b) Cancel is exactly-once: a retry with the same op_id is answered from the
// ledger (replayed), never re-run — the re-run is what re-issued a Square
// refund with a fresh idempotency key. Refund 0 keeps Square out of the test;
// the mechanism under test is the claim.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Cancel Twice','','$rIn','$rOut',2,0,'unpaid',0,400,400,0,3)");
$cxId = (int) $rootDb->lastInsertId();
$cxOp = ['action' => 'cancel', 'id' => $cxId, 'refund_amount' => 0, 'reason' => 'it-replay', 'op_id' => 'it-cancel-rp-' . $cxId];
$r1 = http($admin, 'POST', '/bookings.php', $cxOp);
it_check('§32b cancel runs once (row deleted)',
    ($r1['json']['ok'] ?? false) === true && (int) $rootDb->query("SELECT COUNT(*) FROM bookings WHERE id = $cxId")->fetchColumn() === 0, $r1['raw']);
$r2 = http($admin, 'POST', '/bookings.php', $cxOp);
it_check('§32b the retry is ANSWERED, not re-run (replayed, no 404, no second cancellation)',
    $r2['code'] === 200 && ($r2['json']['ok'] ?? false) === true && ($r2['json']['replayed'] ?? false) === true, $r2['raw']);

// (c) The orphan-payment flag carries its one tap: the activity list attaches
// the closed `act` for exactly the selfrepair.square_orphan event, nothing else.
$rootDb->prepare("INSERT INTO activity_log (category, action, summary, actor, severity, prop_key, entity, entity_id, meta) VALUES ('payment','selfrepair.square_orphan','Self-repair: £90.00 was taken at Square','cron','warn',?, 'booking', ?, ?)")
    ->execute([$propKey, (string) $raceId, json_encode(['square_payment_id' => 'SQ_IT_ORPHAN_1', 'amount' => 90.0, 'currency' => 'GBP'])]);
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'list', 'category' => 'all', 'q' => 'taken at Square', 'limit' => 50]);
$orRow = null;
foreach (($r['json']['events'] ?? []) as $ev) {
    if (($ev['act']['kind'] ?? '') === 'square_orphan') { $orRow = $ev; }
}
it_check('§32c the orphan flag row carries its act (booking + payment id)',
    $orRow && (int) $orRow['act']['booking'] === $raceId && $orRow['act']['payment'] === 'SQ_IT_ORPHAN_1', substr($r['raw'], 0, 200));
$actCount = 0;
foreach (($r['json']['events'] ?? []) as $ev) { if (isset($ev['act'])) { $actCount++; } }
it_check('§32c …and NO other row grows an action from log data', $actCount === 1, 'actCount=' . $actCount);

// (d) A READ-CHANGE-SAVE OF ONE CONTENT KEY IS ONE STEP (content_locked). Requests
// from one browser no longer queue on the PHP session, so two "Seen it" taps can
// each read the list, add to it and save — and one is lost. Hold the key's lock on
// a second connection, fire the request in a child, wait until it is parked, land
// a different change directly, release: both must be in the stored list.
$ckLock = 'chb_ck_' . substr(sha1('activity-seen'), 0, 40);
$slot3 = new PDO("mysql:host=$DB_HOST;port=$DB_PORT;dbname=$DB_NAME;charset=utf8mb4", $DB_USER, $DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$st = $slot3->prepare('SELECT GET_LOCK(?, 0)');
$st->execute([$ckLock]);
it_check('§32d (fixture) the seen list\'s lock is held on a second connection', (int) $st->fetchColumn() === 1);
$ckPayload = json_encode(['action' => 'seen', 'ids' => [990001]]);
$ckScript = sys_get_temp_dir() . '/chb-it-ck-' . getmypid() . '.php';
file_put_contents($ckScript, '<?php $o = ["http" => ["method" => "POST", "header" => "Content-Type: application/json\r\nAccept: application/json\r\nCookie: ' . $raceCookie . '\r\nX-CSRF-Token: ' . ($admin['csrf'] ?? '') . '", "content" => ' . var_export($ckPayload, true) . ', "timeout" => 40, "ignore_errors" => true]]; echo file_get_contents(' . var_export($BASE . '/activity-log.php', true) . ', false, stream_context_create($o));');
$ckp = [];
$ckProc = proc_open('exec php ' . escapeshellarg($ckScript), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $ckp);
$ckParked = false;
for ($i = 0; $i < 100; $i++) {
    $n = (int) $rootDb->query("SELECT COUNT(*) FROM information_schema.processlist WHERE state = 'User lock'")->fetchColumn();
    if ($n > 0) { $ckParked = true; break; }
    usleep(100000);
}
it_check('§32d the "Seen it" request waits for the lock', $ckParked);
$rootDb->exec("INSERT INTO `$DB_NAME`.content (item_key, item_value) VALUES ('activity-seen', '[990002]') ON DUPLICATE KEY UPDATE item_value = '[990002]'");
$slot3->prepare('SELECT RELEASE_LOCK(?)')->execute([$ckLock]);
$ckOut = stream_get_contents($ckp[1]);
proc_close($ckProc);
@unlink($ckScript);
$ckSeen = json_decode((string) $rootDb->query("SELECT item_value FROM `$DB_NAME`.content WHERE item_key = 'activity-seen'")->fetchColumn(), true);
it_check('§32d …and saves its change on top of the one that landed while it waited',
    is_array($ckSeen) && in_array(990001, $ckSeen, true) && in_array(990002, $ckSeen, true), json_encode($ckSeen) . ' ' . substr((string) $ckOut, 0, 120));
$slot3 = null;

// ── §33 the CASH rail's damages deposit has the same lifecycle as the card's ──
// Both halves were card-only. A deposit collected in cash (hold_status stays
// 'none', no hold_payment_id) fell through cancel's settle block entirely — so
// the obligation was destroyed with the row — and through return_deposit's
// settle stamp — so nothing downstream could tell a returned deposit from one
// still held.
echo "\n== \u{00A7}33 the cash rail's damages deposit ==\n";
$cshIn = date('Y-m-d', strtotime('-6 days'));
$cshOut = date('Y-m-d', strtotime('-2 days')); // checked out, so a return is allowed
// Rental 300 + a £60 damages deposit collected IN CASH: paid 360 against a 300
// rental, hold_status 'none' — exactly what set_payment's "collected too" writes.
$mkCash = function ($name) use ($rootDb, $propKey, $cshIn, $cshOut) {
    $rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, payment_method, payment_date, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee, hold_status, hold_amount) VALUES ('$propKey','$name','','$cshIn','$cshOut',2,0,'paid',360,'Cash',CURDATE(),300,300,0,4,60,'none',0)");
    return (int) $rootDb->lastInsertId();
};

// (a) RETURNING a cash deposit marks it settled, so every reader can tell.
$cshId = $mkCash('Cash Return');
it_reauth($admin);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $cshId]);
it_check('§33a a cash deposit returns ok', ($r['json']['ok'] ?? false) === true, $r['raw']);
$cshRow = $rootDb->query("SELECT hold_status, hold_settled_at FROM bookings WHERE id = $cshId")->fetch();
it_check('§33a …and is MARKED settled — the stamp was card-only, so the invoice went on promising a refund that had already happened',
    $cshRow['hold_status'] === 'returned' && !empty($cshRow['hold_settled_at']),
    'hold_status=' . $cshRow['hold_status'] . ' settled=' . var_export($cshRow['hold_settled_at'], true));
// A second return is refused, exactly as on the card rail.
it_reauth($admin);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $cshId]);
it_check('§33a …and cannot be returned twice', $r['code'] === 409, $r['raw']);

// (b) CANCELLING with a cash deposit still held reports it as owed and logs it,
// because the row that recorded it is about to be deleted.
$cshId2 = $mkCash('Cash Cancel');
it_reauth($admin);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $cshId2, 'refund_amount' => 0, 'reason' => 'it-cash', 'op_id' => 'it-cash-cxl-' . $cshId2]);
it_check('§33b cancelling reports the cash deposit as STILL OWED (£60), not silence',
    ($r['json']['ok'] ?? false) === true && abs((float) ($r['json']['deposit_owed'] ?? 0) - 60.0) < 0.005, $r['raw']);
$owedLog = (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'deposit.owed' AND entity_id = '$cshId2'")->fetchColumn();
it_check('§33b …and logs it as a warn, so it outlives the booking in Needs attention', $owedLog === 1, 'rows=' . $owedLog);
it_check('§33b …and the booking really is gone', (int) $rootDb->query("SELECT COUNT(*) FROM bookings WHERE id = $cshId2")->fetchColumn() === 0);

// (c) A booking with NO deposit cancels silently, as before — the warn must
// name a real obligation, never fire on every cancellation.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee, hold_status, hold_amount) VALUES ('$propKey','No Dep','','$cshIn','$cshOut',2,0,'paid',300,300,300,0,4,0,'none',0)");
$noDepId = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $noDepId, 'refund_amount' => 0, 'reason' => 'it-nodep', 'op_id' => 'it-nodep-cxl-' . $noDepId]);
it_check('§33c a booking with no deposit cancels with nothing owed and no warn',
    ($r['json']['ok'] ?? false) === true
    && (float) ($r['json']['deposit_owed'] ?? 0) === 0.0
    && (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'deposit.owed' AND entity_id = '$noDepId'")->fetchColumn() === 0, $r['raw']);

// ── §34 an UNLISTED cottage does not exist on the public site — every route ──
// ?all=1 was fixed for this once; the two routes beside it were not. A private
// cottage's rates rode the anonymous rates payload under `seasons` (keyed by
// its own prop_key), and naming it directly at availability.php?prop= returned
// its whole forward occupancy calendar.
echo "\n== \u{00A7}34 an unlisted cottage stays private on every route ==\n";
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Secret Annexe', 'couple_rate' => 210]);
$secretKey = (string) ($r['json']['prop_key'] ?? ($r['json']['property']['prop_key'] ?? ''));
it_check('§34 a cottage can be created for the test', $secretKey !== '', $r['raw']);
$rootDb->exec("UPDATE properties SET unlisted = 1 WHERE prop_key = " . $rootDb->quote($secretKey));
// It has a season (a rate the public must not read) and a stay (dates the
// public must not read).
$rootDb->exec("INSERT INTO rate_seasons (prop_key, label, start_date, end_date, couple_rate) VALUES (" . $rootDb->quote($secretKey) . ",'Secret Christmas','2026-12-20','2026-12-28',495)");
$secIn = date('Y-m-d', strtotime('+12 days'));
$secOut = date('Y-m-d', strtotime('+15 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES (" . $rootDb->quote($secretKey) . ",'Private Guest','','$secIn','$secOut',2,0,'paid',400,400,400,0,3)");

$anon2 = [];
$r = http($anon2, 'GET', '/rates.php');
$anonRaw = $r['raw'];
$anonProps = array_column($r['json']['properties'] ?? [], 'prop_key');
it_check('§34 the anonymous rates payload omits the cottage itself', !in_array($secretKey, $anonProps, true), implode(',', $anonProps));
it_check('§34 …and omits its SEASONS — the key, the label and the nightly rate were all published',
    !isset(($r['json']['seasons'] ?? [])[$secretKey]) && strpos($anonRaw, 'Secret Christmas') === false && strpos($anonRaw, $secretKey) === false,
    substr($anonRaw, 0, 300));
// The owner still sees everything — the filter is a public-visitor rule, not a
// deletion (the ?all=1 branch's own posture).
$r = http($admin, 'GET', '/rates.php');
it_check('§34 …while the OWNER still receives it, seasons and all',
    in_array($secretKey, array_column($r['json']['properties'] ?? [], 'prop_key'), true)
    && isset(($r['json']['seasons'] ?? [])[$secretKey]), substr($r['raw'], 0, 200));

// availability.php, both routes.
$r = http($anon2, 'GET', '/availability.php?all=1');
it_check('§34 ?all=1 still withholds it (the fix that was already here)', !isset(($r['json']['props'] ?? [])[$secretKey]), substr($r['raw'], 0, 200));
$r = http($anon2, 'GET', '/availability.php?prop=' . rawurlencode($secretKey));
it_check('§34 …and naming it DIRECTLY no longer returns its calendar',
    ($r['json']['ranges'] ?? null) === [] && strpos($r['raw'], $secIn) === false, substr($r['raw'], 0, 200));
// An admin asking the same question still gets the dates, and a LISTED cottage
// is unaffected — the rule must not blank the public site.
$r = http($admin, 'GET', '/availability.php?prop=' . rawurlencode($secretKey));
it_check('§34 …but the owner still gets them', count($r['json']['ranges'] ?? []) === 1, substr($r['raw'], 0, 200));
$r = http($anon2, 'GET', '/availability.php?prop=' . rawurlencode($propKey));
it_check('§34 a LISTED cottage answers anonymous callers exactly as before', is_array($r['json']['ranges'] ?? null), substr($r['raw'], 0, 200));

// §35 A RECORDED DAMAGES DEPOSIT SURVIVES AN EDIT. The edit form sends `payment`
// on every save, and reconcile_deposit('paid') means "received = rental total", so
// correcting a phone number on a cash/bank booking whose £50 deposit had been
// recorded ("Collected too") rewrote deposit_paid £310 -> £260 and the hub went
// back to "£50 balance remaining" for a guest who had paid in full. Dates are
// relative ($dd) so a fixed date can never be swept onto by a moving one.
echo "\n== §35 an edit does not un-collect the damages deposit ==\n";
$dpIn = $dd(950);
$dpOut = $dd(952);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, payment_method, payment_date, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee) VALUES ('$propKey','Deposit Kept','dk@gmail.com','$dpIn','$dpOut',2,0,'paid',310,'Bank transfer','$dpIn',260,260,0,2,50)");
$dpId = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $dpId, 'prop_key' => $propKey, 'name' => 'Deposit Kept', 'email' => 'dk@gmail.com', 'phone' => '07700900321', 'check_in' => $dpIn, 'check_out' => $dpOut, 'adults' => 2, 'children' => 0, 'payment' => 'paid', 'payment_date' => $dpIn, 'payment_method' => 'Bank transfer']);
$dpNow = (float) $rootDb->query("SELECT deposit_paid FROM bookings WHERE id = $dpId")->fetchColumn();
it_check('§35 editing a phone number keeps the recorded £50 deposit (£310, not £260)', $r['code'] === 200 && abs($dpNow - 310.0) < 0.005, 'deposit_paid=' . $dpNow . ' ' . substr($r['raw'], 0, 120));
// The control: a booking that NEVER had the deposit recorded must not gain one.
$dpIn2 = $dd(960);
$dpOut2 = $dd(962);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, payment_method, payment_date, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee) VALUES ('$propKey','Deposit Not Taken','dn@gmail.com','$dpIn2','$dpOut2',2,0,'paid',260,'Bank transfer','$dpIn2',260,260,0,2,50)");
$dpId2 = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $dpId2, 'prop_key' => $propKey, 'name' => 'Deposit Not Taken', 'email' => 'dn@gmail.com', 'phone' => '07700900322', 'check_in' => $dpIn2, 'check_out' => $dpOut2, 'adults' => 2, 'children' => 0, 'payment' => 'paid', 'payment_date' => $dpIn2, 'payment_method' => 'Bank transfer']);
$dpNow2 = (float) $rootDb->query("SELECT deposit_paid FROM bookings WHERE id = $dpId2")->fetchColumn();
it_check('§35 …and a booking that never had the deposit recorded does not gain one (£260 stays £260)', $r['code'] === 200 && abs($dpNow2 - 260.0) < 0.005, 'deposit_paid=' . $dpNow2);

// §36 migration-123 GIVES A BOOKING BACK THE AGREED PRICE ITS EDIT FORM TOOK. The
// Edit form opened with its price-override input blank and saveModal posts it on
// every save ('' = clear), so saving anything dropped a negotiated price. That
// leaves agreed_total at the agreed figure with no override and a snapshot that no
// longer adds up to it — and the hub, damages_collected and accounts then measure
// a cash deposit against the STANDARD rental, so a guest who paid rental + deposit
// in full still read as owing the deposit. The migration restores the override for
// exactly those rows and nothing else. Run here by hand (migrate.php applied it to
// the EMPTY database in §2 and records it, so it will not run again by itself).
echo "\n== §36 migration-123 restores a lost agreed price — and only that ==\n";
$mig123 = __DIR__ . '/migration-123-restore-agreed-price.sql';
$mkRow = function (string $name, array $c) use ($rootDb, $propKey): int {
    $cols = array_merge([
        'prop_key' => $propKey, 'name' => $name, 'email' => strtolower(str_replace(' ', '', $name)) . '@gmail.com',
        'adults' => 2, 'children' => 0, 'payment' => 'paid', 'deposit_paid' => 310,
        'agreed_nights' => 2, 'agreed_booking_fee' => 50, 'price_override' => null,
    ], $c);
    $names = array_keys($cols);
    $rootDb->prepare('INSERT INTO bookings (' . implode(',', $names) . ') VALUES (' . implode(',', array_fill(0, count($names), '?')) . ')')->execute(array_values($cols));
    return (int) $rootDb->lastInsertId();
};
$ovOf = fn(int $id) => $rootDb->query("SELECT price_override FROM bookings WHERE id = $id")->fetchColumn();
$fx = ['check_in' => $dd(970), 'check_out' => $dd(972)];
// A: a negotiated £260 (standard £267.80) whose override was lost — THE case.
$mA = $mkRow('Mig Lost', $fx + ['agreed_total' => 260, 'agreed_nightly' => 260, 'agreed_txn_fee' => 7.8]);
// B: an ordinary standard-priced booking — total IS nightly + fee.
$mB = $mkRow('Mig Standard', ['check_in' => $dd(974), 'check_out' => $dd(976), 'agreed_total' => 267.8, 'agreed_nightly' => 260, 'agreed_txn_fee' => 7.8]);
// C: the older "refundable deposit folded into the total" shape (nightly + fee + £50).
$mC = $mkRow('Mig Folded', ['check_in' => $dd(978), 'check_out' => $dd(980), 'agreed_total' => 317.8, 'agreed_nightly' => 260, 'agreed_txn_fee' => 7.8]);
// D: the same lost override, but the stay is OVER — history is left exactly as it was.
$mD = $mkRow('Mig Past', ['check_in' => $dd(-6), 'check_out' => $dd(-4), 'agreed_total' => 260, 'agreed_nightly' => 260, 'agreed_txn_fee' => 7.8]);
// E: already has an override — never overwritten, even where it differs from the total.
$mE = $mkRow('Mig Has Override', ['check_in' => $dd(982), 'check_out' => $dd(984), 'agreed_total' => 260, 'agreed_nightly' => 260, 'agreed_txn_fee' => 7.8, 'price_override' => 250]);
// F: half a snapshot (no fee line) says nothing about what the total should be.
$mF = $mkRow('Mig Half', ['check_in' => $dd(986), 'check_out' => $dd(988), 'agreed_total' => 260, 'agreed_nightly' => 260, 'agreed_txn_fee' => null]);
// G: a lost override on a booking that never stored a refundable deposit.
$mG = $mkRow('Mig NoDeposit', ['check_in' => $dd(990), 'check_out' => $dd(992), 'agreed_total' => 260, 'agreed_nightly' => 300, 'agreed_txn_fee' => 9, 'agreed_booking_fee' => null]);
$stmts123 = split_sql($mig123);
it_check('§36 the migration is a single DATA statement (force never re-runs it)', count($stmts123) === 1 && !migration_stmt_is_schema($stmts123[0]), (string) count($stmts123));
foreach ($stmts123 as $st) {
    $rootDb->exec($st);
}
it_check('§36 a lost agreed price is restored to the agreed total (£260)', abs((float) $ovOf($mA) - 260.0) < 0.005, var_export($ovOf($mA), true));
it_check('§36 …including where no refundable deposit was ever stored', abs((float) $ovOf($mG) - 260.0) < 0.005, var_export($ovOf($mG), true));
it_check('§36 a standard-priced booking is NOT relabelled custom', $ovOf($mB) === null, var_export($ovOf($mB), true));
it_check('§36 …nor the older folded-deposit shape', $ovOf($mC) === null, var_export($ovOf($mC), true));
it_check('§36 a finished stay is left exactly as it was', $ovOf($mD) === null, var_export($ovOf($mD), true));
it_check('§36 an existing override is never overwritten', abs((float) $ovOf($mE) - 250.0) < 0.005, var_export($ovOf($mE), true));
it_check('§36 a half-snapshotted row is left alone', $ovOf($mF) === null, var_export($ovOf($mF), true));
$before123 = $rootDb->query("SELECT id, price_override, agreed_total, deposit_paid FROM bookings WHERE name LIKE 'Mig %' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
foreach ($stmts123 as $st) {
    $rootDb->exec($st);
}
$after123 = $rootDb->query("SELECT id, price_override, agreed_total, deposit_paid FROM bookings WHERE name LIKE 'Mig %' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
it_check('§36 a second run changes nothing (idempotent)', $before123 === $after123);
it_check('§36 no total or amount received moved — only the override was filled in',
    abs((float) $rootDb->query("SELECT agreed_total FROM bookings WHERE id = $mA")->fetchColumn() - 260.0) < 0.005
    && abs((float) $rootDb->query("SELECT deposit_paid FROM bookings WHERE id = $mA")->fetchColumn() - 310.0) < 0.005);
// The server half of the same contract: an update that does not mention the
// override keeps it (absent = keep, '' = clear). The form's fix is what makes the
// client send the real value; this is what makes ABSENCE safe for any other caller.
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $mA, 'prop_key' => $propKey, 'name' => 'Mig Lost', 'email' => 'miglost@gmail.com', 'phone' => '07700900330', 'check_in' => $fx['check_in'], 'check_out' => $fx['check_out'], 'adults' => 2, 'children' => 0, 'notes' => 'phone corrected', 'payment' => 'paid', 'payment_date' => $dd(-10), 'payment_method' => 'Bank transfer']);
it_check('§36 an edit that does not mention the price keeps it (and the £310 received)',
    $r['code'] === 200 && abs((float) $ovOf($mA) - 260.0) < 0.005 && abs((float) $rootDb->query("SELECT deposit_paid FROM bookings WHERE id = $mA")->fetchColumn() - 310.0) < 0.005, substr($r['raw'], 0, 160));

// §37 SWIPED-AWAY DUTIES. A row on the Needs-you strip can be swiped away; the
// record of which ones lives under the internal content key `duty-dismissed` so a
// swipe on the phone holds on the Mac. Two facts are load-bearing and neither is
// visible from the client: the key must NEVER reach the public content GET (it names
// bookings by id), and it must ride the ADMIN BOOT payload — an internal key is absent
// from the page's content at first render, the strip paints at boot, and read any
// later a dismissed row would flash back first.
echo "\n== §37 swiped-away duties: private, and on the boot payload ==\n";
$dutyMap = ['register:91' => ['sev' => 'warn', 'at' => (int) (microtime(true) * 1000)]];
$r = http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'duty-dismissed', 'value' => $dutyMap]);
it_check('§37 the owner can save the map under the internal key', $r['code'] === 200, $r['raw']);
$r = http($admin, 'GET', '/admin-bootstrap.php');
it_check('§37 …and it rides the admin boot payload, so the strip honours it at first paint',
    ($r['json']['dismissed']['register:91']['sev'] ?? '') === 'warn', mb_substr($r['raw'], 0, 160));
// The payload is {content: {...}}, so the key is looked for INSIDE it — and the admin GET
// is the positive control: without it, an absence proves only that the shape moved.
$r = http($admin, 'GET', '/content.php');
it_check('§37 the admin content GET carries it (the control for the next check)', isset($r['json']['content']['duty-dismissed']['register:91']), mb_substr($r['raw'], 0, 160));
$anonDuty = [];
$r = http($anonDuty, 'GET', '/content.php');
it_check('§37 …but the PUBLIC content GET never does', is_array($r['json']['content'] ?? null) && !array_key_exists('duty-dismissed', $r['json']['content']), mb_substr($r['raw'], 0, 200));
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'duty-dismissed', 'value' => 'garbage']);
$r = http($admin, 'GET', '/admin-bootstrap.php');
it_check('§37 a value that is not a map degrades to nothing dismissed', is_array($r['json']['dismissed'] ?? null) && count($r['json']['dismissed']) === 0, mb_substr($r['raw'], 0, 160));
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'duty-dismissed', 'value' => '']);
$r = http($admin, 'GET', '/admin-bootstrap.php');
it_check('§37 …and nothing set goes out as {} (an object), never []', strpos($r['raw'], '"dismissed":{}') !== false, mb_substr($r['raw'], 0, 200));
$bigDuty = [];
for ($i = 0; $i < 500; $i++) {
    $bigDuty['balance:' . (1000 + $i)] = ['sev' => 'warn', 'at' => $i];
}
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'duty-dismissed', 'value' => $bigDuty]);
$r = http($admin, 'GET', '/admin-bootstrap.php');
it_check('§37 a runaway map is truncated on the way out (400)', count($r['json']['dismissed'] ?? []) === 400, (string) count($r['json']['dismissed'] ?? []));
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'duty-dismissed', 'value' => '']);

// ---------------------------------------------------------------------------
// §38 ONE RENTAL TOTAL. The hub, the emails and the accounts read a booking's rental
// through booking_rental_price / booking_agreed_total; they used to disagree whenever a
// price override was lost. Real rows, read back through PDO (so values arrive as the
// strings the app sees), against the same fixtures the client mirror is held to.
echo "\n== §38 the shared rental fixtures against real stored rows ==\n";
require_once __DIR__ . '/db.php'; // the pure money helpers (db() stays lazy)
$rfx38 = json_decode((string) file_get_contents(__DIR__ . '/rental-fixtures.json'), true);
$n38 = 0;
foreach ($rfx38['cases'] as $i => $rc) {
    $row = $rc['row'];
    $cols = [
        'prop_key' => $propKey, 'name' => 'Rental Fx ' . $i, 'email' => 'rentalfx' . $i . '@gmail.com',
        'adults' => 2, 'children' => 0, 'payment' => 'paid', 'deposit_paid' => 0, 'agreed_nights' => 2,
        'check_in' => $dd(1100 + $i * 4), 'check_out' => $dd(1102 + $i * 4),
    ] + $row;
    $names = array_keys($cols);
    $rootDb->prepare('INSERT INTO bookings (' . implode(',', $names) . ') VALUES (' . implode(',', array_fill(0, count($names), '?')) . ')')->execute(array_values($cols));
    $stored = $rootDb->query('SELECT * FROM bookings WHERE id = ' . (int) $rootDb->lastInsertId())->fetch(PDO::FETCH_ASSOC);
    $ok = booking_total_shape($stored) === $rc['shape']
        && abs(booking_rental_price($stored) - $rc['rental']) < 0.005
        && abs(booking_agreed_total($stored) - $rc['agreedTotal']) < 0.005;
    it_check('§38 stored row: ' . $rc['name'], $ok, booking_total_shape($stored) . ' ' . booking_rental_price($stored) . ' ' . booking_agreed_total($stored));
    // THE PROPERTY: where the two frames used to diverge (a lost override), they agree.
    if ($rc['shape'] === 'lost') {
        it_check('§38 …and for a lost override the rental and the agreed total are ONE figure', abs(booking_rental_price($stored) - booking_agreed_total($stored)) < 0.005);
    }
    $n38++;
}
it_check('§38 every fixture was driven', $n38 === count($rfx38['cases']) && $n38 >= 8, (string) $n38);

// §39 A PLATFORM BLOCK IS NOT A STAY (migration-124). The sync stores what the feed says each
// event is, and the back office reads it through the real door. The classifier itself is gated
// in test-ical.php; this is the column, its default and the route that serves it.
echo "\n== §39 imported events carry what they are ==\n";
$cols39 = $rootDb->query("SHOW COLUMNS FROM ical_blocks")->fetchAll(PDO::FETCH_COLUMN);
it_check('§39 migration-124 added kind and label', in_array('kind', $cols39, true) && in_array('label', $cols39, true), implode(',', $cols39));
$ins39 = $rootDb->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out, kind, label) VALUES (?,?,?,?,?,?,?)');
$ins39->execute([$propKey, 'airbnb', 'it39-block', $dd(900), $dd(903), 'blocked', 'Airbnb (Not available)']);
$ins39->execute([$propKey, 'airbnb', 'it39-res', $dd(910), $dd(913), 'booking', 'Reserved']);
$rootDb->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES (?,?,?,?,?)')->execute([$propKey, 'vrbo', 'it39-plain', $dd(920), $dd(923)]);
$r = http($admin, 'POST', '/ical-import.php', ['action' => 'blocks']);
$by39 = [];
foreach (($r['json']['blocks'] ?? []) as $bl) {
    $by39[$bl['check_in']] = $bl;
}
it_check('§39 the blocks route serves a block\'s kind and label', ($by39[$dd(900)]['kind'] ?? '') === 'blocked' && ($by39[$dd(900)]['label'] ?? '') === 'Airbnb (Not available)');
it_check('§39 …and a booking\'s', ($by39[$dd(910)]['kind'] ?? '') === 'booking');
it_check('§39 an event stored with no kind defaults to unknown (it keeps counting as a stay)', ($by39[$dd(920)]['kind'] ?? '') === 'unknown');
$rootDb->exec("DELETE FROM ical_blocks WHERE uid LIKE 'it39-%'");

// §40 THE THANK-YOU IS OFF UNTIL SWITCHED ON, AND CLAIMS BEFORE IT SENDS (migration-125). Driven
// through the live cron URL against a real stay that ended yesterday. MAIL_ENABLED is off in this
// harness, so a send cannot succeed: what is provable is that OFF touches nothing, that ON takes
// the claim-first path (and a clean failure un-claims, so a later run retries), and that the
// pass never blocks the review requests that follow it.
echo "\n== §40 the day-after-checkout thank-you ==\n";
$col40 = in_array('thankyou_sent', $rootDb->query('SHOW COLUMNS FROM bookings')->fetchAll(PDO::FETCH_COLUMN), true);
it_check('§40 migration-125 added thankyou_sent', $col40);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey', 'Thank Yu', 'thanks40@gmail.com', '" . $dd(-5) . "', '" . $dd(-1) . "', 2, 0, 'paid', 0, 0, 0, 0, 4)");
$ty40 = (int) $rootDb->lastInsertId();
// Isolate it: every OTHER stay is marked thanked so the counts below are about this one alone.
$rootDb->exec("UPDATE bookings SET thankyou_sent = NOW() WHERE id <> $ty40");
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'thankyou-email', 'value' => '']);
$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
it_check('§40 OFF (the default): nothing is attempted, stamped or sent', ($r['json']['thankyou_attempted'] ?? -1) === 0 && ($r['json']['thankyou_sent'] ?? -1) === 0
    && $rootDb->query("SELECT thankyou_sent FROM bookings WHERE id = $ty40")->fetchColumn() === null, $r['raw']);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'thankyou-email', 'value' => '1']);
$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
it_check('§40 ON, with mail disabled: the stay was claimed and attempted, zero sent, and the clean failure un-claimed (a later run retries)',
    ($r['json']['ok'] ?? false) === true && ($r['json']['thankyou_attempted'] ?? -1) === 1 && ($r['json']['thankyou_sent'] ?? -1) === 0
    && $rootDb->query("SELECT thankyou_sent FROM bookings WHERE id = $ty40")->fetchColumn() === null, $r['raw']);
it_check('§40 …and the review-request pass after it still ran', array_key_exists('review_requests_sent', $r['json'] ?? []), $r['raw']);
$rootDb->exec("UPDATE bookings SET thankyou_sent = NOW() WHERE id = $ty40");
$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
it_check('§40 an already-thanked stay is never picked up again', ($r['json']['thankyou_attempted'] ?? -1) === 0
    && $rootDb->query("SELECT thankyou_sent FROM bookings WHERE id = $ty40")->fetchColumn() !== null, $r['raw']);
$rootDb->exec("UPDATE bookings SET thankyou_sent = NULL, review_request_sent = NOW() WHERE id = $ty40");
$r = http($admin, 'GET', '/pre-arrival.php?cron=' . $SECRET);
// (ON for this one: the toggle is still on from above, so a miss here is the review filter, not the switch)
it_check('§40 a stay already asked for a review is not thanked after the fact (the order is thank-you first)',
    ($r['json']['thankyou_attempted'] ?? -1) === 0, $r['raw']);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'thankyou-email', 'value' => '']);
$rootDb->exec("DELETE FROM bookings WHERE id = $ty40");

// ── §41 a backup is RUN only by a POST (or the cron) — a GET is a link anyone can plant ──
foreach (['run', 'run_files', 'verify', ''] as $ba) {
    $r = http($admin, 'GET', '/backup.php' . ($ba !== '' ? '?action=' . $ba : ''));
    it_check('§41 GET backup.php' . ($ba !== '' ? '?action=' . $ba : '') . ' is refused (405), nothing runs', $r['code'] === 405, $r['raw']);
}
$r = http($admin, 'POST', '/backup.php', ['action' => 'status']);
it_check('§41 …while the status read still answers', $r['code'] === 200, $r['raw']);

// ── §42 round-2 audit: agreed terms survive a refresh; the register link closes;
//        the welcome book and the owner's test push are not reachable sideways ──
// (a) The price agreed with an enquirer is STORED, so the approval honours it
//     even when the client sends nothing (it used to live in browser memory only).
$e42In = $ukPlus(70); $e42Out = $ukPlus(73);
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message) VALUES ('$propKey','Terms Kept','terms42@gmail.com','$e42In','$e42Out',2,0,'Hello')");
$e42 = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'set_terms', 'id' => $e42, 'price_override' => '250', 'plan_pct' => '40', 'plan_due' => '']);
it_check('§42 set_terms stores the agreed price and plan', ($r['json']['ok'] ?? false) === true
    && abs((float) $rootDb->query("SELECT agreed_price FROM enquiries WHERE id = $e42")->fetchColumn() - 250.0) < 0.005
    && abs((float) $rootDb->query("SELECT plan_pct FROM enquiries WHERE id = $e42")->fetchColumn() - 40.0) < 0.005, $r['raw']);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'set_terms', 'id' => $e42, 'price_override' => '-5']);
it_check('§42 …a nonsense price is refused in words', $r['code'] === 400, $r['raw']);
$r = http($admin, 'GET', '/enquiries.php');
$e42Row = array_values(array_filter($r['json']['enquiries'] ?? [], fn($x) => (int) ($x['id'] ?? 0) === $e42))[0] ?? [];
it_check('§42 …and the enquiry list carries it back (a refresh keeps it)', abs((float) ($e42Row['agreed_price'] ?? 0) - 250.0) < 0.005, json_encode($e42Row));
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => $e42]);
$b42 = (int) ($r['json']['booking_id'] ?? 0);
$b42Row = $b42 ? $rootDb->query("SELECT price_override, deposit_pct_override FROM bookings WHERE id = $b42")->fetch(PDO::FETCH_ASSOC) : [];
it_check('§42 approval with NOTHING sent still books the stored price and plan', $b42 > 0
    && abs((float) ($b42Row['price_override'] ?? 0) - 250.0) < 0.005 && abs((float) ($b42Row['deposit_pct_override'] ?? 0) - 40.0) < 0.005, $r['raw'] . ' ' . json_encode($b42Row));
// (b) The guest-details link closes a week after the stay, and never shows a
//     stored document number in full.
$formPost = function ($path, array $fields) use ($BASE) {
    $o = ['http' => ['method' => 'POST', 'header' => "Content-Type: application/x-www-form-urlencoded", 'content' => http_build_query($fields), 'timeout' => 20, 'ignore_errors' => true]];
    $http_response_header = [];
    $raw = @file_get_contents($BASE . $path, false, stream_context_create($o));
    $code = 0;
    foreach ($http_response_header as $h) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
            $code = (int) $m[1];
        }
    }
    return ['code' => $code, 'raw' => (string) $raw];
};
$g42In = $ukPlus(10); $g42Out = $ukPlus(12);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Reg Guest','reg42@gmail.com','$g42In','$g42Out',1,0,'paid',300,300,300,0,2)");
$g42 = (int) $rootDb->lastInsertId();
$g42Tok = substr(hash_hmac('sha256', 'guestreg:' . $g42, $SECRET), 0, 32);
$r = $formPost('/guest-details.php', ['b' => $g42, 'token' => $g42Tok, 'name' => ['Reg Guest'], 'nationality' => ['French'], 'doc' => ['FR12345678'], 'docplace' => ['Paris'], 'onward' => ['Paris']]);
it_check('§42 (fixture) the register saves', $r['code'] === 200 && (int) $rootDb->query("SELECT COUNT(*) FROM guest_registrations WHERE booking_id = $g42")->fetchColumn() === 1, substr($r['raw'], 0, 200));
$noJar = [];
$r = http($noJar, 'GET', '/guest-details.php?b=' . $g42 . '&token=' . $g42Tok);
it_check('§42 reopening the link shows the document number MASKED', strpos($r['raw'], 'FR12345678') === false && strpos($r['raw'], '5678') !== false, '');
$r = $formPost('/guest-details.php', ['b' => $g42, 'token' => $g42Tok, 'name' => ['Reg Guest Fixed'], 'nationality' => ['French'], 'doc' => ['••••5678'], 'docplace' => ['Paris'], 'onward' => ['Paris']]);
it_check('§42 …and posting the mask back unchanged KEEPS the stored number (a name fix needs no retyped passport)', $r['code'] === 200 && strpos($r['raw'], 'Please add a passport') === false, substr($r['raw'], 0, 200));
it_check('§42 …and the page a save answers with shows it masked, never in full (§79: Save read every passport)', strpos($r['raw'], 'FR12345678') === false && strpos($r['raw'], '5678') !== false, '');
$r = $formPost('/guest-details.php', ['b' => $g42, 'token' => $g42Tok, 'name' => ['Reg Guest Fixed'], 'nationality' => [''], 'doc' => ['••••5678'], 'docplace' => ['Paris'], 'onward' => ['Paris']]);
it_check('§42 …nor does a save the form refuses', $r['code'] === 200 && strpos($r['raw'], 'FR12345678') === false && strpos($r['raw'], '5678') !== false, substr($r['raw'], 0, 120));
$r = $formPost('/guest-details.php', ['b' => $g42, 'token' => $g42Tok, 'name' => ['Reg Guest Fixed'], 'nationality' => [''], 'doc' => ['DE99887766'], 'docplace' => ['Paris'], 'onward' => ['Paris']]);
it_check('§42 …while a number just typed comes back as typed, so a refused save can be fixed', strpos($r['raw'], 'DE99887766') !== false, '');
$rootDb->exec("UPDATE bookings SET check_in = '" . $ukPlus(-20) . "', check_out = '" . $ukPlus(-18) . "' WHERE id = $g42");
$r = http($noJar, 'GET', '/guest-details.php?b=' . $g42 . '&token=' . $g42Tok);
it_check('§42 a week after the stay the link is CLOSED (410), the party unshown', $r['code'] === 410 && strpos($r['raw'], 'Reg Guest Fixed') === false, (string) $r['code']);
// (c) GET cannot fire owner-side work.
$r = http($admin, 'GET', '/push.php?action=test_admin');
it_check('§42 a GET cannot wake every owner device (test push needs a POST)', $r['code'] === 405, $r['raw']);
$r = http($admin, 'GET', '/webp-backfill.php');
it_check('§42 a GET cannot start the image batch', $r['code'] === 405, $r['raw']);
$rootDb->exec("DELETE FROM guest_registrations WHERE booking_id = $g42");
$rootDb->exec("DELETE FROM bookings WHERE id IN ($g42" . ($b42 ? ", $b42" : '') . ')');

// ── §43 round-3 audit: the one-tap email route honours stored terms; a public
//        enquiry is bounded; a reply quotes the agreed price ──
// (a) The owner's one-tap Approve link books the STORED agreed price and plan
//     (the stored-terms fallback lived in the in-app route only).
$e43In = $ukPlus(80); $e43Out = $ukPlus(83);
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message, agreed_price, plan_pct) VALUES ('$propKey','One Tap','onetap43@gmail.com','$e43In','$e43Out',2,0,'Hello',275,35)");
$e43 = (int) $rootDb->lastInsertId();
$own43 = (int) $rootDb->query('SELECT MIN(id) FROM admins')->fetchColumn(); // a link is one person's (§80)
$e43Tok = hash_hmac('sha256', 'enq-action|' . $e43 . '|approve|' . $own43, $SECRET);
$r = $formPost('/enquiry-action.php', ['id' => $e43, 'a' => 'approve', 'p' => $own43, 't' => $e43Tok]);
$b43 = (int) $rootDb->query("SELECT id FROM bookings WHERE email = 'onetap43@gmail.com' ORDER BY id DESC LIMIT 1")->fetchColumn();
$b43Row = $b43 ? $rootDb->query("SELECT price_override, deposit_pct_override FROM bookings WHERE id = $b43")->fetch(PDO::FETCH_ASSOC) : [];
it_check('§43 the one-tap email Approve books the STORED agreed price and plan', $b43 > 0
    && abs((float) ($b43Row['price_override'] ?? 0) - 275.0) < 0.005 && abs((float) ($b43Row['deposit_pct_override'] ?? 0) - 35.0) < 0.005, substr($r['raw'], 0, 200) . ' ' . json_encode($b43Row));
// (b) A public enquiry is bounded: a real date, a sane stay, columns that fit.
$e43Base = ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Bound Test', 'email' => 'bound43@gmail.com', 'adults' => 2, 'children' => 0,
    'address' => '1 High St, Holt', 'postcode' => 'NR25 7AB', 'message' => 'Hi', 'terms_accepted' => 1, 'terms_version' => 'x', 'no_dogs' => 1];
$anon43 = [];
$r = http($anon43, 'POST', '/enquiries.php', $e43Base + ['check_in' => date('Y', strtotime('+1 year')) . '-02-31', 'check_out' => date('Y', strtotime('+1 year')) . '-03-04']);
it_check('§43 a date that does not exist (31 Feb) is refused in words', $r['code'] === 400 && stripos($r['raw'], 'valid dates') !== false, $r['raw']);
$r = http($anon43, 'POST', '/enquiries.php', $e43Base + ['check_in' => $ukPlus(90), 'check_out' => '9999-12-31']);
it_check('§43 a stay of millions of nights is refused (it froze the Inbox)', $r['code'] === 400 && stripos($r['raw'], 'longer than') !== false, $r['raw']);
$r = http($anon43, 'POST', '/enquiries.php', $e43Base + ['check_in' => $ukPlus(900), 'check_out' => $ukPlus(903)]);
it_check('§43 a check-in more than two years out is refused', $r['code'] === 400 && stripos($r['raw'], 'two years') !== false, $r['raw']);
$r = http($anon43, 'POST', '/enquiries.php', $e43Base + ['check_in' => $ukPlus(90), 'check_out' => $ukPlus(93), 'phone' => str_repeat('0', 61)]);
it_check('§43 a phone longer than its column is refused in words, not a 500', $r['code'] === 400 && stripos($r['raw'], 'phone number is too long') !== false, $r['raw']);
// (c) The reply preview to an enquirer quotes the AGREED price, not the standard one.
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message, agreed_price) VALUES ('$propKey','Reply Quote','reply43@gmail.com','$e43In','$e43Out',2,0,'Hello',199)");
$e43r = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'email_preview', 'id' => $e43r, 'message' => 'Lovely to hear from you.', 'subject' => 'Your stay']);
$prev43 = (string) ($r['json']['html'] ?? $r['raw']) . (string) ($r['json']['text'] ?? '');
it_check('§43 the reply quotes the agreed £199.00 and says so', strpos($prev43, '199.00') !== false && stripos($prev43, 'agreed price') !== false, substr($prev43, 0, 300));
$rootDb->exec("DELETE FROM enquiries WHERE id IN ($e43, $e43r)");
if ($b43) {
    $rootDb->exec("DELETE FROM bookings WHERE id = $b43");
}

// ── §44 round-4 audit: cash and bank money is a dated ledger fact ──
// (a) Each manual receipt is its own dated row, so a cash deposit in one tax
//     year and a transfer in the next land in their own years (one cumulative
//     figure with one date put the whole stay in the later year).
$c44In = $ukPlus(120); $c44Out = $ukPlus(124);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee, hold_status) VALUES ('$propKey','Cash Split','cash44@gmail.com','$c44In','$c44Out',2,0,'unpaid',0,600,600,0,4,75,'none')");
$c44 = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $c44, 'payment' => 'deposit', 'deposit' => 200, 'payment_date' => '2026-03-30', 'payment_method' => 'Cash']);
it_check('§44 (fixture) a £200 cash deposit records', $r['code'] === 200, $r['raw']);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $c44, 'payment' => 'paid', 'payment_date' => '2026-04-10', 'payment_method' => 'Bank transfer']);
$m44 = $rootDb->query("SELECT DATE(created_at) d, amount FROM payments WHERE booking_id = $c44 AND kind = 'manual' ORDER BY created_at")->fetchAll(PDO::FETCH_ASSOC);
it_check('§44 each manual receipt is its own dated ledger row (£200 on 30/03, £400 on 10/04)', count($m44) === 2
    && $m44[0]['d'] === '2026-03-30' && abs((float) $m44[0]['amount'] - 200) < 0.005
    && $m44[1]['d'] === '2026-04-10' && abs((float) $m44[1]['amount'] - 400) < 0.005, json_encode($m44));
$inYr = function ($year, $bid) use ($acctGet) {
    return array_sum(array_map(fn($p) => (float) $p['income_part'], array_filter($acctGet($year)['json']['payments'] ?? [], fn($p) => (int) $p['id'] === $bid)));
};
it_check('§44 the March cash deposit stays in 2025/26 (£200)', abs($inYr(2025, $c44) - 200.0) < 0.005, (string) $inYr(2025, $c44));
it_check('§44 …the April transfer is 2026/27 (£400), not the whole stay', abs($inYr(2026, $c44) - 400.0) < 0.005, (string) $inYr(2026, $c44));
// (b) A cash booking can be cancelled WITH a refund (the cap read the empty card
//     ledger and refused every one), and the money kept stays on the books.
it_reauth($admin);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $c44, 'refund_amount' => 100, 'reason' => 'Plans changed']);
it_check('§44 a cash booking cancels with a £100 refund (no "Only £0.00 is refundable")', $r['code'] === 200 && ($r['json']['ok'] ?? false) === true, $r['raw']);
$kept44 = $inYr(2025, $c44) + $inYr(2026, $c44);
it_check('§44 …and the £500 kept stays income after the hard delete', abs($kept44 - 500.0) < 0.005, (string) $kept44);
// (c) A PART deposit return with a reason settles the rest as kept: no duty
//     left open, the remainder booked once as kept income.
$p44In = $ukPlus(-6); $p44Out = $ukPlus(-3);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee, hold_status, payment_method, payment_date) VALUES ('$propKey','Part Keep','part44@gmail.com','$p44In','$p44Out',2,0,'paid',375,300,300,0,3,75,'none','Cash','$p44In')");
$p44 = (int) $rootDb->lastInsertId();
it_reauth($admin);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'return_deposit', 'id' => $p44, 'amount' => 50, 'note' => 'Broken lamp']);
$hs44 = (string) $rootDb->query("SELECT hold_status FROM bookings WHERE id = $p44")->fetchColumn();
$keptRow44 = (float) $rootDb->query("SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = $p44 AND kind = 'damages' AND square_payment_id LIKE 'kept-%'")->fetchColumn();
it_check('§44 a part return WITH a reason settles the deposit (kept) and books the £25 rest once', $r['code'] === 200 && $hs44 === 'kept' && abs($keptRow44 - 25.0) < 0.005, $r['raw'] . ' hs=' . $hs44 . ' kept=' . $keptRow44);
// (d) The invoice for a cash booking with a deposit-return row still lists the
//     cash that paid the stay (it dropped it once ANY ledger row existed).
$inv44 = http($noJar, 'GET', '/invoice.php?b=' . $p44 . '&token=' . substr(hash_hmac('sha256', 'invoice:' . $p44, $SECRET), 0, 32));
it_check('§44 the invoice lists the cash receipt beside the deposit return', $inv44['code'] === 200 && preg_match('/Received[^<]{0,40}cash/i', $inv44['raw']) === 1, substr(strip_tags($inv44['raw']), 0, 300));
// (e) A correction DOWN shrinks the manual rows (a £700 typed by mistake must
//     not stay on the ledger, the invoice or a later cancellation's income).
$e44In = $ukPlus(130); $e44Out = $ukPlus(133);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee, hold_status) VALUES ('$propKey','Typo Cash','typo44@gmail.com','$e44In','$e44Out',2,0,'unpaid',0,700,700,0,3,50,'none')");
$e44 = (int) $rootDb->lastInsertId();
http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $e44, 'payment' => 'paid', 'payment_date' => $ukToday, 'payment_method' => 'Cash']);
http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $e44, 'payment' => 'unpaid']);
$left44 = (float) $rootDb->query("SELECT COALESCE(SUM(amount),0) FROM payments WHERE booking_id = $e44 AND kind = 'manual'")->fetchColumn();
it_check('§44 setting a cash booking back to Unpaid removes its manual receipt rows', abs($left44) < 0.005, (string) $left44);
// (f) A CARD payment typed in by hand writes no manual twin (the card row is booked elsewhere).
http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $e44, 'payment' => 'paid', 'payment_date' => $ukToday, 'payment_method' => 'Card (terminal)']);
$card44 = (int) $rootDb->query("SELECT COUNT(*) FROM payments WHERE booking_id = $e44 AND kind = 'manual'")->fetchColumn();
it_check('§44 a card payment recorded by hand writes no manual ledger twin', $card44 === 0, (string) $card44);
// (g) The cash cancel cap is the RENTAL received — the deposit is owed back on its own.
http($admin, 'POST', '/bookings.php', ['action' => 'set_payment', 'id' => $e44, 'payment' => 'paid', 'payment_date' => $ukToday, 'payment_method' => 'Cash', 'deposit_collected' => 1]);
it_reauth($admin);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $e44, 'refund_amount' => 750]);
it_check('§44 a cash refund cannot include the deposit (capped at the £700 rental)', $r['code'] === 400 && strpos($r['raw'], '700.00') !== false, $r['raw']);
$rootDb->exec("DELETE FROM payments WHERE booking_id = $e44");
$rootDb->exec("DELETE FROM bookings WHERE id = $e44");
$rootDb->exec("DELETE FROM payments WHERE booking_id IN ($c44, $p44)");
$rootDb->exec("DELETE FROM bookings WHERE id = $p44");

echo "\n== §45 Guests: the owner sends a reset link, never a password ==\n";
// The owner-set password is GONE: the action no longer exists.
$r = http($admin, 'POST', '/auth.php', ['action' => 'guest_reset_password', 'email' => 'ks@gmail.com', 'next' => 'ownerchose1']);
it_check('§45 the owner can no longer set a guest password', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/auth.php', ['action' => 'guest_send_reset', 'email' => 'nobody-here@gmail.com']);
it_check('§45 a reset link for an address with no account is refused in words', $r['code'] === 404 && strpos($r['raw'], 'no account') !== false, $r['raw']);
$r = http($noJar, 'POST', '/auth.php', ['action' => 'guest_send_reset', 'email' => 'ks@gmail.com']);
it_check('§45 a signed-out caller cannot send one', $r['code'] === 401 || $r['code'] === 403, $r['raw']);
// MAIL_ENABLED is off here, so the send itself answers 500 — and logs nothing,
// which is what keeps the one-a-minute guard from refusing a send that never went.
$r = http($admin, 'POST', '/auth.php', ['action' => 'guest_send_reset', 'email' => 'ks@gmail.com']);
$rl45 = (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'guest.reset_link'")->fetchColumn();
it_check('§45 a send the mailer refused is reported as a failure and not logged', $r['code'] === 500 && $rl45 === 0, $r['raw']);
// The guest side: a RESET link opens a window to choose a password with no current one.
$rsJar = [];
$rsId = (int) $rootDb->query("SELECT id FROM guests WHERE email = 'ks@gmail.com'")->fetchColumn();
$rootDb->exec("UPDATE guests SET password_hash = '" . password_hash('oldpassword9', PASSWORD_DEFAULT) . "', email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $rsId");
$rsTs = time() + 2;
$rsTok = substr(hash_hmac('sha256', 'login:' . $rsId . ':' . $rsTs, $SECRET), 0, 32);
// An ordinary sign-in link does NOT open the window.
$plainJar = [];
$pTs = time() + 1;
$r = http($plainJar, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $rsId, 'ts' => $pTs, 'token' => substr(hash_hmac('sha256', 'login:' . $rsId . ':' . $pTs, $SECRET), 0, 32)]);
it_check('§45 (fixture) an ordinary sign-in link signs in', ($r['json']['ok'] ?? false) === true && empty($r['json']['choose_password']), $r['raw']);
$r = http($plainJar, 'POST', '/auth.php', ['action' => 'guest_change_password', 'current' => '', 'next' => 'hijacked99']);
it_check('§45 …and a plain sign-in still needs the current password to change it', $r['code'] === 403, $r['raw']);
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $rsId, 'ts' => $rsTs, 'token' => $rsTok, 'reset' => true]);
it_check('§45 a reset link signs in and asks for a new password', ($r['json']['ok'] ?? false) === true && ($r['json']['choose_password'] ?? false) === true, $r['raw']);
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_change_password', 'current' => '', 'next' => 'freshpass42']);
it_check('§45 …the guest chooses it themselves, no old password needed', ($r['json']['ok'] ?? false) === true, $r['raw']);
$h45 = (string) $rootDb->query("SELECT password_hash FROM guests WHERE id = $rsId")->fetchColumn();
it_check('§45 …and it is THEIR password that is stored', password_verify('freshpass42', $h45), '');
// A SIGNED-IN GUEST may ask for a reset link — only ever to their OWN address: the
// body's email is ignored, so naming a stranger reaches the guest's own account
// (the mailer is off here, hence 500 — a 404 would mean the stranger was looked up).
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_send_reset', 'email' => 'nobody-here@gmail.com']);
it_check('§45 a guest\'s own reset link goes to their own address, whatever the body says', $r['code'] === 500, $r['raw']);
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_change_password', 'current' => '', 'next' => 'againpass77']);
it_check('§45 one reset per link: a second blank-current change is refused', $r['code'] === 403, $r['raw']);
// The CRM carries when a guest was last invited back, so the page remembers it.
$r = http($admin, 'POST', '/auth.php', ['action' => 'guest_crm']);
$g45 = $r['json']['guests'][0] ?? [];
it_check('§45 the guest list says when each guest was last invited back', array_key_exists('invited_at', $g45), $r['raw']);

echo "\n== §46 Status: the week judged, the vitals traced ==\n";
$rootDb->exec("DELETE FROM activity_log WHERE action IN ('csp.violation','email.gaveup') AND summary LIKE '§46%'");
$rootDb->exec("INSERT INTO activity_log (category, action, summary, severity, actor) VALUES ('system','csp.violation','§46 blocked','warn','test'), ('system','csp.violation','§46 blocked','warn','test'), ('email','email.gaveup','§46 gave up','warn','test')");
$rootDb->prepare("REPLACE INTO content (item_key, item_value) VALUES ('mail-sent-days', ?)")->execute([json_encode(json_encode([date('Y-m-d') => 7]))]);
$r = http($admin, 'POST', '/diagnostics.php', ['action' => 'run']);
$in46 = $r['json']['insights'] ?? [];
$wk = $in46['week'] ?? [];
$csp = array_values(array_filter($wk['groups'] ?? [], fn($g) => $g['action'] === 'csp.violation'))[0] ?? [];
$gave = array_values(array_filter($wk['groups'] ?? [], fn($g) => $g['action'] === 'email.gaveup'))[0] ?? [];
it_check('§46 the week has seven days ending today', count($wk['days'] ?? []) === 7 && ($wk['days'][6]['date'] ?? '') === date('Y-m-d'), $r['raw']);
it_check('§46 warnings are grouped and judged — a blocked script needs nothing', ($csp['n'] ?? 0) >= 2 && ($csp['needs'] ?? true) === false, json_encode($csp));
it_check('§46 …and an email that gave up needs the owner, and leads', ($gave['needs'] ?? false) === true && ($wk['groups'][0]['needs'] ?? false) === true, json_encode($wk['groups'] ?? []));
it_check('§46 the daily jobs and calendars carry a seven-day trace', count($in46['automation']['days'] ?? []) === 7 && count($in46['ical']['days'] ?? []) === 7, $r['raw']);
it_check('§46 email counts what left, per day', ($in46['email']['sent7d'] ?? 0) >= 7 && count($in46['email']['days'] ?? []) === 7, json_encode($in46['email'] ?? null));
it_check('§46 every calendar feed is listed', is_array($in46['ical']['list'] ?? null), $r['raw']);
it_check('§46 the newest backup and the storage growth are reported', array_key_exists('backup', $in46) && array_key_exists('grew30d', $in46['storage'] ?? []), $r['raw']);
$anon46 = [];
$r = http($anon46, 'GET', '/content.php');
it_check('§46 the sent count is never public', strpos($r['raw'], 'mail-sent-days') === false, '');
$rootDb->exec("DELETE FROM activity_log WHERE summary LIKE '§46%'");

echo "\n== §47 Activity log: the week, what needs a look, and Seen it ==\n";
$rootDb->exec("DELETE FROM activity_log WHERE summary LIKE '§47%'");
$rootDb->exec("DELETE FROM content WHERE item_key = 'activity-seen'");
$rootDb->exec("INSERT INTO activity_log (category, action, summary, severity, actor) VALUES ('email','email.gaveup','§47 gave up','warn','test'), ('system','csp.violation','§47 blocked','warn','test')");
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'summary']);
$s47 = $r['json'] ?? [];
$techs47 = fn($needs) => array_column((array) $needs, 'tech');
$need47 = array_values(array_filter($s47['needs'] ?? [], fn($n) => ($n['tech'] ?? '') === '§47 gave up'));
it_check('§47 the summary carries seven days ending today', count($s47['days'] ?? []) === 7 && ($s47['days'][6]['date'] ?? '') === date('Y-m-d'), $r['raw']);
it_check('§47 an email that gave up needs a look; a blocked script does not', count($need47) === 1 && !in_array('§47 blocked', $techs47($s47['needs'] ?? []), true), $r['raw']);
$ids47 = $need47[0]['ids'] ?? [];
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'seen', 'ids' => $ids47]);
it_check('§47 Seen it is stored', ($r['json']['ok'] ?? false) === true && count($ids47) > 0, $r['raw']);
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'summary']);
it_check('§47 …and a seen warning no longer needs a look', !in_array('§47 gave up', $techs47($r['json']['needs'] ?? []), true), $r['raw']);
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'seen', 'ids' => []]);
it_check('§47 marking nothing is refused in words', $r['code'] === 400, $r['raw']);
$anon47 = [];
$r = http($anon47, 'POST', '/activity-log.php', ['action' => 'summary']);
it_check('§47 a visitor cannot read the summary', $r['code'] === 401, $r['raw']);
$r = http($anon47, 'GET', '/content.php');
it_check('§47 what the owner has seen is never public', strpos($r['raw'], 'activity-seen') === false, '');
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'list', 'category' => 'all', 'q' => '§47', 'limit' => 50]);
it_check('§47 rows carry their id and plain title', isset($r['json']['events'][0]['id']) && array_key_exists('action', $r['json']['events'][0] ?? []), $r['raw']);
$rootDb->exec("DELETE FROM activity_log WHERE summary LIKE '§47%'");

echo "\n== §48 A guest's profile photo: their own, seen by them and the owner only ==\n";
$avIm = imagecreatetruecolor(400, 300);
imagefilledrectangle($avIm, 0, 0, 399, 299, imagecolorallocate($avIm, 80, 110, 100));
ob_start();
imagejpeg($avIm, null, 90);
$avData = 'data:image/jpeg;base64,' . base64_encode((string) ob_get_clean());
$r = http($noJar, 'POST', '/auth.php', ['action' => 'guest_avatar_set', 'data' => $avData]);
it_check('§48 a signed-out caller cannot set one', $r['code'] === 401, $r['raw']);
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_avatar_set', 'data' => 'data:image/png;base64,iVBORw0KGgo=']);
it_check('§48 a non-JPEG is refused in words', $r['code'] === 400 && strpos($r['raw'], 'photo') !== false, $r['raw']);
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_avatar_set', 'data' => $avData]);
$avV = (string) ($r['json']['avatar'] ?? '');
it_check('§48 the guest sets their own photo and is told only a version', ($r['json']['ok'] ?? false) === true && preg_match('/^[a-f0-9]{10}$/', $avV) === 1, $r['raw']);
$avName = (string) $rootDb->query("SELECT avatar FROM guests WHERE email = 'ks@gmail.com'")->fetchColumn();
it_check('§48 the stored file is the re-encoded 256px square', $avName !== '' && is_file($work . '/uploads/avatars/' . $avName) && (getimagesize($work . '/uploads/avatars/' . $avName)[0] ?? 0) === 256, $avName);
it_check('§48 the folder denies direct access', is_file($work . '/uploads/avatars/.htaccess'), '');
$r = http($rsJar, 'GET', '/avatar.php?v=' . $avV);
it_check('§48 the guest is served their own photo', $r['code'] === 200 && substr($r['raw'], 0, 2) === "\xFF\xD8", (string) $r['code']);
$r = http($noJar, 'GET', '/avatar.php');
it_check('§48 nobody else is', $r['code'] === 401, (string) $r['code']);
$r = http($admin, 'GET', '/avatar.php?email=ks%40gmail.com');
it_check('§48 the owner reads it by the guest\'s email', $r['code'] === 200 && substr($r['raw'], 0, 2) === "\xFF\xD8", (string) $r['code']);
$rootDb->exec("UPDATE guests SET email_verified_at = NULL WHERE email = 'ks@gmail.com'");
$r = http($admin, 'GET', '/avatar.php?email=ks%40gmail.com');
it_check('§48 an UNCONFIRMED account\'s photo is never shown to the owner as that guest\'s', $r['code'] === 404, (string) $r['code']);
$rootDb->exec("UPDATE guests SET email_verified_at = NOW() WHERE email = 'ks@gmail.com'");
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_status']);
it_check('§48 the session reports the version', ($r['json']['guest']['avatar'] ?? '') === $avV, $r['raw']);
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_export_data']);
it_check('§48 "Download my data" includes the photo itself', strpos((string) ($r['json']['data']['profile_photo'] ?? ''), 'data:image/jpeg;base64,/9j/') === 0, substr($r['raw'], 0, 120));
// A tiny file that declares a vast canvas is refused BEFORE GD allocates it.
$bomb = imagecreatetruecolor(3000, 16);
ob_start();
imagejpeg($bomb, null, 10);
$bombData = 'data:image/jpeg;base64,' . base64_encode((string) ob_get_clean());
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_avatar_set', 'data' => $bombData]);
it_check('§48 an oversized canvas is refused (no decompression bomb)', $r['code'] === 400, $r['raw']);
// An orphaned file (a raced replace) is swept by self-repair after a day; a live one is kept.
$orphan = $work . '/uploads/avatars/' . str_repeat('ab', 16) . '.jpg';
file_put_contents($orphan, 'x');
touch($orphan, time() - 2 * 86400);
touch($work . '/uploads/avatars/' . $avName, time() - 2 * 86400);
http($noJar, 'GET', '/self-repair.php?cron=' . $SECRET);
it_check('§48 self-repair removes an unused photo file and keeps the live one', !is_file($orphan) && is_file($work . '/uploads/avatars/' . $avName), '');
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'guest_avatar_remove']);
clearstatcache(); // PHP caches the last stat — this file was just checked above
it_check('§48 removing it deletes the file', ($r['json']['ok'] ?? false) === true && !is_file($work . '/uploads/avatars/' . $avName), $r['raw']);
$r = http($rsJar, 'GET', '/avatar.php');
it_check('§48 and then there is nothing to serve', $r['code'] === 404, (string) $r['code']);

echo "\n== §49 Things to do are for guests who have booked ==\n";
$rootDb->exec("INSERT INTO experiences (title, body, status) VALUES ('§49 Seal trip', 'Out to the Point.', 'published')");
$r = http($noJar, 'GET', '/experiences.php');
it_check('§49 a visitor is refused, in words, with the code the page reads', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'stays_only' && strpos($r['raw'], '§49') === false, $r['raw']);
$r = http($noJar, 'POST', '/experiences.php', ['action' => 'list']);
it_check('§49 …through the POST door too', $r['code'] === 403 && strpos($r['raw'], '§49') === false, $r['raw']);
$r = http($admin, 'GET', '/experiences.php');
it_check('§49 the owner sees the list', $r['code'] === 200 && strpos($r['raw'], '§49 Seal trip') !== false, substr($r['raw'], 0, 120));
$nbJar = [];
$r = http($nbJar, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Not Booked', 'email' => 'notbooked49@gmail.com', 'password' => 'longenough1', 'address' => '1 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$rootDb->exec("UPDATE guests SET email_verified_at = NOW() WHERE email = 'notbooked49@gmail.com'");
$r = http($nbJar, 'POST', '/auth.php', ['action' => 'guest_login', 'email' => 'notbooked49@gmail.com', 'password' => 'longenough1']);
it_check('§49 (the guest is signed in, so the next refusal is about bookings)', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($nbJar, 'GET', '/experiences.php');
it_check('§49 a signed-in guest who has never booked is refused', $r['code'] === 403 && strpos($r['raw'], '§49') === false, $r['raw']);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Not Booked','notbooked49@gmail.com','2024-03-01','2024-03-04',2,0,'paid',300,300,300,0,3)");
$r = http($nbJar, 'GET', '/experiences.php');
it_check('§49 …and sees it once a booking (even a past one) is theirs', $r['code'] === 200 && strpos($r['raw'], '§49 Seal trip') !== false, $r['raw']);
$rootDb->exec("UPDATE guests SET email_verified_at = NULL WHERE email = 'notbooked49@gmail.com'");
$r = http($nbJar, 'GET', '/experiences.php');
it_check('§49 an account that has not proven its address is refused even with a booking', $r['code'] === 403, $r['raw']);
$r = http($noJar, 'GET', '/experiences-page.php');
it_check('§49 /experiences no longer renders the list for crawlers', $r['code'] === 200 && strpos($r['raw'], '§49 Seal trip') === false, (string) $r['code']);
$r = http($noJar, 'GET', '/sitemap.php');
it_check('§49 …and the sitemap no longer lists it', strpos($r['raw'], '/experiences<') === false, '');
// A place's photo is painted as CSS url('…') inside a style attribute, where HTML
// escaping cannot stop a quote ending the url() (exp_safe_image).
$r = http($admin, 'POST', '/experiences.php', ['action' => 'save', 'title' => '§49 Bad photo', 'image_url' => "uploads/a.jpg') ;background:red"]);
it_check('§49 a photo address that could break out of its url() is refused', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/experiences.php', ['action' => 'save', 'title' => '§49 Good photo', 'image_url' => 'uploads/seal-trip.jpg']);
it_check('§49 …the uploader\'s own path saves', $r['code'] === 200, $r['raw']);
$rootDb->exec("INSERT INTO experiences (title, body, image_url, status) VALUES ('§49 Stored bad', '', 'https://x.com/a.jpg'') ;x:y', 'published')");
$r = http($admin, 'GET', '/experiences.php');
$stored = array_values(array_filter($r['json']['experiences'] ?? [], fn($x) => is_array($x) && ($x['title'] ?? '') === '§49 Stored bad'));
it_check('§49 …and one already stored is served as no photo', $stored && ($stored[0]['image'] ?? null) === '', json_encode($stored));
$rootDb->exec("DELETE FROM experiences WHERE title LIKE '§49%'");
$rootDb->exec("DELETE FROM bookings WHERE email = 'notbooked49@gmail.com'");
$rootDb->exec("DELETE FROM guests WHERE email = 'notbooked49@gmail.com'");

echo "\n== §50 The code-first sign-in ==\n";
$cHash = fn($email, $code) => hash_hmac('sha256', 'code:' . strtolower($email) . ':' . $code, $SECRET);
$cSet = function ($email, $code) use ($rootDb, $cHash, $DB_NAME) {
    $rootDb->prepare("UPDATE `$DB_NAME`.guest_codes SET code_hash = ? WHERE email = ? AND used_at IS NULL")->execute([$cHash($email, $code), $email]);
};
$rootDb->exec("USE `$DB_NAME`");
$newJar = [];
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'Newbie50@Gmail.com']);
$known = http($noJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'ks@gmail.com']);
// srv is the server's clock, which can tick between the two requests on a loaded
// machine; everything else must be identical (§56's rule).
$noSrv = fn($x) => json_encode(array_diff_key((array) ($x['json'] ?? []), ['srv' => 1]));
it_check('§50 asking for a code answers the same whether or not an account exists', $r['code'] === 200 && $known['code'] === 200 && $noSrv($r) === $noSrv($known) && ($r['json']['ok'] ?? false) === true, $r['raw'] . ' / ' . $known['raw']);
$row = $rootDb->query("SELECT code_hash, expires_at > NOW() AS live, used_at FROM guest_codes WHERE email = 'newbie50@gmail.com' ORDER BY id DESC LIMIT 1")->fetch();
it_check('§50 the code is stored only as a hash, alive for 30 minutes', $row && strlen($row['code_hash']) === 64 && (int) $row['live'] === 1 && $row['used_at'] === null, json_encode($row));
$cSet('newbie50@gmail.com', '135790');
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'newbie50@gmail.com', 'code' => '000000']);
it_check('§50 a wrong code is refused in words, with the tries left', $r['code'] === 401 && ($r['json']['code'] ?? '') === 'wrong' && ($r['json']['left'] ?? 0) === 4, $r['raw']);
for ($i = 0; $i < 3; $i++) {
    http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'newbie50@gmail.com', 'code' => '00000' . $i]);
}
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'newbie50@gmail.com', 'code' => '000009']);
it_check('§50 the fifth wrong try retires the code', $r['code'] === 429 && ($r['json']['code'] ?? '') === 'too_many', $r['raw']);
$rootDb->exec("DELETE FROM login_attempts WHERE identifier LIKE 'code%'"); // the sign-in throttle would also refuse; prove the CODE is dead
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'newbie50@gmail.com', 'code' => '135790']);
it_check('§50 …and the right code no longer works after that', $r['code'] === 401 && ($r['json']['code'] ?? '') === 'expired', $r['raw']);
$rootDb->exec("DELETE FROM login_attempts WHERE identifier LIKE 'code%'");
http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'newbie50@gmail.com']);
$cSet('newbie50@gmail.com', '246801');
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_register', 'name' => 'Sneaky']);
it_check('§50 no account can be made before a code is confirmed', $r['code'] === 401, $r['raw']);
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'newbie50@gmail.com', 'code' => '246801']);
it_check('§50 the right code for a new email asks only for a name', $r['code'] === 200 && ($r['json']['new'] ?? false) === true, $r['raw']);
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_register', 'name' => 'Nina Newbie']);
$g50 = $rootDb->query("SELECT name, email_verified_at, password_hash, address FROM guests WHERE email = 'newbie50@gmail.com'")->fetch();
it_check('§50 …and the account is created CONFIRMED, with no password and no address yet', $r['code'] === 200 && ($r['json']['guest']['name'] ?? '') === 'Nina Newbie' && $g50 && $g50['email_verified_at'] !== null && $g50['password_hash'] === '' && (string) $g50['address'] === '', $r['raw'] . json_encode($g50));
$r = http($newJar, 'GET', '/my-bookings.php');
it_check('§50 …signed in and proven (no "confirm your email" limbo)', $r['code'] === 200 && empty($r['json']['unproven']), $r['raw']);
$r = http($newJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'newbie50@gmail.com', 'code' => '246801']);
it_check('§50 a code works once', $r['code'] === 401, $r['raw']);
// A squatter registered a guest's email with a password; the real guest's CODE ends that claim.
$sqJar = [];
http($sqJar, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Squatter', 'email' => 'claim50@gmail.com', 'password' => 'squatpass1', 'address' => '1 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Real Guest','claim50@gmail.com','2024-03-01','2024-03-04',2,0,'paid',300,300,300,0,3)");
$realJar = [];
http($realJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'claim50@gmail.com']);
$cSet('claim50@gmail.com', '112358');
$r = http($realJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'claim50@gmail.com', 'code' => '112358']);
$c50 = $rootDb->query("SELECT password_hash, email_verified_at FROM guests WHERE email = 'claim50@gmail.com'")->fetch();
it_check('§50 a code from another browser proves the address and clears a squatter\'s password', $r['code'] === 200 && ($r['json']['reset'] ?? false) === true && $c50['password_hash'] === '' && $c50['email_verified_at'] !== null, $r['raw']);
$r = http($sqJar, 'GET', '/my-bookings.php');
it_check('§50 …and the squatter\'s session is signed out', $r['code'] === 401, $r['raw']);
$r = http($realJar, 'GET', '/my-bookings.php');
it_check('§50 …while the real guest sees their stay', $r['code'] === 200 && count($r['json']['bookings'] ?? []) === 1, substr($r['raw'], 0, 120));
// A CODE IS A WHOLE SIGN-IN, so a DAY's wrong guesses from every IP are capped: at
// ten, codes for that address pause, the right one included, and no new one is
// sent. Ten rows from ten other IPs stand in for a distributed guesser (one IP is
// stopped at five by throttle_check before the day's count matters).
$rootDb->exec("DELETE FROM login_attempts WHERE identifier LIKE 'code%'");
$capJar = [];
http($capJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'cap50@gmail.com']);
$cSet('cap50@gmail.com', '808080');
$capIns = $rootDb->prepare("INSERT INTO login_attempts (ip, identifier, success) VALUES (?, 'codev:cap50@gmail.com', 0)");
for ($i = 0; $i < 10; $i++) {
    $capIns->execute(['10.9.0.' . $i]);
}
$r = http($capJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'cap50@gmail.com', 'code' => '808080']);
it_check('§50 ten wrong codes in a day, from anywhere, pause the address — the right code included', $r['code'] === 429 && ($r['json']['code'] ?? '') === 'paused', $r['raw']);
$r = http($capJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'cap50@gmail.com']);
it_check('§50 …and no new code is sent to it until the day is out', $r['code'] === 429 && ($r['json']['code'] ?? '') === 'paused' && (int) $rootDb->query("SELECT COUNT(*) FROM guest_codes WHERE email = 'cap50@gmail.com'")->fetchColumn() === 1, $r['raw']);
$rootDb->exec("DELETE FROM login_attempts WHERE identifier = 'codev:cap50@gmail.com' AND ip = '10.9.0.9'");
$r = http($capJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'cap50@gmail.com', 'code' => '808080']);
it_check('§50 …while nine is still under the line', $r['code'] === 200 && ($r['json']['new'] ?? false) === true, $r['raw']);
$rootDb->exec("DELETE FROM login_attempts WHERE identifier LIKE 'code%'");
$rootDb->exec("DELETE FROM bookings WHERE email = 'claim50@gmail.com'");
$rootDb->exec("DELETE FROM guests WHERE email IN ('claim50@gmail.com', 'newbie50@gmail.com')");
$rootDb->exec("DELETE FROM guest_codes");

echo "\n== §51 People: separate sign-ins, and what each person can do ==\n";
// A second person signs in with their own password; the server — not the screens —
// holds them to the areas switched on for them. MAIL_ENABLED is off here, so an
// invite or reset is driven by writing a KNOWN token's hash, exactly what the
// emailed link would carry.
$rootDb->exec("USE `$DB_NAME`");
$ownerId = (int) $rootDb->query("SELECT MIN(id) FROM admins")->fetchColumn();
$r = http($admin, 'POST', '/auth.php', ['action' => 'admin_status']);
it_check('§51 the owner is told who they are: full access, the first owner', ($r['json']['me']['full'] ?? null) === true && ($r['json']['me']['original'] ?? null) === true && ($r['json']['me']['id'] ?? 0) === $ownerId, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'invite', 'name' => 'Sophia Hart', 'email' => 'not-an-email']);
it_check('§51 an invite to something that is not an email is refused in words', $r['code'] === 400 && strpos((string) ($r['json']['error'] ?? ''), 'email') !== false, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'invite', 'name' => 'Sophia Hart', 'email' => 'Sophia51@Example.com']);
$sId = (int) ($r['json']['id'] ?? 0);
$sRow = $rootDb->query("SELECT * FROM admins WHERE id = $sId")->fetch();
it_check('§51 inviting someone adds them, waiting for their own password', $r['code'] === 200 && $sId > 0 && count($r['json']['people'] ?? []) === 2 && $sRow['password_hash'] === '' && $sRow['invited_at'] !== null && strlen((string) $sRow['invite_hash']) === 64, $r['raw']);
// Permissions: a new person is a plain HOST — perms stored as the difference from a
// Host, so '{}' — never a Super User unless the invite said so.
it_check('§51 …as a plain Host: no differences stored, not a Super User', (int) $sRow['full_access'] === 0 && $sRow['perms'] === '{}' && $sRow['email'] === 'sophia51@example.com' && $sRow['username'] === 'sophiahart', json_encode($sRow));
$r = http($admin, 'POST', '/people.php', ['action' => 'invite', 'name' => 'Someone Else', 'email' => 'sophia51@example.com']);
it_check('§51 an email that already has a sign-in is refused', $r['code'] === 409, $r['raw']);
// The first sign-in carries the config owner address until its owner sets their
// own, so inviting whoever used to share that address meets your OWN row.
$r = http($admin, 'POST', '/auth.php', ['action' => 'admin_status']);
$ownContact = (string) ($r['json']['me']['contact'] ?? '');
$r = http($admin, 'POST', '/people.php', ['action' => 'invite', 'name' => 'Shared Inbox', 'email' => $ownContact]);
it_check('§51 inviting the email on your own sign-in says so, and where to change it', $ownContact !== '' && $r['code'] === 409 && strpos((string) ($r['json']['error'] ?? ''), 'your own sign-in') !== false, $ownContact . ' ' . $r['raw']);
// The invite link: id.token, only the hash kept.
$tok = str_repeat('5a', 24);
$rootDb->prepare('UPDATE admins SET invite_hash = ? WHERE id = ?')->execute([hash('sha256', $tok), $sId]);
$soph = [];
$r = http($soph, 'POST', '/auth.php', ['action' => 'admin_link_check', 'kind' => 'invite', 'link' => "$sId.$tok"]);
it_check('§51 the invite link greets the person by name and shows their username', $r['code'] === 200 && ($r['json']['first'] ?? '') === 'Sophia' && ($r['json']['username'] ?? '') === 'sophiahart', $r['raw']);
it_check('§51 …and the address they sign in with (the page files the new password under it)', ($r['json']['email'] ?? '') === 'sophia51@example.com', $r['raw']);
$r = http($soph, 'POST', '/auth.php', ['action' => 'admin_link_check', 'kind' => 'invite', 'link' => "$sId." . str_repeat('5b', 24)]);
it_check('§51 a wrong token is a dead link, said in words', $r['code'] === 410 && strpos((string) ($r['json']['error'] ?? ''), 'invite link') !== false, $r['raw']);
$r = http($soph, 'POST', '/auth.php', ['action' => 'admin_invite_accept', 'link' => "$sId.$tok", 'password' => 'short', 'again' => 'short']);
it_check('§51 a short password is refused, with the length', $r['code'] === 400 && strpos((string) ($r['json']['error'] ?? ''), '12 characters') !== false, $r['raw']);
$r = http($soph, 'POST', '/auth.php', ['action' => 'admin_invite_accept', 'link' => "$sId.$tok", 'password' => 'sophias own passphrase', 'again' => 'sophias other phrase']);
it_check('§51 two that do not match are refused', $r['code'] === 400, $r['raw']);
$r = http($soph, 'POST', '/auth.php', ['action' => 'admin_invite_accept', 'link' => "$sId.$tok", 'password' => 'sophias own passphrase', 'again' => 'sophias own passphrase']);
$sRow = $rootDb->query("SELECT * FROM admins WHERE id = $sId")->fetch();
it_check('§51 choosing a password signs them in, as themselves, limited', $r['code'] === 200 && ($r['json']['me']['id'] ?? 0) === $sId && ($r['json']['me']['full'] ?? true) === false, $r['raw']);
it_check('§51 …the invite is used up and the password is theirs', $sRow['invited_at'] === null && $sRow['invite_hash'] === null && password_verify('sophias own passphrase', $sRow['password_hash']), json_encode($sRow));
$r = http($guest, 'POST', '/auth.php', ['action' => 'admin_invite_accept', 'link' => "$sId.$tok", 'password' => 'another passphrase!', 'again' => 'another passphrase!']);
it_check('§51 the link works once', $r['code'] === 410, $r['raw']);
// What a limited person may and may not do — refused BY THE SERVER, in words.
$refused = function ($res) {
    return $res['code'] === 403 && ($res['json']['code'] ?? '') === 'not_allowed' && ($res['json']['error'] ?? '') === 'That’s for Owner to change.';
};
// A plain Host has the money permissions; the owner takes two away, and the server
// holds her to it on the very next request.
http($admin, 'POST', '/people.php', ['action' => 'set_perm', 'id' => $sId, 'perm' => 'mo.view', 'on' => false]);
http($admin, 'POST', '/people.php', ['action' => 'set_perm', 'id' => $sId, 'perm' => 'mo.refund', 'on' => false]);
it_check('§51 the Payments screens need See the money', $refused(http($soph, 'GET', '/accounts.php')), '');
$r = http($soph, 'POST', '/bookings.php', ['action' => 'refund', 'id' => 1, 'amount' => 10]);
it_check('§51 a refund needs Refunds (refused before any money moves)', $refused($r), $r['raw']);
it_check('§51 People & access is full access only', $refused(http($soph, 'POST', '/people.php', ['action' => 'list'])), '');
it_check('§51 the system check is full access only', $refused(http($soph, 'POST', '/diagnostics.php', ['action' => 'run'])), '');
it_check('§51 rates are Prices and cottages', $refused(http($soph, 'POST', '/rates.php', ['action' => 'save', 'prop_key' => $propKey, 'couple_rate' => 1])), '');
it_check('§51 bank details are full access only, written through content.php', $refused(http($soph, 'POST', '/content.php', ['action' => 'set', 'key' => 'bacs-details', 'value' => 'hijacked'])), '');
// The Mac assistant was removed; the deploy never deletes files on the host, so its
// old door is a tombstone that answers 410 to everyone and does nothing else.
$r = http($admin, 'POST', '/nightshift.php', ['action' => 'chat_thread']);
it_check('the retired Mac assistant endpoint answers 410 and nothing else',
    $r['code'] === 410 && is_array($r['json']) && array_keys($r['json']) === ['error'], $r['raw']);
// An action named in TWO places is judged by both: some endpoints read the query
// string first, so a body saying something everyday must not carry a query
// string saying something else past the gate. The stricter one decides.
$r = http($soph, 'POST', '/bookings.php?action=refund', ['action' => 'set_notes', 'id' => 1, 'notes' => 'x']);
it_check('§51 an action in the query string is checked too', $refused($r), $r['raw']);
it_check('§51 the everyday is open: bookings, enquiries, messages, the boot payload', http($soph, 'GET', '/bookings.php')['code'] === 200 && http($soph, 'GET', '/enquiries.php')['code'] === 200 && http($soph, 'POST', '/messages.php', ['action' => 'threads'])['code'] === 200 && http($soph, 'GET', '/admin-bootstrap.php')['code'] === 200, '');
$r = http($soph, 'POST', '/content.php', ['action' => 'set', 'key' => 'host-bio', 'value' => 'Sophia runs the cottages.']);
it_check('§51 the host card is everyday (Sophia is the host)', $r['code'] === 200, $r['raw']);
// The activity log names who did it: a chat reply from her session is hers, not
// the first owner's (chat_admin_reply used to stamp every reply 'owner').
// A guest thread for her to answer (clear the toll first: the suite has spent the
// anonymous-message allowance by now, and this check is about the actor, not the meter).
$rootDb->exec('DELETE FROM login_attempts');
$sTok = str_repeat('e', 32);
http($guest, 'POST', '/messages.php', ['action' => 'send', 'token' => $sTok,
    'body' => 'Is there parking at Jollyboat?', 'name' => 'Rachel Verney', 'email' => 'rv51@example.com']);
$sTid = (int) $rootDb->query("SELECT id FROM chat_threads WHERE token = '$sTok'")->fetchColumn();
$r = http($soph, 'POST', '/messages.php', ['action' => 'send', 'thread_id' => $sTid, 'body' => 'Sophia here — all set for Friday.']);
$act = (string) $rootDb->query("SELECT actor FROM activity_log WHERE action = 'message.reply' ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('§51 her chat reply is logged as hers', $r['code'] === 200 && $act === 'admin:' . $sId, $act . ' ' . $r['raw']);
$r = http($soph, 'GET', '/admin-bootstrap.php');
it_check('§51 the boot payload leaves out the set-up and money parts', $r['code'] === 200 && !array_key_exists('cron', $r['json'] ?? []) && array_key_exists('payoutTrouble', $r['json'] ?? []) && $r['json']['payoutTrouble'] === null && !array_key_exists('night', $r['json'] ?? []), substr($r['raw'], 0, 200));
// Reading: a limited person never sees a secret.
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'bacs-details', 'value' => 'Sort 12-34-56 · Acc 12345678']);
http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => 'backup-passphrase', 'value' => 'a very long backup phrase']);
$oGet = http($admin, 'GET', '/content.php')['json']['content'] ?? [];
$sGet = http($soph, 'GET', '/content.php')['json']['content'] ?? [];
it_check('§51 the content read hides bank details from a limited person (the owner still sees them)', array_key_exists('bacs-details', $oGet) && !array_key_exists('bacs-details', $sGet) && ($sGet['host-bio'] ?? '') === 'Sophia runs the cottages.', json_encode(array_keys($sGet)));
$oAll = http($admin, 'POST', '/content.php', ['action' => 'get_all'])['json']['content'] ?? [];
$sAll = http($soph, 'POST', '/content.php', ['action' => 'get_all'])['json']['content'] ?? [];
it_check('§51 …and the private read hides the backup passphrase', ($oAll['backup-passphrase'] ?? '') === 'a very long backup phrase' && !array_key_exists('backup-passphrase', $sAll) && !array_key_exists('bacs-details', $sAll), json_encode(array_keys($sAll)));
// A switch takes effect on the next request — no signing out and in.
$r = http($admin, 'POST', '/people.php', ['action' => 'set_perm', 'id' => $sId, 'perm' => 'mo.view', 'on' => true]);
it_check('§51 switching See the money back on opens the Payments screens at once', $r['code'] === 200 && http($soph, 'GET', '/accounts.php')['code'] === 200, $r['raw']);
// A booking edit keeps its money unless the person takes payments.
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, price_override) VALUES ('$propKey','Edit Guest','edit51@example.com','2031-03-01','2031-03-04',2,0,'unpaid',0,300,300,0,3,250)");
$bId = (int) $rootDb->lastInsertId();
http($admin, 'POST', '/people.php', ['action' => 'set_perm', 'id' => $sId, 'perm' => 'mo.record', 'on' => false]);
http($admin, 'POST', '/people.php', ['action' => 'set_perm', 'id' => $sId, 'perm' => 'mo.ask', 'on' => false]);
// The reason goes with the price: a sheet that left it blank must not wipe the
// owner's reason while the price it explains stays put.
$rootDb->exec("UPDATE bookings SET price_reason = 'Returning guest' WHERE id = $bId");
$r = http($soph, 'POST', '/bookings.php', ['action' => 'update', 'id' => $bId, 'notes' => 'Late arrival', 'price_override' => 1, 'price_reason' => '', 'payment' => 'paid', 'deposit' => 999, 'op_id' => 'it51-edit-0001']);
$bRow = $rootDb->query("SELECT notes, price_override, price_reason, payment, deposit_paid FROM bookings WHERE id = $bId")->fetch();
it_check('§51 without Record payments or Ask for money, an edit changes the booking and never its money', $r['code'] === 200 && $bRow['notes'] === 'Late arrival' && abs((float) $bRow['price_override'] - 250) < 0.005 && $bRow['payment'] === 'unpaid' && abs((float) $bRow['deposit_paid']) < 0.005, $r['raw'] . json_encode($bRow));
it_check('§51 …nor the reason for its price', ($bRow['price_reason'] ?? '') === 'Returning guest', json_encode($bRow));
$r = http($soph, 'POST', '/bookings.php', ['action' => 'request_payment', 'id' => $bId]);
it_check('§51 …and asking for money is refused', $refused($r), $r['raw']);
$r = http($soph, 'POST', '/enquiries.php', ['action' => 'approve', 'id' => 1, 'price_override' => 99]);
it_check('§51 approving an enquiry WITH an agreed price needs Ask for money too', $refused($r), $r['raw']);
// The activity log names who did what.
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'list']);
$named = array_values(array_filter($r['json']['events'] ?? ($r['json']['items'] ?? []), fn($e) => ($e['actor'] ?? '') === 'Sophia Hart'));
it_check('§51 the activity log names Sophia for what Sophia did', $r['code'] === 200 && count($named) > 0, substr($r['raw'], 0, 300));
// Passkeys: the owner can see and remove someone's, never add or use them.
$rootDb->prepare("INSERT INTO admin_passkeys (admin_id, credential_id, public_key, label) VALUES (?, 'it51-cred', 'pk', 'iPhone')")->execute([$sId]);
$r = http($admin, 'POST', '/people.php', ['action' => 'passkeys', 'id' => $sId]);
$pkId = (int) ($r['json']['passkeys'][0]['id'] ?? 0);
it_check('§51 the owner sees which devices have Sophia\'s passkeys', $r['code'] === 200 && ($r['json']['passkeys'][0]['label'] ?? '') === 'iPhone', $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'passkey_remove', 'id' => $sId, 'key' => $pkId]);
it_check('§51 …and can remove a lost phone\'s', $r['code'] === 200 && (int) $rootDb->query("SELECT COUNT(*) FROM admin_passkeys WHERE admin_id = $sId")->fetchColumn() === 0, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'remove', 'id' => $ownerId]);
it_check('§51 you never act on yourself from People & access', $r['code'] === 400, $r['raw']);
// THREE EQUAL WAYS IN: an emailed code, a password, a passkey. The code alone signs
// in now (it used to be followed by the password), so a back-office code lives 10
// minutes, not a guest's 30, and the device it was typed on is remembered.
$emJar = [];
http($emJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'sophia51@example.com']);
// expires_at is on the APP's clock (Europe/London, as db.php sets the connection).
$cExp = (string) $rootDb->query("SELECT expires_at FROM guest_codes WHERE email = 'sophia51@example.com' AND used_at IS NULL ORDER BY id DESC LIMIT 1")->fetchColumn();
$cLife = (strtotime($cExp . ' Europe/London') - time()) / 60;
it_check('§51 a back-office email\'s code lives 10 minutes (a guest\'s lives 30)', $cLife > 8.5 && $cLife <= 10.1, $cExp . ' → ' . round($cLife, 1) . ' min');
$cSet('sophia51@example.com', '515151');
$r = http($emJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'sophia51@example.com', 'code' => '515151']);
it_check('§51 the code alone signs her in, as herself (no password asked, no guest account made)', $r['code'] === 200 && ($r['json']['admin'] ?? false) === true && ($r['json']['me']['id'] ?? 0) === $sId && http($emJar, 'GET', '/bookings.php')['code'] === 200 && (int) $rootDb->query("SELECT COUNT(*) FROM guests WHERE email = 'sophia51@example.com'")->fetchColumn() === 0, $r['raw']);
it_check('§51 …and remembers the device, so a password typed on it later needs no second code', !empty($emJar['chb_admin_device']) && (int) $rootDb->query("SELECT COUNT(*) FROM admin_devices WHERE admin_id = $sId")->fetchColumn() >= 1, json_encode(array_keys($emJar)));
$how = (string) $rootDb->query("SELECT summary FROM activity_log WHERE action IN ('admin.login', 'admin.login_new') ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('§51 …and the log says how she got in', strpos($how, 'Sophia Hart signed in with an emailed code') === 0, $how);
// A GUEST ACCOUNT ON THE SAME ADDRESS is never where the code lands someone: the back
// office is decided first (reported as "only a password reset gets us in").
$rootDb->prepare("INSERT INTO guests (name, email, phone, address, postcode, password_hash, email_verified_at) VALUES ('Sophia Hart', 'sophia51@example.com', '', '', '', ?, NOW())")->execute([password_hash('her guest password', PASSWORD_DEFAULT)]);
$gJar = [];
http($gJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'sophia51@example.com']);
$cSet('sophia51@example.com', '525252');
$r = http($gJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'sophia51@example.com', 'code' => '525252']);
$gs = http($gJar, 'POST', '/auth.php', ['action' => 'guest_status']);
it_check('§51 …even with a guest account on her address, the code opens the back office, never the guest account', $r['code'] === 200 && ($r['json']['me']['id'] ?? 0) === $sId && empty($gs['json']['guest']), $r['raw'] . ' / ' . $gs['raw']);
// A PASSWORD STILL WORKS, with her email or her username.
$pwJar = [];
$r = http($pwJar, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'sophia51@example.com', 'password' => 'not her password at all']);
it_check('§51 a password still works with her email: a wrong one is refused, saying nothing more', $r['code'] === 401 && ($r['json']['error'] ?? '') === 'Incorrect username or password' && !isset($r['json']['code']), $r['raw']);
$r = http($pwJar, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'sophia51@example.com', 'password' => 'sophias own passphrase']);
it_check('§51 …and the right one signs her in, as herself', $r['code'] === 200 && ($r['json']['me']['id'] ?? 0) === $sId, $r['raw']);
$rootDb->exec("DELETE FROM guests WHERE email = 'sophia51@example.com'");
// THE ADDRESS THAT GETS YOUR CODES IS AN ADDRESS YOU CAN SIGN IN WITH: the first
// owner's codes go to the config owner address while their own email is blank, so
// that address must find them, not start a guest sign-in — and it is saved onto
// their row as it does.
$rootDb->prepare("UPDATE admins SET email = '' WHERE id = ?")->execute([$ownerId]);
$owJar = [];
http($owJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => $ownContact]);
$cSet($ownContact, '616161');
$r = http($owJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => $ownContact, 'code' => '616161']);
$owEmail = (string) $rootDb->query("SELECT email FROM admins WHERE id = $ownerId")->fetchColumn();
it_check('§51 the owner address their codes go to finds the first owner even with their email blank — and fills it in', $r['code'] === 200 && ($r['json']['admin'] ?? false) === true && $owEmail === $ownContact && (int) $rootDb->query('SELECT COUNT(*) FROM guests WHERE email = ' . $rootDb->quote($ownContact))->fetchColumn() === 0, $owEmail . ' ' . $r['raw']);
$rootDb->prepare('UPDATE admins SET email = ? WHERE id = ?')->execute([$ownContact, $ownerId]); // as it was, whatever happened above
// A reset link: a new password, and every other session ends.
$rtok = str_repeat('7c', 24);
$r = http($guest, 'POST', '/auth.php', ['action' => 'admin_reset_request', 'id' => 'sophiahart']);
it_check('§51 asking for a reset answers the same whoever is asked about', $r['code'] === 200 && $r['raw'] === http($guest, 'POST', '/auth.php', ['action' => 'admin_reset_request', 'id' => 'nobody-here'])['raw'], $r['raw']);
// On the APP's clock (Europe/London, as db.php sets the connection): this
// connection's NOW() is the server's, which in BST is an hour behind.
$rExp = (new DateTime('+30 minutes', new DateTimeZone('Europe/London')))->format('Y-m-d H:i:s');
$rootDb->prepare('UPDATE admins SET reset_hash = ?, reset_expires = ? WHERE id = ?')->execute([hash('sha256', $rtok), $rExp, $sId]);
$rsJar = [];
$r = http($rsJar, 'POST', '/auth.php', ['action' => 'admin_reset_save', 'link' => "$sId.$rtok", 'password' => 'a brand new passphrase', 'again' => 'a brand new passphrase']);
it_check('§51 a reset link sets a new password and signs in', $r['code'] === 200 && ($r['json']['me']['id'] ?? 0) === $sId, $r['raw']);
it_check('§51 …and every other session is signed out', http($soph, 'GET', '/bookings.php')['code'] === 401 && http($emJar, 'GET', '/bookings.php')['code'] === 401 && http($rsJar, 'GET', '/bookings.php')['code'] === 200, '');
// Removing someone: out at once, their password switched off — said in words.
$r = http($admin, 'POST', '/people.php', ['action' => 'remove', 'id' => $sId]);
it_check('§51 removing someone signs them out everywhere straight away', $r['code'] === 200 && http($rsJar, 'GET', '/bookings.php')['code'] === 401, $r['raw']);
$r = http($guest, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'sophiahart', 'password' => 'a brand new passphrase']);
it_check('§51 …and their sign-in says it has been switched off', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'removed' && strpos((string) ($r['json']['error'] ?? ''), 'switched off') !== false, $r['raw']);
$rmJar = [];
http($rmJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'sophia51@example.com']);
$cSet('sophia51@example.com', '545454');
$r = http($rmJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'sophia51@example.com', 'code' => '545454']);
it_check('§51 …an emailed code says the same, and signs nobody in', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'removed' && http($rmJar, 'GET', '/bookings.php')['code'] === 401, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'list']);
$sP = array_values(array_filter($r['json']['people'] ?? [], fn($p) => ($p['id'] ?? 0) === $sId));
it_check('§51 …while they stay listed, so the log can still name them', $sP && ($sP[0]['state'] ?? '') === 'removed', $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'restore', 'id' => $sId]);
$sRow = $rootDb->query("SELECT * FROM admins WHERE id = $sId")->fetch();
it_check('§51 giving access back is a fresh invite: no password, a new link', $r['code'] === 200 && $sRow['removed_at'] === null && $sRow['invited_at'] !== null && $sRow['password_hash'] === '' && strlen((string) $sRow['invite_hash']) === 64, json_encode($sRow));
// Someone invited and not started yet is asked to choose a password; the code
// proves the inbox but signs nobody in until they have.
$ivJar = [];
http($ivJar, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'sophia51@example.com']);
$cSet('sophia51@example.com', '535353');
$r = http($ivJar, 'POST', '/auth.php', ['action' => 'guest_code_verify', 'email' => 'sophia51@example.com', 'code' => '535353']);
it_check('§51 an invited person\'s code asks them to choose a password, signing nobody in yet', $r['code'] === 200 && ($r['json']['choose'] ?? false) === true && empty($r['json']['me']) && http($ivJar, 'GET', '/bookings.php')['code'] === 401, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'cancel_invite', 'id' => $sId]);
it_check('§51 an unused invite can be cancelled outright', $r['code'] === 200 && (int) $rootDb->query("SELECT COUNT(*) FROM admins WHERE id = $sId")->fetchColumn() === 0, $r['raw']);
$rootDb->exec("DELETE FROM bookings WHERE id = $bId");
$rootDb->exec("DELETE FROM guest_codes");
$rootDb->exec("DELETE FROM content WHERE item_key IN ('bacs-details', 'backup-passphrase', 'host-bio')");

echo "\n== §52 Who gets which emails ==\n";
// Each person chooses which kinds reach them, an area switched off takes its
// emails with it, the backup never goes to the extra addresses, and an email that
// must reach someone can't lose its last person. MAIL_ENABLED is off here, so who
// an email WOULD go to is asked of the app itself, in the app copy (CLI).
$mailProbe = function ($code) use ($work) {
    $f = $work . '/it-mail-probe.php';
    file_put_contents($f, "<?php\nrequire __DIR__ . '/db.php';\nrequire_once __DIR__ . '/mailer.php';\n" . $code);
    $out = (string) shell_exec('cd ' . escapeshellarg($work) . ' && php ' . escapeshellarg($f) . ' 2>/dev/null');
    @unlink($f);
    $j = json_decode(trim(substr($out, (int) strrpos($out, "\n{"))), true);
    return is_array($j) ? $j : json_decode(trim($out), true);
};
$rcpts = fn() => $mailProbe('echo "\n" . json_encode(["enquiry" => owner_recipients("enquiry"), "ideas" => owner_recipients("ideas"), "backup" => owner_recipients("backup"), "paid" => owner_recipients("paid"), "senders" => people_mail_senders(), "from" => (people_mail_sender_row("ellie52@example.com") ?: ["id" => 0])["id"]]);');
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, caps, created_at) VALUES ('ellie52', 'x', 'Ellie Marsh', 'ellie52@example.com', 0, '{\"payments\":true}', NOW())");
$eId = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('notify-emails', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode(['co52@example.com'])]);
$r = http($admin, 'POST', '/auth.php', ['action' => 'admin_status']);
$ownMail = (string) ($r['json']['me']['contact'] ?? '');
$R = $rcpts();
it_check('§52 a new enquiry reaches the owner, the new person and the extra address', is_array($R) && ($R['enquiry'] ?? []) === [$ownMail, 'ellie52@example.com', 'co52@example.com'], json_encode($R));
it_check('§52 a things-to-do idea skips someone without Website and marketing', ($R['ideas'] ?? []) === [$ownMail, 'co52@example.com'], json_encode($R['ideas'] ?? null));
it_check('§52 the backup goes to full access only, never to the extra addresses', ($R['backup'] ?? []) === [$ownMail], json_encode($R['backup'] ?? null));
it_check('§52 a reply by email from her address is allowed, and is hers', in_array('ellie52@example.com', $R['senders'] ?? [], true) && (int) ($R['from'] ?? 0) === $eId, json_encode($R));
$r = http($admin, 'POST', '/people.php', ['action' => 'list']);
$eP = array_values(array_filter($r['json']['people'] ?? [], fn($p) => ($p['id'] ?? 0) === $eId))[0] ?? [];
it_check('§52 the list says what each person gets and may get', ($eP['mail']['enquiry'] ?? null) === true && ($eP['mailCan']['ideas'] ?? null) === false && ($eP['mailCan']['backup'] ?? null) === false && in_array('paid', $eP['mailGets'] ?? [], true) && count($r['json']['mailKinds'] ?? []) === 9 && ($r['json']['mailExtras'] ?? []) === ['co52@example.com'], json_encode($eP));
// Choosing: the owner stops new enquiries for himself — fine, Ellie still gets them.
$r = http($admin, 'POST', '/people.php', ['action' => 'set_mail', 'id' => $ownerId, 'kind' => 'enquiry', 'on' => false]);
$R = $rcpts();
it_check('§52 you can stop an email for yourself while someone else gets it', $r['code'] === 200 && ($R['enquiry'] ?? []) === ['ellie52@example.com', 'co52@example.com'], $r['raw'] . ' ' . json_encode($R['enquiry'] ?? null));
$r = http($admin, 'POST', '/people.php', ['action' => 'set_mail', 'id' => $eId, 'kind' => 'enquiry', 'on' => false]);
it_check('§52 …but not take it from the last person, said in words', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'must' && strpos((string) ($r['json']['error'] ?? ''), 'a guest is waiting for a reply') !== false, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'set_mail', 'id' => $eId, 'kind' => 'ideas', 'on' => true]);
it_check('§52 an email for a permission she does not have can\'t be switched on', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'locked' && strpos((string) ($r['json']['error'] ?? ''), 'Home page and things to do') !== false, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'set_mail', 'id' => $eId, 'kind' => 'paid', 'on' => false]);
$R = $rcpts();
it_check('§52 switching one off for her stops it reaching her', $r['code'] === 200 && !in_array('ellie52@example.com', $R['paid'] ?? [], true) && in_array($ownMail, $R['paid'] ?? [], true), json_encode($R['paid'] ?? null));
// Her Take payments switched off takes payment emails with it — and back on
// brings her old choice back (she had chosen them again).
http($admin, 'POST', '/people.php', ['action' => 'set_mail', 'id' => $eId, 'kind' => 'paid', 'on' => true]);
http($admin, 'POST', '/people.php', ['action' => 'set_perm', 'id' => $eId, 'perm' => 'mo.record', 'on' => false]);
$R = $rcpts();
it_check('§52 a permission switched off takes its emails with it', !in_array('ellie52@example.com', $R['paid'] ?? [], true), json_encode($R['paid'] ?? null));
http($admin, 'POST', '/people.php', ['action' => 'set_perm', 'id' => $eId, 'perm' => 'mo.record', 'on' => true]);
$R = $rcpts();
it_check('§52 …and switching it back on brings her choice back', in_array('ellie52@example.com', $R['paid'] ?? [], true), json_encode($R['paid'] ?? null));
// An email that must reach someone is never lost: with nobody choosing it, it
// falls back to the first owner.
$rootDb->exec("UPDATE admins SET removed_at = NOW() WHERE id = $eId");
$R = $rcpts();
it_check('§52 with its last person gone, a new enquiry falls back to the first owner', ($R['enquiry'] ?? []) === [$ownMail, 'co52@example.com'], json_encode($R['enquiry'] ?? null));
it_check('§52 …and a removed person can no longer reply by email', !in_array('ellie52@example.com', $R['senders'] ?? [], true), json_encode($R['senders'] ?? null));
$rootDb->exec("DELETE FROM admins WHERE id = $eId");
$rootDb->exec("UPDATE admins SET mail_prefs = NULL WHERE id = $ownerId");
$rootDb->exec("DELETE FROM content WHERE item_key = 'notify-emails'");

echo "\n== §53 Bank statements: read once, never counted twice ==\n";
// The owner adds a CSV statement exported from Monzo Business. Driven through the
// real endpoint against the real tables (migration-135): a statement is read
// once, a payment already here is never added twice (however the files overlap
// or a reply is lost), only a Square payout and a pot move sort themselves, and
// sorting the rest is the owner's.
$stHead = "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Balance,Balance currency\n";
$stLine = fn($id, $d, $t, $type, $name, $amt, $bal, $desc = '') => "$id,$d,$t,$type,$name,,General,$amt,GBP,$amt,GBP,,,,$desc,,$bal,GBP\n";
$stA = $stHead
    . $stLine('tx_it53_1', '03/09/2026', '09:12:00', 'Faster payment', 'SQUARE PAYOUT', '612.40', '1612.40', 'SQ *PAYOUT')
    . $stLine('tx_it53_2', '10/09/2026', '14:00:00', 'Faster payment', 'R PEMBERTON', '340.00', '1952.40', 'CHB-000053')
    . $stLine('tx_it53_3', '15/09/2026', '08:30:00', 'Faster payment', 'NORFOLK CLEAN CO', '-86.40', '1866.00', 'INV 2201')
    . $stLine('tx_it53_4', '30/09/2026', '23:10:00', 'Pot transfer', 'Tax pot', '-631.44', '1234.56', '');
$stCount = fn() => (int) $rootDb->query('SELECT COUNT(*) FROM bank_lines')->fetchColumn();
$stAnon = [];
$r = http($stAnon, 'POST', '/statements.php', ['action' => 'status']);
it_check('§53 a visitor is refused', $r['code'] === 401, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'status']);
it_check('§53 before any statement: the tables exist and nothing is switched on', $r['code'] === 200 && ($r['json']['ready'] ?? false) === true && ($r['json']['on'] ?? true) === false && ($r['json']['unsorted'] ?? -1) === 0 && array_key_exists('last', $r['json'] ?? []) && $r['json']['last'] === null, $r['raw']);
// The real file BEFORE the PDF as well as after it: in CI (PHP 8.3 + MySQL) the
// preview after the PDF refusal answered "no payments in that file" while the
// identical import a moment later read all four — this pair says whether the
// refusal is what poisons the next read.
$r = http($admin, 'POST', '/statements.php', ['action' => 'preview', 'csv' => $stA, 'filename' => 'monzo.csv']);
it_check('§53 the preview reads the file (before any refusal)', $r['code'] === 200 && (($r['json']['summary']['adding'] ?? 0) === 4), 'cols=' . json_encode($r['json']['read']['cols'] ?? null) . ' code=' . $r['code'] . ' php=' . PHP_VERSION);
$r = http($admin, 'POST', '/statements.php', ['action' => 'preview', 'csv' => '%PDF-1.4 …', 'filename' => 'statement.pdf']);
it_check('§53 a PDF is refused in words', $r['code'] === 400 && strpos((string) ($r['json']['error'] ?? ''), 'pick CSV') !== false, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'preview', 'csv' => $stA, 'filename' => 'monzo.csv']);
$sm = $r['json']['summary'] ?? [];
it_check('§53 the preview says what would be added, and writes nothing', $r['code'] === 200 && ($sm['adding'] ?? 0) === 4 && ($sm['already'] ?? -1) === 0 && abs((float) ($sm['balance'] ?? 0) - 1234.56) < 0.001 && $sm['to'] === '2026-09-30' && $stCount() === 0, 'code=' . $r['code'] . ' ' . $r['raw'] . ' len=' . strlen($stA) . ' head=' . json_encode(substr($stA, 0, 40)));
$r = http($admin, 'POST', '/statements.php', ['action' => 'import', 'csv' => $stA, 'filename' => 'monzo.csv', 'op_id' => 'it53-import-a']);
$sm = $r['json']['summary'] ?? [];
it_check('§53 adding it stores four payments, two of which sorted themselves', $r['code'] === 200 && ($sm['added'] ?? 0) === 4 && ($sm['auto'] ?? 0) === 2 && $stCount() === 4, $r['raw']);
$auto = $rootDb->query("SELECT ext_key, sorted_as FROM bank_lines WHERE sorted_as IS NOT NULL ORDER BY ext_key")->fetchAll(PDO::FETCH_KEY_PAIR);
it_check('§53 …the Square payout and the pot move, nothing else', $auto === ['m:tx_it53_1' => 'square', 'm:tx_it53_4' => 'pot'], json_encode($auto));
$r = http($admin, 'POST', '/statements.php', ['action' => 'import', 'csv' => $stA, 'filename' => 'monzo.csv', 'op_id' => 'it53-import-a']);
it_check('§53 a retried import is answered from the ledger, adding nothing', ($r['json']['replayed'] ?? false) === true && $stCount() === 4, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'import', 'csv' => $stA, 'filename' => 'monzo-again.csv', 'op_id' => 'it53-import-a2']);
it_check('§53 the same file added again adds nothing', $r['code'] === 200 && ($r['json']['summary']['added'] ?? -1) === 0 && ($r['json']['summary']['already'] ?? 0) === 4 && $stCount() === 4, $r['raw']);
$stB = $stHead
    . $stLine('tx_it53_3', '15/09/2026', '08:30:00', 'Faster payment', 'NORFOLK CLEAN CO', '-86.40', '1866.00', 'INV 2201')
    . $stLine('tx_it53_4', '30/09/2026', '23:10:00', 'Pot transfer', 'Tax pot', '-631.44', '1234.56', '')
    . $stLine('tx_it53_5', '02/10/2026', '10:00:00', 'Faster payment', 'NORFOLK CLEAN CO', '-72.00', '1162.56', 'INV 2207');
$r = http($admin, 'POST', '/statements.php', ['action' => 'import', 'csv' => $stB, 'filename' => 'october.csv', 'op_id' => 'it53-import-b']);
it_check('§53 an overlapping statement adds only the payment that is new', ($r['json']['summary']['added'] ?? -1) === 1 && ($r['json']['summary']['already'] ?? 0) === 2 && $stCount() === 5, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'status']);
$st = $r['json'] ?? [];
$byKey = [];
foreach ($rootDb->query('SELECT id, ext_key FROM bank_lines')->fetchAll() as $row) {
    $byKey[$row['ext_key']] = (int) $row['id'];
}
it_check('§53 the status: on, three to sort, the latest statement and its closing balance',
    ($st['on'] ?? false) === true && ($st['unsorted'] ?? 0) === 3 && ($st['last']['to'] ?? '') === '2026-10-02' && abs((float) ($st['balance'] ?? 0) - 1162.56) < 0.001 && ($st['uploads'] ?? 0) === 3 && count($st['lines'] ?? []) === 5, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'mark', 'id' => $byKey['m:tx_it53_2'], 'as' => 'payment']);
it_check('§53 a guest payment must name its booking', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'mark', 'id' => $byKey['m:tx_it53_2'], 'as' => 'square']);
it_check('§53 the owner cannot claim a payment is a Square payout', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'mark', 'id' => 999999, 'as' => 'ignore']);
it_check('§53 a payment that is not here says so', $r['code'] === 404, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'mark', 'id' => $byKey['m:tx_it53_3'], 'as' => 'expense', 'expense_id' => 4242, 'label' => 'Cleaning']);
$r2 = http($admin, 'POST', '/statements.php', ['action' => 'status']);
$learnt = array_values(array_filter($r2['json']['learned'] ?? [], fn($x) => $x['name'] === 'NORFOLK CLEAN CO'));
it_check('§53 sorting one as an expense keeps the link and teaches the next suggestion', $r['code'] === 200 && ($r2['json']['unsorted'] ?? 0) === 2 && $learnt && $learnt[0]['as'] === 'expense' && $learnt[0]['label'] === 'Cleaning'
    && (int) $rootDb->query('SELECT expense_id FROM bank_lines WHERE id = ' . $byKey['m:tx_it53_3'])->fetchColumn() === 4242, $r2['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'unmark', 'id' => $byKey['m:tx_it53_3']]);
$row = $rootDb->query('SELECT sorted_as, expense_id FROM bank_lines WHERE id = ' . $byKey['m:tx_it53_3'])->fetch();
it_check('§53 undo puts it back to sort, link and all', $r['code'] === 200 && $row['sorted_as'] === null && $row['expense_id'] === null, json_encode($row));
$r = http($admin, 'POST', '/statements.php', ['action' => 'settings', 'remind' => false]);
$r2 = http($admin, 'POST', '/statements.php', ['action' => 'status']);
it_check('§53 the monthly reminder can be switched off', ($r2['json']['remind'] ?? true) === false, $r2['raw']);
$r = http($stAnon, 'GET', '/content.php');
it_check('§53 the setting never reaches the public content', $r['code'] === 200 && !isset($r['json']['content']['bank-statements']), mb_substr($r['raw'], 0, 160));
$r = http($admin, 'POST', '/statements.php', ['action' => 'remove']);
$r2 = http($admin, 'POST', '/statements.php', ['action' => 'status']);
it_check('§53 stopping keeps every payment already added', $r['code'] === 200 && ($r2['json']['on'] ?? true) === false && $stCount() === 5, $r2['raw']);
$rootDb->exec('DELETE FROM bank_lines');
$rootDb->exec('DELETE FROM bank_imports');
$rootDb->exec("DELETE FROM content WHERE item_key = 'bank-statements'");

echo "\n== §54 The Monzo Business live link, against a fake Monzo ==\n";
// The real monzo.php, monzo-callback.php and monzo-sync.php, talking to a fake
// Monzo on its own port (MONZO_API_BASE in this copy's config). Connect, the
// single-use return, approval in the app, the business account only, the sync
// into the statements' table (once, sharing their keys), token refresh, a
// revoked link, and disconnecting. Nothing here reaches the real Monzo.
$mzDir = sys_get_temp_dir() . '/chb-it-monzo-' . getmypid();
@mkdir($mzDir, 0777, true);
$mzRouter = <<<'FAKE'
<?php
$st = __DIR__ . '/state.json';
$S = json_decode((string) @file_get_contents($st), true) ?: [];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
parse_str((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY), $q);
$auth = preg_replace('/^Bearer /', '', $_SERVER['HTTP_AUTHORIZATION'] ?? '');
file_put_contents(__DIR__ . '/log.txt', json_encode(['m' => $_SERVER['REQUEST_METHOD'], 'p' => $path, 'q' => $q, 'post' => $_POST, 'auth' => $auth]) . "\n", FILE_APPEND);
header('Content-Type: application/json');
$out = function ($code, $b) { http_response_code($code); echo json_encode($b); exit; };
$save = function () use (&$S, $st) { file_put_contents($st, json_encode($S)); };
if ($path === '/oauth2/token') {
    if (($_POST['grant_type'] ?? '') === 'authorization_code') {
        if (($_POST['code'] ?? '') !== 'good-code' || ($_POST['client_secret'] ?? '') !== 'mnzconf.it-secret-0001') { $out(400, ['error' => 'invalid_grant']); }
        $S['access'] = 'acc-1'; $S['refresh'] = 'ref-1'; $save();
        $out(200, ['access_token' => 'acc-1', 'refresh_token' => 'ref-1', 'expires_in' => 200, 'user_id' => 'user_it']);
    }
    if (!empty($S['refuse_refresh']) || ($_POST['refresh_token'] ?? '') !== ($S['refresh'] ?? '')) { $out(401, ['error' => 'invalid_grant']); }
    $S['access'] = 'acc-2'; $S['refresh'] = 'ref-2'; $save();
    $out(200, ['access_token' => 'acc-2', 'refresh_token' => 'ref-2', 'expires_in' => 21600, 'user_id' => 'user_it']);
}
if ($path === '/oauth2/logout') { $out(200, []); }
if ($auth === '' || $auth !== ($S['access'] ?? '') || !empty($S['revoked'])) { $out(401, ['code' => 'unauthorized.bad_access_token']); }
if (empty($S['approved'])) { $out(403, ['code' => 'forbidden.insufficient_permissions']); }
if ($path === '/accounts') { $out(200, ['accounts' => $S['accounts'] ?? []]); }
if ($path === '/pots') { $out(200, ['pots' => [['id' => 'pot_tax', 'name' => 'Tax']]]); }
if ($path === '/balance') { $out(200, ['balance' => 125706, 'total_balance' => 188850, 'currency' => 'GBP']); }
if ($path === '/transactions') {
    $all = $S['txs'] ?? [];
    usort($all, fn($a, $b) => strcmp($a['created'], $b['created']));
    $since = (string) ($q['since'] ?? '');
    if (strpos($since, 'tx_') === 0) {
        $i = array_search($since, array_column($all, 'id'), true);
        $all = $i === false ? [] : array_slice($all, $i + 1);
    } elseif ($since !== '') {
        $all = array_values(array_filter($all, fn($t) => strtotime($t['created']) >= strtotime($since)));
    }
    $out(200, ['transactions' => array_slice($all, 0, (int) ($q['limit'] ?? 30))]);
}
$out(404, ['code' => 'not_found']);
FAKE;
file_put_contents($mzDir . '/router.php', $mzRouter);
$mzState = function (array $patch) use ($mzDir) {
    $s = json_decode((string) @file_get_contents($mzDir . '/state.json'), true) ?: [];
    file_put_contents($mzDir . '/state.json', json_encode(array_merge($s, $patch)));
};
$mzLog = function () use ($mzDir) {
    return array_values(array_filter(array_map(fn($l) => json_decode($l, true), file($mzDir . '/log.txt', FILE_IGNORE_NEW_LINES) ?: [])));
};
$iso = fn($daysAgo, $h = 12) => gmdate('Y-m-d\TH:i:s\Z', strtotime(gmdate('Y-m-d') . " $h:00:00 UTC") - $daysAgo * 86400);
$mzState([
    'approved' => false,
    'accounts' => [['id' => 'acc_personal', 'type' => 'uk_retail', 'closed' => false, 'account_number' => '11112222']],
    'txs' => [
        ['id' => 'tx_it54_in', 'created' => $iso(5), 'amount' => 37750, 'currency' => 'GBP', 'description' => 'M HILL', 'notes' => 'CHB-000006', 'scheme' => 'payport_faster_payments', 'settled' => $iso(5), 'counterparty' => ['name' => 'Marcus Hill'], 'account_balance' => 195000],
        ['id' => 'tx_it54_sq', 'created' => $iso(4), 'amount' => 61240, 'currency' => 'GBP', 'description' => 'SQ *PAYOUT', 'scheme' => 'payport_faster_payments', 'settled' => $iso(4), 'counterparty' => ['name' => 'SQUARE EUROPE LTD']],
        ['id' => 'tx_it54_pot', 'created' => $iso(3), 'amount' => -63144, 'currency' => 'GBP', 'description' => 'pot_tax', 'scheme' => 'uk_retail_pot', 'settled' => $iso(3), 'metadata' => ['pot_id' => 'pot_tax']],
        ['id' => 'tx_it54_card', 'created' => $iso(2), 'amount' => -2310, 'currency' => 'GBP', 'description' => 'TESCO STORES 2231', 'scheme' => 'mastercard', 'settled' => $iso(1), 'merchant' => ['name' => 'Tesco']],
        ['id' => 'tx_it54_declined', 'created' => $iso(2, 13), 'amount' => -9900, 'currency' => 'GBP', 'decline_reason' => 'INSUFFICIENT_FUNDS', 'scheme' => 'mastercard'],
        ['id' => 'tx_it54_pending', 'created' => $iso(0, 9), 'amount' => -1500, 'currency' => 'GBP', 'scheme' => 'mastercard', 'settled' => '', 'merchant' => ['name' => 'Shell']],
        ['id' => 'tx_it54_eur', 'created' => $iso(1, 9), 'amount' => -1200, 'currency' => 'EUR', 'settled' => $iso(1, 9)],
    ],
]);
$mzServer = proc_open("exec php -S 127.0.0.1:$MONZO_PORT " . escapeshellarg($mzDir . '/router.php') . ' 2>/dev/null', [], $mzPipes);
register_shutdown_function(function () use ($mzServer, $mzDir) {
    if (is_resource($mzServer)) {
        proc_terminate($mzServer);
    }
    exec('rm -rf ' . escapeshellarg($mzDir));
});
for ($i = 0; $i < 50; $i++) {
    usleep(100000);
    if (@file_get_contents("http://127.0.0.1:$MONZO_PORT/oauth2/logout", false, stream_context_create(['http' => ['timeout' => 1, 'ignore_errors' => true]])) !== false) {
        break;
    }
}
$mzLines = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM bank_lines WHERE ext_key LIKE 'm:tx_it54_%'")->fetchColumn();
$r = http($admin, 'POST', '/monzo.php', ['action' => 'status']);
it_check('§54 before anything: off, and the redirect address to paste into Monzo is this site\'s callback', $r['code'] === 200 && ($r['json']['live']['state'] ?? '') === 'off' && substr((string) ($r['json']['live']['redirect'] ?? ''), -19) === '/monzo-callback.php', $r['raw']);
$r = http($stAnon, 'POST', '/monzo.php', ['action' => 'status']);
it_check('§54 a visitor is refused', $r['code'] === 401, $r['raw']);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'save_client', 'client_id' => 'oauth2client_it54', 'client_secret' => 'mnzpub.it-public-0001']);
it_check('§54 a non-confidential client is refused in words', $r['code'] === 400 && strpos((string) ($r['json']['error'] ?? ''), 'Confidential') !== false, $r['raw']);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'save_client', 'client_id' => 'oauth2client_it54', 'client_secret' => 'mnzconf.it-secret-0001']);
$stored = (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'monzo-client'")->fetchColumn();
it_check('§54 the client is saved encrypted, and never sent back', $r['code'] === 200 && ($r['json']['live']['state'] ?? '') === 'ready' && strpos($stored, 'enc1:') === 0 && strpos($r['raw'], 'it-secret') === false, $r['raw']);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'connect']);
$url = (string) ($r['json']['url'] ?? '');
parse_str((string) parse_url($url, PHP_URL_QUERY), $cq);
it_check('§54 connecting sends the owner to Monzo with the client, the callback and a state', strpos($url, "http://127.0.0.1:$MONZO_PORT/auth/?") === 0 && ($cq['client_id'] ?? '') === 'oauth2client_it54' && substr((string) ($cq['redirect_uri'] ?? ''), -19) === '/monzo-callback.php' && strlen((string) ($cq['state'] ?? '')) === 32, $url);
$mzAnon = [];
$r = http($mzAnon, 'GET', '/monzo-callback.php?state=' . str_repeat('0', 32) . '&code=good-code');
it_check('§54 a return with the wrong state changes nothing', strpos($r['raw'], 'That link has expired') !== false && (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'monzo-auth'")->fetchColumn() === '', mb_substr($r['raw'], 0, 120));
$r = http($admin, 'POST', '/monzo.php', ['action' => 'connect']);
parse_str((string) parse_url((string) ($r['json']['url'] ?? ''), PHP_URL_QUERY), $cq);
$r = http($mzAnon, 'GET', '/monzo-callback.php?state=' . urlencode((string) $cq['state']) . '&code=good-code');
$authRow = (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'monzo-auth'")->fetchColumn();
it_check('§54 the right return, in a browser with no session, exchanges the code and asks for approval in the app', $r['code'] === 200 && strpos($r['raw'], 'approve it in the Monzo app') !== false && strpos($authRow, 'enc1:') === 0 && strpos($authRow, 'acc-1') === false, mb_substr($r['raw'], 0, 200));
$r = http($mzAnon, 'GET', '/monzo-callback.php?state=' . urlencode((string) $cq['state']) . '&code=good-code');
it_check('§54 …and the same return twice is refused: the state is single-use', strpos($r['raw'], 'That link has expired') !== false, mb_substr($r['raw'], 0, 120));
$r = http($admin, 'POST', '/monzo.php', ['action' => 'check']);
it_check('§54 not approved in the app yet: still waiting, nothing fetched', ($r['json']['live']['state'] ?? '') === 'approve' && $mzLines() === 0, $r['raw']);
$refreshed = array_values(array_filter($mzLog(), fn($e) => ($e['p'] ?? '') === '/oauth2/token' && ($e['post']['grant_type'] ?? '') === 'refresh_token'));
it_check('§54 a token about to lapse is refreshed first, with the refresh token Monzo gave', count($refreshed) === 1 && ($refreshed[0]['post']['refresh_token'] ?? '') === 'ref-1', json_encode($refreshed));
$mzState(['approved' => true]);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'check']);
it_check('§54 Monzo shared only a personal account: said, and its payments are NOT taken', ($r['json']['live']['state'] ?? '') === 'no_business' && strpos((string) ($r['json']['live']['say'] ?? ''), 'a personal account') !== false && $mzLines() === 0, $r['raw']);
$usedNew = array_values(array_filter($mzLog(), fn($e) => ($e['p'] ?? '') === '/accounts'));
it_check('§54 …and every call after the refresh carried the new token', $usedNew && end($usedNew)['auth'] === 'acc-2', json_encode(end($usedNew)));
$mzState(['accounts' => [['id' => 'acc_personal', 'type' => 'uk_retail', 'closed' => false], ['id' => 'acc_biz', 'type' => 'uk_business', 'closed' => false, 'account_number' => '87654471']]]);
http($admin, 'POST', '/monzo.php', ['action' => 'disconnect']);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'connect']);
parse_str((string) parse_url((string) ($r['json']['url'] ?? ''), PHP_URL_QUERY), $cq);
http($mzAnon, 'GET', '/monzo-callback.php?state=' . urlencode((string) $cq['state']) . '&code=good-code');
$r = http($admin, 'POST', '/monzo.php', ['action' => 'check']);
$sum = $r['json']['sync'] ?? [];
it_check('§54 with the business account shared, approval fetches its payments at once', ($r['json']['live']['state'] ?? '') === 'live' && ($r['json']['live']['account'] ?? '') === 'Business account ending 4471' && ($sum['added'] ?? 0) === 4 && ($sum['auto'] ?? 0) === 2, $r['raw']);
$txq = array_values(array_filter($mzLog(), fn($e) => ($e['p'] ?? '') === '/transactions'));
$tyStart = (date('m-d') < '04-06' ? (int) date('Y') - 1 : (int) date('Y')) . '-04-06T00:00:00Z';
it_check('§54 …asking from the start of the tax year, inside Monzo\'s first five minutes, for the business account only', $txq && ($txq[0]['q']['since'] ?? '') === $tyStart && !array_filter($txq, fn($e) => ($e['q']['account_id'] ?? '') !== 'acc_biz'), json_encode($txq[0] ?? null));
$rows = $rootDb->query("SELECT ext_key, kind, name, amount, sorted_as FROM bank_lines WHERE ext_key LIKE 'm:tx_it54_%' ORDER BY ext_key")->fetchAll(PDO::FETCH_ASSOC);
$byK = array_column($rows, null, 'ext_key');
it_check('§54 declined, pending and foreign-currency payments are left out', !isset($byK['m:tx_it54_declined']) && !isset($byK['m:tx_it54_pending']) && !isset($byK['m:tx_it54_eur']), json_encode(array_keys($byK)));
it_check('§54 the pot is named and sorts itself, the Square payout too, and the rest wait for the owner',
    ($byK['m:tx_it54_pot']['name'] ?? '') === 'To Tax pot' && ($byK['m:tx_it54_pot']['sorted_as'] ?? '') === 'pot' && ($byK['m:tx_it54_sq']['sorted_as'] ?? '') === 'square'
    && isset($byK['m:tx_it54_in']) && $byK['m:tx_it54_in']['sorted_as'] === null && ($byK['m:tx_it54_in']['name'] ?? '') === 'Marcus Hill' && abs((float) ($byK['m:tx_it54_card']['amount'] ?? 0) + 23.10) < 0.001, json_encode($rows));
it_check('§54 the balance is Monzo\'s, dated', abs((float) ($r['json']['live']['balance'] ?? 0) - 1257.06) < 0.001 && abs((float) ($r['json']['live']['total'] ?? 0) - 1888.50) < 0.001 && ($r['json']['live']['balance_at'] ?? 0) > time() - 120, $r['raw']);
it_check('§54 no token or secret ever reaches the page', strpos($r['raw'], 'acc-') === false && strpos($r['raw'], 'ref-') === false && strpos($r['raw'], 'it-secret') === false, $r['raw']);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'sync']);
it_check('§54 syncing again adds nothing already here', ($r['json']['sync']['ok'] ?? false) === true && ($r['json']['sync']['added'] ?? -1) === 0 && $mzLines() === 4, $r['raw']);
// ONE lock for every change to the link (monzo_locked). Held here as a sync in
// flight would hold it: a disconnect waits for it rather than racing it (a refresh
// saved after the disconnect brought the link back), says so when it cannot, and
// changes nothing; an approval check meanwhile reports the link without calling Monzo.
$rootDb->query("SELECT GET_LOCK('chb_monzo_sync', 0)")->fetchColumn();
$authBefore = (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'monzo-auth'")->fetchColumn();
$before = count($mzLog());
$r = http($admin, 'POST', '/monzo.php', ['action' => 'disconnect']);
$linkNow = json_decode((string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'monzo-link'")->fetchColumn(), true);
it_check('§54 a disconnect while a sync holds the link waits, says so, and changes nothing',
    $r['code'] === 409 && ($r['json']['code'] ?? '') === 'busy'
    && (string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'monzo-auth'")->fetchColumn() === $authBefore
    && ($linkNow['account_id'] ?? '') === 'acc_biz' && count($mzLog()) === $before, $r['raw']);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'check']);
it_check('§54 …and an approval check meanwhile reports the link without calling Monzo', ($r['json']['live']['state'] ?? '') === 'live' && count($mzLog()) === $before, $r['raw']);
$rootDb->query("SELECT RELEASE_LOCK('chb_monzo_sync')")->fetchColumn();
$csv = "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Balance,Balance currency\n"
    . 'tx_it54_in,' . gmdate('d/m/Y', strtotime($iso(5))) . ",12:00:00,Faster payment,M HILL,,General,377.50,GBP,377.50,GBP,,,,CHB-000006,,1950.00,GBP\n";
$r = http($admin, 'POST', '/statements.php', ['action' => 'preview', 'csv' => $csv, 'filename' => 'monzo.csv']);
it_check('§54 a statement holding a payment the link already brought finds it already here', ($r['json']['summary']['already'] ?? 0) === 1 && ($r['json']['summary']['adding'] ?? -1) === 0, $r['raw']);
$r = http($admin, 'POST', '/statements.php', ['action' => 'status']);
it_check('§54 the statements answer carries the link, so the page needs one request', ($r['json']['live']['state'] ?? '') === 'live', mb_substr($r['raw'], 0, 160));
$mzState(['revoked' => true]);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'sync']);
it_check('§54 a link Monzo stopped accepting says so', ($r['json']['live']['state'] ?? '') === 'reconnect' && strpos((string) ($r['json']['live']['say'] ?? ''), 'Connect again') !== false, $r['raw']);
$mzState(['revoked' => false]);
$before = count($mzLog());
$r = http($admin, 'POST', '/monzo.php', ['action' => 'sync']);
it_check('§54 …and its token is dropped: nothing more is asked of Monzo until the owner connects again', count($mzLog()) === $before && ($r['json']['live']['state'] ?? '') === 'reconnect', $r['raw']);
$r = http($admin, 'POST', '/monzo.php', ['action' => 'disconnect']);
$lout = array_filter($mzLog(), fn($e) => ($e['p'] ?? '') === '/oauth2/logout' && ($e['m'] ?? '') === 'POST');
it_check('§54 disconnecting keeps every payment already added, keeps the client for next time, and tells Monzo when there was a token', ($r['json']['live']['state'] ?? '') === 'ready' && $mzLines() === 4 && count($lout) >= 1, $r['raw']);
$rootDb->exec("DELETE FROM bank_lines WHERE ext_key LIKE 'm:tx_it54_%'");
$rootDb->exec("DELETE FROM content WHERE item_key IN ('monzo-client', 'monzo-auth', 'monzo-link')");

echo "\n== §55 Whose money is whose: the account holder pays a host their cottage's money ==\n";
// One bank account (the holder's) takes every guest's money. A host who isn't the
// holder is paid out: their cottage's money after card fees, less what has been
// sent to them by name. Driven through the real endpoints and tables
// (migration-136): the signed-in owner hosts one cottage and someone else holds
// the account, then the other way round.
$r = http($admin, 'POST', '/split.php', ['action' => 'status']);
it_check('§55 nothing set: the split is off and says so', $r['code'] === 200 && ($r['json']['ready'] ?? false) === true && ($r['json']['on'] ?? true) === false && ($r['json']['role'] ?? '') === 'none', $r['raw']);
$ownName = (string) ($r['json']['people'][0]['name'] ?? '');
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Pimp Fiftyfive', 'couple_rate' => 100]);
$pk55 = (string) ($r['json']['property']['prop_key'] ?? ($r['json']['prop_key'] ?? ''));
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, caps, created_at) VALUES ('holder55', 'x', 'Hollie Holder', 'holder55@example.com', 0, '{\"money\":true}', NOW())");
$h55 = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => $h55, 'hosts' => ['no_such_cottage' => $ownerId]]);
it_check('§55 a cottage that isn’t one is refused', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => 99999, 'hosts' => []]);
it_check('§55 a holder who isn’t a person is refused', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => $h55, 'hosts' => [$pk55 => $ownerId]]);
$cfg55 = json_decode((string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'money-split'")->fetchColumn(), true);
$ty55 = (date('m-d') < '04-06' ? (int) date('Y') - 1 : (int) date('Y'));
it_check('§55 settings saved: who holds, who hosts, and it starts from this tax year', $r['code'] === 200 && ($cfg55['holder'] ?? 0) === $h55 && ($cfg55['hosts'][$pk55] ?? 0) === $ownerId && ($cfg55['since'] ?? '') === $ty55 . '-04-06', json_encode($cfg55));
// Two stays at the owner's cottage: one paid by card (a fee), one by bank transfer (no fee).
$today55 = date('Y-m-d');
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date) VALUES ('$pk55','Liam Card55','lc55@x.co','" . date('Y-m-d', strtotime('+20 days')) . "','" . date('Y-m-d', strtotime('+23 days')) . "',2,0,'paid',500,500,500,0,3,'$today55')");
$bc55 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, fee, created_at) VALUES ($bc55,'deposit',500,'COMPLETED','sq_it55_a',8.50, NOW() - INTERVAL 2 DAY)");
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date) VALUES ('$pk55','Ellie Bank55','eb55@x.co','" . date('Y-m-d', strtotime('+30 days')) . "','" . date('Y-m-d', strtotime('+33 days')) . "',2,0,'paid',300,300,300,0,3,'$today55')");
$bb55 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, created_at) VALUES ($bb55,'manual',300,'MANUAL','man_it55_b', NOW())");
// The holder sent the owner £200 by name a day ago, before anyone linked the name.
$nowD = date('Y-m-d', strtotime('-1 day'));
$ins55 = $rootDb->prepare("INSERT INTO bank_lines (ext_key, import_id, txn_date, txn_time, kind, name, category, description, notes, amount, balance) VALUES (?,0,?,'10:00:00','Faster payment',?,'','Cottage money','',?,0)");
$ins55->execute(['m:tx_it55_1', $nowD, $ownName, -200]);
$ins55->execute(['m:tx_it55_2', $nowD, 'Someone Else', -50]);
$r = http($admin, 'POST', '/split.php', ['action' => 'status']);
$me55 = $r['json']['me'] ?? [];
it_check('§55 the owner hosts a cottage the account doesn’t hold: they are paid out', ($r['json']['role'] ?? '') === 'paid' && ($r['json']['holder_first'] ?? '') === 'Hollie', $r['raw']);
it_check('§55 their money is the cottage’s, after the card fee (500 − 8.50 + 300)', abs((float) ($me55['share'] ?? 0) - 791.50) < 0.005, json_encode($me55));
it_check('§55 nothing counts as sent until the name is theirs, but the payment to it is offered', abs((float) ($me55['sent'] ?? -1)) < 0.005 && ($me55['candidates']['exact']['count'] ?? 0) === 1 && abs((float) ($me55['candidates']['exact']['total'] ?? 0) - 200) < 0.005, json_encode($me55['candidates'] ?? null));
it_check('§55 every booking is owed, each after its own fee', count($me55['due'] ?? []) === 2 && abs(array_sum(array_column($me55['due'] ?? [], 'amount')) - 791.50) < 0.005, json_encode($me55['due'] ?? null));
$r = http($admin, 'POST', '/split.php', ['action' => 'link', 'admin_id' => $h55, 'name' => 'Hollie Holder']);
it_check('§55 a name can only be linked to someone who is paid out', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'link', 'admin_id' => $ownerId, 'name' => $ownName]);
it_check('§55 linking the name sorts the payment already there', $r['code'] === 200 && ($r['json']['count'] ?? 0) === 1 && abs((float) ($r['json']['total'] ?? 0) - 200) < 0.005, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'status']);
$me55 = $r['json']['me'] ?? [];
it_check('§55 sent £200: what is still owed is the rest, the earliest booking first', abs((float) ($me55['sent'] ?? 0) - 200) < 0.005 && abs((float) ($me55['owed'] ?? 0) - 591.50) < 0.005
    && count($me55['due'] ?? []) === 2 && abs((float) ($me55['due'][0]['amount'] ?? 0) - 291.50) < 0.005 && ($me55['due'][0]['name'] ?? '') === 'Liam Card55', json_encode($me55['due'] ?? null));
it_check('§55 the payment to someone else is not theirs', (string) $rootDb->query("SELECT COALESCE(sorted_as,'') FROM bank_lines WHERE ext_key = 'm:tx_it55_2'")->fetchColumn() === '', '');
// A new statement with a transfer to the linked name sorts itself, by name, as paid to them.
$csv55 = "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Balance,Balance currency\n"
    . 'tx_it55_3,' . date('d/m/Y') . ',09:00:00,Faster payment,' . strtoupper($ownName) . ",,General,-591.50,GBP,-591.50,GBP,,,,Cottage Oct,,500.00,GBP\n";
$r = http($admin, 'POST', '/statements.php', ['action' => 'import', 'csv' => $csv55, 'filename' => 'it55.csv', 'since' => '']);
$row55 = $rootDb->query("SELECT sorted_as, admin_id FROM bank_lines WHERE ext_key = 'm:tx_it55_3'")->fetch(PDO::FETCH_ASSOC);
it_check('§55 a later transfer to the same name sorts itself as theirs, as it arrives', ($r['json']['summary']['auto'] ?? 0) === 1 && ($row55['sorted_as'] ?? '') === 'person' && (int) ($row55['admin_id'] ?? 0) === $ownerId, json_encode([$r['json']['summary'] ?? null, $row55]));
$r = http($admin, 'POST', '/split.php', ['action' => 'status']);
it_check('§55 …and that pays them up: nothing owed, no bookings left', abs((float) ($r['json']['me']['owed'] ?? 1)) < 0.005 && ($r['json']['me']['due'] ?? [1]) === [], json_encode($r['json']['me'] ?? null));
// The other way round: the owner holds the account, and someone else is paid out.
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => $ownerId, 'hosts' => [$pk55 => $h55]]);
$r = http($admin, 'POST', '/split.php', ['action' => 'status']);
$po55 = $r['json']['paid_out'][0] ?? [];
it_check('§55 the holder sees the account’s side and who is paid out', ($r['json']['role'] ?? '') === 'holder' && ($po55['id'] ?? 0) === $h55 && abs((float) ($po55['share'] ?? 0) - 791.50) < 0.005 && abs((float) ($po55['sent'] ?? -1)) < 0.005, $r['raw']);
it_check('§55 …and the paid-out cottage is not one of theirs', !in_array($pk55, array_column($r['json']['mine'] ?? [], 'k'), true) && array_key_exists('profit', $r['json'] ?? []), json_encode($r['json']['mine'] ?? null));
$r = http($admin, 'POST', '/statements.php', ['action' => 'mark', 'id' => (int) $rootDb->query("SELECT id FROM bank_lines WHERE ext_key = 'm:tx_it55_2'")->fetchColumn(), 'as' => 'person', 'admin_id' => $ownerId]);
it_check('§55 a payment can’t be marked as paid to someone who isn’t paid out', $r['code'] === 400, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'unlink', 'admin_id' => $ownerId, 'name' => $ownName]);
it_check('§55 unlinking puts the payments to that name back to sort', $r['code'] === 200 && ($r['json']['count'] ?? 0) === 2 && (int) $rootDb->query("SELECT COUNT(*) FROM bank_lines WHERE sorted_as = 'person'")->fetchColumn() === 0, $r['raw']);
$r = http($guest, 'GET', '/content.php');
it_check('§55 whose money is whose never reaches the public content', $r['code'] === 200 && isset($r['json']['content']) && !isset($r['json']['content']['money-split']), mb_substr($r['raw'], 0, 120));
it_check('§55 a visitor is refused', http($guest, 'POST', '/split.php', ['action' => 'status'])['code'] === 401, '');
$rootDb->exec("DELETE FROM bank_lines WHERE ext_key LIKE 'm:tx_it55_%'");
$rootDb->exec("DELETE FROM payments WHERE booking_id IN ($bc55, $bb55)");
$rootDb->exec("DELETE FROM bookings WHERE id IN ($bc55, $bb55)");
$rootDb->exec("DELETE FROM content WHERE item_key = 'money-split'");
$rootDb->exec("DELETE FROM admins WHERE id = $h55");

// ── §56 malformed and over-long input answers in words ─────────────────────
// An array where text belongs threw a TypeError (a "Site error detected" push to
// the owner), and text longer than its column was rejected by the database and
// reported as "Something went wrong on our side" — or blamed on migrations.
echo "\n== \u{00A7}56 malformed and over-long input answers in words ==\n";
$rootDb->exec("DELETE FROM login_attempts"); // earlier sections spent the public rate limits
$errs56 = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'server.error'")->fetchColumn();
$errsBefore56 = $errs56();
$anon56 = [];
$r = http($anon56, 'POST', '/waitlist.php', ['action' => 'join', 'prop' => $propKey, 'name' => ['x'], 'email' => 'w56@gmail.com']);
it_check('§56 an array where a name belongs is answered, not a server error', $r['code'] < 500 && is_array($r['json']), $r['raw']);
$r = http($anon56, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'nobody56', 'password' => ['x']]);
it_check('§56 an array for a password is refused like a wrong password', $r['code'] === 401, $r['raw']);
$add56 = fn($pc) => http($admin, 'POST', '/bookings.php', ['action' => 'add', 'prop_key' => $propKey, 'name' => 'Long Postcode', 'check_in' => $dd(940), 'check_out' => $dd(943), 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'postcode' => $pc]);
$r = $add56('D02 X285 Ireland');
it_check('§56 a postcode longer than its column is refused, naming the postcode', $r['code'] === 400 && ($r['json']['field'] ?? '') === 'postcode' && stripos((string) ($r['json']['error'] ?? ''), 'postcode') !== false, $r['raw']);
$r = $add56('D02 X285');
it_check('§56 …while one that fits saves', ($r['json']['ok'] ?? false) === true, $r['raw']);
$r = http($admin, 'POST', '/experiences.php', ['action' => 'save', 'title' => '§56 Long', 'distance' => str_repeat('x', 85)]);
it_check('§56 a Things-to-do field too long is named, not blamed on migrations', $r['code'] === 400 && ($r['json']['field'] ?? '') === 'distance', $r['raw']);
it_check('§56 and none of it logged a server error', $errs56() === $errsBefore56, 'server.error rows: ' . ($errs56() - $errsBefore56));
$rootDb->exec("DELETE FROM bookings WHERE name = 'Long Postcode'");
$rootDb->exec("DELETE FROM experiences WHERE title LIKE '§56%'");

// (b) THE ACTIVITY LOG CANNOT BE FLOODED AWAY. Anyone can POST a CSP report for a
// made-up host (each one a new de-dupe signature), and the daily prune kept only
// the newest 5,000 rows, so enough reports erased the owner's real history.
$rootDb->exec("DELETE FROM activity_log WHERE action = 'csp.violation'");
for ($i = 0; $i < 15; $i++) {
    $ch = curl_init($BASE . '/csp-report.php');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Content-Type: application/csp-report'],
        CURLOPT_POSTFIELDS => json_encode(['csp-report' => ['violated-directive' => 'img-src', 'blocked-uri' => 'https://made-up-' . $i . '.example/x.png']])]);
    curl_exec($ch);
    curl_close($ch);
}
$cspN = (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'csp.violation'")->fetchColumn();
it_check('§56 one address can add at most 10 CSP reports an hour', $cspN === 10, 'rows=' . $cspN);
// …and a real warning stays in Needs attention under a pile of machine reports.
// (Earlier sections' warnings are cleared first: the list shows six groups.)
$rootDb->exec("DELETE FROM activity_log WHERE severity IN ('warn', 'action')");
$rootDb->exec("INSERT INTO activity_log (actor, category, action, summary, severity) VALUES ('system', 'payment', 'deposit.owed', '§56 A deposit is owed back', 'warn')");
$owedId = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO activity_log (actor, category, action, summary, severity) SELECT 'system', 'security', 'csp.violation', CONCAT('§56 noise ', n), 'warn' FROM (SELECT a.N + b.N * 10 + c.N * 100 + d.N * 1000 AS n FROM (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a, (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b, (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) c, (SELECT 0 N UNION SELECT 1) d) t WHERE n < 1200");
$r = http($admin, 'POST', '/activity-log.php', ['action' => 'summary']);
$owedSeen = false;
foreach (($r['json']['needs'] ?? []) as $g) {
    if (in_array($owedId, array_map('intval', (array) ($g['ids'] ?? [])), true)) { $owedSeen = true; }
}
it_check('§56 a real warning is still in Needs attention under 1,200 newer machine reports', $owedSeen, substr($r['raw'], 0, 200));
$rootDb->exec("DELETE FROM activity_log WHERE summary LIKE '§56%' OR action = 'csp.violation'");
// (c) ONE INBOX GETS AT MOST TEN SIGN-IN EMAILS A DAY, however many connections
// ask. Each request below clears the per-sender throttles first (as a fresh
// address would arrive with none), so only the shared daily allowance can stop it.
$codeLogs = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'guest.code'")->fetchColumn();
$codeBefore = $codeLogs();
$bombAnswers = [];
for ($i = 0; $i < 12; $i++) {
    $rootDb->exec("DELETE FROM login_attempts WHERE identifier NOT LIKE 'mailto:%'");
    $rb = http($anon56, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'bomb56@gmail.com']);
    $bombAnswers[] = $rb['code'] . ' ' . json_encode(array_diff_key((array) ($rb['json'] ?? []), ['srv' => 1])); // srv is the clock
}
it_check('§56 twelve code requests for one inbox send ten emails', $codeLogs() - $codeBefore === 10, 'sent ' . ($codeLogs() - $codeBefore));
it_check('§56 …and every request is answered the same way', count(array_unique($bombAnswers)) === 1 && strpos($bombAnswers[0], '200 {"ok":true') === 0, implode(' | ', array_unique($bombAnswers)));
$rootDb->exec("DELETE FROM login_attempts");
// (d) A SIGN-IN FOR NOBODY TAKES AS LONG AS ONE FOR SOMEBODY. The dummy hash was a
// fixed cost 12 beside cost-10 accounts, so an unknown name answered four times
// slower; and an account with no password answered at once.
it_check('§56 the dummy hash costs what this PHP makes a real one cost', !password_needs_rehash(auth_dummy_hash(), PASSWORD_DEFAULT), auth_dummy_hash());
it_check('§56 …and it is what an absent account or an empty password is checked against',
    auth_hash_for(false) === auth_dummy_hash() && auth_hash_for(['password_hash' => '']) === auth_dummy_hash() && auth_hash_for(['password_hash' => '$2y$10$x']) === '$2y$10$x');
// (e) SIGNING OUT ENDS THE SESSION, not just the name on it.
$lo = [];
http($lo, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-123']);
$loOld = (string) ($lo['PHPSESSID'] ?? '');
http($lo, 'POST', '/auth.php', ['action' => 'admin_logout']);
it_check('§56 signing out issues a new session id', $loOld !== '' && ($lo['PHPSESSID'] ?? '') !== '' && ($lo['PHPSESSID'] ?? '') !== $loOld, $loOld . ' → ' . ($lo['PHPSESSID'] ?? ''));
$loStale = ['PHPSESSID' => $loOld];
$r = http($loStale, 'POST', '/auth.php', ['action' => 'admin_status']);
it_check('§56 …and the old id is signed in as nobody', ($r['json']['admin'] ?? null) === false, $r['raw']);
$cronSrc56 = preg_replace('#//[^\n]*#', '', (string) file_get_contents(__DIR__ . '/cron.php'));
it_check('§56 the daily prune keeps history by age, not by a bare row count', strpos($cronSrc56, 'OFFSET 5000') === false && strpos($cronSrc56, 'INTERVAL 3 YEAR') !== false, '');
it_check('§56 …and lets go of the address a row came from after 90 days', (bool) preg_match('/UPDATE activity_log SET ip = NULL WHERE ip IS NOT NULL AND created_at < \(NOW\(\) - INTERVAL 90 DAY\)/', $cronSrc56), '');
// The statement itself, on the real schema (the source check cannot see a typo in SQL).
$rootDb->exec("USE `$DB_NAME`");
$rootDb->exec("INSERT INTO activity_log (actor, category, action, summary, ip, created_at) VALUES ('system', 'system', 'it56.old', '§56 old', '203.0.113.9', NOW() - INTERVAL 100 DAY), ('system', 'system', 'it56.new', '§56 new', '203.0.113.10', NOW() - INTERVAL 5 DAY)");
$rootDb->exec('UPDATE activity_log SET ip = NULL WHERE ip IS NOT NULL AND created_at < (NOW() - INTERVAL 90 DAY)');
it_check('§56 …an old row keeps its line and loses its address; a recent one keeps both',
    $rootDb->query("SELECT ip FROM activity_log WHERE action = 'it56.old'")->fetchColumn() === null
    && $rootDb->query("SELECT ip FROM activity_log WHERE action = 'it56.new'")->fetchColumn() === '203.0.113.10', '');

// ── §57 the reads that run on every booking page, send and limit check can use an index ──
// activity_log is kept for three years under a 200,000-row ceiling, and a booking
// page's feed, the send guard and the per-hour caps scanned all of it. The plan is
// read from EXPLAIN's possible_keys — whether an index is USABLE, which is what
// was missing, and unlike the optimiser's final choice it does not depend on how
// few rows this harness holds.
echo "\n== §57 the hot reads can use an index ==\n";
$rootDb->exec("USE `$DB_NAME`");
$keys57 = function (string $sql, array $args = []) use ($rootDb) {
    $st = $rootDb->prepare('EXPLAIN ' . $sql);
    $st->execute($args);
    return implode(',', array_map(fn($r) => (string) ($r['possible_keys'] ?? ''), $st->fetchAll(PDO::FETCH_ASSOC)));
};
foreach ([
    ['a booking page\'s feed', "SELECT action, summary, actor, created_at FROM activity_log WHERE entity = 'booking' AND entity_id = ? ORDER BY id DESC LIMIT 80", ['42'], 'idx_activity_entity'],
    ['the send guard', "SELECT created_at FROM activity_log WHERE entity = 'booking' AND entity_id = ? AND action = ? AND created_at >= (NOW() - INTERVAL 180 SECOND) ORDER BY created_at DESC LIMIT 1", ['42', 'payment.request'], 'idx_activity_entity'],
    ['the per-hour report caps', "SELECT SUM(ip = ?) AS mine, COUNT(*) AS allr FROM activity_log WHERE action = 'csp.violation' AND created_at > (NOW() - INTERVAL 1 HOUR)", ['1.2.3.4'], 'idx_activity_action'],
    ['the per-account limits', 'SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND attempted_at > (NOW() - INTERVAL 1 DAY)', ['mailto:x'], 'idx_attempt_ident'],
    ['a guest\'s own enquiries', 'SELECT * FROM enquiries WHERE email = ?', ['g@example.org'], 'idx_enq_email'],
] as [$what, $sql, $args, $want]) {
    $have = $keys57($sql, $args);
    it_check("§57 $what can use $want", strpos($have, $want) !== false, $have);
}

// ── §58 the booking sheet's money (the add/edit audit) ──
// Each of these was reproduced on a full stack: the sheet promised one thing and the
// save stored another. Driven through the real endpoint; the browser half is
// ui-test-bookingsheet.js.
echo "\n== §58 the booking sheet's money ==\n";
$rootDb->exec("USE `$DB_NAME`");
$rootDb->exec('DELETE FROM login_attempts');
$row58 = function ($id) use ($rootDb) {
    $q = $rootDb->prepare('SELECT * FROM bookings WHERE id = ?');
    $q->execute([(int) $id]);
    return $q->fetch(PDO::FETCH_ASSOC) ?: [];
};
$add58 = function ($ci, $co, $name, $extra = []) use (&$admin, $propKey) {
    return http($admin, 'POST', '/bookings.php', array_merge(['action' => 'add', 'prop_key' => $propKey, 'name' => $name, 'email' => '', 'phone' => '', 'check_in' => $ci, 'check_out' => $co, 'adults' => 2, 'children' => 0, 'payment' => 'unpaid', 'override_clash' => true, 'send_confirmation' => false], $extra));
};
$upd58 = function ($id, $extra = []) use (&$admin) {
    return http($admin, 'POST', '/bookings.php', array_merge(['action' => 'update', 'id' => (int) $id], $extra));
};
// (a) "All of it" on Add records the refundable deposit when the sheet says it came too.
$r = $add58($dd(700), $dd(703), 'All Of It', ['payment' => 'paid', 'payment_date' => $dd(0), 'payment_method' => 'Cash', 'deposit_collected' => true]);
$b58a = $row58($r['json']['id'] ?? 0);
$dep58 = round((float) ($b58a['agreed_booking_fee'] ?? 0), 2);
it_check('§58 "All of it" with the deposit records the rental AND the refundable deposit', $r['code'] === 200 && $dep58 > 0 && abs((float) $b58a['deposit_paid'] - ((float) $b58a['agreed_total'] + $dep58)) < 0.005 && $b58a['payment'] === 'paid', json_encode($b58a));
$r = $add58($dd(704), $dd(707), 'Rental Only', ['payment' => 'paid', 'payment_date' => $dd(0), 'payment_method' => 'Cash']);
$b58a2 = $row58($r['json']['id'] ?? 0);
it_check('§58 …without the flag it is the rental alone, as before', abs((float) $b58a2['deposit_paid'] - (float) $b58a2['agreed_total']) < 0.005, json_encode($b58a2));
// (b) Clearing a custom price set when the booking was added restores the standard one.
$r = $add58($dd(710), $dd(713), 'Custom Then Standard', ['price_override' => 250, 'price_reason' => 'Friends & family']);
$id58b = (int) ($r['json']['id'] ?? 0);
$b58b = $row58($id58b);
it_check('§58 a custom price on Add is stored as the override and the total', abs((float) $b58b['price_override'] - 250) < 0.005 && abs((float) $b58b['agreed_total'] - 250) < 0.005, json_encode($b58b));
$r = $upd58($id58b, ['price_override' => '', 'price_reason' => '']);
$b58b = $row58($id58b);
$std58 = round((float) $b58b['agreed_nightly'] + (float) $b58b['agreed_txn_fee'], 2);
it_check('§58 clearing it restores the standard total, not the old custom one', $r['code'] === 200 && $b58b['price_override'] === null && abs((float) $b58b['agreed_total'] - $std58) < 0.005 && abs($std58 - 250) > 0.5, json_encode($b58b));
// (c) A new refundable deposit keeps the agreed nights at their agreed price.
$r = $add58($dd(720), $dd(723), 'Deposit Only');
$id58c = (int) ($r['json']['id'] ?? 0);
$b58c0 = $row58($id58c);
$rate58 = (float) $rootDb->query("SELECT couple_rate FROM properties WHERE prop_key = " . $rootDb->quote($propKey))->fetchColumn();
$rootDb->prepare('UPDATE properties SET couple_rate = ? WHERE prop_key = ?')->execute([$rate58 + 40, $propKey]);
$newDep58 = max(0.0, round((float) $b58c0['agreed_booking_fee'] - 25, 2));
$r = $upd58($id58c, ['damages_deposit' => $newDep58]);
$b58c = $row58($id58c);
$rootDb->prepare('UPDATE properties SET couple_rate = ? WHERE prop_key = ?')->execute([$rate58, $propKey]);
it_check('§58 a deposit-only change keeps the agreed rental (rates have risen since)', $r['code'] === 200 && abs((float) $b58c['agreed_total'] - (float) $b58c0['agreed_total']) < 0.005 && abs((float) $b58c['agreed_nightly'] - (float) $b58c0['agreed_nightly']) < 0.005, json_encode([$b58c0['agreed_total'], $b58c['agreed_total'], $b58c['agreed_nightly']]));
it_check('§58 …moves the deposit, and counts as a change the confirmation states', abs((float) $b58c['agreed_booking_fee'] - $newDep58) < 0.005 && ($r['json']['material'] ?? null) === true, $r['raw']);
// (d) Money recorded without a date (record_square_payment's old write) no longer
// blocks every later edit.
$r = $add58($dd(730), $dd(733), 'No Date Money');
$id58d = (int) ($r['json']['id'] ?? 0);
$rootDb->exec("UPDATE bookings SET deposit_paid = 100, payment = 'deposit', payment_date = NULL WHERE id = $id58d");
$r = $upd58($id58d, ['phone' => '07700 900058']);
$b58d = $row58($id58d);
it_check('§58 an edit that sends no payment fields saves without a payment date', $r['code'] === 200 && $b58d['phone'] === '07700 900058' && abs((float) $b58d['deposit_paid'] - 100) < 0.005, $r['raw']);
$r = $upd58($id58d, ['payment' => 'deposit', 'deposit' => 150]);
it_check('§58 …while an edit that records money still needs one', $r['code'] === 400 && strpos((string) ($r['json']['error'] ?? ''), 'payment date') !== false, $r['raw']);
// (e) The owner editing an enquiry agrees exceptions; the refusals left are theirs.
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'One Night Owner Edit', 'email' => 'one58@example.com', 'check_in' => $dd(740), 'check_out' => $dd(741), 'adults' => 2, 'children' => 0, 'message' => '']);
it_check('§58 an owner can move an enquiry to a stay under the minimum (an exception is theirs)', $r['code'] === 200 && !empty($r['json']['id']), $r['raw']);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'prop_key' => $propKey, 'name' => 'Clash Owner Edit', 'email' => 'clash58@example.com', 'check_in' => $dd(720), 'check_out' => $dd(722), 'adults' => 2, 'children' => 0, 'message' => '']);
it_check('§58 …and a clash is refused in the owner\'s words, not "Sorry, those dates are no longer available"', $r['code'] === 409 && strpos((string) ($r['json']['error'] ?? ''), 'enquiry can’t move onto them') !== false, $r['raw']);

// ── §59 each pound once, on the day it moved (the money split and bank audit) ──
// Every case here was reproduced on a full stack: a payment recorded twice from one
// stale figure, income moved into a later tax year, a refund restating a closed
// year, a cancelled stay's money landing on nobody's cottage, a kept deposit and an
// archived cottage left out of the split, and a link's Undo taking more than it gave.
echo "\n== §59 each pound once, on the day it moved ==\n";
$rootDb->exec("USE `$DB_NAME`");
$rootDb->exec('DELETE FROM login_attempts');
$manual59 = function ($id) use ($rootDb) {
    $q = $rootDb->prepare("SELECT ROUND(amount,2) a, DATE(created_at) d FROM payments WHERE booking_id = ? AND kind = 'manual' ORDER BY created_at, id");
    $q->execute([(int) $id]);
    return array_map(fn($r) => [(float) $r['a'], (string) $r['d']], $q->fetchAll(PDO::FETCH_ASSOC));
};
$sp59 = function ($id, $extra) use (&$admin, $dd) {
    return http($admin, 'POST', '/bookings.php', array_merge(['action' => 'set_payment', 'id' => (int) $id, 'payment' => 'deposit', 'payment_date' => $dd(0), 'payment_method' => 'Bank transfer'], $extra));
};
$inYear59 = function ($year, $id) use ($acctGet) {
    $j = $acctGet($year)['json'] ?? [];
    $rows = array_values(array_filter($j['payments'] ?? [], fn($p) => (int) $p['id'] === (int) $id));
    return ['sum' => round(array_sum(array_map(fn($p) => (float) $p['income_part'], $rows)), 2), 'rows' => $rows];
};
$ty59 = (date('m-d') < '04-06' ? (int) date('Y') - 1 : (int) date('Y'));
// (a) A payment worked out from a figure that has since moved is refused, not written.
$r = $add58($dd(760), $dd(767), 'Stale Write');
$id59a = (int) ($r['json']['id'] ?? 0);
$r = $sp59($id59a, ['deposit' => 100, 'expect_paid' => 0]);
it_check('§59 a payment recorded from the figure the page loaded is saved', $r['code'] === 200 && abs((float) $row58($id59a)['deposit_paid'] - 100) < 0.005, $r['raw']);
$r = $sp59($id59a, ['deposit' => 150, 'expect_paid' => 0]);
$m59a = $manual59($id59a);
it_check('§59 …a second one worked out from the same stale figure is refused and changes nothing', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'stale'
    && abs((float) $row58($id59a)['deposit_paid'] - 100) < 0.005 && count($m59a) === 1 && abs($m59a[0][0] - 100) < 0.005, $r['raw'] . ' ' . json_encode($m59a));
$r = $sp59($id59a, ['deposit' => 250, 'expect_paid' => 100]);
it_check('§59 …and from the figure now there, both payments add up', $r['code'] === 200 && abs((float) $row58($id59a)['deposit_paid'] - 250) < 0.005 && abs(array_sum(array_column($manual59($id59a), 0)) - 250) < 0.005, $r['raw']);
$r = $sp59($id59a, ['deposit' => 260]);
it_check('§59 a caller that does not say what it started from is still served', $r['code'] === 200 && abs((float) $row58($id59a)['deposit_paid'] - 260) < 0.005, $r['raw']);
// (b) Money recorded with a booking, or before the ledger kept cash rows, keeps its own date.
$r = $add58($dd(770), $dd(777), 'Dated Add', ['payment' => 'deposit', 'deposit' => 120, 'payment_date' => ($ty59 - 1) . '-09-01', 'payment_method' => 'Bank transfer']);
$id59b = (int) ($r['json']['id'] ?? 0);
it_check('§59 money recorded with a booking gets a ledger row on its own day', $manual59($id59b) === [[120.0, ($ty59 - 1) . '-09-01']], json_encode($manual59($id59b)));
$r = $sp59($id59b, ['deposit' => 300, 'expect_paid' => 120]);
it_check('§59 …so the next payment does not carry it into this tax year', $r['code'] === 200 && $manual59($id59b) === [[120.0, ($ty59 - 1) . '-09-01'], [180.0, $dd(0)]]
    && abs($inYear59($ty59 - 1, $id59b)['sum'] - 120) < 0.005 && abs($inYear59($ty59, $id59b)['sum'] - 180) < 0.005, json_encode($manual59($id59b)));
$legacy59 = function ($name, $method) use ($rootDb, $propKey, $dd, $ty59) {
    $rootDb->prepare("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date, payment_method) VALUES (?,?,'',?,?,2,0,'deposit',200,700,700,0,7,?,?)")
        ->execute([$propKey, $name, $dd(780), $dd(787), ($ty59 - 1) . '-08-15', $method]);
    return (int) $rootDb->lastInsertId();
};
$id59c = $legacy59('Legacy Cash59', 'Cash');
$r = $sp59($id59c, ['deposit' => 350, 'payment_method' => 'Cash', 'expect_paid' => 200]);
it_check('§59 money from before the ledger kept cash rows is dated on its own day before the date moves', $r['code'] === 200 && $manual59($id59c) === [[200.0, ($ty59 - 1) . '-08-15'], [150.0, $dd(0)]], json_encode($manual59($id59c)));
$id59d = $legacy59('Legacy Card59', 'Card');
$r = $sp59($id59d, ['deposit' => 350, 'expect_paid' => 200]);
it_check('§59 …but not money recorded as a card, whose own card row is coming', $r['code'] === 200 && $manual59($id59d) === [[150.0, $dd(0)]], json_encode($manual59($id59d)));
// (c) A refund comes off in the year it went back; a closed year keeps what it received.
$card59 = function ($name, $paid, $charge, $chargeAt, $refund, $refundAt) use ($rootDb, $propKey, $dd) {
    $rootDb->prepare("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date, payment_method) VALUES (?,?,'',?,?,2,0,?,?,400,400,0,4,?,'Square card')")
        ->execute([$propKey, $name, $dd(790), $dd(794), $paid > 0 ? 'deposit' : 'unpaid', $paid, substr($chargeAt, 0, 10)]);
    $id = (int) $rootDb->lastInsertId();
    $rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, prop_key, created_at) VALUES (?,'deposit',?,'COMPLETED',?,?,?)")->execute([$id, $charge, 'sq_it59_' . $id, $propKey, $chargeAt]);
    $rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, prop_key, created_at) VALUES (?,'refund',?,'COMPLETED',?,?,?)")->execute([$id, $refund, 'sq_it59r_' . $id, $propKey, $refundAt]);
    return $id;
};
$prev59 = $ty59 - 1;
$id59e = $card59('Refund Next Year', 250, 400, $prev59 . '-09-01 10:00:00', 150, $ty59 . '-05-10 10:00:00');
it_check('§59 a part refund in a later tax year leaves the year the money came in as it was', abs($inYear59($prev59, $id59e)['sum'] - 400) < 0.005, json_encode($inYear59($prev59, $id59e)));
it_check('§59 …and comes off the year it went back', abs($inYear59($ty59, $id59e)['sum'] + 150) < 0.005, json_encode($inYear59($ty59, $id59e)));
$id59f = $card59('Refund Same Year', 0, 300, $prev59 . '-09-02 10:00:00', 300, $prev59 . '-10-01 10:00:00');
it_check('§59 a stay refunded in full within one year is not listed at all, as before', !$inYear59($prev59, $id59f)['rows'] && !$inYear59($ty59, $id59f)['rows'], json_encode($inYear59($prev59, $id59f)));
// (d) A cancelled stay's money keeps its cottage, and its refund its own day.
$ghost59 = 999059;
$rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, fee, prop_key, guest_name, created_at) VALUES (?,'deposit',500,'COMPLETED','sq_it59_g',9.00,?,'Gone Fiftynine',?)")->execute([$ghost59, $propKey, $prev59 . '-11-01 10:00:00']);
$rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, prop_key, guest_name, created_at) VALUES (?,'refund',200,'COMPLETED','sq_it59_gr',?,'Gone Fiftynine',?)")->execute([$ghost59, $propKey, $ty59 . '-05-12 10:00:00']);
$g59 = $inYear59($prev59, $ghost59);
it_check('§59 a cancelled stay\'s money is still its cottage\'s', abs($g59['sum'] - 500) < 0.005 && ($g59['rows'][0]['prop_key'] ?? '') === $propKey && ($g59['rows'][0]['property_name'] ?? '') !== '', json_encode($g59));
it_check('§59 …and its refund comes off the year it went back', abs($inYear59($ty59, $ghost59)['sum'] + 200) < 0.005, json_encode($inYear59($ty59, $ghost59)));
// (e) The split: a cancelled stay and a kept deposit are the host's cottage's money,
// and an archived cottage still counts in the account's figures.
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Split Fiftynine', 'couple_rate' => 100]);
$pk59 = (string) ($r['json']['property']['prop_key'] ?? ($r['json']['prop_key'] ?? ''));
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Old Fiftynine', 'couple_rate' => 100]);
$pk59x = (string) ($r['json']['property']['prop_key'] ?? ($r['json']['prop_key'] ?? ''));
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, caps, created_at) VALUES ('holder59', 'x', 'Hana Holder', 'holder59@example.com', 0, '{\"money\":true}', NOW())");
$h59 = (int) $rootDb->lastInsertId();
$now59 = date('Y-m-d H:i:s');
$addPaid59 = function ($pk, $name, $rental, $method) use ($rootDb, $dd, $now59) {
    $rootDb->prepare("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, payment_date, payment_method) VALUES (?,?,'',?,?,2,0,'paid',?,?,?,0,3,?,?)")
        ->execute([$pk, $name, $dd(800), $dd(803), $rental, $rental, $rental, substr($now59, 0, 10), $method]);
    $id = (int) $rootDb->lastInsertId();
    $rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, prop_key, guest_name, created_at) VALUES (?,'manual',?,'MANUAL',?,?,?,?)")->execute([$id, $rental, 'man_it59_' . $id, $pk, $name, $now59]);
    return $id;
};
$kb59 = $addPaid59($pk59, 'Kept Fiftynine', 300, 'Cash');
$rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, prop_key, guest_name, created_at) VALUES (?,'damages',75,'COMPLETED','kept_it59',?,'Kept Fiftynine',?)")->execute([$kb59, $pk59, $now59]);
$rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, fee, prop_key, guest_name, created_at) VALUES (999159,'deposit',400,'COMPLETED','sq_it59_c',7.00,?,'Cancel Fiftynine',?)")->execute([$pk59, $now59]);
$xb59 = $addPaid59($pk59x, 'Old Cottage Guest', 200, 'Cash');
$rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, prop_key, guest_name, created_at) VALUES (?,'damages',40,'COMPLETED','kept_it59x',?,'Old Cottage Guest',?)")->execute([$xb59, $pk59x, $now59]);
$rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id, fee, prop_key, guest_name, created_at) VALUES (999160,'deposit',100,'COMPLETED','sq_it59_cx',3.00,?,'Cancel Old',?)")->execute([$pk59x, $now59]);
$r = http($admin, 'POST', '/rates.php', ['action' => 'archive', 'prop_key' => $pk59x, 'confirm_stays' => true]);
it_check('§59 the old cottage is archived', $r['code'] === 200, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => $h59, 'hosts' => [$pk59 => $ownerId]]);
$r = http($admin, 'POST', '/split.php', ['action' => 'status']);
$me59 = $r['json']['me'] ?? [];
$due59 = array_column((array) ($me59['due'] ?? []), null, 'booking_id');
it_check('§59 the host\'s share counts the cancelled stay (less its fee) and the kept deposit (393 + 300 + 75)', ($r['json']['role'] ?? '') === 'paid' && abs((float) ($me59['share'] ?? 0) - 768) < 0.005, json_encode($me59));
it_check('§59 …owed as the cancelled stay\'s own line and with the kept deposit on its booking', abs((float) ($due59[999159]['amount'] ?? 0) - 393) < 0.005 && strpos((string) ($due59[999159]['name'] ?? ''), '(cancelled)') !== false
    && abs((float) ($due59[$kb59]['amount'] ?? 0) - 375) < 0.005, json_encode($me59['due'] ?? null));
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => $ownerId, 'hosts' => [$pk59 => $h59]]);
$r = http($admin, 'POST', '/split.php', ['action' => 'status']);
$mine59 = array_column((array) ($r['json']['mine'] ?? []), null, 'k');
it_check('§59 the holder sees the same share for the host', ($r['json']['role'] ?? '') === 'holder' && abs((float) ($r['json']['paid_out'][0]['share'] ?? 0) - 768) < 0.005, json_encode($r['json']['paid_out'] ?? null));
it_check('§59 an archived cottage still counts in the account\'s figures: its stay, kept deposit and cancelled stay less its fee (200 + 40 + 100 − 3)', isset($mine59[$pk59x]) && abs((float) $mine59[$pk59x]['net'] - 337) < 0.005, json_encode($mine59[$pk59x] ?? array_keys($mine59)));
it_check('§59 …while nobody is asked to host it', !in_array($pk59x, array_column((array) ($r['json']['cottages'] ?? []), 'k'), true), json_encode($r['json']['cottages'] ?? null));
// (f) A link's Undo puts back only what that link sorted.
$ins59 = $rootDb->prepare("INSERT INTO bank_lines (ext_key, import_id, txn_date, txn_time, kind, name, category, description, notes, amount, balance) VALUES (?,0,?,'10:00:00','Faster payment','Link Fiftynine','','Cottage money','',?,0)");
$ins59->execute(['m:tx_it59_hand', date('Y-m-d'), -120]);
$hand59 = (int) $rootDb->lastInsertId();
$ins59->execute(['m:tx_it59_new', date('Y-m-d'), -80]);
$r = http($admin, 'POST', '/statements.php', ['action' => 'mark', 'id' => $hand59, 'as' => 'person', 'admin_id' => $h59]);
it_check('§59 a payment to that name sorted to them by hand first', $r['code'] === 200, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'link', 'admin_id' => $h59, 'name' => 'Link Fiftynine']);
$ids59 = (array) ($r['json']['ids'] ?? []);
it_check('§59 linking the name sorts the other and says which', $r['code'] === 200 && ($r['json']['count'] ?? 0) === 1 && count($ids59) === 1, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'unlink', 'admin_id' => $h59, 'name' => 'Link Fiftynine', 'ids' => $ids59]);
it_check('§59 its Undo puts that one back and keeps the one sorted by hand', $r['code'] === 200 && ($r['json']['count'] ?? 0) === 1
    && (string) $rootDb->query("SELECT COALESCE(sorted_as,'') FROM bank_lines WHERE ext_key = 'm:tx_it59_hand'")->fetchColumn() === 'person'
    && (string) $rootDb->query("SELECT COALESCE(sorted_as,'') FROM bank_lines WHERE ext_key = 'm:tx_it59_new'")->fetchColumn() === '', $r['raw']);
$rootDb->exec("DELETE FROM bank_lines WHERE ext_key LIKE 'm:tx_it59_%'");
$rootDb->exec("DELETE FROM payments WHERE booking_id IN (999059, 999159, 999160, $kb59, $xb59, $id59e, $id59f)");
$rootDb->exec("DELETE FROM bookings WHERE id IN ($kb59, $xb59, $id59e, $id59f)");
$rootDb->exec("DELETE FROM content WHERE item_key = 'money-split'");
$rootDb->exec("DELETE FROM admins WHERE id = $h59");

// ── §60 the automatic collector's due query, on the real schema ──
// test-autopay stubs the database, so it accepts any SQL; a broken clause here would
// fall back to the old query in silence. This runs the collector's own text.
echo "\n== §60 the automatic collector's due query reads the real schema ==\n";
require_once __DIR__ . '/autopay-lib.php';
$rootDb->exec("USE `$DB_NAME`");
$yd60 = date('Y-m-d', strtotime('-1 day'));
$ap60 = $rootDb->prepare("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, autopay_consent_at, autopay_card_id, autopay_amount, autopay_due, autopay_attempts, autopay_collected_for) VALUES (?,?,'',?,?,2,0,'deposit',100,400,400,0,3,NOW(),'ccof:it60',300,?,0,?)");
$ap60->execute([$propKey, 'Spent Plan60', $dd(830), $dd(833), $yd60, $yd60]);
$spent60 = (int) $rootDb->lastInsertId();
$ap60->execute([$propKey, 'Live Plan60', $dd(840), $dd(843), $yd60, null]);
$live60 = (int) $rootDb->lastInsertId();
$ids60 = function ($sql) use ($rootDb) {
    try {
        $q = $rootDb->prepare($sql);
        $q->execute([date('Y-m-d')]);
        return array_map('intval', array_column($q->fetchAll(PDO::FETCH_ASSOC), 'id'));
    } catch (\Throwable $e) {
        return ['error' => $e->getMessage()];
    }
};
$got60 = $ids60(autopay_due_sql(true));
it_check('§60 the due query runs on the real schema and leaves a plan already collected out', in_array($live60, $got60, true) && !in_array($spent60, $got60, true), json_encode($got60));
it_check('§60 …and its fallback (no spent clause) runs too', in_array($spent60, $ids60(autopay_due_sql(false)), true), '');
$rootDb->exec("DELETE FROM bookings WHERE id IN ($spent60, $live60)");

// §61 THE CALENDAR SYNC CAN'T LOSE A BOOKING. Through the real endpoints and tables:
// saving one platform's link keeps the others (the list used to be replaced whole
// from the page's copy, dropping any link it didn't know about with its stays);
// unlinking is one platform, its blocks with it; a booking moved onto another
// cottage meets that cottage's platform stay even at exactly its own dates (the
// echo skip compared the new cottage's blocks with the old cottage's dates); a
// proven platform guest is never our echo; the nightly audit reports one; and a
// removed cottage's calendar is not published.
echo "\n== §61 the calendar sync can't lose a booking ==\n";
$r = http($admin, 'POST', '/rates.php', ['action' => 'create', 'name' => 'Move Sixtyone', 'couple_rate' => 100]);
$p61 = $r['json']['property']['prop_key'] ?? ($r['json']['prop_key'] ?? '');
it_check('§61 a second cottage to sync and move onto', $p61 !== '', $r['raw']);
$feeds61 = function () use (&$admin, $p61) {
    $r = http($admin, 'POST', '/ical-import.php', ['action' => 'list', 'prop' => $p61]);
    $m = [];
    foreach ($r['json']['feeds'] ?? [] as $f) {
        $m[$f['source']] = $f['url'];
    }
    ksort($m);
    return $m;
};
$A1 = 'https://www.airbnb.com/calendar/ical/61.ics';
$A2 = 'https://www.airbnb.com/calendar/ical/61b.ics';
$V1 = 'http://www.vrbo.com/icalendar/61.ics';
http($admin, 'POST', '/ical-import.php', ['action' => 'save_feeds', 'prop' => $p61, 'feeds' => [['source' => 'airbnb', 'url' => $A1]]]);
$r = http($admin, 'POST', '/ical-import.php', ['action' => 'save_feeds', 'prop' => $p61, 'feeds' => [['source' => 'vrbo', 'url' => $V1]]]);
it_check('§61 saving a second platform\'s link keeps the first', $r['code'] === 200 && $feeds61() === ['airbnb' => $A1, 'vrbo' => $V1], json_encode($feeds61()));
http($admin, 'POST', '/ical-import.php', ['action' => 'save_feeds', 'prop' => $p61, 'feeds' => [['source' => 'airbnb', 'url' => $A2]]]);
it_check('§61 replacing one link leaves the other as it was', $feeds61() === ['airbnb' => $A2, 'vrbo' => $V1], json_encode($feeds61()));
$ib61 = $rootDb->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out, kind, label) VALUES (?,?,?,?,?,?,?)');
$ib61->execute([$p61, 'vrbo', 'it61-v', $dd(970), $dd(973), 'booking', 'Reserved - Vic']);
$ib61->execute([$p61, 'airbnb', 'it61-a', $dd(975), $dd(978), 'booking', 'Reserved']);
$ib61->execute([$p61, 'owner', 'it61-o', $dd(980), $dd(982), 'unknown', null]);
$srcs61 = function () use ($rootDb, $p61) {
    $q = $rootDb->prepare('SELECT source FROM ical_blocks WHERE prop_key = ? ORDER BY source');
    $q->execute([$p61]);
    return implode(',', $q->fetchAll(PDO::FETCH_COLUMN));
};
$r = http($admin, 'POST', '/ical-import.php', ['action' => 'unlink_feed', 'prop' => $p61, 'source' => 'vrbo']);
it_check('§61 unlinking one platform removes only its link', $r['code'] === 200 && $feeds61() === ['airbnb' => $A2], json_encode($feeds61()));
it_check('§61 …and only its stays (Airbnb and the owner\'s own block stay)', $srcs61() === 'airbnb,owner', $srcs61());
$r = http($admin, 'POST', '/ical-import.php', ['action' => 'unlink_feed', 'prop' => $p61, 'source' => 'owner']);
it_check('§61 the owner\'s own blocks cannot be "unlinked" (400, nothing removed)', $r['code'] === 400 && $srcs61() === 'airbnb,owner', $r['raw']);
$r = http($admin, 'POST', '/ical-import.php', ['action' => 'unlink_feed', 'prop' => $p61, 'source' => '']);
it_check('§61 an unlink that names no platform is refused', $r['code'] === 400, $r['raw']);
$q = $rootDb->prepare("SELECT COUNT(*) FROM activity_log WHERE action = 'ical.unlink' AND prop_key = ?");
$q->execute([$p61]);
it_check('§61 the unlink is in the activity log', (int) $q->fetchColumn() === 1);
it_check('§61 a guest cannot save or unlink links', http($guest, 'POST', '/ical-import.php', ['action' => 'unlink_feed', 'prop' => $p61, 'source' => 'airbnb'])['code'] === 401 && $feeds61() === ['airbnb' => $A2]);

// The move. A booking on the first cottage, an Airbnb stay on the second at
// EXACTLY its dates (kind 'unknown', so only the cottage check can catch it).
$r = $addBooking($dd(1260), $dd(1264), 'Moving Mo');
$mv61 = (int) ($r['json']['id'] ?? 0);
it_check('§61 the booking to move is created', $mv61 > 0, $r['raw']);
$ib61->execute([$p61, 'airbnb', 'it61-same', $dd(1260), $dd(1264), 'unknown', 'Airbnb']);
$mv = fn($pk, $extra = []) => http($admin, 'POST', '/bookings.php', array_merge([
    'action' => 'update', 'id' => $mv61, 'prop_key' => $pk, 'name' => 'Moving Mo', 'email' => '', 'phone' => '',
    'check_in' => $dd(1260), 'check_out' => $dd(1264), 'adults' => 2, 'children' => 0,
], $extra));
$r = $mv($p61);
it_check('§61 moving it onto another cottage\'s platform stay at the same dates asks first', $r['code'] === 200 && !empty($r['json']['clash']), $r['raw']);
it_check('§61 …naming what holds the dates', stripos((string) ($r['json']['message'] ?? ''), 'an Airbnb stay') !== false, (string) ($r['json']['message'] ?? ''));
$q = $rootDb->prepare('SELECT prop_key FROM bookings WHERE id = ?');
$q->execute([$mv61]);
it_check('§61 …and nothing moved', (string) $q->fetchColumn() === (string) $propKey);

// The echo on its OWN cottage: our "Booked" coming back is skipped; a proven guest is
// not. An edit that changes no dates runs no clash check at all, so each case extends
// the stay by a night — the check then compares the block with the STORED dates.
$ib61->execute([$propKey, 'vrbo', 'it61-echo', $dd(1260), $dd(1264), 'booking', 'Booked']);
$r = $mv($propKey, ['check_out' => $dd(1265)]);
it_check('§61 our own booking coming back as "Booked" is still the echo (no question)', $r['code'] === 200 && empty($r['json']['clash']), $r['raw']);
$rootDb->prepare('UPDATE bookings SET check_out = ? WHERE id = ?')->execute([$dd(1264), $mv61]);
$rootDb->exec("UPDATE ical_blocks SET label = 'Reserved', uid = 'it61-real' WHERE uid = 'it61-echo'");
$r = $mv($propKey, ['check_out' => $dd(1265)]);
it_check('§61 a proven platform guest at exactly its dates is never the echo — it asks', $r['code'] === 200 && !empty($r['json']['clash']), $r['raw']);
$r = http($guest, 'GET', '/conflict-audit.php?cron=' . $SECRET);
$q = $rootDb->prepare("SELECT summary FROM activity_log WHERE action = 'booking.conflict' AND prop_key = ? AND summary LIKE ? ORDER BY id DESC LIMIT 1");
$q->execute([$propKey, '%Moving Mo%']);
$sum61 = (string) $q->fetchColumn();
it_check('§61 the nightly audit reports it as a double booking', $r['code'] === 200 && stripos($sum61, 'Double booking') !== false && stripos($sum61, 'a Vrbo stay') !== false, $sum61 . ' ' . $r['raw']);
$rootDb->exec("DELETE FROM ical_blocks WHERE uid IN ('it61-real', 'it61-same')");

// A removed cottage's calendar is not public.
$r = http($admin, 'POST', '/rates.php', ['action' => 'archive', 'prop_key' => $p61]);
it_check('§61 a cottage with stays still to come is not removed in one tap: it says what removing it takes away', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'stays_ahead' && strpos((string) ($r['json']['error'] ?? ''), 'key safes') !== false && (int) $rootDb->query('SELECT COUNT(*) FROM properties WHERE archived_at IS NULL AND prop_key = ' . $rootDb->quote($p61))->fetchColumn() === 1, $r['raw']);
$r = http($admin, 'POST', '/rates.php', ['action' => 'archive', 'prop_key' => $p61, 'confirm_stays' => true]);
it_check('§61 the second cottage is removed once the owner confirms', $r['code'] === 200, $r['raw']);
$pubA = http($guest, 'GET', '/availability.php?prop=' . urlencode($p61));
$admA = http($admin, 'GET', '/availability.php?prop=' . urlencode($p61));
it_check('§61 a removed cottage\'s calendar is not published to a visitor', ($pubA['json']['ranges'] ?? null) === [], $pubA['raw']);
it_check('§61 …while the owner still sees it', count($admA['json']['ranges'] ?? []) >= 1, $admA['raw']);
$rootDb->prepare('DELETE FROM ical_blocks WHERE prop_key = ?')->execute([$p61]);
$rootDb->prepare('DELETE FROM bookings WHERE id = ?')->execute([$mv61]);

echo "\n== §62 who is who: a typed email is not proof ==\n";
// Anyone can type a guest's email into the website chat, and registering an address
// is not owning it. The owner's Inbox, the push lookup, the reset link and the
// photo wall all used to take the address at its word.
$rootDb->exec("USE `$DB_NAME`");
$rootDb->exec("DELETE FROM login_attempts WHERE identifier IN ('chat', 'guestcode', 'register')");
$w62 = 'wren62-' . bin2hex(random_bytes(3)) . '@gmail.com';
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Wren Real'," . $rootDb->quote($w62) . ",'2031-06-02','2031-06-05',2,0,'paid',300,300,300,0,3)");
$w62Bid = (int) $rootDb->lastInsertId();
$thr62 = function ($tid) use ($admin) {
    $j = $admin;
    $r = http($j, 'POST', '/messages.php', ['action' => 'list']);
    foreach ($r['json']['threads'] ?? [] as $t) {
        if ((int) ($t['thread_id'] ?? 0) === (int) $tid) {
            return $t;
        }
    }
    return null;
};
// (a) A website visitor types the booked guest's name and email.
$imp62 = [];
$tok62 = bin2hex(random_bytes(16));
$r = http($imp62, 'POST', '/messages.php', ['action' => 'send', 'token' => $tok62, 'name' => 'Wren Real', 'email' => $w62, 'body' => 'The key safe code is not working']);
$imp62Tid = (int) $rootDb->query('SELECT id FROM chat_threads WHERE token = ' . $rootDb->quote($tok62))->fetchColumn();
it_check('§62 (fixture) a website chat is started with a booked guest\'s email', $r['code'] === 200 && $imp62Tid > 0, $r['raw']);
$t = $thr62($imp62Tid);
it_check('§62 the owner\'s chat list marks it NOT verified', is_array($t) && ($t['verified'] ?? null) === false, json_encode($t));
$r = http($admin, 'POST', '/messages.php', ['action' => 'thread', 'thread_id' => $imp62Tid]);
it_check('§62 …and the thread carries none of that guest\'s bookings', $r['code'] === 200 && ($r['json']['thread']['verified'] ?? null) === false && ($r['json']['bookings'] ?? null) === [], substr($r['raw'], 0, 300));
// (b) A guest account: unproven, then proven in the browser that registered it.
$g62 = 'gina62-' . bin2hex(random_bytes(3)) . '@gmail.com';
$gj62 = [];
$r = http($gj62, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Gina Sixtytwo', 'email' => $g62, 'password' => 'ginapass12', 'address' => '6 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$gid62 = (int) $rootDb->query('SELECT id FROM guests WHERE email = ' . $rootDb->quote($g62))->fetchColumn();
it_check('§62 (fixture) a new account signs in, unproven', !empty($r['json']['guest']) && $gid62 > 0, $r['raw']);
http($gj62, 'POST', '/messages.php', ['action' => 'send', 'body' => 'Hello from my account']);
$gt62 = (int) $rootDb->query("SELECT id FROM chat_threads WHERE guest_id = $gid62")->fetchColumn();
$t = $thr62($gt62);
it_check('§62 an unproven account\'s chat is not verified either', $gt62 > 0 && ($t['verified'] ?? null) === false && ($t['is_guest'] ?? null) === true, json_encode($t));
$sub62 = ['endpoint' => 'https://fcm.googleapis.com/fcm/send/it62-' . bin2hex(random_bytes(4)), 'keys' => ['p256dh' => 'BPit62', 'auth' => 'ait62']];
$r = http($gj62, 'POST', '/push.php', ['action' => 'subscribe', 'subscription' => $sub62]);
it_check('§62 an unproven account cannot add a phone for alerts', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'email_unproven', $r['raw']);
$gidFor62 = fn($em) => $mailProbe('require_once __DIR__ . "/webpush.php";' . "\n" . 'echo "\n" . json_encode(["id" => guest_id_for_email(' . var_export($em, true) . ')]);');
$rootDb->prepare('INSERT INTO push_subscriptions (guest_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,NOW())')->execute([$gid62, 'https://fcm.googleapis.com/fcm/send/it62-old', 'k', 'a']);
$p62 = $gidFor62($g62);
it_check('§62 a booking\'s push alerts never go to an unproven account (even one with a phone stored)', is_array($p62) && (int) ($p62['id'] ?? -1) === 0, json_encode($p62));
$r = http($gj62, 'POST', '/auth.php', ['action' => 'guest_send_reset']);
it_check('§62 an unproven account cannot send itself reset links', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'email_unproven', $r['raw']);
$ts62 = time();
$r = http($gj62, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $gid62, 'ts' => $ts62, 'token' => substr(hash_hmac('sha256', 'login:' . $gid62 . ':' . $ts62, $SECRET), 0, 32)]);
it_check('§62 (fixture) the guest confirms the email in the browser that registered it', ($r['json']['ok'] ?? false) === true && ($r['json']['reset'] ?? true) === false, $r['raw']);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Gina Sixtytwo'," . $rootDb->quote($g62) . ",'" . $ukPlus(-1) . "','" . $ukPlus(2) . "',2,0,'paid',300,300,300,0,3)");
$g62Bid = (int) $rootDb->lastInsertId();
$t = $thr62($gt62);
it_check('§62 once proven, their own chat is verified', ($t['verified'] ?? null) === true, json_encode($t));
$r = http($admin, 'POST', '/messages.php', ['action' => 'thread', 'thread_id' => $gt62]);
it_check('§62 …and carries their booking', count($r['json']['bookings'] ?? []) === 1 && ($r['json']['thread']['verified'] ?? null) === true, substr($r['raw'], 0, 300));
$r = http($gj62, 'POST', '/push.php', ['action' => 'subscribe', 'subscription' => $sub62]);
it_check('§62 a proven account can add a phone', ($r['json']['ok'] ?? false) === true, $r['raw']);
$p62 = $gidFor62($g62);
it_check('§62 …and its booking alerts find it', (int) ($p62['id'] ?? 0) === $gid62, json_encode($p62));
// A self-reset counts against the address's daily sign-in emails.
$mk62 = fn($em) => 'mailto:' . substr(sha1(strtolower($em)), 0, 40);
$mailN62 = fn($em) => (int) $rootDb->query('SELECT COUNT(*) FROM login_attempts WHERE identifier = ' . $rootDb->quote($mk62($em)))->fetchColumn();
$r = http($gj62, 'POST', '/auth.php', ['action' => 'guest_send_reset']);
it_check('§62 a proven account may send itself a reset link, counted against the day\'s emails (the mailer is off: 500)', $r['code'] === 500 && $mailN62($g62) === 1, $r['raw']);
$ins62 = $rootDb->prepare("INSERT INTO login_attempts (ip, identifier, success) VALUES ('10.62.0.1', ?, 0)");
for ($i = 0; $i < 10; $i++) {
    $ins62->execute([$mk62($g62)]);
}
$r = http($gj62, 'POST', '/auth.php', ['action' => 'guest_send_reset']);
it_check('§62 …and past the day\'s allowance it is refused in words, not sent', $r['code'] === 429 && ($r['json']['code'] ?? '') === 'paused' && $mailN62($g62) === 11, $r['raw']);
$rootDb->prepare('DELETE FROM login_attempts WHERE identifier = ?')->execute([$mk62($g62)]);
// Codes paused for the address: the same answer for anyone, and a guest account
// gets a sign-in LINK instead (it cannot be guessed), so a stranger's wrong
// guesses no longer lock the guest out of their stay for the day.
$cv62 = $rootDb->prepare('INSERT INTO login_attempts (ip, identifier, success) VALUES (?, ?, 0)');
foreach ([$g62, 'nobody62@gmail.com'] as $em) {
    for ($i = 0; $i < 10; $i++) {
        $cv62->execute(['10.62.1.' . $i, 'codev:' . $em]);
    }
}
$pj62 = [];
$rk = http($pj62, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => $g62]);
$ru = http($pj62, 'POST', '/auth.php', ['action' => 'guest_code_request', 'email' => 'nobody62@gmail.com']);
it_check('§62 a paused code request answers the same for a guest and for nobody', $rk['code'] === 429 && $rk['raw'] === $ru['raw'] && ($rk['json']['code'] ?? '') === 'paused' && strpos($rk['raw'], 'link') !== false, $rk['raw'] . ' / ' . $ru['raw']);
it_check('§62 …and only the guest\'s account is sent a sign-in link (one email counted)', $mailN62($g62) === 1 && $mailN62('nobody62@gmail.com') === 0, $mailN62($g62) . '/' . $mailN62('nobody62@gmail.com'));
$rootDb->exec("DELETE FROM login_attempts WHERE identifier LIKE 'codev:%62%' OR identifier LIKE 'code:%62%'");
// (c) A squatter's account: when the real guest proves the address from their own
// browser, everything the squatter set up goes with the password.
$s62 = 'squat62-' . bin2hex(random_bytes(3)) . '@gmail.com';
$sj62 = [];
http($sj62, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Squatter Sixtytwo', 'email' => $s62, 'password' => 'squatpass62', 'address' => '9 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$sGid62 = (int) $rootDb->query('SELECT id FROM guests WHERE email = ' . $rootDb->quote($s62))->fetchColumn();
$rootDb->prepare('INSERT INTO push_subscriptions (guest_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,NOW())')->execute([$sGid62, 'https://fcm.googleapis.com/fcm/send/it62-squat', 'k', 'a']);
http($sj62, 'POST', '/messages.php', ['action' => 'send', 'body' => 'Squatter says hello']);
$sTid62 = (int) $rootDb->query("SELECT id FROM chat_threads WHERE guest_id = $sGid62")->fetchColumn();
$r = http($sj62, 'POST', '/auth.php', ['action' => 'guest_avatar_set', 'data' => $avData]);
$sAv62 = (string) $rootDb->query("SELECT avatar FROM guests WHERE id = $sGid62")->fetchColumn();
it_check('§62 (fixture) the squatter has a phone, a chat and a photo', $sGid62 > 0 && $sTid62 > 0 && $sAv62 !== '' && is_file($work . '/uploads/avatars/' . $sAv62), $r['raw']);
$rj62 = [];
$ts62 = time();
$r = http($rj62, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $sGid62, 'ts' => $ts62, 'token' => substr(hash_hmac('sha256', 'login:' . $sGid62 . ':' . $ts62, $SECRET), 0, 32)]);
it_check('§62 the real guest proves the address from their own browser', ($r['json']['ok'] ?? false) === true && ($r['json']['reset'] ?? false) === true, $r['raw']);
it_check('§62 …the squatter\'s phones stop getting the guest\'s alerts', (int) $rootDb->query("SELECT COUNT(*) FROM push_subscriptions WHERE guest_id = $sGid62")->fetchColumn() === 0, '');
clearstatcache();
it_check('§62 …its photo is gone, file and all', $rootDb->query("SELECT avatar FROM guests WHERE id = $sGid62")->fetchColumn() === null && !is_file($work . '/uploads/avatars/' . $sAv62), '');
$t = $thr62($sTid62);
it_check('§62 …and its chat is no longer the guest\'s: unlinked and not verified', $rootDb->query("SELECT guest_id FROM chat_threads WHERE id = $sTid62")->fetchColumn() === null && ($t['verified'] ?? null) === false, json_encode($t));
// (d) A guest's PNG reaches the photo wall without its metadata.
$im62 = imagecreatetruecolor(40, 30);
imagefilledrectangle($im62, 0, 0, 39, 29, imagecolorallocate($im62, 40, 90, 120));
ob_start();
imagepng($im62);
$png62 = (string) ob_get_clean();
$txt62 = 'tEXt' . "Comment\0GPS 52.955N 1.020E it62-secret";
$png62 = substr($png62, 0, -12) . pack('N', strlen($txt62) - 4) . $txt62 . pack('N', crc32($txt62)) . substr($png62, -12);
$mp62 = '----chbit62' . bin2hex(random_bytes(6));
$mpBody = '';
foreach (['action' => 'submit', 'prop_key' => $propKey, 'caption' => 'From the quay'] as $k => $v) {
    $mpBody .= "--$mp62\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n";
}
$mpBody .= "--$mp62\r\nContent-Disposition: form-data; name=\"image\"; filename=\"quay.png\"\r\nContent-Type: image/png\r\n\r\n$png62\r\n--$mp62--\r\n";
$mpRaw = @file_get_contents($BASE . '/photos.php', false, stream_context_create(['http' => ['method' => 'POST', 'ignore_errors' => true, 'timeout' => 30,
    'header' => "Accept: application/json\r\nContent-Type: multipart/form-data; boundary=$mp62\r\nCookie: " . implode('; ', array_map(fn($k) => "$k={$gj62[$k]}", array_keys($gj62))),
    'content' => $mpBody]]));
$url62 = (string) $rootDb->query("SELECT url FROM guest_photos WHERE guest_id = $gid62 ORDER BY id DESC LIMIT 1")->fetchColumn();
$stored62 = $url62 !== '' && is_file($work . '/' . $url62) ? (string) file_get_contents($work . '/' . $url62) : '';
it_check('§62 (fixture) the PNG sent carries a location in its metadata', strpos($png62, 'it62-secret') !== false, '');
it_check('§62 a guest\'s PNG is stored without it, still a PNG', strpos((string) $mpRaw, '"ok":true') !== false && $stored62 !== '' && strpos($stored62, 'it62-secret') === false && (getimagesizefromstring($stored62)[2] ?? 0) === IMAGETYPE_PNG, (string) $mpRaw . ' ' . $url62);
// (e) The test centre's guest record is not public content.
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('testcentre-guest', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode(['id' => 1, 'email' => 'owner62@example.com'])]);
$r = http($noJar, 'GET', '/content.php');
it_check('§62 the test centre\'s guest record never reaches the public content', $r['code'] === 200 && is_array($r['json']['content'] ?? null) && !array_key_exists('testcentre-guest', $r['json']['content']) && strpos($r['raw'], 'owner62@example.com') === false, substr($r['raw'], 0, 160));
$rootDb->exec("DELETE FROM content WHERE item_key = 'testcentre-guest'");
foreach ([$imp62Tid, $gt62, $sTid62] as $tid) {
    $rootDb->exec('DELETE FROM messages WHERE thread_id = ' . (int) $tid);
    $rootDb->exec('DELETE FROM chat_threads WHERE id = ' . (int) $tid);
}
$rootDb->exec("DELETE FROM guest_photos WHERE guest_id = $gid62");
$rootDb->exec("DELETE FROM push_subscriptions WHERE guest_id IN ($gid62, $sGid62)");
$rootDb->exec("DELETE FROM bookings WHERE id IN ($w62Bid, $g62Bid)");
$rootDb->exec("DELETE FROM guests WHERE id IN ($gid62, $sGid62)");

// §63 A PHOTO IS AN UPLOADED IMAGE. The photo keys are printed inside url('…') in
// style attributes on the public pages; a stored quote or bracket ended the link and
// the attribute around it. content.php refuses one at the write (app.js encodes at
// every sink as well — smoke-test 12j).
echo "\n== §63 a photo is an uploaded image ==\n";
$evil63 = "x');\"><iframe src=\"https://evil.example/pay\"></iframe><i x=\"";
$set63 = fn($k, $v) => http($admin, 'POST', '/content.php', ['action' => 'set', 'key' => $k, 'value' => $v]);
$r = $set63('images-' . $propKey, ['uploads/ok-63.jpg', $evil63]);
it_check('§63 a gallery with a link that could end its url() is refused, in words', $r['code'] === 400 && strpos((string) ($r['json']['error'] ?? ''), 'uploaded image') !== false, $r['raw']);
$r = $set63('hero-bg', $evil63);
it_check('§63 …and so is a hero photo', $r['code'] === 400, $r['raw']);
$r = $set63('card-img-' . $propKey, "uploads/a.jpg'),url(data:x);position:fixed;x:url('");
it_check('§63 …and a home card photo built to break out of CSS alone', $r['code'] === 400, $r['raw']);
$r = $set63('images-' . $propKey, ['uploads/ok-63.jpg', 'https://images.example.com/cottage/2.jpg?w=800&q=80']);
it_check('§63 an upload and a clean https link are saved', $r['code'] === 200, $r['raw']);
$r = $set63('host-photo', '');
it_check('§63 …and clearing a photo still works', $r['code'] === 200, $r['raw']);
$r = $set63('hero-title', 'Three "lovely" cottages (by the quay)');
it_check('§63 a TEXT key with quotes and brackets is untouched by the rule', $r['code'] === 200, $r['raw']);
$rootDb->exec("DELETE FROM content WHERE item_key IN ('images-$propKey', 'hero-title', 'host-photo')");

// §64 DELETING AN ACCOUNT NEVER TAKES AN UPCOMING STAY WITH IT. It anonymised every
// booking under the address, the one next month included: the owner was left a
// "Former guest" with no way to reach them, and the arrival email, the balance chase
// and the guest's own door code all match by that address.
echo "\n== §64 deleting an account never takes an upcoming stay with it ==\n";
$rootDb->exec("DELETE FROM login_attempts WHERE identifier IN ('register', 'guestcode', 'chat')");
$d64 = 'dora64-' . bin2hex(random_bytes(3)) . '@gmail.com';
$dj64 = [];
http($dj64, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Dora Sixtyfour', 'email' => $d64, 'password' => 'dorapass64x', 'address' => '4 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$dGid64 = (int) $rootDb->query('SELECT id FROM guests WHERE email = ' . $rootDb->quote($d64))->fetchColumn();
$ts64 = time();
$r = http($dj64, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $dGid64, 'ts' => $ts64, 'token' => substr(hash_hmac('sha256', 'login:' . $dGid64 . ':' . $ts64, $SECRET), 0, 32)]);
it_check('§64 (fixture) a proven, signed-in guest', $dGid64 > 0 && ($r['json']['ok'] ?? false) === true, $r['raw']);
$ci64 = date('Y-m-d', strtotime('+20 days'));
$co64 = date('Y-m-d', strtotime('+23 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, phone, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Dora Sixtyfour'," . $rootDb->quote($d64) . ",'07700 900164','$ci64','$co64',2,0,'deposit',100,400,400,0,3)");
$dBid64 = (int) $rootDb->lastInsertId();
$r = http($dj64, 'POST', '/auth.php', ['action' => 'guest_delete_account']);
$b64 = $rootDb->query("SELECT name, email, phone FROM bookings WHERE id = $dBid64")->fetch(PDO::FETCH_ASSOC);
it_check('§64 an account with a stay still to come is not deleted: the stay\'s date, in words', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'stay_ahead' && strpos((string) ($r['json']['error'] ?? ''), date('d/m/Y', strtotime($ci64))) !== false, $r['raw']);
it_check('§64 …the stay keeps its guest, email and phone', ($b64['name'] ?? '') === 'Dora Sixtyfour' && ($b64['email'] ?? '') === $d64 && ($b64['phone'] ?? '') === '07700 900164', json_encode($b64));
it_check('§64 …and the account is still there', (int) $rootDb->query("SELECT COUNT(*) FROM guests WHERE id = $dGid64")->fetchColumn() === 1, '');
// Once the stay has ended, the same tap deletes the account and anonymises the record.
$rootDb->exec("UPDATE bookings SET check_in = DATE_SUB(CURDATE(), INTERVAL 5 DAY), check_out = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE id = $dBid64");
$r = http($dj64, 'POST', '/auth.php', ['action' => 'guest_delete_account']);
$b64 = $rootDb->query("SELECT name, email, phone FROM bookings WHERE id = $dBid64")->fetch(PDO::FETCH_ASSOC);
it_check('§64 once the stay has ended the account is deleted', $r['code'] === 200 && (int) $rootDb->query("SELECT COUNT(*) FROM guests WHERE id = $dGid64")->fetchColumn() === 0, $r['raw']);
it_check('§64 …and the past stay is kept, anonymised', ($b64['name'] ?? '') === 'Former guest' && $b64['email'] === null && $b64['phone'] === null, json_encode($b64));
$rootDb->exec("DELETE FROM bookings WHERE id = $dBid64");

// §65 A QUEUED EMAIL IS SENT ONLY WHILE IT IS STILL TRUE. The outbox retries a
// failed one-shot later — and the send that succeeds after an outage is what drains
// it, so a confirmation queued in the outage landed just after the cancellation, or
// after the corrected one with the new dates. Each queued row now names what it is
// about, and the drain asks before it sends. (Mail is off here, so a row the drain
// DOES try fails with "Mail disabled" and moves forward — which is the tell.)
echo "\n== §65 a queued email is sent only while it is still true ==\n";
$rootDb->exec("DELETE FROM email_outbox");
$ci65 = $ukPlus(40);
$co65 = $ukPlus(43);
$mk65 = function ($name) use ($rootDb, $propKey, $ci65, $co65) {
    $rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey'," . $rootDb->quote($name) . ",'g65@example.com','$ci65','$co65',2,0,'unpaid',0,400,400,0,3)");
    return (int) $rootDb->lastInsertId();
};
$keep65 = $mk65('Kept Sixtyfive');
$moved65 = $mk65('Moved Sixtyfive');
$gone65 = $mk65('Gone Sixtyfive');
$paid65 = $mk65('Paid Sixtyfive');
$refs65 = $mailProbe('$s = db()->prepare("SELECT * FROM bookings WHERE id = ?"); $o = []; foreach ([' . $keep65 . ', ' . $moved65 . ', ' . $gone65 . ', ' . $paid65 . '] as $i) { $s->execute([$i]); $o[] = email_booking_ref($s->fetch()); } echo "\n" . json_encode($o);');
it_check('§65 (fixture) a reference per stay, from the app itself', is_array($refs65) && count(array_filter($refs65)) === 4 && strpos((string) $refs65[0], 'booking:' . $keep65 . ':') === 0, json_encode($refs65));
// What changes after they were queued: one stay moves, one is cancelled; an enquiry is
// declined, a subscriber leaves, a person is removed.
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, declined_at) VALUES ('$propKey','Enq Sixtyfive','e65@example.com','$ci65','$co65',2,0,NOW())");
$enq65 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO newsletter_subscribers (email, token, unsubscribed_at) VALUES ('n65@example.com', 'tok65" . bin2hex(random_bytes(4)) . "', NOW())");
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, caps, created_at, removed_at) VALUES ('gone65', 'x', 'Gone Person', 'p65@example.com', 0, '{}', NOW(), NOW())");
$pid65 = (int) $rootDb->lastInsertId();
$q65 = $rootDb->prepare("INSERT INTO email_outbox (next_try_at, context, to_email, to_name, subject, body_text, last_error, ref) VALUES (DATE_SUB(NOW(), INTERVAL 1 MINUTE), ?, ?, ?, 'S', 'b', 'seed', ?)");
// Oldest first, and the drain stops at the first row the relay refuses — so the stale
// rows go in first (each dropped without a send), then the one it really tries.
foreach ([['confirmation', 'moved65@example.com', 'Moved', $refs65[1]], ['confirmation', 'gone65@example.com', 'Gone', $refs65[2]], ['confirmation', 'paid65@example.com', 'Paid', $refs65[3]], ['enquiry-ack', 'e65@example.com', 'Enq', 'enquiry:' . $enq65], ['newsletter', 'n65@example.com', 'News', 'newsletter:n65@example.com'], ['owner-alert', 'p65@example.com', 'Person', 'person:' . $pid65], ['confirmation', 'keep65@example.com', 'Kept', $refs65[0]], ['owner-alert', 'x65@example.com', 'Extra', '']] as $row65) {
    $q65->execute($row65);
}
$rootDb->exec("UPDATE bookings SET check_in = DATE_ADD(check_in, INTERVAL 7 DAY), check_out = DATE_ADD(check_out, INTERVAL 7 DAY) WHERE id = $moved65");
$rootDb->exec("DELETE FROM bookings WHERE id = $gone65");
$rootDb->exec("UPDATE bookings SET payment = 'paid', deposit_paid = 400 WHERE id = $paid65");
$warn65 = (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'email.gaveup'")->fetchColumn();
$r = http($guest, 'GET', '/self-repair.php?cron=' . $SECRET);
$rows65 = [];
foreach ($rootDb->query("SELECT to_name, tries, last_error, gave_up_at FROM email_outbox")->fetchAll(PDO::FETCH_ASSOC) as $x) {
    $rows65[$x['to_name']] = $x;
}
// A second pass, with the tried row out of the way, reaches the last one.
$rootDb->exec("UPDATE email_outbox SET next_try_at = DATE_ADD(NOW(), INTERVAL 1 DAY) WHERE to_name = 'Kept'");
http($guest, 'GET', '/self-repair.php?cron=' . $SECRET);
$rows65['Extra'] = $rootDb->query("SELECT to_name, tries, last_error, gave_up_at FROM email_outbox WHERE to_name = 'Extra'")->fetch(PDO::FETCH_ASSOC);
$tried65 = fn($n) => isset($rows65[$n]) && (int) $rows65[$n]['tries'] === 1 && $rows65[$n]['gave_up_at'] === null;
$dropped65 = fn($n) => isset($rows65[$n]) && (int) $rows65[$n]['tries'] === 0 && $rows65[$n]['gave_up_at'] !== null && $rows65[$n]['last_error'] === 'no longer current';
it_check('§65 a confirmation for a stay that is unchanged is still tried', $r['code'] === 200 && $tried65('Kept'), json_encode($rows65['Kept'] ?? null));
it_check('§65 …one for a stay that MOVED is not sent', $dropped65('Moved'), json_encode($rows65['Moved'] ?? null));
it_check('§65 …nor one for a stay that was CANCELLED', $dropped65('Gone'), json_encode($rows65['Gone'] ?? null));
it_check('§65 …nor one that says "Unpaid" about a stay since PAID in full', $dropped65('Paid'), json_encode($rows65['Paid'] ?? null));
it_check('§65 …nor an enquiry acknowledgement after the enquiry was answered', $dropped65('Enq'), json_encode($rows65['Enq'] ?? null));
it_check('§65 …nor a newsletter after an unsubscribe', $dropped65('News'), json_encode($rows65['News'] ?? null));
it_check('§65 …nor an owner alert to a person since removed', $dropped65('Person'), json_encode($rows65['Person'] ?? null));
it_check('§65 a row that names nothing is still tried (an extra address)', $tried65('Extra'), json_encode($rows65['Extra'] ?? null));
it_check('§65 a dropped email is no alarm: no give-up warning, one quiet line each', (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'email.gaveup'")->fetchColumn() === $warn65 && (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'email.dropped'")->fetchColumn() >= 5, '');
$rootDb->exec("DELETE FROM email_outbox");
$rootDb->exec("DELETE FROM bookings WHERE id IN ($keep65, $moved65, $paid65)");
$rootDb->exec("DELETE FROM enquiries WHERE id = $enq65");
$rootDb->exec("DELETE FROM newsletter_subscribers WHERE email = 'n65@example.com'");
$rootDb->exec("DELETE FROM admins WHERE id = $pid65");

// §66 A CANCELLATION DECIDES ITS DEPOSIT UNDER THE LOCK. It chose the deposit path
// from the row it read before waiting for book_lock — which pay.php holds to charge.
// A deposit charged while it waited took the cash branch, found no cash deposit, and
// was neither returned nor recorded as owed before the row was deleted. Reproduced
// for real, as §32a does: hold the lock, park the cancel, land the charge, release.
echo "\n== §66 a cancellation decides its deposit under the lock ==\n";
it_reauth($admin); // the deposit that appears needs the step-up, and the window is fresh
$cIn66 = $ukPlus(50);
$cOut66 = $ukPlus(53);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, agreed_booking_fee) VALUES ('$propKey','Race Cancel','','$cIn66','$cOut66',2,0,'unpaid',0,400,400,0,3,75)");
$cId66 = (int) $rootDb->lastInsertId();
$slot66 = new PDO("mysql:host=$DB_HOST;port=$DB_PORT;dbname=$DB_NAME;charset=utf8mb4", $DB_USER, $DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$st66 = $slot66->prepare('SELECT GET_LOCK(?, 0)');
$st66->execute([$lockName]);
it_check('§66 (fixture) the booking lock is held on a second connection', (int) $st66->fetchColumn() === 1);
$cxCookie66 = implode('; ', array_map(fn($k) => "$k={$admin[$k]}", array_keys($admin)));
$cxPayload66 = json_encode(['action' => 'cancel', 'id' => $cId66, 'refund_amount' => 0, 'reason' => 'it-race']);
$cxScript66 = sys_get_temp_dir() . '/chb-it-cxrace-' . getmypid() . '.php';
file_put_contents($cxScript66, '<?php $o = ["http" => ["method" => "POST", "header" => "Content-Type: application/json\r\nAccept: application/json\r\nCookie: ' . $cxCookie66 . '\r\nX-CSRF-Token: ' . ($admin['csrf'] ?? '') . '", "content" => ' . var_export($cxPayload66, true) . ', "timeout" => 40, "ignore_errors" => true]]; echo file_get_contents(' . var_export($BASE . '/bookings.php', true) . ', false, stream_context_create($o));');
$cp66 = [];
$cxProc66 = proc_open('exec php ' . escapeshellarg($cxScript66), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $cp66);
$parked66 = false;
for ($i = 0; $i < 100; $i++) {
    if ((int) $rootDb->query("SELECT COUNT(*) FROM information_schema.processlist WHERE state = 'User lock'")->fetchColumn() > 0) {
        $parked66 = true;
        break;
    }
    usleep(100000);
}
it_check('§66 the cancellation parks at the lock (past its first read)', $parked66);
// pay.php's charge: the rental part to the ledger figure, the deposit onto hold_*.
$rootDb->exec("UPDATE bookings SET deposit_paid = 100, payment = 'deposit', payment_date = CURDATE(), payment_method = 'Square card', hold_status = 'charged', hold_amount = 75, hold_payment_id = 'SQ_IT_66' WHERE id = $cId66");
$slot66->prepare('SELECT RELEASE_LOCK(?)')->execute([$lockName]);
$cxOut66 = stream_get_contents($cp66[1]);
proc_close($cxProc66);
@unlink($cxScript66);
$cxJson66 = json_decode((string) $cxOut66, true);
it_check('§66 the deposit charged while it waited is not lost: reported owed (Square is off here)', ($cxJson66['ok'] ?? false) === true && round((float) ($cxJson66['deposit_owed'] ?? 0), 2) === 75.00, substr((string) $cxOut66, 0, 300));
it_check('§66 …and logged, so it outlives the deleted booking', (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'deposit.owed' AND summary LIKE '%Race Cancel%'")->fetchColumn() === 1, '');
$slot66 = null;

// §67 A MOVED STAY CARRIES ITS SCHEDULE AND ITS RECORDS WITH IT. The balance ask and
// its reminders keyed off stamps left from the old dates (a postponed stay was never
// asked for its balance again), and the guest register's retention date was fixed at
// submission (a moved stay purged early; a cancelled one kept a party's passport
// numbers for a year after a stay that never happened).
echo "\n== §67 a moved stay carries its schedule and its records ==\n";
$reg67 = $rootDb->prepare("INSERT INTO guest_registrations (booking_id, party_enc, guest_count, submitted_at, updated_at, expires_at) VALUES (?, 'x', 2, NOW(), NOW(), DATE_ADD(?, INTERVAL 12 MONTH))");
$bk67 = function ($name, $in, $out) use ($rootDb, $propKey) {
    $rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, balance_requested_at, balance_reminded_at) VALUES ('$propKey'," . $rootDb->quote($name) . ",'s67@example.com','$in','$out',2,0,'unpaid',0,400,400,0,3, DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY))");
    return (int) $rootDb->lastInsertId();
};
$mv67 = $bk67('Moved Sixtyseven', $ukPlus(320), $ukPlus(323));
$reg67->execute([$mv67, $ukPlus(323)]);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $mv67, 'check_in' => $ukPlus(330), 'check_out' => $ukPlus(334)]);
$row67 = $rootDb->query("SELECT b.balance_requested_at, b.balance_reminded_at, g.expires_at FROM bookings b LEFT JOIN guest_registrations g ON g.booking_id = b.id WHERE b.id = $mv67")->fetch(PDO::FETCH_ASSOC);
$exp67 = (new DateTime($ukPlus(334)))->modify('+12 months')->format('Y-m-d');
it_check('§67 a moved stay is asked for its balance afresh (both chase stamps cleared)', $r['code'] === 200 && $row67['balance_requested_at'] === null && $row67['balance_reminded_at'] === null, $r['raw'] . ' ' . json_encode($row67));
it_check('§67 …and its register is kept for a year from the NEW checkout', ($row67['expires_at'] ?? '') === $exp67, json_encode($row67) . ' want ' . $exp67);
$rootDb->exec("UPDATE bookings SET balance_requested_at = NOW(), balance_reminded_at = NOW() WHERE id = $mv67");
$r = http($admin, 'POST', '/bookings.php', ['action' => 'set_payment_plan', 'id' => $mv67, 'balance_due_date' => $ukPlus(300)]);
$st67 = $rootDb->query("SELECT balance_requested_at, balance_reminded_at FROM bookings WHERE id = $mv67")->fetch(PDO::FETCH_ASSOC);
it_check('§67 a new balance date is a new ask too', $r['code'] === 200 && $st67['balance_requested_at'] === null && $st67['balance_reminded_at'] === null, $r['raw'] . ' ' . json_encode($st67));
$rootDb->exec("UPDATE bookings SET balance_requested_at = NOW() WHERE id = $mv67");
$r = http($admin, 'POST', '/bookings.php', ['action' => 'update', 'id' => $mv67, 'notes' => 'a phone number corrected']);
it_check('§67 …while an edit that moves nothing leaves the ask alone', $r['code'] === 200 && $rootDb->query("SELECT balance_requested_at FROM bookings WHERE id = $mv67")->fetchColumn() !== null, $r['raw']);
// Cancelled before it began: the register goes. Begun, then deleted: kept for its year.
$cx67 = $bk67('Cancelled Sixtyseven', $ukPlus(340), $ukPlus(343));
$reg67->execute([$cx67, $ukPlus(343)]);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'cancel', 'id' => $cx67, 'refund_amount' => 0, 'reason' => 'it67']);
it_check('§67 a stay cancelled before it began takes its register with it', ($r['json']['ok'] ?? false) === true && (int) $rootDb->query("SELECT COUNT(*) FROM guest_registrations WHERE booking_id = $cx67")->fetchColumn() === 0, $r['raw']);
$on67 = $bk67('Begun Sixtyseven', $ukPlus(-1), $ukPlus(2));
$reg67->execute([$on67, $ukPlus(2)]);
$r = http($admin, 'POST', '/bookings.php', ['action' => 'delete', 'id' => $on67]);
$kept67 = $rootDb->query("SELECT expires_at FROM guest_registrations WHERE booking_id = $on67")->fetchColumn();
it_check('§67 …one that had begun keeps it, for a year from today', ($r['json']['ok'] ?? false) === true && $kept67 === (new DateTime($ukToday))->modify('+12 months')->format('Y-m-d'), $r['raw'] . ' ' . var_export($kept67, true));
$rootDb->exec("DELETE FROM guest_registrations WHERE booking_id IN ($mv67, $cx67, $on67)");
$rootDb->exec("DELETE FROM bookings WHERE id IN ($mv67, $on67)");

// §68 AN EDITED ENQUIRY IS THE SAME ENQUIRY. The owner's Edit/Move is decline +
// resubmit, and the new row started over: the guest's text-message consent was lost,
// a guest waiting two days read as new today, and the follow-up nudge went again.
echo "\n== §68 an edited enquiry is the same enquiry ==\n";
$eIn68 = $ukPlus(360);
$eOut68 = $ukPlus(363);
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, phone, check_in, check_out, adults, children, sms_opt_in, seen_at, nudge_sent_at, created_at) VALUES ('$propKey','Ena Sixtyeight','e68@example.com','07700 900168','$eIn68','$eOut68',2,0,1, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY))");
$e68 = (int) $rootDb->lastInsertId();
$orig68 = $rootDb->query("SELECT created_at, seen_at, nudge_sent_at FROM enquiries WHERE id = $e68")->fetch(PDO::FETCH_ASSOC);
$r = http($admin, 'POST', '/enquiries.php', ['action' => 'submit', 'replaces_id' => $e68, 'prop_key' => $propKey, 'name' => 'Ena Sixtyeight', 'email' => 'e68@example.com', 'phone' => '07700 900168', 'check_in' => $eIn68, 'check_out' => $ukPlus(364), 'adults' => 2, 'children' => 0, 'message' => 'one more night']);
$new68 = (int) ($r['json']['id'] ?? 0);
$row68 = $rootDb->query("SELECT sms_opt_in, created_at, seen_at, nudge_sent_at FROM enquiries WHERE id = $new68")->fetch(PDO::FETCH_ASSOC);
it_check('§68 (fixture) the owner\'s edit makes a new row', $r['code'] === 200 && $new68 > $e68, $r['raw']);
it_check('§68 the guest\'s text-message consent travels with it', (int) ($row68['sms_opt_in'] ?? 0) === 1, json_encode($row68));
it_check('§68 …and so does its age, seen and nudged state (no second nudge, no "new today")', ($row68['created_at'] ?? '') === $orig68['created_at'] && ($row68['seen_at'] ?? '') === $orig68['seen_at'] && ($row68['nudge_sent_at'] ?? '') === $orig68['nudge_sent_at'], json_encode([$row68, $orig68]));
$rootDb->exec("DELETE FROM enquiries WHERE id IN ($e68, $new68)");

// §69 A PERSON IS NOT REMOVED FROM UNDER THE MONEY SPLIT. Removing a paid-out host
// left them in it: their cottage's income left the holder's profit, a "Pay Someone"
// row appeared, and that cottage's guests dropped out of "Guests still to pay".
echo "\n== §69 a host is not removed from under the money split ==\n";
$splitWas69 = $rootDb->query("SELECT item_value FROM content WHERE item_key = 'money-split'")->fetchColumn();
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, caps, created_at) VALUES ('host69', 'x', 'Hana Host', 'host69@example.com', 0, '{}', NOW())");
$h69 = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => $ownerId, 'hosts' => [$propKey => $h69]]);
it_check('§69 (fixture) Hana hosts a cottage in the split', $r['code'] === 200, $r['raw']);
$r = http($admin, 'POST', '/people.php', ['action' => 'remove', 'id' => $h69]);
it_check('§69 removing her is refused, saying where to change it', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'in_split' && strpos((string) ($r['json']['error'] ?? ''), 'Cottages and the bank') !== false && $rootDb->query("SELECT removed_at FROM admins WHERE id = $h69")->fetchColumn() === null, $r['raw']);
$r = http($admin, 'POST', '/split.php', ['action' => 'settings', 'holder' => $ownerId, 'hosts' => [$propKey => $ownerId]]);
$r = http($admin, 'POST', '/people.php', ['action' => 'remove', 'id' => $h69]);
it_check('§69 …and allowed once the cottage is someone else\'s', $r['code'] === 200 && $rootDb->query("SELECT removed_at FROM admins WHERE id = $h69")->fetchColumn() !== null, $r['raw']);
$rootDb->exec("DELETE FROM admins WHERE id = $h69");
if ($splitWas69 === false) {
    $rootDb->exec("DELETE FROM content WHERE item_key = 'money-split'");
} else {
    $rootDb->prepare("UPDATE content SET item_value = ? WHERE item_key = 'money-split'")->execute([$splitWas69]);
}

// §70 A DELETED ACCOUNT TAKES ITS WHOLE CONVERSATION. Deletion removed only the
// guest's own lines: the owner's replies and their emailed ones carry no guest_id, so
// they outlived the account (and stayed searchable); a chat started before signing in
// was never theirs at all; and the half-typed enquiry, the "book direct" lead, the
// owner's emails to them, unsent queued copies and old sign-in codes all stayed.
echo "\n== §70 a deleted account takes its whole conversation ==\n";
$rootDb->exec("DELETE FROM login_attempts WHERE identifier IN ('register', 'guestcode', 'chat')");
$z70 = 'zara70-' . bin2hex(random_bytes(3)) . '@gmail.com';
$zj70 = [];
http($zj70, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Zara Seventy', 'email' => $z70, 'password' => 'zarapass70x', 'address' => '7 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$zGid70 = (int) $rootDb->query('SELECT id FROM guests WHERE email = ' . $rootDb->quote($z70))->fetchColumn();
$ts70 = time();
http($zj70, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $zGid70, 'ts' => $ts70, 'token' => substr(hash_hmac('sha256', 'login:' . $zGid70 . ':' . $ts70, $SECRET), 0, 32)]);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Zara Seventy'," . $rootDb->quote($z70) . ", DATE_SUB(CURDATE(), INTERVAL 30 DAY), DATE_SUB(CURDATE(), INTERVAL 27 DAY),2,0,'paid',300,300,300,0,3)");
$zBid70 = (int) $rootDb->lastInsertId();
http($zj70, 'POST', '/messages.php', ['action' => 'send', 'body' => 'Was the wifi password changed?']);
$zTid70 = (int) $rootDb->query("SELECT id FROM chat_threads WHERE guest_id = $zGid70")->fetchColumn();
$r = http($admin, 'POST', '/messages.php', ['action' => 'send', 'thread_id' => $zTid70, 'body' => 'Yes — it is on the fridge']);
$rootDb->prepare("INSERT INTO chat_threads (guest_id, token, name, email) VALUES (NULL, ?, 'Zara Seventy', ?)")->execute(['it70-' . bin2hex(random_bytes(6)), $z70]);
$aTid70 = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO messages (guest_id, thread_id, sender_role, body) VALUES (NULL, ?, 'guest', 'before I signed in')")->execute([$aTid70]);
$rootDb->prepare("INSERT INTO enquiry_drafts (email, prop_key, name) VALUES (?, ?, 'DRAFT-NAME-70')")->execute([$z70, $propKey]);
$rootDb->prepare("INSERT INTO direct_leads (prop_key, name, email, review_text, admin_note) VALUES (?, 'Zara Seventy', ?, 'LEAD-REVIEW-70', 'OWNER-NOTE-70')")->execute([$propKey, $z70]);
$rootDb->prepare("INSERT INTO mail_sent (to_email, subject, body) VALUES (?, 'Your stay', 'INBOX-EMAIL-70')")->execute([$z70]);
$rootDb->prepare("INSERT INTO email_outbox (next_try_at, context, to_email, subject, body_text) VALUES (DATE_ADD(NOW(), INTERVAL 1 HOUR), 'confirmation', ?, 'S', 'b')")->execute([$z70]);
$rootDb->prepare("INSERT INTO activity_log (category, action, summary, entity, entity_id, meta) VALUES ('comms', 'booking.email', 'Emailed guest', 'booking', ?, ?)")->execute([(string) $zBid70, json_encode(['subject' => 'About your stay', 'body' => 'BOOKING-PAGE-EMAIL-70'])]);
$msgs70 = (int) $rootDb->query("SELECT COUNT(*) FROM messages WHERE thread_id IN ($zTid70, $aTid70)")->fetchColumn();
it_check('§70 (fixture) a signed-in chat with the owner\'s reply, and one from before signing in', $zTid70 > 0 && $msgs70 >= 3, (string) $msgs70 . ' ' . $r['raw']);
// "Download my data" carries what deletion takes: the conversation's other half, the
// chat from before signing in, the draft, the review from a link and the owner's
// emails to them. Never a chat's key, nor the owner's private note on the lead.
$r = http($zj70, 'POST', '/auth.php', ['action' => 'guest_export_data']);
$x70 = $r['json']['data'] ?? [];
$xBodies70 = array_map(fn($m) => (string) ($m['body'] ?? ''), $x70['messages'] ?? []);
$tok70 = (string) $rootDb->query("SELECT token FROM chat_threads WHERE id = $aTid70")->fetchColumn();
it_check('§70 the export carries the owner\'s replies and the chat from before signing in', in_array('Yes — it is on the fridge', $xBodies70, true) && in_array('before I signed in', $xBodies70, true), json_encode($xBodies70));
it_check('§70 …and the draft, the review from a link and the owner\'s emails (Inbox and booking page)', strpos($r['raw'], 'DRAFT-NAME-70') !== false && strpos($r['raw'], 'LEAD-REVIEW-70') !== false
    && strpos($r['raw'], 'INBOX-EMAIL-70') !== false && strpos($r['raw'], 'BOOKING-PAGE-EMAIL-70') !== false, substr($r['raw'], 0, 300));
it_check('§70 …but never a chat\'s key, nor the owner\'s private note', $tok70 !== '' && strpos($r['raw'], $tok70) === false && strpos($r['raw'], 'OWNER-NOTE-70') === false, '');
// The activity log's copies of those words: the first line of each chat message (the
// Activity log page shows and searches it) and the booking page's email in full.
$rootDb->prepare("INSERT INTO activity_log (category, action, summary, entity, entity_id, meta) VALUES ('comms', 'message.guest', 'New chat message from Zara Seventy', 'thread', ?, ?)")->execute([(string) $aTid70, json_encode(['detail' => 'ANON-LINE-70'])]);
$keepLog70 = (int) $rootDb->query("SELECT MAX(id) FROM activity_log WHERE entity = 'thread' AND entity_id = '$zTid70'")->fetchColumn();
$r = http($zj70, 'POST', '/auth.php', ['action' => 'guest_delete_account']);
$log70 = $rootDb->query("SELECT GROUP_CONCAT(CONCAT_WS('|', summary, IFNULL(meta, '')) SEPARATOR ' ## ') FROM activity_log WHERE (entity = 'thread' AND entity_id IN ('$zTid70', '$aTid70')) OR (entity = 'booking' AND entity_id = '$zBid70')")->fetchColumn();
it_check('§70 the activity log keeps no line of the conversation nor the booking page\'s email', $keepLog70 > 0 && (string) $log70 !== ''
    && strpos((string) $log70, 'wifi password') === false && strpos((string) $log70, 'on the fridge') === false
    && strpos((string) $log70, 'ANON-LINE-70') === false && strpos((string) $log70, 'BOOKING-PAGE-EMAIL-70') === false, (string) $log70);
it_check('§70 …and a guest\'s chat message no longer names them, while the rows stay as the record', strpos((string) $log70, 'from Zara Seventy') === false && strpos((string) $log70, 'New chat message') !== false, (string) $log70);
$left70 = [
    'messages' => (int) $rootDb->query("SELECT COUNT(*) FROM messages WHERE thread_id IN ($zTid70, $aTid70)")->fetchColumn(),
    'threads' => (int) $rootDb->query("SELECT COUNT(*) FROM chat_threads WHERE id IN ($zTid70, $aTid70)")->fetchColumn(),
];
foreach (['enquiry_drafts' => 'email', 'direct_leads' => 'email', 'mail_sent' => 'to_email', 'email_outbox' => 'to_email'] as $t70 => $c70) {
    $q70 = $rootDb->prepare("SELECT COUNT(*) FROM $t70 WHERE $c70 = ?");
    $q70->execute([$z70]);
    $left70[$t70] = (int) $q70->fetchColumn();
}
it_check('§70 the account is deleted (its stay is over)', $r['code'] === 200, $r['raw']);
it_check('§70 …with every message of both conversations, the owner\'s replies included', $left70['messages'] === 0 && $left70['threads'] === 0, json_encode($left70));
it_check('§70 …and the draft, the lead, the owner\'s emails to them and the queued copy', $left70['enquiry_drafts'] + $left70['direct_leads'] + $left70['mail_sent'] + $left70['email_outbox'] === 0, json_encode($left70));
$rootDb->exec("DELETE FROM bookings WHERE id = $zBid70");

// §71 A DELETED EXPENSE TAKES ITS SORTING WITH IT. A bank payment sorted as an
// expense still read "Counted, as a cost" after the expense was deleted, and never
// came back to To sort.
echo "\n== §71 a deleted expense takes its sorting with it ==\n";
$r = http($admin, 'POST', '/expenses.php', ['action' => 'add', 'category' => 'General', 'description' => 'it71 cleaner', 'amount' => 42.5, 'date' => $ukToday]);
$x71 = (int) ($r['json']['id'] ?? $rootDb->query("SELECT id FROM expenses WHERE description = 'it71 cleaner' ORDER BY id DESC LIMIT 1")->fetchColumn());
$rootDb->prepare("INSERT INTO bank_lines (ext_key, import_id, txn_date, txn_time, kind, name, category, description, notes, amount, balance, sorted_as, expense_id, sorted_label, sorted_at, prop_key) VALUES (?,0,?,'10:00:00','Card payment','Shiny Cleaners','','it71','',-42.5,0,'expense',?,'Cleaning',NOW(),'jollyboat')")->execute(['it71-' . bin2hex(random_bytes(4)), $ukToday, $x71]);
$l71 = (int) $rootDb->lastInsertId();
it_check('§71 (fixture) a bank payment sorted as that expense', $x71 > 0 && $l71 > 0, $r['raw']);
$r = http($admin, 'POST', '/expenses.php', ['action' => 'delete', 'id' => $x71]);
$row71 = $rootDb->query("SELECT sorted_as, expense_id, sorted_at, prop_key FROM bank_lines WHERE id = $l71")->fetch(PDO::FETCH_ASSOC);
it_check('§71 deleting the expense puts the payment back to be sorted', $r['code'] === 200 && $row71['sorted_as'] === null && $row71['expense_id'] === null && $row71['sorted_at'] === null, json_encode($row71));
it_check('§71 …with nothing of the old sorting left (its cottage too, as the bank page\'s own undo)', $row71['prop_key'] === null, json_encode($row71));
$rootDb->exec("DELETE FROM bank_lines WHERE id = $l71");

// §72 A VISITOR'S CONTENT READ LEAVES THE OPERATIONAL CACHES IN THE DATABASE. The
// public content GET (every visitor, every 30 seconds) read every value in the table —
// the payout cache, the mailbox's handled list, the opt-out list — and threw them away.
// It leaves them out by name now, in the same one query (§24 counts the statements), and
// a later read of one in the same request (the cron watchdog's, straight after the
// payload) still asks for it rather than reading "not set" from the memo.
echo "\n== §72 a visitor's content read leaves the operational caches in the database ==\n";
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('mac-chat-sum', ?), ('welcome-it72', ?), ('it72-pub', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode('it72-internal'), json_encode('it72-private'), json_encode('it72-public')]);
$c72 = $mailProbe('require_once __DIR__ . "/content.php"; $p = content_public_payload(); $all = $GLOBALS["__content_all"] ?? []; echo "\n" . json_encode(["pub" => $p["content"]["it72-pub"] ?? null, "leak" => array_key_exists("mac-chat-sum", $p["content"]) || array_key_exists("welcome-it72", $p["content"]), "fetched" => array_key_exists("mac-chat-sum", $all) || array_key_exists("welcome-it72", $all), "later" => content_value("mac-chat-sum"), "absent" => content_value("it72-nope"), "listed" => array_values(array_filter(CONTENT_VISITOR_SKIP, fn($k) => !is_internal_content_key($k) && !is_private_content_key($k))), "prefixed" => array_values(array_filter(CONTENT_VISITOR_SKIP_PREFIX, fn($x) => strpbrk($x, "%_") !== false || (!is_internal_content_key($x . "z") && !is_private_content_key($x . "z"))))]);');
it_check('§72 a visitor still gets the public content, and no internal or private key', is_array($c72) && ($c72['pub'] ?? null) === 'it72-public' && ($c72['leak'] ?? true) === false, json_encode($c72));
it_check('§72 …and the listed caches never leave the database', ($c72['fetched'] ?? true) === false, json_encode($c72));
it_check('§72 …while a later read of one in the same request still finds it', ($c72['later'] ?? '') === 'it72-internal' && ($c72['absent'] ?? 'x') === '', json_encode($c72));
it_check('§72 every key and prefix left out is one a visitor never gets (so the output cannot change)', ($c72['listed'] ?? null) === [] && ($c72['prefixed'] ?? null) === [], json_encode([$c72['listed'] ?? null, $c72['prefixed'] ?? null]));
// The owner gets the internal keys the back office reads; the server's own caches
// (the retired chat's summary among them, §76) stay behind for them too.
$hadPrefs72 = (bool) $rootDb->query("SELECT 1 FROM content WHERE item_key = 'notify-prefs'")->fetchColumn();
$rootDb->exec("INSERT INTO content (item_key, item_value) VALUES ('notify-prefs', '{}') ON DUPLICATE KEY UPDATE item_value = item_value");
$a72 = $mailProbe('require_once __DIR__ . "/content.php"; $_SESSION["admin_id"] = ' . (int) $ownerId . '; $p = content_public_payload(); echo "\n" . json_encode(["internal" => array_key_exists("notify-prefs", $p["content"]), "cache" => array_key_exists("mac-chat-sum", $p["content"]) || array_key_exists("mac-chat-sum", $GLOBALS["__content_all"] ?? []), "later" => content_value("mac-chat-sum")]);');
it_check('§72 the owner\'s read carries the internal keys the back office reads', is_array($a72) && ($a72['internal'] ?? false) === true, json_encode($a72));
it_check('§72 …and leaves the server\'s own caches behind, still readable later in the request', ($a72['cache'] ?? true) === false && ($a72['later'] ?? '') === 'it72-internal', json_encode($a72));
$rootDb->exec("DELETE FROM content WHERE item_key IN ('mac-chat-sum', 'welcome-it72', 'it72-pub')");
if (!$hadPrefs72) {
    $rootDb->exec("DELETE FROM content WHERE item_key = 'notify-prefs'");
}

// §73 THE PLATFORMS' CALENDAR FEED CARRIES WHAT IS AHEAD, AND SAYS WHEN NOTHING
// CHANGED. Each platform polls it many times a day. It carried every stay since the
// first, and a fresh DTSTAMP every second made each answer new. A stay that ended over
// a month ago is left out (a platform only blocks what is ahead), and the tag is taken
// over the events alone, so a feed whose stays have not changed answers 304.
echo "\n== §73 the calendar feed: what is ahead, and a 304 when nothing changed ==\n";
$tok73 = (string) (($mailProbe('echo "\n" . json_encode(["t" => ical_token(' . var_export($propKey, true) . ')]);') ?: [])['t'] ?? '');
$day73 = fn($n) => (new DateTime($ukToday, new DateTimeZone('Europe/London')))->modify(($n < 0 ? '' : '+') . $n . ' days')->format('Y-m-d');
$mk73 = function ($name, $in, $out) use ($rootDb, $propKey) {
    $rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey'," . $rootDb->quote($name) . ",'f73@example.com','$in','$out',2,0,'unpaid',0,400,400,0,3)");
    return (int) $rootDb->lastInsertId();
};
$old73 = $mk73('Feed Old', $day73(-60), $day73(-55));
$recent73 = $mk73('Feed Recent', $day73(-12), $day73(-8));
$ahead73 = $mk73('Feed Ahead', $day73(50), $day73(53));
$url73 = '/ical-export.php?prop=' . rawurlencode($propKey) . '&token=' . rawurlencode($tok73);
$f73 = $shellGet($url73);
$has73 = fn($id, $body) => strpos($body, 'UID:chb-' . $propKey . '-' . $id . '@') !== false;
it_check('§73 the feed carries the stays ahead and the last month', $f73['code'] === 200 && $has73($ahead73, $f73['raw']) && $has73($recent73, $f73['raw']), 'code ' . $f73['code'] . ' ' . substr($f73['raw'], 0, 200));
it_check('§73 …and not a stay that ended two months ago', !$has73($old73, $f73['raw']), substr($f73['raw'], 0, 400));
sleep(1); // the next answer carries a different DTSTAMP
$g73 = $shellGet($url73, $f73['etag']);
it_check('§73 an unchanged feed answers 304, a second later (its DTSTAMP is not part of the tag)', $f73['etag'] !== '' && $g73['code'] === 304 && $g73['len'] === 0, "etag {$f73['etag']} code {$g73['code']} len {$g73['len']}");
$z73 = $shellGet($url73, '"' . trim($f73['etag'], '"') . '-gzip"');
it_check('§73 …the tag as Apache\'s compression rewrites it too', $z73['code'] === 304, "code {$z73['code']}");
$rootDb->exec("UPDATE bookings SET check_out = DATE_ADD(check_out, INTERVAL 1 DAY) WHERE id = $ahead73");
$m73 = $shellGet($url73, $f73['etag']);
it_check('§73 a stay that changed sends the feed again, with a new tag', $m73['code'] === 200 && $m73['etag'] !== '' && $m73['etag'] !== $f73['etag'] && $has73($ahead73, $m73['raw']), "code {$m73['code']} etag {$m73['etag']}");
it_check('§73 a wrong token still gets nothing', $shellGet('/ical-export.php?prop=' . rawurlencode($propKey) . '&token=nope')['code'] === 403);
$rootDb->exec("DELETE FROM bookings WHERE id IN ($old73, $recent73, $ahead73)");

echo "\n== §74 a guest's chat poll asks the mailbox throttle without reading the handled list ==\n";
// A guest in the chat nudges the mailbox read every few seconds, and the poll's
// state holds the whole inbox's handled list. The throttle is asked first, of the
// row's own timestamp (mailbox_poll_recent). Driven in the app copy (CLI), with
// the mailbox switched on and no host to reach, so a poll that is not throttled
// stops at "no mailbox configured" without touching the network.
$pollProbe = function () use ($work) {
    $f = $work . '/it-poll-probe.php';
    file_put_contents($f, "<?php\nfunction mailbox_auto_enabled() { return true; }\nfunction mailbox_pop_host() { return ''; }\nrequire __DIR__ . '/db.php';\nrequire_once __DIR__ . '/mailbox-read.php';\necho \"\\n\" . json_encode(['recent' => mailbox_poll_recent(), 'poll' => poll_mailbox_replies()]);\n");
    $out = (string) shell_exec('cd ' . escapeshellarg($work) . ' && php ' . escapeshellarg($f) . ' 2>/dev/null');
    @unlink($f);
    return json_decode(trim(substr($out, (int) strrpos($out, "\n{"))), true);
};
// The app writes updated_at on the London clock (db.php sets the session's zone),
// so the fixture does too. The state's own stamp is OLD in every case: only the
// row's timestamp can throttle.
$set74 = function ($agoSeconds) use ($rootDb) {
    $when = (new DateTime('now', new DateTimeZone('Europe/London')))->modify('-' . (int) $agoSeconds . ' seconds')->format('Y-m-d H:i:s');
    $val = json_encode(['at' => time() - 3600, 'uids' => array_map(fn($i) => 'uid-' . $i, range(1, 3000)), 'error' => null]);
    $rootDb->prepare("INSERT INTO content (item_key, item_value, updated_at) VALUES ('mailbox-poll', ?, ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = VALUES(updated_at)")->execute([$val, $when]);
    return $when;
};
$when74 = $set74(3);
$R74 = $pollProbe();
it_check('§74 a poll saved seconds ago is recent', ($R74['recent'] ?? null) === true, json_encode($R74));
it_check('§74 …so the next poll is throttled before the handled list is read', ($R74['poll']['skipped'] ?? '') === 'throttled', json_encode($R74));
it_check('§74 …and leaves the row as it was', (string) $rootDb->query("SELECT updated_at FROM content WHERE item_key = 'mailbox-poll'")->fetchColumn() === $when74);
$set74(60);
$R74 = $pollProbe();
it_check('§74 a poll a minute ago is not recent, and the next one goes ahead', ($R74['recent'] ?? null) === false && ($R74['poll']['skipped'] ?? '') !== 'throttled', json_encode($R74));
$rootDb->exec("DELETE FROM content WHERE item_key = 'mailbox-poll'");
$R74 = $pollProbe();
it_check('§74 no row at all is not recent', ($R74['recent'] ?? null) === false, json_encode($R74));
$rootDb->exec("DELETE FROM content WHERE item_key = 'mailbox-poll'");

// §75 UPLOADED FILES ARE PRIVATE UNTIL THEY ARE SHOWN, AND GO WITH WHAT SHOWS THEM.
// A made-up chat token could keep any image on the site's own address, unseen and
// undeletable; deleting a conversation, an account, a rejected photo or suggestion
// left the files public; and an upload sat in public, location and all, while it
// was being cleaned.
echo "\n== §75 uploaded files are private until shown, and go with what shows them ==\n";
$rootDb->exec("DELETE FROM login_attempts WHERE identifier IN ('chatupload', 'chatupload-new', 'chat', 'register', 'guestcode', 'photo')");
$mp75 = function ($path, array $fields, $fileName, $bytes, array $jar = []) use ($BASE) {
    $bd = '----chbit75' . bin2hex(random_bytes(6));
    $body = '';
    foreach ($fields as $k => $v) {
        $body .= "--$bd\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n";
    }
    $body .= "--$bd\r\nContent-Disposition: form-data; name=\"image\"; filename=\"$fileName\"\r\nContent-Type: image/jpeg\r\n\r\n$bytes\r\n--$bd--\r\n";
    $hdr = "Accept: application/json\r\nContent-Type: multipart/form-data; boundary=$bd\r\n";
    if ($jar) {
        $hdr .= 'Cookie: ' . implode('; ', array_map(fn($k) => "$k={$jar[$k]}", array_keys($jar))) . "\r\n";
        if (!empty($jar['__csrf'])) {
            $hdr .= 'X-CSRF-Token: ' . $jar['__csrf'] . "\r\n";
        }
    }
    $raw = @file_get_contents($BASE . $path, false, stream_context_create(['http' => ['method' => 'POST', 'ignore_errors' => true, 'timeout' => 30, 'header' => $hdr, 'content' => $body]]));
    return json_decode((string) $raw, true) ?: ['raw' => (string) $raw];
};
// A wide phone photo carrying a location in its EXIF block.
$im75 = imagecreatetruecolor(3000, 1500);
imagefilledrectangle($im75, 0, 0, 2999, 1499, imagecolorallocate($im75, 30, 80, 110));
ob_start();
imagejpeg($im75, null, 80);
$jpg75 = (string) ob_get_clean();
$app1 = "Exif\0\0" . 'GPS 52.955N 1.020E it75-secret';
$jpg75 = substr($jpg75, 0, 2) . "\xFF\xE1" . pack('n', strlen($app1) + 2) . $app1 . substr($jpg75, 2);
$tok75 = bin2hex(random_bytes(12));
$up = $mp75('/chat-upload.php', ['token' => $tok75], 'photo.jpg', $jpg75);
$staged75 = (string) ($up['url'] ?? '');
$name75 = basename($staged75);
clearstatcache();
it_check('§75 a chat photo is staged privately, not published', strpos($staged75, 'uploads/pending/chat-') === 0 && is_file($work . '/' . $staged75) && !is_file($work . '/uploads/' . $name75), json_encode($up));
$st75 = is_file($work . '/' . $staged75) ? (string) file_get_contents($work . '/' . $staged75) : '';
$sz75 = $st75 !== '' ? getimagesizefromstring($st75) : false;
it_check('§75 …cleaned of its location and brought down to 2000px on its long side', $st75 !== '' && strpos($st75, 'it75-secret') === false && $sz75 && $sz75[0] === 2000 && $sz75[1] === 1000, $sz75 ? $sz75[0] . 'x' . $sz75[1] : 'unreadable');
it_check('§75 …and the staging folder carries its own deny-all rule', is_file($work . '/uploads/pending/.htaccess') && strpos((string) file_get_contents($work . '/uploads/pending/.htaccess'), 'Require all denied') !== false, '');
$anon75 = [];
$r = http($anon75, 'POST', '/messages.php', ['action' => 'send', 'token' => $tok75, 'body' => 'Here is the view', 'name' => 'Ana Seventyfive', 'email' => 'ana75@gmail.com', 'attachment' => $staged75]);
$aTid75 = (int) $rootDb->query('SELECT id FROM chat_threads WHERE token = ' . $rootDb->quote($tok75))->fetchColumn();
$att75 = (string) $rootDb->query("SELECT attachment FROM messages WHERE thread_id = $aTid75 ORDER BY id DESC LIMIT 1")->fetchColumn();
clearstatcache();
it_check('§75 sending it publishes it: the message carries the public path', $r['code'] === 200 && $att75 === 'uploads/' . $name75 && is_file($work . '/uploads/' . $name75) && !is_file($work . '/' . $staged75), $r['raw'] . ' ' . $att75);
$r = http($anon75, 'POST', '/messages.php', ['action' => 'send', 'token' => $tok75, 'body' => 'And again', 'attachment' => $staged75]);
it_check('§75 …a send retried with the staged path still finds the photo', $r['code'] === 200 && (string) $rootDb->query("SELECT attachment FROM messages WHERE thread_id = $aTid75 ORDER BY id DESC LIMIT 1")->fetchColumn() === 'uploads/' . $name75, $r['raw']);
$r = http($admin, 'POST', '/messages.php', ['action' => 'delete', 'thread_id' => $aTid75]);
clearstatcache();
it_check('§75 deleting the conversation deletes its photo, file and WebP copy', $r['code'] === 200 && !is_file($work . '/uploads/' . $name75) && !is_file($work . '/uploads/' . $name75 . '.webp'), $r['raw']);
// Deleting an account takes its chat photos, its photos never shown and its unpublished
// suggestions; an approved photo and a published card stay, without its name.
$g75 = 'gwen75-' . bin2hex(random_bytes(3)) . '@gmail.com';
$gj75 = [];
http($gj75, 'POST', '/auth.php', ['action' => 'guest_register', 'name' => 'Gwen Seventyfive', 'email' => $g75, 'password' => 'gwenpass75x', 'address' => '7 Test Lane, Norwich', 'postcode' => 'NR25 7AB']);
$gid75 = (int) $rootDb->query('SELECT id FROM guests WHERE email = ' . $rootDb->quote($g75))->fetchColumn();
$ts75 = time();
http($gj75, 'POST', '/auth.php', ['action' => 'guest_magic_consume', 'guest_id' => $gid75, 'ts' => $ts75, 'token' => substr(hash_hmac('sha256', 'login:' . $gid75 . ':' . $ts75, $SECRET), 0, 32)]);
$up = $mp75('/chat-upload.php', [], 'mine.jpg', $jpg75, $gj75);
$gStaged75 = (string) ($up['url'] ?? '');
http($gj75, 'POST', '/messages.php', ['action' => 'send', 'body' => 'Our photo', 'attachment' => $gStaged75]);
$gFile75 = (string) $rootDb->query("SELECT m.attachment FROM messages m JOIN chat_threads t ON t.id = m.thread_id WHERE t.guest_id = $gid75 AND m.attachment <> '' LIMIT 1")->fetchColumn();
$mk75 = function ($prefix) use ($work) {
    $n = $prefix . '-' . bin2hex(random_bytes(6)) . '.jpg';
    file_put_contents($work . '/uploads/' . $n, 'x');
    return 'uploads/' . $n;
};
$pend75 = $mk75('guest');
$appr75 = $mk75('guest');
$rootDb->prepare("INSERT INTO guest_photos (prop_key, guest_id, guest_name, url, caption, status) VALUES (?,?,?,?,?,?)")->execute([$propKey, $gid75, 'Gwen Seventyfive', $pend75, 'waiting', 'pending']);
$rootDb->prepare("INSERT INTO guest_photos (prop_key, guest_id, guest_name, url, caption, status) VALUES (?,?,?,?,?,?)")->execute([$propKey, $gid75, 'Gwen Seventyfive', $appr75, 'shown', 'approved']);
$exPend75 = $mk75('experience');
$rootDb->prepare("INSERT INTO experiences (title, body, image_url, category, status, source, suggested_by_name, suggested_by_email) VALUES ('IT75 pending', 'b', ?, 'Walks', 'pending', 'guest', 'Gwen Seventyfive', ?)")->execute([$exPend75, $g75]);
$exPendId75 = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO experiences (title, body, image_url, category, status, source, suggested_by_name, suggested_by_email) VALUES ('IT75 shown', 'b', '', 'Walks', 'published', 'guest', 'Gwen Seventyfive', ?)")->execute([$g75]);
$exPubId75 = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute(['guest-ping-' . $gid75, json_encode(['title' => 'IT75-PING', 'body' => 'Your balance is due', 'at' => time()])]);
clearstatcache();
it_check('§75 (fixture) a sent chat photo, a photo waiting, one approved, two suggestions', $gFile75 !== '' && is_file($work . '/' . $gFile75) && is_file($work . '/' . $pend75), $gFile75 . ' ' . $gStaged75);
// A SITE PHOTO IS NOT A CHAT ATTACHMENT. Naming a cottage's gallery image (its path is
// in the public content feed) as one put it on the guest's message, and deleting the
// account then deleted it from the cottage page, resized copies and all.
$site75 = $mk75('gallery');
$r = http($gj75, 'POST', '/messages.php', ['action' => 'send', 'body' => 'Not mine to send', 'attachment' => $site75]);
it_check('§75 a site photo named as a chat attachment is not attached', (int) $rootDb->query('SELECT COUNT(*) FROM messages WHERE attachment = ' . $rootDb->quote($site75))->fetchColumn() === 0, $r['raw']);
$r = http($gj75, 'POST', '/auth.php', ['action' => 'guest_delete_account']);
clearstatcache();
it_check('§75 deleting the account deletes its chat photos', $r['code'] === 200 && !is_file($work . '/' . $gFile75), $r['raw']);
it_check('§75 …and leaves a site photo where it is', is_file($work . '/' . $site75), $site75);
it_check('§75 …and a photo never shown, row and file, while an approved one stays on the wall without a name',
    !is_file($work . '/' . $pend75) && (int) $rootDb->query('SELECT COUNT(*) FROM guest_photos WHERE url = ' . $rootDb->quote($pend75))->fetchColumn() === 0
    && is_file($work . '/' . $appr75) && $rootDb->query('SELECT guest_name FROM guest_photos WHERE url = ' . $rootDb->quote($appr75))->fetchColumn() === 'Former guest', '');
it_check('§75 …and the text of their last notification', (int) $rootDb->query("SELECT COUNT(*) FROM content WHERE item_key = 'guest-ping-$gid75'")->fetchColumn() === 0, '');
it_check('§75 …and a suggestion never published, picture and all, while a published card keeps nothing of them',
    (int) $rootDb->query("SELECT COUNT(*) FROM experiences WHERE id = $exPendId75")->fetchColumn() === 0 && !is_file($work . '/' . $exPend75)
    && $rootDb->query("SELECT CONCAT(suggested_by_name, suggested_by_email) FROM experiences WHERE id = $exPubId75")->fetchColumn() === '', '');
// Moderation: a rejected photo's file goes, and it cannot then be approved onto the wall.
$rej75 = $mk75('guest');
$rootDb->prepare("INSERT INTO guest_photos (prop_key, guest_id, guest_name, url, caption, status) VALUES (?,NULL,'A Guest',?,'c','pending')")->execute([$propKey, $rej75]);
$rejId75 = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/photos.php', ['action' => 'reject', 'id' => $rejId75]);
clearstatcache();
it_check('§75 rejecting a guest photo deletes its file', $r['code'] === 200 && !is_file($work . '/' . $rej75), $r['raw']);
$r = http($admin, 'POST', '/photos.php', ['action' => 'approve', 'id' => $rejId75]);
it_check('§75 …and approving it afterwards is refused, never a broken image on the wall', $r['code'] === 409 && $rootDb->query("SELECT status FROM guest_photos WHERE id = $rejId75")->fetchColumn() === 'rejected', $r['raw']);
$exRej75 = $mk75('experience');
$rootDb->prepare("INSERT INTO experiences (title, body, image_url, category, status, source) VALUES ('IT75 reject', 'b', ?, 'Walks', 'pending', 'guest')")->execute([$exRej75]);
$exRejId75 = (int) $rootDb->lastInsertId();
$r = http($admin, 'POST', '/experiences.php', ['action' => 'reject', 'id' => $exRejId75]);
clearstatcache();
it_check('§75 rejecting a suggestion deletes the picture the guest sent', $r['code'] === 200 && !is_file($work . '/' . $exRej75) && $rootDb->query("SELECT image_url FROM experiences WHERE id = $exRejId75")->fetchColumn() === '', $r['raw']);
// The daily sweeps: a staged file nobody sent, and a chat photo no message carries.
$oldStaged75 = $work . '/uploads/pending/chat-' . bin2hex(random_bytes(6)) . '.jpg';
$newStaged75 = $work . '/uploads/pending/chat-' . bin2hex(random_bytes(6)) . '.jpg';
$orph75 = $work . '/uploads/chat-' . bin2hex(random_bytes(6)) . '.jpg';
$kept75 = 'chat-' . bin2hex(random_bytes(6)) . '.jpg';
foreach ([$oldStaged75, $newStaged75, $orph75, $work . '/uploads/' . $kept75] as $f) {
    file_put_contents($f, 'x');
}
touch($oldStaged75, time() - 3 * 86400);
touch($orph75, time() - 2 * 86400);
touch($work . '/uploads/' . $kept75, time() - 2 * 86400);
$rootDb->prepare("INSERT INTO chat_threads (guest_id, token, name, email) VALUES (NULL, ?, 'Kept', 'kept75@gmail.com')")->execute(['kt75-' . bin2hex(random_bytes(6))]);
$kTid75 = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO messages (guest_id, thread_id, sender_role, body, attachment) VALUES (NULL, ?, 'guest', 'kept', ?)")->execute([$kTid75, 'uploads/' . $kept75]);
http($noJar, 'GET', '/self-repair.php?cron=' . $SECRET);
clearstatcache();
it_check('§75 self-repair empties a staged file nobody sent, and leaves a fresh one', !is_file($oldStaged75) && is_file($newStaged75), '');
it_check('§75 …and deletes a chat photo no message carries, never one that a message does', !is_file($orph75) && is_file($work . '/uploads/' . $kept75), '');
@unlink($newStaged75);
@unlink($work . '/uploads/' . $kept75);
$rootDb->exec("DELETE FROM messages WHERE thread_id = $kTid75");
$rootDb->exec("DELETE FROM chat_threads WHERE id = $kTid75");
$rootDb->exec("DELETE FROM guest_photos WHERE url IN (" . $rootDb->quote($appr75) . ',' . $rootDb->quote($rej75) . ')');
$rootDb->exec("DELETE FROM experiences WHERE id IN ($exPubId75, $exRejId75)");
@unlink($work . '/' . $appr75);
// A /64 is one address to a limit: a phone moving through its privacy addresses no
// longer buys a fresh allowance with each one.
$ipProbe75 = $work . '/it75-ip-' . bin2hex(random_bytes(4)) . '.php';
file_put_contents($ipProbe75, "<?php\nrequire __DIR__ . '/db.php';\n\$out = [];\nforeach (['2001:db8:75:1::a', '2001:db8:75:1:ffff::b', '2001:db8:75:1:1234:5678:9abc:def0', '2001:db8:75:2::a'] as \$ip) {\n    \$_SERVER['REMOTE_ADDR'] = \$ip;\n    \$out[] = rate_allow('it75-v6', 2, 10);\n}\n\$_SERVER['REMOTE_ADDR'] = '::ffff:192.0.2.75';\n\$out[] = client_ip_key();\necho \"\\n\" . json_encode(\$out);\n");
$ipOut75 = (string) shell_exec('cd ' . escapeshellarg($work) . ' && php ' . escapeshellarg($ipProbe75) . ' 2>/dev/null');
@unlink($ipProbe75);
$ipR75 = json_decode(trim(substr($ipOut75, (int) strrpos($ipOut75, "\n["))), true);
it_check('§75 three addresses in one /64 share one allowance; the next /64 has its own', $ipR75 === [true, true, false, true, '192.0.2.75'], $ipOut75);
$rootDb->exec("DELETE FROM login_attempts WHERE identifier = 'it75-v6'");

// §76 THE OWNER'S BOOT DOES NOT GROW WITH EVERY BOOKING EVER TAKEN. Measured on five
// years' data: each card plan's state asked the payments table on its own (216 of the
// boot's 262 statements), every booking carried thirteen columns nothing reads (three
// of them Square's card-on-file handles) and a register link closed long ago, and the
// owner's content held the server's own caches (the mailbox's handled list alone ran
// to 149KB). Counted on the probe's own connection, so other work on the server cannot
// move the figure.
echo "\n== §76 the owner's boot does not grow with every booking ever taken ==\n";
$boot76 = fn() => $mailProbe('require_once __DIR__ . "/bookings.php"; $q = fn() => (int) db()->query("SHOW SESSION STATUS LIKE \'Questions\'")->fetch()["Value"]; $a = $q(); $p = bookings_admin_payload(); $b = $q(); $st = []; $cols = []; $reg = []; foreach ($p["bookings"] as $r) { $st[(int) $r["id"]] = $r["autopay_state"] ?? ""; $cols += array_flip(array_keys($r)); $reg[(int) $r["id"]] = $r["reg_url"] ?? ""; } $exp = []; foreach (db()->query("SELECT * FROM bookings")->fetchAll() as $r) { [$s] = booking_autopay_state($r); $exp[(int) $r["id"]] = $s; } echo "\n" . json_encode(["n" => $b - $a, "st" => $st, "exp" => $exp, "cols" => array_keys($cols), "reg" => $reg]);');
$R76a = $boot76();
$ids76 = [];
$d76 = fn($n) => (new DateTime($ukToday, new DateTimeZone('Europe/London')))->modify('+' . $n . ' days')->format('Y-m-d');
for ($i = 0; $i < 10; $i++) {
    $rootDb->prepare("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights, autopay_consent_at, autopay_card_id, autopay_customer_id, autopay_amount, autopay_due, autopay_attempts) VALUES (?, ?, ?, ?, ?, 2, 0, 'deposit', ?, 600, 600, 0, 3, NOW(), ?, ?, 450, ?, 0)")
        ->execute([$propKey, 'Plan Seventysix ' . $i, 'plan76-' . $i . '@example.com', $d76(400 + 5 * $i), $d76(403 + 5 * $i), 0, 'ccof:it76-' . $i, 'cust-it76-' . $i, $d76(370 + 5 * $i)]);
    $bid = (int) $rootDb->lastInsertId();
    $ids76[] = $bid;
    if ($i % 2) {
        $rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id) VALUES (?, 'deposit', 150, 'COMPLETED', ?)")->execute([$bid, 'sq_it76_' . $i]);
    }
    if ($i === 3) {
        $rootDb->prepare("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id) VALUES (?, 'refund', 50, 'FAILED', ?)")->execute([$bid, 'sq_it76_r' . $i]);
    }
}
$R76b = $boot76();
$grow76 = (int) ($R76b['n'] ?? 999) - (int) ($R76a['n'] ?? 0);
it_check('§76 ten more card plans cost the owner\'s booking list no more statements', is_array($R76a) && is_array($R76b) && $grow76 < 3, "grew by $grow76 (" . ($R76a['n'] ?? '?') . ' → ' . ($R76b['n'] ?? '?') . ')');
$same76 = is_array($R76b) && count($R76b['st'] ?? []) === count($R76b['exp'] ?? []);
foreach (($R76b['exp'] ?? []) as $id => $s) {
    if (($R76b['st'][$id] ?? null) !== $s) {
        $same76 = false;
    }
}
$planStates76 = array_map(fn($id) => $R76b['st'][$id] ?? '', $ids76);
// Half the deposits are on the ledger alone (the booking row says nothing paid), so a
// list that read the ledger wrongly would give those plans a different state.
it_check('§76 …and every plan\'s state is what it is booking by booking', $same76 && count(array_filter($planStates76, fn($s) => $s !== '' && $s !== 'off')) === 10 && count(array_unique($planStates76)) >= 2, json_encode($planStates76));
$omit76 = ['hold_payment_id', 'autopay_card_id', 'autopay_customer_id', 'hold_authorized_at', 'hold_requested_at', 'deposit_reminded_at', 'review_request_sent', 'thankyou_sent', 'autopay_last_try', 'autopay_notified_at', 'autopay_last_code', 'autopay_collected_for', 'arrival_window'];
it_check('§76 the list leaves on the server what the back office never reads, the card handles among it', array_values(array_intersect($omit76, $R76b['cols'] ?? [])) === [] && in_array('autopay_state', $R76b['cols'] ?? [], true), json_encode(array_values(array_intersect($omit76, $R76b['cols'] ?? []))));
$client76 = (string) file_get_contents(__DIR__ . '/app.js') . (string) file_get_contents(__DIR__ . '/admin.js') . (string) file_get_contents(__DIR__ . '/guest-app.js');
it_check('§76 …and no client file names any of them', array_values(array_filter($omit76, fn($c) => preg_match('/\b' . preg_quote($c, '/') . '\b/', $client76) === 1)) === [], '');
$reg76 = $rootDb->prepare("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES (?, ?, 'reg76@example.com', ?, ?, 2, 0, 'paid', 300, 300, 300, 0, 3)");
$reg76->execute([$propKey, 'Reg Closed', $d76(-13), $d76(-10)]);
$regClosed76 = (int) $rootDb->lastInsertId();
$reg76->execute([$propKey, 'Reg Open', $d76(-6), $d76(-3)]);
$regOpen76 = (int) $rootDb->lastInsertId();
$R76c = $boot76();
it_check('§76 a register link rides only a stay whose link still opens (a week after it)', ($R76c['reg'][$regClosed76] ?? 'x') === '' && strpos((string) ($R76c['reg'][$regOpen76] ?? ''), 'guest-details.php?b=' . $regOpen76) !== false, json_encode([$R76c['reg'][$regClosed76] ?? null, $R76c['reg'][$regOpen76] ?? null]));
// The server's own caches stay out of the owner's content, from both outputs.
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('mailbox-poll', ?), ('guest-ping-7676', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()")->execute([json_encode(['uids' => ['it76-uid'], 'at' => 1]), json_encode(['title' => 'IT76-PING', 'at' => time()])]);
$c76 = $mailProbe('require_once __DIR__ . "/content.php"; $_SESSION["admin_id"] = ' . (int) $ownerId . '; $p = content_public_payload(); echo "\n" . json_encode(["leak" => array_key_exists("mailbox-poll", $p["content"]) || array_key_exists("guest-ping-7676", $p["content"]), "later" => (content_json("mailbox-poll", [])["uids"] ?? [])]);');
it_check('§76 the owner\'s content leaves the server\'s caches behind, which the server still reads', is_array($c76) && ($c76['leak'] ?? true) === false && ($c76['later'] ?? []) === ['it76-uid'], json_encode($c76));
$r = http($admin, 'POST', '/content.php', ['action' => 'get_all']);
it_check('§76 …and so does the back office\'s full read', $r['code'] === 200 && is_array($r['json']['content'] ?? null) && !array_key_exists('mailbox-poll', $r['json']['content']) && !array_key_exists('guest-ping-7676', $r['json']['content']), substr($r['raw'], 0, 160));
$so76 = $mailProbe('require_once __DIR__ . "/content.php"; echo "\n" . json_encode(["keys" => CONTENT_SERVER_ONLY, "prefixes" => CONTENT_SERVER_ONLY_PREFIX]);');
$named76 = array_values(array_filter(array_merge($so76['keys'] ?? [], $so76['prefixes'] ?? []), fn($k) => strpos($client76, "'" . $k) !== false || strpos($client76, '"' . $k) !== false || strpos($client76, '`' . $k) !== false));
it_check('§76 no client file reads a key kept on the server', is_array($so76) && count($so76['keys'] ?? []) > 10 && $named76 === [], json_encode($named76));
// A guest's notification text waits five minutes for their phone; the rows stayed for good.
$rootDb->prepare("INSERT INTO content (item_key, item_value, updated_at) VALUES ('guest-ping-7677', ?, DATE_SUB(NOW(), INTERVAL 2 DAY)) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)")->execute([json_encode(['title' => 'old', 'at' => 1])]);
http($noJar, 'GET', '/self-repair.php?cron=' . $SECRET);
$pings76 = $rootDb->query("SELECT item_key FROM content WHERE item_key IN ('guest-ping-7676', 'guest-ping-7677') ORDER BY item_key")->fetchAll(PDO::FETCH_COLUMN);
it_check('§76 self-repair clears a notification no phone fetched within a day, and keeps a fresh one', $pings76 === ['guest-ping-7676'], json_encode($pings76));
// The calendar's two hot reads can use an index that starts with the cottage; the
// owner's enquiry list one on declined_at.
$ex76 = function ($sql, $args) use ($rootDb) {
    $s = $rootDb->prepare('EXPLAIN ' . $sql);
    $s->execute($args);
    return implode(',', array_map(fn($r) => (string) ($r['possible_keys'] ?? ''), $s->fetchAll()));
};
it_check('§76 a visitor\'s availability read and the clash check can use (prop_key, check_out, check_in)',
    strpos($ex76('SELECT check_in, check_out FROM bookings WHERE prop_key = ? AND check_out >= CURDATE()', [$propKey]), 'idx_book_prop_dates') !== false
    && strpos($ex76('SELECT COUNT(*) c FROM bookings WHERE prop_key = ? AND check_in < ? AND check_out > ?', [$propKey, $d76(403), $d76(400)]), 'idx_book_prop_dates') !== false, '');
it_check('§76 the owner\'s enquiry list can use (declined_at, created_at)', strpos($ex76('SELECT * FROM enquiries WHERE declined_at IS NULL ORDER BY created_at ASC', []), 'idx_enq_declined') !== false, '');
$r = http($admin, 'GET', '/track.php?action=summary&days=30');
it_check('§76 Analytics no longer works out a figure nothing reads', $r['code'] === 200 && is_array($r['json'] ?? null) && !array_key_exists('visitorMix', $r['json']) && array_key_exists('uniqueVisitors', $r['json']), substr($r['raw'], 0, 200));
$rootDb->exec('DELETE FROM payments WHERE booking_id IN (' . implode(',', $ids76) . ')');
$rootDb->exec('DELETE FROM bookings WHERE id IN (' . implode(',', array_merge($ids76, [$regClosed76, $regOpen76])) . ')');
$rootDb->exec("DELETE FROM content WHERE item_key IN ('mailbox-poll', 'guest-ping-7676', 'guest-ping-7677')");

// §77 REPLY BY EMAIL, AGAINST A MAILBOX THAT ANSWERS. The poll had only ever met a
// mailbox it could not reach (§74), so the work it exists for (an owner's emailed
// answer reaching the guest's chat, a guest's reply landing as theirs, our own alerts
// and a forged sender left alone) was gated piece by piece in test-reply and never
// end to end. test-pop3-server.php serves a folder of real emails over TLS; the poll
// and the Inbox's mailbox.php read it exactly as they read the real one. The webhook
// route (inbound-mail.php, used when REPLY_INBOX is set) is driven alongside.
echo "\n== §77 replies by email reach the right conversation, as the right person ==\n";
$md77 = $work . '/it-maildir';
@mkdir($md77, 0777, true);
$log77 = $work . '/it-pop3.log';
@unlink($log77);
$srv77 = proc_open('exec php ' . escapeshellarg(__DIR__ . '/test-pop3-server.php') . ' ' . (int) $POP_PORT . ' ' . escapeshellarg($md77) . ' ' . escapeshellarg($log77), [], $pipes77);
register_shutdown_function(function () use ($srv77) {
    if (is_resource($srv77)) {
        proc_terminate($srv77);
    }
});
$up77 = false;
for ($i = 0; $i < 100 && !$up77; $i++) {
    usleep(100000);
    $up77 = strpos((string) @file_get_contents($log77), 'LISTEN') !== false;
}
it_check('§77 (fixture) the fake mailbox is listening', $up77, (string) @file_get_contents($log77));
$who77 = $mailProbe('$o = db()->query("SELECT * FROM admins ORDER BY id LIMIT 1")->fetch(); echo "\n" . json_encode(["owner" => strtolower(admin_contact_email($o)), "id" => (int) $o["id"], "own" => mailbox_own_address()]);');
$owner77 = (string) ($who77['owner'] ?? '');
$own77 = (string) ($who77['own'] ?? '');
// The owner reads the same mailbox the site sends from, and their phone writes as it,
// so that address is one of theirs too.
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('notify-emails', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode([$own77])]);
$th77 = $rootDb->prepare('INSERT INTO chat_threads (guest_id, token, name, email) VALUES (NULL, ?, ?, ?)');
$th77->execute(['it77-' . bin2hex(random_bytes(6)), 'Wren Ashby', 'wren77@example.com']);
$t77 = (int) $rootDb->lastInsertId();
$th77->execute(['it77-' . bin2hex(random_bytes(6)), 'Gone Guest', 'gone77@example.com']);
$gone77 = (int) $rootDb->lastInsertId();
$tk77 = $mailProbe('echo "\n" . json_encode(["o" => msg_reply_token(' . $t77 . '), "g" => msg_reply_token(' . $t77 . ', "guest"), "gone" => msg_reply_token(' . $gone77 . ')]);');
$o77 = (string) ($tk77['o'] ?? '');
$g77 = (string) ($tk77['g'] ?? '');
$og77 = (string) ($tk77['gone'] ?? '');
$legacy77 = substr($o77, 0, -16); // the 16-hex form that emails sent before the widening carry
$half77 = $legacy77 . str_repeat('0', 16); // a current token whose second half is forged
$rootDb->exec('DELETE FROM chat_threads WHERE id = ' . $gone77); // the owner deleted that chat
it_check('§77 (fixture) the owner, the site\'s address and three tokens', $owner77 !== '' && $own77 !== '' && $owner77 !== $own77 && strlen($o77) === strlen((string) $t77) + 33 && $g77 !== '' && $og77 !== '', json_encode([$who77, $tk77]));
$eml77 = function ($name, array $head, $body) use ($md77) {
    $h = 'Date: ' . date('r') . "\r\n";
    foreach ($head as $k => $v) {
        $h .= "$k: $v\r\n";
    }
    file_put_contents($md77 . '/' . $name . '.eml', $h . "\r\n" . $body);
};
$quote77 = "\r\n\r\nOn Fri, 9 Oct 2026 at 10:00, Cottage Holidays Blakeney <$own77> wrote:\r\n> Wren Ashby asked: is there parking?\r\n";
$plain77 = ['Content-Type' => 'text/plain; charset=UTF-8'];
$eml77('it77-01-owner', ['From' => "George <$owner77>", 'To' => $own77, 'Subject' => 'Re: New message from Wren Ashby', 'In-Reply-To' => "<msg.$o77@yourdomain.co.uk>", 'Content-Type' => 'text/plain; charset=UTF-8', 'Content-Transfer-Encoding' => 'quoted-printable'], 'Yes =E2=80=94 the parking is behind the cottage, IT77-OWNER.' . $quote77);
$eml77('it77-02-guest', ['From' => 'Wren Ashby <wren77@example.com>', 'To' => $own77, 'Subject' => 'Re: Your message to Cottage Holidays Blakeney', 'In-Reply-To' => "<msg.$g77@yourdomain.co.uk>", 'Content-Type' => 'text/plain; charset=ISO-8859-1', 'Content-Transfer-Encoding' => '8bit'], "Thanks! We\x92ll bring \xA320 for the honesty box, IT77-GUEST." . $quote77);
$eml77('it77-03-forged', ['From' => "George <$owner77>", 'To' => $own77, 'Subject' => 'Re: Your message to Cottage Holidays Blakeney', 'In-Reply-To' => "<msg.$g77@yourdomain.co.uk>"] + $plain77, 'IT77-FORGED Please refund the deposit to this new card.');
$eml77('it77-04-site', ['From' => "Cottage Holidays Blakeney <$own77>", 'To' => $owner77, 'X-CHB-Origin' => 'site', 'Message-ID' => "<msg.$o77@yourdomain.co.uk>", 'Subject' => "New message from Wren Ashby [#$o77]"] + $plain77, 'IT77-SELF Wren Ashby asked: is there parking?');
$eml77('it77-05-phone', ['From' => "George <$own77>", 'To' => $own77, 'Message-ID' => '<5F3A2B1C-77AA-4E7D-9C1B@icloud.com>', 'Subject' => "Re: New message from Wren Ashby [#$o77]"] + $plain77, 'IT77-PHONE The key safe code comes the day before.' . $quote77);
$eml77('it77-06-customer', ['From' => 'Anne Betts <anne77@example.org>', 'To' => $own77, 'Subject' => 'Availability in May?'] + $plain77, 'Hello, IT77-ANNE is the cottage free in May?');
$eml77('it77-07-dmarc', ['From' => 'noreply-dmarc-support@google.com', 'To' => $own77, 'Subject' => 'Report domain: yourdomain.co.uk'] + $plain77, 'IT77-DMARC aggregate report attached.');
$eml77('it77-08-legacy', ['From' => "George <$owner77>", 'To' => $own77, 'Subject' => "Re: New message from Wren Ashby [#$legacy77]"] + $plain77, 'IT77-LEGACY An old email, an old token.');
$eml77('it77-09-gone', ['From' => "George <$owner77>", 'To' => $own77, 'Subject' => 'Re: New message from Gone Guest', 'In-Reply-To' => "<msg.$og77@yourdomain.co.uk>"] + $plain77, 'IT77-GONE Replying to a chat since deleted.');
$eml77('it77-10-half', ['From' => "George <$owner77>", 'To' => $own77, 'Subject' => 'Re: New message from Wren Ashby', 'In-Reply-To' => "<msg.$half77@yourdomain.co.uk>"] + $plain77, 'IT77-HALF A token with its second half forged.');
$eml77('it77-11-refs', ['From' => "George <$owner77>", 'To' => $own77, 'Subject' => 'Re: New message from Wren Ashby', 'References' => '<msg.9x' . str_repeat('ab', 16) . "@elsewhere.example> <msg.$o77@yourdomain.co.uk>"] + $plain77, 'IT77-REFS Found behind another id.');
// The poll, as the cron and the Inbox's nudge run it, with the mailbox switched on.
$poll77 = function () use ($work) {
    $f = $work . '/it-poll77.php';
    file_put_contents($f, "<?php\nfunction mailbox_auto_enabled() { return true; }\nrequire __DIR__ . '/db.php';\nrequire_once __DIR__ . '/mailbox-read.php';\necho \"\\n\" . json_encode(poll_mailbox_replies(true));\n");
    $out = (string) shell_exec('cd ' . escapeshellarg($work) . ' && php ' . escapeshellarg($f) . ' 2>&1');
    @unlink($f);
    $j = json_decode(trim(substr($out, (int) strrpos($out, "\n{"))), true);
    return is_array($j) ? $j : ['raw' => substr($out, -600)];
};
$retr77 = fn() => preg_match_all('/^RETR /m', (string) @file_get_contents($log77));
$rows77 = fn() => $rootDb->query('SELECT thread_id, sender_role, body FROM messages WHERE body LIKE ' . $rootDb->quote('%IT77-%') . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$one77 = function ($marker) use ($rows77) {
    $hit = array_values(array_filter($rows77(), fn($r) => strpos($r['body'], $marker) !== false));
    return count($hit) === 1 ? $hit[0] : (count($hit) ? ['many' => count($hit)] : null);
};
$R77 = $poll77();
it_check('§77 the poll reads the mailbox and delivers five replies', ($R77['ok'] ?? false) === true && ($R77['handled'] ?? -1) === 5, json_encode($R77));
$r = $one77('IT77-OWNER');
it_check('§77 the owner\'s emailed answer reaches the guest\'s chat as the owner\'s, decoded and without the quoted alert', ($r['sender_role'] ?? '') === 'admin' && (int) ($r['thread_id'] ?? 0) === $t77 && ($r['body'] ?? '') === 'Yes — the parking is behind the cottage, IT77-OWNER.', json_encode($r));
$actor77 = $rootDb->prepare("SELECT actor FROM activity_log WHERE action = 'message.reply' AND entity = 'thread' AND entity_id = ? AND meta LIKE ? ORDER BY id DESC LIMIT 1");
$actor77->execute([(string) $t77, '%IT77-OWNER%']);
it_check('§77 …credited to the person whose address it came from', (string) $actor77->fetchColumn() === 'admin:' . (int) ($who77['id'] ?? 0));
$r = $one77('IT77-GUEST');
it_check('§77 the guest\'s reply lands as theirs, its Windows-1252 quote and £ intact', ($r['sender_role'] ?? '') === 'guest' && (int) ($r['thread_id'] ?? 0) === $t77 && ($r['body'] ?? '') === "Thanks! We\u{2019}ll bring \u{00A3}20 for the honesty box, IT77-GUEST.", json_encode($r));
it_check('§77 the owner\'s address on a GUEST\'s token posts nothing in the owner\'s name', $one77('IT77-FORGED') === null);
it_check('§77 the site\'s own alert, carrying an owner token, is never taken for a reply', $one77('IT77-SELF') === null);
$r = $one77('IT77-PHONE');
it_check('§77 the owner typing from the business address on their phone still reaches the chat', ($r['sender_role'] ?? '') === 'admin' && (int) ($r['thread_id'] ?? 0) === $t77, json_encode($r));
$r = $one77('IT77-LEGACY');
it_check('§77 a 16-hex token from an email sent before the widening still routes', ($r['sender_role'] ?? '') === 'admin', json_encode($r));
it_check('§77 a reply to a chat since deleted makes no orphan message', $one77('IT77-GONE') === null && (int) $rootDb->query('SELECT COUNT(*) FROM messages WHERE thread_id = ' . $gone77)->fetchColumn() === 0);
it_check('§77 a current token with its second half forged routes nothing (it was read as its first 16 hex)', $one77('IT77-HALF') === null);
$r = $one77('IT77-REFS');
it_check('§77 a token-shaped id earlier in References no longer hides the real token', ($r['sender_role'] ?? '') === 'admin', json_encode($r));
$new77 = array_column((array) json_decode((string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'mailbox-new'")->fetchColumn(), true), null, 'uid');
$newKeys77 = array_keys($new77);
sort($newKeys77);
it_check('§77 mail the poll did not route is recorded for the owner: the customer, the forged sender, the deleted chat\'s reply, the bad token', $newKeys77 === ['it77-03-forged', 'it77-06-customer', 'it77-09-gone', 'it77-10-half'], json_encode($newKeys77));
it_check('§77 …with the sender\'s name', ($new77['it77-06-customer']['name'] ?? '') === 'Anne Betts', json_encode($new77['it77-06-customer'] ?? null));
$handled77 = (array) (json_decode((string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'mailbox-poll'")->fetchColumn(), true)['uids'] ?? []);
it_check('§77 every message is marked handled, each read once', count($handled77) === 11 && $retr77() === 11, json_encode([$handled77, $retr77()]));
$before77 = [$retr77(), count($rows77())];
$R77 = $poll77();
it_check('§77 the next poll reads nothing again and posts nothing again', ($R77['ok'] ?? false) === true && ($R77['handled'] ?? -1) === 0 && [$retr77(), count($rows77())] === $before77, json_encode([$R77, $retr77(), count($rows77())]));
it_check('§77 the poll never deletes mail', preg_match('/^DELE /m', (string) @file_get_contents($log77)) === 0);
// The Inbox's own mailbox, over HTTP as the owner.
$r = http($admin, 'POST', '/mailbox.php', ['action' => 'list']);
$listed77 = array_map(fn($m) => (string) $m['uid'], (array) ($r['json']['messages'] ?? []));
sort($listed77);
it_check('§77 the Inbox lists the customer\'s mail and what the poll left as mail', $r['code'] === 200 && $listed77 === ['it77-02-guest', 'it77-03-forged', 'it77-06-customer', 'it77-09-gone', 'it77-10-half'], json_encode([$r['code'], $listed77, substr($r['raw'], 0, 160)]));
it_check('§77 …and sets aside our own alert and every owner reply already in a chat, from any of their addresses', ($r['json']['ownHidden'] ?? -1) === 5 && ($r['json']['robotHidden'] ?? -1) === 1 && ($r['json']['total'] ?? -1) === 11, json_encode([$r['json']['ownHidden'] ?? null, $r['json']['robotHidden'] ?? null, $r['json']['total'] ?? null]));
$r = http($admin, 'POST', '/mailbox.php', ['action' => 'read', 'uid' => 'it77-06-customer']);
it_check('§77 reading an email shows its words', $r['code'] === 200 && strpos((string) ($r['json']['body'] ?? ''), 'IT77-ANNE is the cottage free in May?') !== false && ($r['json']['from'] ?? '') === 'anne77@example.org', substr($r['raw'], 0, 200));
$r = http($admin, 'POST', '/mailbox.php', ['action' => 'new']);
it_check('§77 …and the new-mail count drops by the one read', $r['code'] === 200 && ($r['json']['new']['count'] ?? -1) === 3, substr($r['raw'], 0, 200));
$r = http($admin, 'POST', '/mailbox.php', ['action' => 'delete', 'uids' => ['it77-06-customer']]);
it_check('§77 deleting an email removes it from the mailbox', $r['code'] === 200 && ($r['json']['deleted'] ?? 0) === 1 && !is_file($md77 . '/it77-06-customer.eml'), substr($r['raw'], 0, 200));
$poll77();
$handled77 = (array) (json_decode((string) $rootDb->query("SELECT item_value FROM content WHERE item_key = 'mailbox-poll'")->fetchColumn(), true)['uids'] ?? []);
it_check('§77 …and the handled list forgets it with the mailbox, keeping the rest', count($handled77) === 10 && !in_array('it77-06-customer', $handled77, true), json_encode($handled77));
// THE WEBHOOK ROUTE (REPLY_INBOX set): the provider posts the parsed email as a form.
$hook77 = function (array $fields) use ($BASE, $SECRET) {
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/x-www-form-urlencoded', 'content' => http_build_query($fields), 'timeout' => 30, 'ignore_errors' => true]]);
    return trim((string) @file_get_contents($BASE . '/inbound-mail.php?key=' . rawurlencode($SECRET), false, $ctx));
};
$h = $hook77(['recipient' => "reply+$g77@yourdomain.co.uk", 'sender' => 'wren77@example.com', 'subject' => 'Re: Your message', 'stripped-text' => 'IT77-HOOK-GUEST See you on Friday.']);
$r = $one77('IT77-HOOK-GUEST');
it_check('§77 webhook: the guest\'s own reply lands as theirs (it was refused as "no thread")', $h === 'ok' && ($r['sender_role'] ?? '') === 'guest' && (int) ($r['thread_id'] ?? 0) === $t77, json_encode([$h, $r]));
$h = $hook77(['recipient' => "reply+$o77@yourdomain.co.uk", 'sender' => $owner77, 'subject' => 'Re: New message', 'stripped-text' => 'IT77-HOOK-OWNER Yes, Friday is fine.']);
$r = $one77('IT77-HOOK-OWNER');
it_check('§77 webhook: the owner\'s reply lands as the owner\'s', $h === 'ok' && ($r['sender_role'] ?? '') === 'admin', json_encode([$h, $r]));
$h = $hook77(['recipient' => "reply+$g77@yourdomain.co.uk", 'sender' => $owner77, 'subject' => 'Re: Your message', 'stripped-text' => 'IT77-HOOK-FORGED Refund to this card.']);
it_check('§77 webhook: the owner\'s address on a guest\'s token is refused', $h === 'sender not allowed' && $one77('IT77-HOOK-FORGED') === null, $h);
$h = $hook77(['recipient' => "reply+$og77@yourdomain.co.uk", 'sender' => $owner77, 'subject' => 'Re: New message', 'stripped-text' => 'IT77-HOOK-GONE Hello?']);
it_check('§77 webhook: a reply to a chat since deleted makes no orphan message', $h === 'thread gone' && $one77('IT77-HOOK-GONE') === null, $h);
$h = $hook77(['recipient' => "reply+$half77@yourdomain.co.uk", 'sender' => $owner77, 'subject' => 'Re: New message', 'stripped-text' => 'IT77-HOOK-HALF Hello?']);
it_check('§77 webhook: a token with its second half forged finds no thread', $h === 'no thread' && $one77('IT77-HOOK-HALF') === null, $h);
if (is_resource($srv77)) {
    proc_terminate($srv77);
}
$rootDb->exec('DELETE FROM messages WHERE thread_id IN (' . $t77 . ', ' . $gone77 . ')');
$rootDb->exec('DELETE FROM chat_threads WHERE id = ' . $t77);
$rootDb->exec("DELETE FROM content WHERE item_key IN ('mailbox-poll', 'mailbox-new', 'mailbox-seen', 'notify-emails')");
exec('rm -rf ' . escapeshellarg($md77));

// §78 A BADGE'S COUNT IS A COUNT. Today and Manage asked for every review, photo and
// suggestion there has ever been, to count the ones waiting. list_admin with
// count:'pending' answers the number alone, and it is the number the list shows.
echo "\n== §78 a badge's count is a count, not every row ==\n";
// One review per guest per cottage (uniq_guest_prop), so three guests.
$gIns78 = $rootDb->prepare("INSERT INTO guests (name, email, phone, address, postcode, password_hash, email_verified_at) VALUES (?, ?, '', '', '', '', NOW())");
$g78s = [];
foreach (['Rhea', 'Sol', 'Tam'] as $n78) {
    $gIns78->execute([$n78 . ' Seventyeight', strtolower($n78) . '78@example.com']);
    $g78s[] = (int) $rootDb->lastInsertId();
}
$g78 = $g78s[0];
$want78 = fn() => [
    'reviews.php' => (int) $rootDb->query("SELECT COUNT(*) FROM guest_reviews r JOIN guests g ON g.id = r.guest_id WHERE r.status = 'pending'")->fetchColumn(),
    'photos.php' => (int) $rootDb->query("SELECT COUNT(*) FROM guest_photos WHERE status = 'pending'")->fetchColumn(),
    'experiences.php' => (int) $rootDb->query("SELECT COUNT(*) FROM experiences WHERE status = 'pending'")->fetchColumn(),
];
$before78 = $want78();
$rev78 = $rootDb->prepare('INSERT INTO guest_reviews (guest_id, prop_key, stars, review_text, status) VALUES (?, ?, 5, ?, ?)');
$rev78->execute([$g78s[0], $propKey, 'IT78 waiting one', 'pending']);
$rev78->execute([$g78s[1], $propKey, 'IT78 waiting two', 'pending']);
$rev78->execute([$g78s[2], $propKey, 'IT78 shown', 'approved']);
$rev78->execute([999999, $propKey, 'IT78 orphan, its guest gone', 'pending']); // not in the list, so not in the count
$rootDb->prepare("INSERT INTO guest_photos (prop_key, guest_id, guest_name, url, caption, status) VALUES (?, ?, 'Rhea', 'uploads/it78.jpg', 'c', 'pending')")->execute([$propKey, $g78]);
$rootDb->exec("INSERT INTO experiences (title, body, status) VALUES ('IT78 idea', 'b', 'pending')");
$after78 = $want78();
foreach (['reviews.php' => 'reviews', 'photos.php' => 'photos', 'experiences.php' => 'experiences'] as $f78 => $key78) {
    $c = http($admin, 'POST', '/' . $f78, ['action' => 'list_admin', 'count' => 'pending']);
    $l = http($admin, 'POST', '/' . $f78, ['action' => 'list_admin']);
    $listed78 = count(array_filter((array) ($l['json'][$key78] ?? []), fn($x) => ($x['status'] ?? '') === 'pending'));
    it_check("§78 $f78 answers the count of those waiting without the rows, and it is what the list shows", $c['code'] === 200 && ($c['json']['pending'] ?? -1) === $listed78 && !isset($c['json'][$key78]) && $listed78 === $after78[$f78] && $after78[$f78] > $before78[$f78], json_encode([$c['json'] ?? null, $listed78, $before78[$f78], $after78[$f78]]));
}
$rootDb->exec("DELETE FROM guest_reviews WHERE review_text LIKE 'IT78%'");
$rootDb->exec("DELETE FROM guest_photos WHERE url = 'uploads/it78.jpg'");
$rootDb->exec("DELETE FROM experiences WHERE title = 'IT78 idea'");
$rootDb->exec('DELETE FROM guests WHERE id IN (' . implode(', ', $g78s) . ')');

// §79 THE GUEST JOURNEY (round 7). (a) A CARD PAYMENT AFTER THE FIRST: the write-back
// compared the DATE payment_date with '' (NULLIF), which a strict-mode database refuses
// once a date is set, so a balance paid by card failed after Square had taken it and
// the booking still read "deposit". The harness cannot run the charge (Square is off),
// so it drives the webhook's write through its real route, and pay.php's own SQL text
// against the real schema (the §60 technique).
echo "\n== §79 the guest journey ==\n";
$in79 = date('Y-m-d', strtotime('+40 days'));
$out79 = date('Y-m-d', strtotime('+43 days'));
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, payment_method, payment_date, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Dated Deposit','dd79@example.com','$in79','$out79',2,0,'deposit',100,'Square card','2026-09-01',400,400,0,3)");
$dd79 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO payments (booking_id, kind, amount, status, square_payment_id) VALUES ($dd79,'deposit',100,'COMPLETED','sq79_dep'), ($dd79,'balance',300,'PENDING','sq79_bal')");
$r79 = $post(['type' => 'payment.updated', 'data' => ['object' => ['payment' => ['id' => 'sq79_bal', 'status' => 'COMPLETED', 'reference_id' => 'CHB-' . $dd79]]]]);
$row79 = $rootDb->query("SELECT payment, deposit_paid, payment_date FROM bookings WHERE id = $dd79")->fetch(PDO::FETCH_ASSOC);
it_check('§79 a balance settling on a booking that already has a payment date is recorded (it was a 500 after the charge)',
    $r79['code'] === 200 && $row79 && $row79['payment'] === 'paid' && abs((float) $row79['deposit_paid'] - 400) < 0.005,
    json_encode([$r79, $row79]));
it_check('§79 …and the first payment\'s date is kept', $row79 && $row79['payment_date'] === '2026-09-01', json_encode($row79));
$paySrc79 = (string) file_get_contents(__DIR__ . '/pay.php');
$paySql79 = preg_match('/->prepare\("(UPDATE bookings SET payment=\?, deposit_paid=\?, payment_method=\?, payment_date=[^"]*)"\)/', $paySrc79, $pm79) ? $pm79[1] : '';
$err79 = '';
try {
    if ($paySql79 === '') {
        throw new RuntimeException('pay.php write-back not found');
    }
    $rootDb->prepare("UPDATE bookings SET payment = 'deposit', deposit_paid = 100 WHERE id = ?")->execute([$dd79]);
    $rootDb->prepare($paySql79)->execute(['paid', 400, 'Square card', date('Y-m-d'), $dd79]);
} catch (\Throwable $e) {
    $err79 = $e->getMessage();
}
$row79b = $rootDb->query("SELECT payment, payment_date FROM bookings WHERE id = $dd79")->fetch(PDO::FETCH_ASSOC);
it_check('§79 pay.php\'s own write-back runs on a dated booking and keeps its date', $err79 === '' && $row79b && $row79b['payment'] === 'paid' && $row79b['payment_date'] === '2026-09-01', $err79 . ' ' . json_encode($row79b));
$rootDb->exec("UPDATE bookings SET payment_date = NULL WHERE id = $dd79");
$rootDb->prepare($paySql79 ?: 'SELECT 1')->execute($paySql79 ? ['paid', 400, 'Square card', '2026-10-05', $dd79] : []);
it_check('§79 …and dates an undated one', (string) $rootDb->query("SELECT payment_date FROM bookings WHERE id = $dd79")->fetchColumn() === '2026-10-05');
$rootDb->exec("DELETE FROM payments WHERE booking_id = $dd79");
$rootDb->exec("DELETE FROM bookings WHERE id = $dd79");

// §80 NOTIFICATIONS (round 7). (a) A DEVICE'S ALERTS END WITH ITS SIGN-IN: signing out
// kept the device's push subscription, so a phone nobody was signed in on still got
// "New message — Hannah: the key safe code you gave me…", and a password change that
// signs out the other devices left every one of them subscribed. Three owner devices,
// a legacy row with no admin_id (the original owner's), another person's device and a
// guest's; each step changes exactly the rows it should.
echo "\n== §80 notifications ==\n";
$ep80 = fn($k) => 'https://fcm.googleapis.com/fcm/send/it80-' . $k;
$subs80 = fn() => array_map('strval', $rootDb->query("SELECT endpoint FROM push_subscriptions WHERE endpoint LIKE '%/it80-%' ORDER BY endpoint")->fetchAll(PDO::FETCH_COLUMN));
$has80 = fn($k) => in_array($ep80($k), $subs80(), true);
$dev80 = [];
foreach (['a', 'b', 'c'] as $k) {
    $dev80[$k] = [];
    http($dev80[$k], 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-123']);
    http($dev80[$k], 'POST', '/push.php', ['action' => 'subscribe_admin', 'subscription' => ['endpoint' => $ep80($k), 'keys' => ['p256dh' => 'p', 'auth' => 'a']]]);
}
$rootDb->prepare("INSERT INTO push_subscriptions (guest_id, role, endpoint, p256dh, auth, created_at, admin_id) VALUES (NULL, 'admin', ?, 'p', 'a', NOW(), NULL)")->execute([$ep80('legacy')]);
$rootDb->prepare("INSERT INTO push_subscriptions (guest_id, role, endpoint, p256dh, auth, created_at, admin_id) VALUES (NULL, 'admin', ?, 'p', 'a', NOW(), 999990)")->execute([$ep80('other')]);
it_check('§80 (fixture) three owner devices, a legacy one and another person\'s are subscribed', count($subs80()) === 5, json_encode($subs80()));
http($dev80['a'], 'POST', '/auth.php', ['action' => 'admin_logout', 'push_endpoint' => $ep80('a')]);
it_check('§80 signing out drops this device\'s alerts, and only this device\'s', !$has80('a') && $has80('b') && $has80('c') && $has80('legacy'), json_encode($subs80()));
http($dev80['b'], 'POST', '/auth.php', ['action' => 'admin_logout', 'push_endpoint' => $ep80('other')]);
it_check('§80 a sign-out naming someone else\'s device drops nothing of theirs', $has80('other') && $has80('b'), json_encode($subs80()));
$r = http($dev80['c'], 'POST', '/auth.php', ['action' => 'admin_change_password', 'current' => 'it-pass-123', 'next' => 'it-pass-80-changed', 'push_endpoint' => $ep80('c')]);
it_check('§80 a password change drops every other device of theirs, the legacy one included, and keeps this one',
    ($r['json']['ok'] ?? false) === true && $has80('c') && !$has80('b') && !$has80('legacy') && $has80('other'), $r['raw'] . ' ' . json_encode($subs80()));
$owner80 = (int) $rootDb->query("SELECT id FROM admins WHERE username = 'owner'")->fetchColumn();
$tok80 = bin2hex(random_bytes(24));
// The expiry on the APP's clock, as §51 sets it: this connection's NOW() is the server's.
$exp80 = (new DateTime('+30 minutes', new DateTimeZone('Europe/London')))->format('Y-m-d H:i:s');
$rootDb->prepare('UPDATE admins SET reset_hash = ?, reset_expires = ? WHERE id = ?')->execute([hash('sha256', $tok80), $exp80, $owner80]);
$rj80 = [];
$r = http($rj80, 'POST', '/auth.php', ['action' => 'admin_reset_save', 'link' => $owner80 . '.' . $tok80, 'password' => 'it-pass-80-reset', 'again' => 'it-pass-80-reset']);
it_check('§80 a reset from a link drops every device it signs out', ($r['json']['ok'] ?? false) === true && !$has80('c') && $has80('other'), $r['raw'] . ' ' . json_encode($subs80()));
$rootDb->prepare("INSERT INTO guests (name, email, phone, address, postcode, password_hash, email_verified_at) VALUES ('Push Eighty', 'push80@example.com', '', '', '', ?, NOW())")->execute([password_hash('longenough80', PASSWORD_DEFAULT)]);
$g80 = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO push_subscriptions (guest_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, 'p', 'a', NOW())")->execute([$g80, $ep80('guest')]);
$gj80 = [];
http($gj80, 'POST', '/auth.php', ['action' => 'guest_login', 'email' => 'push80@example.com', 'password' => 'longenough80']);
http($gj80, 'POST', '/auth.php', ['action' => 'guest_logout', 'push_endpoint' => $ep80('guest')]);
it_check('§80 a guest signing out drops their device\'s alerts too', !$has80('guest'), json_encode($subs80()));
// …and a guest's new password signs out their other devices, so it drops those devices' alerts too.
foreach (['g1', 'g2'] as $k) {
    $rootDb->prepare("INSERT INTO push_subscriptions (guest_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, 'p', 'a', NOW())")->execute([$g80, $ep80($k)]);
}
$gk80 = [];
http($gk80, 'POST', '/auth.php', ['action' => 'guest_login', 'email' => 'push80@example.com', 'password' => 'longenough80']);
$r = http($gk80, 'POST', '/auth.php', ['action' => 'guest_change_password', 'current' => 'longenough80', 'next' => 'longenough80b', 'push_endpoint' => $ep80('g1')]);
it_check('§80 a guest\'s new password drops their other devices\' alerts and keeps this one',
    ($r['json']['ok'] ?? false) === true && $has80('g1') && !$has80('g2') && $has80('other'), $r['raw'] . ' ' . json_encode($subs80()));
$rootDb->exec("DELETE FROM push_subscriptions WHERE endpoint LIKE '%/it80-%'");
$rootDb->exec('DELETE FROM guests WHERE id = ' . $g80);

// (b) THE ONE-TAP APPROVE LINK IS ONE PERSON'S, and only someone who may approve gets
// one. Every copy of the new-enquiry email carried the same link and enquiry-action.php
// trusted the link alone: a Host refused in the app approved from the email, booking the
// guest and asking them for money. The copies are composed here from the REAL people
// (CLI in the app copy, as §52 asks who an email would reach), then each person's link
// is used against the real page.
$nj80 = [];
$probe80 = function ($code) use ($work) {
    $f = $work . '/it-mail-probe80.php';
    file_put_contents($f, "<?php\nrequire __DIR__ . '/db.php';\nrequire_once __DIR__ . '/mailer.php';\nrequire_once __DIR__ . '/enquiry-actions.php';\n" . $code);
    $out = (string) shell_exec('cd ' . escapeshellarg($work) . ' && php ' . escapeshellarg($f) . ' 2>/dev/null');
    @unlink($f);
    return json_decode(trim(substr($out, (int) strrpos($out, "\n{"))), true);
};
$fp80 = function ($path, array $fields) use ($BASE) {
    $o = ['http' => ['method' => 'POST', 'header' => 'Content-Type: application/x-www-form-urlencoded', 'content' => http_build_query($fields), 'timeout' => 20, 'ignore_errors' => true]];
    $http_response_header = [];
    $raw = @file_get_contents($BASE . $path, false, stream_context_create($o));
    $code = 0;
    foreach ($http_response_header as $h) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $h, $m)) {
            $code = (int) $m[1];
        }
    }
    return ['code' => $code, 'raw' => (string) $raw];
};
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, perms, created_at) VALUES ('pat80', 'x', 'Pat Noapprove', 'pat80@example.com', 0, '{\"gu.approve\":false}', NOW())");
$pat80 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, perms, created_at) VALUES ('rho80', 'x', 'Rho Approver', 'rho80@example.com', 0, '{}', NOW())");
$rho80 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, perms, created_at, removed_at) VALUES ('gone80', 'x', 'Gone Approver', 'gone80@example.com', 1, NULL, NOW(), NOW())");
$gone80 = (int) $rootDb->lastInsertId();
$own80 = (int) $rootDb->query('SELECT MIN(id) FROM admins')->fetchColumn();
$e80In = $ukPlus(120);
$e80Out = $ukPlus(123);
$rootDb->exec("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, message) VALUES ('$propKey','Tap Eighty','tap80@gmail.com','$e80In','$e80Out',2,0,'Hello')");
$e80 = (int) $rootDb->lastInsertId();
$C80 = $probe80(strtr(<<<'PHP'
$e = ['id' => EID, 'name' => 'Tap Eighty', 'email' => 'tap80@gmail.com', 'prop_key' => 'PKEY', 'check_in' => 'CIN', 'check_out' => 'COUT',
    'adults' => 2, 'children' => 0, 'action_link' => fn($pid, $a) => enquiry_action_url(site_base_url(), EID, $a, $pid)];
$out = [];
foreach (people_mail_recipients('enquiry') as $r) {
    $c = owner_enquiry_copy($e, $r['row']);
    $out[$r['to']] = preg_match('~enquiry-action\.php\?(\S+)~', $c['text'], $m) ? $m[1] : (strpos($c['text'], '?open=enquiry-EID') !== false ? 'open' : '');
}
echo "\n" . json_encode($out);
PHP, ['EID' => (string) $e80, 'PKEY' => $propKey, 'CIN' => $e80In, 'COUT' => $e80Out]));
$q80 = function ($who) use ($C80) {
    parse_str((string) ($C80[$who] ?? ''), $q);
    return $q;
};
$ownerCopy80 = array_values(array_filter((array) $C80, fn($v) => strpos((string) $v, 'p=' . $own80 . '&') !== false));
it_check('§80 the new-enquiry copy of a Host who may approve carries links made for her',
    ($q80('rho80@example.com')['p'] ?? '') === (string) $rho80 && ($q80('rho80@example.com')['id'] ?? '') === (string) $e80, json_encode($C80));
it_check('§80 …and the owner\'s copy carries his own', count($ownerCopy80) === 1, json_encode($C80));
it_check('§80 a Host whose approve switch is off gets the enquiry\'s page, never a link to act with', ($C80['pat80@example.com'] ?? null) === 'open', json_encode($C80));
it_check('§80 a removed person gets no copy at all', !array_key_exists('gone80@example.com', (array) $C80), json_encode($C80));
$tok80 = fn($a, $pid) => hash_hmac('sha256', 'enq-action|' . $e80 . '|' . $a . '|' . $pid, $SECRET);
$pending80 = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM enquiries WHERE id = $e80 AND declined_at IS NULL")->fetchColumn() === 1
    && (int) $rootDb->query("SELECT COUNT(*) FROM bookings WHERE email = 'tap80@gmail.com'")->fetchColumn() === 0;
$r = http($nj80, 'GET', '/enquiry-action.php?id=' . $e80 . '&a=approve&p=' . $pat80 . '&t=' . $tok80('approve', $pat80));
it_check('§80 a link made for someone who may not approve shows no Approve button', $r['code'] === 403 && strpos($r['raw'], 'switched on for you') !== false && strpos($r['raw'], 'Approve booking') === false, $r['code'] . ' ' . substr($r['raw'], 0, 160));
$r = $fp80('/enquiry-action.php', ['id' => $e80, 'a' => 'approve', 'p' => $pat80, 't' => $tok80('approve', $pat80)]);
it_check('§80 …and posting it books nothing', $r['code'] === 403 && $pending80(), $r['code'] . ' ' . substr($r['raw'], 0, 160));
$r = $fp80('/enquiry-action.php', ['id' => $e80, 'a' => 'approve', 'p' => $gone80, 't' => $tok80('approve', $gone80)]);
it_check('§80 a removed person\'s link does nothing', $r['code'] === 403 && strpos($r['raw'], 'isn&rsquo;t valid') !== false && $pending80(), $r['code'] . ' ' . substr($r['raw'], 0, 160));
$r = $fp80('/enquiry-action.php', ['id' => $e80, 'a' => 'approve', 't' => hash_hmac('sha256', 'enq-action|' . $e80 . '|approve', $SECRET)]);
it_check('§80 a link from before links named their person does nothing', $r['code'] === 403 && $pending80(), $r['code'] . ' ' . substr($r['raw'], 0, 160));
// The token the APP made for her, carried under someone else's id: if the person were
// not part of what is signed, any link would work for anyone the page asks about.
$rq80 = $q80('rho80@example.com');
$r = $fp80('/enquiry-action.php', ['id' => $e80, 'a' => 'approve', 'p' => $own80, 't' => (string) ($rq80['t'] ?? '')]);
it_check('§80 one person\'s link cannot be passed off as another\'s', $r['code'] === 403 && $pending80(), $r['code'] . ' ' . substr($r['raw'], 0, 160));
$r = http($nj80, 'GET', '/enquiry-action.php?' . http_build_query($rq80));
it_check('§80 the link in her copy opens the confirmation, carrying whose it is', $r['code'] === 200 && strpos($r['raw'], 'name="p" value="' . $rho80 . '"') !== false, $r['code'] . ' ' . substr($r['raw'], 0, 160));
$rqd80 = ['id' => $e80, 'a' => 'decline', 'p' => $rho80, 't' => $tok80('decline', $rho80)];
$r = $fp80('/enquiry-action.php', $rqd80);
$log80 = (string) $rootDb->query("SELECT actor FROM activity_log WHERE action = 'enquiry.decline' AND entity_id = '$e80' ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('§80 her Decline works, and the log credits her', $r['code'] === 200 && (int) $rootDb->query("SELECT COUNT(*) FROM enquiries WHERE id = $e80 AND declined_at IS NOT NULL")->fetchColumn() === 1 && $log80 === 'admin:' . $rho80, $r['code'] . ' ' . $log80);
$rootDb->exec("DELETE FROM enquiries WHERE id = $e80");
$rootDb->exec("DELETE FROM activity_log WHERE entity = 'enquiry' AND entity_id = '$e80'");
$rootDb->exec("DELETE FROM admins WHERE id IN ($pat80, $rho80, $gone80)");

// (c) REPLYING BY EMAIL FOLLOWS THE APP'S RULES. The sender list let in anyone with a
// sign-in — a Host whose reply switch was off posted to a guest as the business — and
// always the config owner address, which is the first owner's: removed, they still
// could. And an email that must reach someone fell back to that same address, so with
// the first owner removed the next enquiry went to them. Through the real webhook.
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, perms, created_at) VALUES ('nor80', 'x', 'Nora Noreply', 'nor80@example.com', 0, '{\"gu.reply\":false}', NOW())");
$nor80 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, perms, created_at) VALUES ('ann80', 'x', 'Ann Answers', 'ann80@example.com', 0, '{}', NOW())");
$ann80 = (int) $rootDb->lastInsertId();
$rootDb->exec("INSERT INTO admins (username, password_hash, name, email, full_access, perms, created_at) VALUES ('sue80', 'x', 'Sue Super', 'sue80@example.com', 1, NULL, NOW())");
$sue80 = (int) $rootDb->lastInsertId();
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('notify-emails', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode(['nor80@example.com', 'extra80@example.com'])]);
$rootDb->prepare('INSERT INTO chat_threads (guest_id, token, name, email) VALUES (NULL, ?, ?, ?)')->execute(['it80-' . bin2hex(random_bytes(6)), 'Fern Eighty', 'fern80@example.com']);
$t80 = (int) $rootDb->lastInsertId();
$who80 = fn() => $probe80('echo "\n" . json_encode(["tok" => msg_reply_token(' . $t80 . ', "owner"), "senders" => people_mail_senders(), "enquiry" => owner_recipients("enquiry"), "owner" => strtolower(admin_contact_email(db()->query("SELECT * FROM admins ORDER BY id LIMIT 1")->fetch()))]);');
$hook80 = function (array $fields) use ($BASE, $SECRET) {
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/x-www-form-urlencoded', 'content' => http_build_query($fields), 'timeout' => 30, 'ignore_errors' => true]]);
    return trim((string) @file_get_contents($BASE . '/inbound-mail.php?key=' . rawurlencode($SECRET), false, $ctx));
};
$posted80 = fn($marker) => (int) $rootDb->query('SELECT COUNT(*) FROM messages WHERE thread_id = ' . $t80 . " AND body LIKE '%" . $marker . "%'")->fetchColumn();
$W80 = $who80();
$tokO80 = (string) ($W80['tok'] ?? '');
it_check('§80 a Host whose reply switch is off is not on the reply-by-email list, even listed as an extra address',
    is_array($W80) && !in_array('nor80@example.com', (array) ($W80['senders'] ?? []), true) && in_array('ann80@example.com', (array) ($W80['senders'] ?? []), true) && in_array('extra80@example.com', (array) ($W80['senders'] ?? []), true), json_encode($W80));
$h = $hook80(['recipient' => "reply+$tokO80@yourdomain.co.uk", 'sender' => 'nor80@example.com', 'subject' => 'Re: New message', 'stripped-text' => 'IT80-NORA the code is 1234']);
it_check('§80 …so her emailed reply posts nothing', $h === 'sender not allowed' && $posted80('IT80-NORA') === 0, $h);
$h = $hook80(['recipient' => "reply+$tokO80@yourdomain.co.uk", 'sender' => 'ann80@example.com', 'subject' => 'Re: New message', 'stripped-text' => 'IT80-ANN see you Friday']);
it_check('§80 …while a Host who may reply still can', $h === 'ok' && $posted80('IT80-ANN') === 1, $h);
$owner80 = (string) ($W80['owner'] ?? '');
$rootDb->exec("UPDATE admins SET mail_prefs = '{\"enquiry\":false}' WHERE id IN ($ann80, $sue80)");
$rootDb->exec("UPDATE admins SET removed_at = NOW() WHERE id = $own80");
$rootDb->exec("DELETE FROM content WHERE item_key = 'notify-emails'");
$W80 = $who80();
it_check('§80 a removed first owner\'s address is off the reply-by-email list', $owner80 !== '' && is_array($W80) && !in_array($owner80, (array) ($W80['senders'] ?? []), true) && in_array('sue80@example.com', (array) ($W80['senders'] ?? []), true), json_encode([$owner80, $W80['senders'] ?? null]));
it_check('§80 an enquiry nobody has chosen goes to a current Super User, never the removed owner', ($W80['enquiry'] ?? null) === ['sue80@example.com'], json_encode($W80['enquiry'] ?? null));
// With no Super User who can sign in (Sue still only invited), the config owner address
// is the last resort, and it is the removed owner's: nobody gets it, rather than them.
$rootDb->exec("UPDATE admins SET invited_at = NOW() WHERE id = $sue80");
$W80 = $who80();
it_check('§80 …and with no current Super User at all, still never the removed owner', ($W80['enquiry'] ?? null) === [], json_encode($W80['enquiry'] ?? null));
$rootDb->exec("UPDATE admins SET invited_at = NULL WHERE id = $sue80");
// "Also emailed" still RECEIVES what the owner listed there (it is on screen to change);
// what removal takes away is posting to a guest as the business, whatever list it is on.
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('notify-emails', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode([$owner80])]);
$W80 = $who80();
it_check('§80 …even listed as an extra address', is_array($W80) && !in_array($owner80, (array) ($W80['senders'] ?? []), true), json_encode($W80['senders'] ?? null));
$h = $hook80(['recipient' => "reply+$tokO80@yourdomain.co.uk", 'sender' => $owner80, 'subject' => 'Re: New message', 'stripped-text' => 'IT80-GONE the new key safe code is 9999']);
it_check('§80 …so their emailed reply posts nothing to the guest', $h === 'sender not allowed' && $posted80('IT80-GONE') === 0, $h);
$rootDb->exec("UPDATE admins SET removed_at = NULL WHERE id = $own80");
$rootDb->exec("DELETE FROM content WHERE item_key = 'notify-emails'");
$rootDb->exec("DELETE FROM messages WHERE thread_id = $t80");
$rootDb->exec("DELETE FROM chat_threads WHERE id = $t80");
$rootDb->exec("DELETE FROM admins WHERE id IN ($nor80, $ann80, $sue80)");

// (d) A REQUEST SENDING SAMPLES NEVER DRAINS REAL MAIL. The samples' [SAMPLE] prefix
// is applied to every subject sent in the request, and the first sample to go out
// kicked the outbox: a guest's queued "We've got your enquiry" went out as
// "[SAMPLE] We've got your enquiry". A real queued row, due now, against the real kick.
$rootDb->exec("INSERT INTO email_outbox (next_try_at, context, to_email, to_name, subject, body_text) VALUES (DATE_SUB(NOW(), INTERVAL 1 MINUTE), 'enquiry-ack', 'grace80@example.com', 'Grace Real', 'We have your enquiry', 'IT80-OUTBOX')");
$ob80 = (int) $rootDb->lastInsertId();
$touched80 = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM email_outbox WHERE id = $ob80 AND (tries > 0 OR next_try_at > NOW() OR sent_at IS NOT NULL OR gave_up_at IS NOT NULL)")->fetchColumn() === 1;
$probe80('$GLOBALS["__chb_test_prefix"] = "[SAMPLE] "; email_outbox_kick(); echo "\n" . json_encode(["ok" => 1]);');
it_check('§80 a request sending samples leaves real queued mail alone', !$touched80());
$probe80('people_mail_only("someone@example.com"); email_outbox_kick(); echo "\n" . json_encode(["ok" => 1]);');
it_check('§80 …and so does one sending an email only to whoever asked for it', !$touched80());
$probe80('email_outbox_kick(); echo "\n" . json_encode(["ok" => 1]);');
it_check('§80 …while an ordinary request still retries it', $touched80());
$rootDb->exec("DELETE FROM email_outbox WHERE id = $ob80");

// (e) THE CHAT'S ONE-TAP SENDS SHARE THE BOOKING PAGE'S GUARD. They had none, and the
// balance logged under its own name, so two taps in the chat (or one there and one on
// the booking page) sent the same email two or three times. Mail is off here, so the
// booking page's sends are recorded as it records them, and the chat is asked next.
$aj80 = [];
http($aj80, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => 'owner', 'password' => 'it-pass-80-reset']);
$rootDb->exec("INSERT INTO bookings (prop_key, name, email, check_in, check_out, adults, children, payment, deposit_paid, agreed_total, agreed_nightly, agreed_txn_fee, agreed_nights) VALUES ('$propKey','Chat Eighty','chat80@example.com','" . $ukPlus(60) . "','" . $ukPlus(63) . "',2,0,'deposit',100,400,400,0,3)");
$cb80 = (int) $rootDb->lastInsertId();
$rootDb->prepare('INSERT INTO chat_threads (guest_id, token, name, email) VALUES (NULL, ?, ?, ?)')->execute(['it80c-' . bin2hex(random_bytes(6)), 'Chat Eighty', 'chat80@example.com']);
$ct80 = (int) $rootDb->lastInsertId();
// Stamped on the APP's clock (Europe/London, as db.php sets the connection): this
// connection's NOW() is the server's, an hour behind in summer — "a moment ago" read
// as an hour ago, and the guard rightly let the send through.
$now80 = (new DateTime('now', new DateTimeZone('Europe/London')))->format('Y-m-d H:i:s');
$seed80 = $rootDb->prepare("INSERT INTO activity_log (category, action, summary, actor, entity, entity_id, created_at) VALUES ('comms', ?, 'sent from the booking page', 'owner', 'booking', ?, ?)");
$seed80->execute(['email.arrival', (string) $cb80, $now80]);
$r = http($aj80, 'POST', '/messages.php', ['action' => 'send_arrival', 'thread_id' => $ct80, 'booking_id' => $cb80]);
it_check('§80 the chat will not send an arrival email the booking page sent a moment ago', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'already_sent', $r['code'] . ' ' . $r['raw']);
$seed80->execute(['payment.request', (string) $cb80, $now80]);
$r = http($aj80, 'POST', '/messages.php', ['action' => 'send_balance', 'thread_id' => $ct80, 'booking_id' => $cb80]);
it_check('§80 …nor a payment request', $r['code'] === 409 && ($r['json']['code'] ?? '') === 'already_sent', $r['code'] . ' ' . $r['raw']);
it_check('§80 …and posts nothing into the conversation for a send that did not happen', (int) $rootDb->query("SELECT COUNT(*) FROM messages WHERE thread_id = $ct80")->fetchColumn() === 0);
$rootDb->exec("DELETE FROM activity_log WHERE entity = 'booking' AND entity_id = '$cb80'");
$rootDb->exec("DELETE FROM chat_threads WHERE id = $ct80");
$rootDb->exec("DELETE FROM bookings WHERE id = $cb80");

// (f) THE NOTES ASKING AN ENQUIRER BACK HONOUR THE UNSUBSCRIBE. An address that had
// opted out got "Nearly there: finish your enquiry", with no link to stop the next.
// Through the real nightly job: an opted-out enquiry and draft are set aside without a
// send (stamped as dealt with), while an ordinary pair is still tried (mail is off
// here, so a tried one fails cleanly and is left to try again: still NULL).
$out80 = 'optout80@example.com';
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('email-optout', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode([$out80])]);
$rootDb->exec("DELETE FROM content WHERE item_key = 'enquiry-nudge-off'");
$eIns80 = $rootDb->prepare("INSERT INTO enquiries (prop_key, name, email, check_in, check_out, adults, children, created_at) VALUES (?, 'Nudge Eighty', ?, ?, ?, 2, 0, DATE_SUB(NOW(), INTERVAL 3 DAY))");
$eIns80->execute([$propKey, $out80, $ukPlus(90), $ukPlus(93)]);
$eOut80 = (int) $rootDb->lastInsertId();
$eIns80->execute([$propKey, 'stay80@example.com', $ukPlus(95), $ukPlus(98)]);
$eIn80 = (int) $rootDb->lastInsertId();
$dIns80 = $rootDb->prepare("INSERT INTO enquiry_drafts (email, prop_key, name, check_in, check_out, created_at, updated_at) VALUES (?, ?, 'Draft Eighty', ?, ?, DATE_SUB(NOW(), INTERVAL 5 HOUR), DATE_SUB(NOW(), INTERVAL 5 HOUR))");
$dIns80->execute(['optdraft80@example.com', $propKey, $ukPlus(100), $ukPlus(102)]);
$dOut80 = (int) $rootDb->lastInsertId();
$dIns80->execute(['draft80@example.com', $propKey, $ukPlus(104), $ukPlus(106)]);
$dIn80 = (int) $rootDb->lastInsertId();
$rootDb->prepare("UPDATE content SET item_value = ? WHERE item_key = 'email-optout'")->execute([json_encode([$out80, 'optdraft80@example.com'])]);
$r = http($guest, 'GET', '/enquiry-nudge.php?cron=' . $SECRET);
$st80 = fn($sql) => $rootDb->query($sql)->fetchColumn();
it_check('§80 the follow-up to an enquiry from an opted-out address is set aside, never sent', $r['code'] === 200 && $st80("SELECT nudge_sent_at FROM enquiries WHERE id = $eOut80") !== null, $r['raw']);
it_check('§80 …and so is the rescue of an opted-out address\'s abandoned enquiry', $st80("SELECT nudged_at FROM enquiry_drafts WHERE id = $dOut80") !== null);
it_check('§80 …while an ordinary enquiry and draft are not set aside', $st80("SELECT nudge_sent_at FROM enquiries WHERE id = $eIn80") === null && $st80("SELECT nudged_at FROM enquiry_drafts WHERE id = $dIn80") === null);
$rootDb->exec("DELETE FROM enquiries WHERE id IN ($eOut80, $eIn80)");
$rootDb->exec("DELETE FROM enquiry_drafts WHERE id IN ($dOut80, $dIn80)");
$rootDb->exec("DELETE FROM content WHERE item_key = 'email-optout'");

// ---- 81. The guest chat says who answers ----------------------------------
// Guests see the people who answer — first name, the line under it, the account
// photo — and every reply is signed by whoever wrote it, while that person is shown
// in the chat. Someone switched off, removed, or unable to reply is never named: their
// replies carry the crown. Driven through the real endpoints and tables.
echo "\n== 81. The guest chat says who answers ==\n";
foreach ([['messages', 'admin_id'], ['messages', 'kind'], ['chat_threads', 'admin_typing_by'], ['admins', 'chat_show'], ['admins', 'chat_line']] as [$tbl81, $col81]) {
    it_check("§81 $tbl81.$col81 exists after schema + migrations", count($rootDb->query("SHOW COLUMNS FROM $tbl81 LIKE '$col81'")->fetchAll()) === 1);
}
// Four people: two Super Users (one the host the cottage pages name), a Host who may
// reply, and a Host who may not. Each with a photo on disk, like a real upload.
$face81 = function () use ($work) {
    $n = bin2hex(random_bytes(16)) . '.jpg';
    @mkdir($work . '/uploads/avatars', 0700, true);
    $im = imagecreatetruecolor(32, 32);
    imagejpeg($im, $work . '/uploads/avatars/' . $n, 80);
    return $n;
};
$mk81 = function ($user, $name, $full, $perms, $line = '') use ($rootDb, $face81) {
    $rootDb->prepare('INSERT INTO admins (username, password_hash, name, email, full_access, perms, twofa, photo, chat_line, created_at) VALUES (?,?,?,?,?,?,0,?,?,NOW())')
        ->execute([$user, password_hash('pw-' . $user, PASSWORD_DEFAULT), $name, $user . '@example.com', $full, $perms, $face81(), $line]);
    return (int) $rootDb->lastInsertId();
};
$mar81 = $mk81('marigold81', 'Marigold Moss', 1, null);
$gid81 = $mk81('gideon81', 'Gideon Lane', 1, null, 'Bookings & Website');
$het81 = $mk81('hettie81', 'Hettie Hall', 0, '{}');
$ned81 = $mk81('ned81', 'Ned Noreply', 0, '{"gu.reply":false}');
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('host-name', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode('Marigold')]);
$jar81 = [];
foreach (['marigold81', 'gideon81', 'hettie81'] as $u81) {
    $jar81[$u81] = [];
    $r = http($jar81[$u81], 'POST', '/auth.php', ['action' => 'admin_login', 'username' => $u81, 'password' => 'pw-' . $u81]);
    it_check("§81 $u81 signs in", $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
}
// What a first-time visitor is told as the chat opens.
$anon81 = [];
$r = http($anon81, 'POST', '/messages.php', ['action' => 'thread', 'team' => 1]);
$team81 = $r['json']['team'] ?? [];
$ids81 = array_map(fn($m) => (int) ($m['id'] ?? 0), $team81);
$byId81 = array_combine($ids81, $team81) ?: [];
it_check('§81 a visitor is told who answers', $r['code'] === 200 && isset($byId81[$mar81], $byId81[$gid81], $byId81[$het81]), $r['raw']);
it_check('§81 …the host the cottage pages name comes first, as "Host"', ($team81[0]['id'] ?? 0) === $mar81 && ($byId81[$mar81]['line'] ?? '') === 'Host', json_encode($team81[0] ?? null));
it_check('§81 …each person with their own line, else none', ($byId81[$gid81]['line'] ?? '') === 'Bookings & Website' && ($byId81[$het81]['line'] ?? 'x') === '', json_encode([$byId81[$gid81] ?? null, $byId81[$het81] ?? null]));
it_check('§81 …never someone who may not reply to guests', !isset($byId81[$ned81]));
it_check('§81 …first names and a photo version only: no surname, no address', !preg_match('/Moss|Lane|Hall|@/', json_encode($team81)) && array_keys($byId81[$mar81] ?? []) === ['id', 'name', 'line', 'v'] && preg_match('/^[a-f0-9]{10}$/', (string) ($byId81[$mar81]['v'] ?? '')), json_encode($byId81[$mar81] ?? null));
it_check('§81 …and whether they are away now', isset($r['json']['away']['on']), $r['raw']);
// The photo route: public for someone shown, and nothing else.
$photo81 = function ($q) use ($BASE) {
    $ctx = stream_context_create(['http' => ['timeout' => 10, 'ignore_errors' => true]]);
    $http_response_header = []; // predeclared; the fetch overwrites it
    $body = @file_get_contents($BASE . '/avatar.php?' . $q, false, $ctx);
    $hdrs = implode("\n", $http_response_header);
    preg_match('#^HTTP/\S+ (\d+)#', $hdrs, $m);
    return ['code' => (int) ($m[1] ?? 0), 'h' => $hdrs, 'body' => (string) $body];
};
$p = $photo81('team=' . $mar81);
it_check('§81 a shown person\'s photo is served to anyone', $p['code'] === 200 && stripos($p['h'], 'Content-Type: image/jpeg') !== false, substr($p['h'], 0, 200));
it_check('§81 …cached as public, with no cookie stored beside it', stripos($p['h'], 'Cache-Control: public') !== false && stripos($p['h'], 'Set-Cookie') === false, $p['h']);
it_check('§81 …but not the photo of someone who may not reply', $photo81('team=' . $ned81)['code'] === 404);
it_check('§81 …nor of nobody', $photo81('team=999999')['code'] === 404);
it_check('§81 …and the back office\'s own photo route still needs a session', $photo81('admin=' . $mar81)['code'] === 401);
// A REPLY IS SIGNED BY WHOEVER WROTE IT.
$tok81 = bin2hex(random_bytes(12));
$vis81 = [];
$r = http($vis81, 'POST', '/messages.php', ['action' => 'send', 'token' => $tok81, 'body' => 'IT81 is there parking?', 'name' => 'Vera Visitor', 'email' => 'vera81@example.com']);
$t81 = (int) $rootDb->query("SELECT id FROM chat_threads WHERE token = '$tok81'")->fetchColumn();
it_check('§81 a visitor starts a conversation', $r['code'] === 200 && $t81 > 0, $r['raw']);
$guestView81 = function () use (&$vis81, $tok81) {
    return http($vis81, 'POST', '/messages.php', ['action' => 'thread', 'token' => $tok81]);
};
$g = $guestView81();
$mine81 = array_values(array_filter($g['json']['messages'] ?? [], fn($m) => ($m['role'] ?? '') === 'guest'));
it_check('§81 their message reads Sent until someone in the back office opens it', isset($mine81[0]) && ($mine81[0]['read'] ?? null) === false, json_encode($mine81));
$r = http($jar81['gideon81'], 'POST', '/messages.php', ['action' => 'thread', 'thread_id' => $t81]);
$g = $guestView81();
$mine81 = array_values(array_filter($g['json']['messages'] ?? [], fn($m) => ($m['role'] ?? '') === 'guest'));
it_check('§81 …and Seen once they have', ($mine81[0]['read'] ?? null) === true, json_encode($mine81));
$r = http($jar81['gideon81'], 'POST', '/messages.php', ['action' => 'send', 'thread_id' => $t81, 'body' => 'IT81-GIDEON There is a space outside.', 'op_id' => 'it81-send-1']);
$row81 = $rootDb->query("SELECT admin_id, kind FROM messages WHERE thread_id = $t81 AND body LIKE 'IT81-GIDEON%'")->fetch(PDO::FETCH_ASSOC);
it_check('§81 a reply records who wrote it', $r['code'] === 200 && (int) ($row81['admin_id'] ?? 0) === $gid81 && ($row81['kind'] ?? 'x') === '', json_encode($row81));
$last81 = function () use ($guestView81) {
    $ms = $guestView81()['json']['messages'] ?? [];
    return end($ms) ?: [];
};
it_check('§81 the guest sees it signed by that person', (int) ($last81()['by'] ?? -1) === $gid81, json_encode($last81()));
$own81 = http($jar81['marigold81'], 'POST', '/messages.php', ['action' => 'thread', 'thread_id' => $t81])['json']['messages'] ?? [];
$ownLast81 = end($own81) ?: [];
it_check('§81 the back office reads the author\'s first name', ($ownLast81['by_name'] ?? '') === 'Gideon' && (int) ($ownLast81['by'] ?? 0) === $gid81, json_encode($ownLast81));
// Typing says who.
http($jar81['gideon81'], 'POST', '/messages.php', ['action' => 'typing', 'thread_id' => $t81]);
$g = $guestView81();
it_check('§81 the guest sees who is typing', !empty($g['json']['peer_typing']) && (int) ($g['json']['typing_by'] ?? 0) === $gid81, $g['raw']);
// THE SWITCH IS THE PERSON'S OR A SUPER USER'S, and switched off they are not named.
$r = http($jar81['hettie81'], 'POST', '/messages.php', ['action' => 'set_member', 'id' => $gid81, 'show' => 0]);
it_check('§81 a Host cannot switch someone else off', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'not_allowed', $r['raw']);
$r = http($jar81['hettie81'], 'POST', '/messages.php', ['action' => 'set_member', 'id' => $het81, 'line' => "Cleaning\n& keys"]);
$hm81 = array_values(array_filter($r['json']['members'] ?? [], fn($m) => ($m['id'] ?? 0) === $het81));
it_check('§81 …but sets her own line, one line of plain text', $r['code'] === 200 && ($hm81[0]['lineSet'] ?? '') === 'Cleaning & keys', $r['raw']);
$canEdit81 = array_map(fn($m) => [$m['id'], $m['canEdit']], $r['json']['members'] ?? []);
it_check('§81 …and is offered only her own row to change', !in_array([$gid81, true], $canEdit81, true) && in_array([$het81, true], $canEdit81, true), json_encode($canEdit81));
$r = http($jar81['hettie81'], 'POST', '/messages.php', ['action' => 'set_member', 'id' => $het81, 'line' => str_repeat('x', 41)]);
it_check('§81 a line over 40 characters is refused in words', $r['code'] === 400 && stripos((string) ($r['json']['error'] ?? ''), '40') !== false, $r['raw']);
$r = http($jar81['marigold81'], 'POST', '/messages.php', ['action' => 'set_member', 'id' => $gid81, 'show' => 0]);
it_check('§81 a Super User switches someone off', $r['code'] === 200 && !in_array($gid81, array_map(fn($m) => (int) $m['id'], $r['json']['team'] ?? []), true), $r['raw']);
it_check('§81 …and their replies are signed with the crown', (int) ($last81()['by'] ?? -1) === 0);
it_check('§81 …their photo is not public any more', $photo81('team=' . $gid81)['code'] === 404);
http($jar81['gideon81'], 'POST', '/messages.php', ['action' => 'typing', 'thread_id' => $t81]);
$g = $guestView81();
it_check('§81 …and their typing is not named', !empty($g['json']['peer_typing']) && (int) ($g['json']['typing_by'] ?? -1) === 0, $g['raw']);
http($jar81['marigold81'], 'POST', '/messages.php', ['action' => 'set_member', 'id' => $gid81, 'show' => 1]);
it_check('§81 switched back on, they are named again', (int) ($last81()['by'] ?? -1) === $gid81);
// A REMOVED PERSON IS NEVER NAMED by the replies they left.
$rootDb->prepare("INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest, admin_id) VALUES (?, 'admin', 'IT81-HETTIE', 1, 0, ?)")->execute([$t81, $het81]);
it_check('§81 a Host\'s reply is signed by her', (int) ($last81()['by'] ?? -1) === $het81);
$rootDb->exec("UPDATE admins SET removed_at = NOW() WHERE id = $het81");
it_check('§81 …until she is removed: then the crown', (int) ($last81()['by'] ?? -1) === 0);
// A REPLY BY EMAIL is signed by the person it came from; one from an address that is
// nobody's sign-in (an extra address) by nobody, whoever happens to be signed in.
$probe81 = function ($code) use ($work) {
    $f = $work . '/it-chat-probe81.php';
    file_put_contents($f, "<?php\nrequire __DIR__ . '/db.php';\nrequire_once __DIR__ . '/mailer.php';\nrequire_once __DIR__ . '/chat-lib.php';\n" . $code);
    $out = (string) shell_exec('cd ' . escapeshellarg($work) . ' && php ' . escapeshellarg($f) . ' 2>/dev/null');
    @unlink($f);
    return json_decode(trim(substr($out, (int) strrpos($out, "\n{"))), true);
};
$tokO81 = (string) (($probe81('echo "\n" . json_encode(["tok" => msg_reply_token(' . $t81 . ', "owner")]);') ?: [])['tok'] ?? '');
$rootDb->prepare("INSERT INTO content (item_key, item_value) VALUES ('notify-emails', ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)")->execute([json_encode(['extra81@example.com'])]);
$hook81 = function (array $fields) use ($BASE, $SECRET) {
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/x-www-form-urlencoded', 'content' => http_build_query($fields), 'timeout' => 30, 'ignore_errors' => true]]);
    return trim((string) @file_get_contents($BASE . '/inbound-mail.php?key=' . rawurlencode($SECRET), false, $ctx));
};
$h = $hook81(['recipient' => "reply+$tokO81@yourdomain.co.uk", 'sender' => 'marigold81@example.com', 'subject' => 'Re: New message', 'stripped-text' => 'IT81-MAILED see you Friday']);
$mailed81 = $rootDb->query("SELECT admin_id FROM messages WHERE thread_id = $t81 AND body LIKE 'IT81-MAILED%'")->fetchColumn();
it_check('§81 a reply by email is signed by the person whose address it came from', $h === 'ok' && (int) $mailed81 === $mar81, $h . ' / ' . var_export($mailed81, true));
$h = $hook81(['recipient' => "reply+$tokO81@yourdomain.co.uk", 'sender' => 'extra81@example.com', 'subject' => 'Re: New message', 'stripped-text' => 'IT81-EXTRA the bins go out Tuesday']);
$extra81 = $rootDb->query("SELECT admin_id FROM messages WHERE thread_id = $t81 AND body LIKE 'IT81-EXTRA%'")->fetch(PDO::FETCH_ASSOC);
it_check('§81 …and one from an extra address by nobody: the crown', $h === 'ok' && $extra81 && $extra81['admin_id'] === null, $h . ' / ' . json_encode($extra81));
$rootDb->exec("DELETE FROM content WHERE item_key = 'notify-emails'");
// The guest's reply email names who answered, while they are shown.
$an81 = $probe81('echo "\n" . json_encode(["mar" => chat_author_name(' . $mar81 . '), "het" => chat_author_name(' . $het81 . '), "ned" => chat_author_name(' . $ned81 . ')]);');
it_check('§81 the reply email is signed "Marigold" for a shown person, by the business otherwise', ($an81['mar'] ?? '') === 'Marigold' && ($an81['het'] ?? 'x') === '' && ($an81['ned'] ?? 'x') === '', json_encode($an81));
// THE AWAY REPLY SAYS IT IS AUTOMATIC, and the header says until when.
$hour81 = (int) (new DateTime('now', new DateTimeZone('Europe/London')))->format('G');
$from81 = sprintf('%02d', ($hour81 + 1) % 24);
$to81 = sprintf('%02d', ($hour81 + 2) % 24);
foreach (['chat-away-enabled' => '1', 'chat-away-from' => $from81, 'chat-away-to' => $to81] as $k81 => $v81) {
    $rootDb->prepare('INSERT INTO content (item_key, item_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE item_value = VALUES(item_value)')->execute([$k81, json_encode($v81)]);
}
$tokB81 = bin2hex(random_bytes(12));
$visB81 = [];
http($visB81, 'POST', '/messages.php', ['action' => 'send', 'token' => $tokB81, 'body' => 'IT81-LATE our train is late', 'name' => 'Lou Late', 'email' => 'lou81@example.com']);
$tB81 = (int) $rootDb->query("SELECT id FROM chat_threads WHERE token = '$tokB81'")->fetchColumn();
$auto81 = null;
for ($i = 0; $i < 30 && !$auto81; $i++) {
    usleep(100000);
    $auto81 = $rootDb->query("SELECT admin_id, kind FROM messages WHERE thread_id = $tB81 AND sender_role = 'admin'")->fetch(PDO::FETCH_ASSOC);
}
it_check('§81 the away reply is written as automatic, by nobody', $auto81 && $auto81['kind'] === 'auto' && $auto81['admin_id'] === null, json_encode($auto81));
$r = http($visB81, 'POST', '/messages.php', ['action' => 'thread', 'token' => $tokB81, 'team' => 1]);
$lastB81 = end($r['json']['messages']) ?: [];
it_check('§81 …the guest is told so', ($lastB81['kind'] ?? '') === 'auto' && (int) ($lastB81['by'] ?? -1) === 0, json_encode($lastB81));
it_check('§81 …and the chat says when someone is back: the hour they start, not the hour they stop', ($r['json']['away']['on'] ?? null) === true && (int) ($r['json']['away']['until'] ?? -1) === (int) $from81, json_encode($r['json']['away'] ?? null));
$rootDb->exec("DELETE FROM content WHERE item_key IN ('chat-away-enabled', 'chat-away-from', 'chat-away-to')");
// A note the chat posts when it emails a pay link or the arrival details is an EVENT
// signed by whoever sent it (mail is off here, so the send itself cannot be driven).
$msgSrc81 = (string) file_get_contents(__DIR__ . '/messages.php');
it_check('§81 the chat\'s pay-link and arrival notes are written as events, signed by the sender', substr_count($msgSrc81, "chat_insert_owner_message(\$tid, \$note, (int) \$_SESSION['admin_id'], 'event')") === 1);
// Clean up.
$rootDb->exec("DELETE FROM messages WHERE thread_id IN ($t81, $tB81)");
$rootDb->exec("DELETE FROM chat_threads WHERE id IN ($t81, $tB81)");
$rootDb->exec("DELETE FROM admins WHERE id IN ($mar81, $gid81, $het81, $ned81)");
$rootDb->exec("DELETE FROM content WHERE item_key = 'host-name'");

// ---- 82. Devices ----------------------------------------------------------------
// Every device a person is signed in on is a row, and every request asks its row,
// so one device can be signed out while the rest carry on. Driven through the real
// sign-in, the real endpoint and the session files themselves: a session from
// before the list began is made by taking its row id out of its file.
echo "\n== 82. Devices: where each person is signed in, and signing one out ==\n";
it_check('§82 admin_sessions exists after schema + migrations', count($rootDb->query("SHOW TABLES LIKE 'admin_sessions'")->fetchAll()) === 1);
it_check('§82 push_subscriptions.admin_session_id exists', count($rootDb->query("SHOW COLUMNS FROM push_subscriptions LIKE 'admin_session_id'")->fetchAll()) === 1);
$UA82 = [
    'app' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'mac' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'pc' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.65',
    'safari' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
];
// One browser: its cookie jar and the user agent it sends.
$h82 = function (&$jar, $ua, $method, $path, $body = null) {
    $was = (string) ini_get('user_agent');
    ini_set('user_agent', $ua);
    try {
        return http($jar, $method, $path, $body);
    } finally {
        ini_set('user_agent', $was);
    }
};
$mk82 = function ($user, $name, $full) use ($rootDb) {
    $rootDb->prepare('INSERT INTO admins (username, password_hash, name, email, full_access, perms, twofa, created_at) VALUES (?,?,?,?,?,?,0,NOW())')
        ->execute([$user, password_hash('pw-' . $user, PASSWORD_DEFAULT), $name, $user . '@example.com', $full, $full ? null : '{}']);
    return (int) $rootDb->lastInsertId();
};
$wren82 = $mk82('wren82', 'Wren Lark', 1);
$ivy82 = $mk82('ivy82', 'Ivy Holt', 0);
$in82 = function (&$jar, $ua, $user, $pw = '') use ($h82) {
    return $h82($jar, $ua, 'POST', '/auth.php', ['action' => 'admin_login', 'username' => $user, 'password' => $pw !== '' ? $pw : 'pw-' . $user]);
};
$list82 = function (&$jar, $ua, $id = 0) use ($h82) {
    return $h82($jar, $ua, 'POST', '/devices.php', ['action' => 'list'] + ($id ? ['id' => $id] : []));
};
$newWren82 = fn() => (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'admin.login_new' AND summary LIKE 'Wren Lark signed in%'")->fetchColumn();
$wP = [];
$r = $in82($wP, $UA82['app'], 'wren82');
it_check('§82 Wren signs in on her phone', $r['code'] === 200 && !empty($r['json']['ok']), $r['raw']);
it_check('§82 …her first sign-in anywhere is not news', $newWren82() === 0);
$wM = [];
$in82($wM, $UA82['mac'], 'wren82');
$lastNew82 = (string) $rootDb->query("SELECT summary FROM activity_log WHERE action = 'admin.login_new' AND summary LIKE 'Wren Lark%' ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('§82 a second device signing in is news, and the log names the device', $newWren82() === 1 && strpos($lastNew82, 'Wren Lark signed in with a password on a new device: Mac · Chrome') === 0, $lastNew82);
$r = $list82($wP, $UA82['app']);
$d82 = $r['json']['devices'] ?? [];
it_check('§82 her list has both: this phone first, marked, then the Mac', $r['code'] === 200 && count($d82) === 2 && ($d82[0]['here'] ?? false) === true && ($d82[0]['label'] ?? '') === 'iPhone · App' && ($d82[1]['label'] ?? '') === 'Mac · Chrome' && ($d82[1]['here'] ?? true) === false, $r['raw']);
it_check('§82 …each says how it signed in', ($d82[1]['how'] ?? '') === 'Password' && ($d82[1]['earlier'] ?? true) === false, json_encode($d82[1] ?? null));
$phone82 = (int) ($d82[0]['id'] ?? 0);
$mac82 = (int) ($d82[1]['id'] ?? 0);
// The same browser signing in again is not a new device; logging out ends its row.
$h82($wM, $UA82['mac'], 'POST', '/auth.php', ['action' => 'admin_logout']);
it_check('§82 logging out ends that device\'s row', $rootDb->query("SELECT ended_why FROM admin_sessions WHERE id = $mac82")->fetchColumn() === 'logout');
// With two-step trust this time, so signing it out has something to forget.
$tok82 = bin2hex(random_bytes(20));
$rootDb->prepare("INSERT INTO admin_devices (token_hash, user_agent, last_seen, admin_id) VALUES (?, 'it82', NOW(), ?)")->execute([hash('sha256', $tok82), $wren82]);
$wM['chb_admin_device'] = $tok82;
$in82($wM, $UA82['mac'], 'wren82');
it_check('§82 the same browser signing in again is not news', $newWren82() === 1);
$r = $list82($wP, $UA82['app']);
$d82 = $r['json']['devices'] ?? [];
$mac82 = (int) (array_values(array_filter($d82, fn($d) => ($d['label'] ?? '') === 'Mac · Chrome'))[0]['id'] ?? 0);
it_check('§82 …and the list still has two devices, not three', count($d82) === 2 && $mac82 > 0, $r['raw']);
$ep82 = 'https://fcm.googleapis.com/fcm/send/it82-mac';
$h82($wM, $UA82['mac'], 'POST', '/push.php', ['action' => 'subscribe_admin', 'subscription' => ['endpoint' => $ep82, 'keys' => ['p256dh' => 'p', 'auth' => 'a']]]);
it_check('§82 a device\'s alerts are tied to it', (int) $rootDb->query("SELECT admin_session_id FROM push_subscriptions WHERE endpoint = '$ep82'")->fetchColumn() === $mac82);
$macRow82 = array_values(array_filter($list82($wP, $UA82['app'])['json']['devices'] ?? [], fn($d) => (int) ($d['id'] ?? 0) === $mac82))[0] ?? [];
it_check('§82 …and the list says so, and that two-step trusts it', ($macRow82['alerts'] ?? false) === true && ($macRow82['trusted'] ?? false) === true, json_encode($macRow82));
// The page tells what the browser doesn't: an iPad's Safari says it is a Mac.
$wT = ['chb_dh' => 'ipad.app'];
$in82($wT, $UA82['safari'], 'wren82');
$labels82 = array_column($list82($wP, $UA82['app'])['json']['devices'] ?? [], 'label');
it_check('§82 an iPad whose Safari calls itself a Mac is listed as the iPad app the page knows it is', in_array('iPad · App', $labels82, true), json_encode($labels82));
// SIGNING ONE DEVICE OUT.
$r = $h82($wP, $UA82['app'], 'POST', '/devices.php', ['action' => 'sign_out', 'sid' => $mac82]);
it_check('§82 signing the Mac out from the phone', $r['code'] === 200 && ($r['json']['label'] ?? '') === 'Mac · Chrome' && !in_array('Mac · Chrome', array_column($r['json']['devices'] ?? [], 'label'), true), $r['raw']);
$r = $h82($wM, $UA82['mac'], 'GET', '/bookings.php');
it_check('§82 …the Mac is signed out the next time it is used', $r['code'] === 401, $r['code'] . ' ' . substr($r['raw'], 0, 120));
$r = $h82($wM, $UA82['mac'], 'POST', '/auth.php', ['action' => 'admin_status']);
it_check('§82 …and is told why', ($r['json']['admin'] ?? true) === false && ($r['json']['ended'] ?? '') === 'device', $r['raw']);
$r = $h82($wM, $UA82['mac'], 'POST', '/auth.php', ['action' => 'admin_status']);
it_check('§82 …once', !isset($r['json']['ended']), $r['raw']);
it_check('§82 …its alerts stop', (int) $rootDb->query("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = '$ep82'")->fetchColumn() === 0);
it_check('§82 …and two-step forgets it', (int) $rootDb->query("SELECT COUNT(*) FROM admin_devices WHERE token_hash = '" . hash('sha256', $tok82) . "'")->fetchColumn() === 0);
it_check('§82 …while the phone carries on', $h82($wP, $UA82['app'], 'GET', '/bookings.php')['code'] === 200);
it_check('§82 …and the log says who signed out what', (string) $rootDb->query("SELECT summary FROM activity_log WHERE action = 'admin.device_signout' ORDER BY id DESC LIMIT 1")->fetchColumn() === 'Wren Lark signed out Mac · Chrome');
$r = $h82($wP, $UA82['app'], 'POST', '/devices.php', ['action' => 'sign_out', 'sid' => $mac82]);
it_check('§82 a device already signed out is answered with the list, nothing done twice', $r['code'] === 200 && ($r['json']['already'] ?? false) === true, $r['raw']);
$r = $h82($wP, $UA82['app'], 'POST', '/devices.php', ['action' => 'sign_out', 'sid' => $phone82]);
it_check('§82 the device you are using is never signed out from here', $r['code'] === 400 && ($r['json']['code'] ?? '') === 'this_device', $r['raw']);
// SOMEONE ELSE'S DEVICES are a Super User's.
$iA = [];
$in82($iA, $UA82['pc'], 'ivy82');
$r = $list82($iA, $UA82['pc'], $wren82);
it_check('§82 a Host cannot see someone else\'s devices', $r['code'] === 403 && ($r['json']['code'] ?? '') === 'not_allowed', $r['raw']);
$r = $h82($iA, $UA82['pc'], 'POST', '/devices.php', ['action' => 'sign_out', 'id' => $wren82, 'sid' => $phone82]);
it_check('§82 …nor sign one out', $r['code'] === 403, $r['raw']);
$r = $h82($iA, $UA82['pc'], 'POST', '/devices.php', ['action' => 'sign_out', 'sid' => $phone82]);
it_check('§82 …not even by naming its number on her own list', $r['code'] === 404 && ($r['json']['code'] ?? '') === 'gone' && $h82($wP, $UA82['app'], 'GET', '/bookings.php')['code'] === 200, $r['raw']);
// A SESSION FROM BEFORE THE LIST BEGAN: no row id in its file, and no row.
$iB = [];
$iC = [];
$in82($iB, $UA82['mac'], 'ivy82');
$in82($iC, $UA82['pc'], 'ivy82');
$legacy82 = function ($jar) use ($work, $rootDb) {
    $f = $work . '/sessions/sess_' . ($jar['PHPSESSID'] ?? '');
    $raw = (string) @file_get_contents($f);
    if (!preg_match('/admin_sess\|i:(\d+);/', $raw, $m)) {
        return false;
    }
    $rootDb->exec('DELETE FROM admin_sessions WHERE id = ' . (int) $m[1]);
    return file_put_contents($f, str_replace($m[0], '', $raw)) !== false;
};
it_check('§82 (fixture) two of Ivy\'s sessions made as if from before the list began', $legacy82($iB) && $legacy82($iC));
$r = $h82($iC, $UA82['pc'], 'GET', '/bookings.php');
$late82 = $rootDb->query("SELECT how FROM admin_sessions WHERE admin_id = $ivy82 AND ended_at IS NULL ORDER BY id DESC LIMIT 1")->fetchColumn();
it_check('§82 such a session is recorded the next time it is used, and is not news', $r['code'] === 200 && $late82 === 'earlier' && (int) $rootDb->query("SELECT COUNT(*) FROM activity_log WHERE action = 'admin.login_new' AND summary LIKE 'Ivy Holt%' AND summary LIKE '%Not recorded%'")->fetchColumn() === 0, (string) $late82);
$r = $list82($wP, $UA82['app'], $ivy82);
$ivyList82 = $r['json']['devices'] ?? [];
it_check('§82 a Super User sees Ivy\'s devices: the two used since the list began', $r['code'] === 200 && count($ivyList82) === 2 && in_array(true, array_column($ivyList82, 'earlier'), true) && !in_array(true, array_column($ivyList82, 'here'), true), $r['raw']);
it_check('§82 …and is told the list may not be complete yet, and since when', ($r['json']['partial'] ?? null) === true && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($r['json']['began'] ?? '')) === 1, $r['raw']);
$r = $h82($wP, $UA82['app'], 'POST', '/devices.php', ['action' => 'sign_out_all', 'id' => $ivy82]);
it_check('§82 a Super User signs Ivy out everywhere', $r['code'] === 200 && ($r['json']['devices'] ?? null) === [] && (int) ($r['json']['count'] ?? -1) === 2, $r['raw']);
it_check('§82 …every one of her sessions is out, the one never recorded included',
    $h82($iA, $UA82['pc'], 'GET', '/bookings.php')['code'] === 401 && $h82($iB, $UA82['mac'], 'GET', '/bookings.php')['code'] === 401 && $h82($iC, $UA82['pc'], 'GET', '/bookings.php')['code'] === 401);
it_check('§82 …and the log names who did it', (string) $rootDb->query("SELECT summary FROM activity_log WHERE action = 'admin.device_signout_all' ORDER BY id DESC LIMIT 1")->fetchColumn() === 'Wren Lark signed Ivy Holt out everywhere');
// SIGNING YOURSELF OUT OF EVERY OTHER DEVICE.
$wC = [];
$in82($wC, $UA82['pc'], 'wren82');
$ep82b = 'https://fcm.googleapis.com/fcm/send/it82-pc';
$h82($wC, $UA82['pc'], 'POST', '/push.php', ['action' => 'subscribe_admin', 'subscription' => ['endpoint' => $ep82b, 'keys' => ['p256dh' => 'p', 'auth' => 'a']]]);
$ep82c = 'https://fcm.googleapis.com/fcm/send/it82-phone';
$h82($wP, $UA82['app'], 'POST', '/push.php', ['action' => 'subscribe_admin', 'subscription' => ['endpoint' => $ep82c, 'keys' => ['p256dh' => 'p', 'auth' => 'a']]]);
$r = $h82($wP, $UA82['app'], 'POST', '/devices.php', ['action' => 'sign_out_all', 'push_endpoint' => $ep82c]);
$left82 = $r['json']['devices'] ?? [];
it_check('§82 signing out of all your other devices leaves only this one', $r['code'] === 200 && count($left82) === 1 && ($left82[0]['here'] ?? false) === true && (int) ($r['json']['count'] ?? 0) === 2, $r['raw']);
it_check('§82 …the others are out', $h82($wC, $UA82['pc'], 'GET', '/bookings.php')['code'] === 401 && $h82($wT, $UA82['safari'], 'GET', '/bookings.php')['code'] === 401);
it_check('§82 …this one carries on (its session re-stamped with the new epoch)', $h82($wP, $UA82['app'], 'GET', '/bookings.php')['code'] === 200);
it_check('§82 …the others\' alerts stop and this one\'s stay', (int) $rootDb->query("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = '$ep82b'")->fetchColumn() === 0 && (int) $rootDb->query("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = '$ep82c'")->fetchColumn() === 1);
// A PASSWORD CHANGE and A REMOVAL take devices off the list too.
$wD = [];
$in82($wD, $UA82['mac'], 'wren82');
$dSid82 = (int) $rootDb->query("SELECT MAX(id) FROM admin_sessions WHERE admin_id = $wren82")->fetchColumn();
$r = $h82($wP, $UA82['app'], 'POST', '/auth.php', ['action' => 'admin_change_password', 'current' => 'pw-wren82', 'next' => 'pw-wren82-changed']);
it_check('§82 a password change takes the other devices off the list', $r['code'] === 200 && $rootDb->query("SELECT ended_why FROM admin_sessions WHERE id = $dSid82")->fetchColumn() === 'password' && count($list82($wP, $UA82['app'])['json']['devices'] ?? []) === 1, $r['raw']);
$iE = [];
$in82($iE, $UA82['pc'], 'ivy82');
$eSid82 = (int) $rootDb->query("SELECT MAX(id) FROM admin_sessions WHERE admin_id = $ivy82")->fetchColumn();
$r = $h82($wP, $UA82['app'], 'POST', '/people.php', ['action' => 'remove', 'id' => $ivy82]);
it_check('§82 removing someone takes their devices off too', $r['code'] === 200 && $rootDb->query("SELECT ended_why FROM admin_sessions WHERE id = $eSid82")->fetchColumn() === 'removed', $r['raw']);
// THE NIGHTLY JOB: a device unused for longer than a session lives is over (and is
// not listed even before then), and an old sign-out is forgotten.
$wF = [];
$in82($wF, $UA82['pc'], 'wren82', 'pw-wren82-changed');
$fSid82 = (int) $rootDb->query("SELECT MAX(id) FROM admin_sessions WHERE admin_id = $wren82")->fetchColumn();
$rootDb->exec("UPDATE admin_sessions SET created_at = DATE_SUB(NOW(), INTERVAL 70 DAY), last_seen = DATE_SUB(NOW(), INTERVAL 70 DAY) WHERE id = $fSid82");
it_check('§82 a device unused for longer than a session lives is not listed', !in_array($fSid82, array_column($list82($wP, $UA82['app'])['json']['devices'] ?? [], 'id'), true));
$rootDb->exec("UPDATE admin_sessions SET ended_at = DATE_SUB(NOW(), INTERVAL 100 DAY) WHERE id = $mac82");
$probe82 = function ($code) use ($work) {
    $f = $work . '/it-devices-probe82.php';
    file_put_contents($f, "<?php\nrequire __DIR__ . '/db.php';\n" . $code);
    $out = (string) shell_exec('cd ' . escapeshellarg($work) . ' && php ' . escapeshellarg($f) . ' 2>/dev/null');
    @unlink($f);
    return json_decode(trim(substr($out, (int) strrpos($out, "\n{"))), true);
};
$p82 = $probe82('echo "\n" . json_encode(["n" => devices_prune()]);');
it_check('§82 the nightly job ends it, and deletes a sign-out older than 90 days',
    (int) ($p82['n'] ?? 0) >= 2 && $rootDb->query("SELECT ended_why FROM admin_sessions WHERE id = $fSid82")->fetchColumn() === 'expired' && (int) $rootDb->query("SELECT COUNT(*) FROM admin_sessions WHERE id = $mac82")->fetchColumn() === 0, json_encode($p82));
// Clean up.
$rootDb->exec("DELETE FROM push_subscriptions WHERE endpoint LIKE '%/it82-%'");
$rootDb->exec("DELETE FROM admin_devices WHERE admin_id IN ($wren82, $ivy82)");
$rootDb->exec("DELETE FROM admin_sessions WHERE admin_id IN ($wren82, $ivy82)");
$rootDb->exec("DELETE FROM admins WHERE id IN ($wren82, $ivy82)");

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
