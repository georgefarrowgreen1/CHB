<?php
// ============================================================
//  test-sms.php — how Twilio settings RESOLVE, and what the settings page is
//  allowed to say. DEV/CI only (deploy-excluded with the other test-*.php).
//
//      php test-sms.php
//
//  NO NETWORK and NO DATABASE. sms_send() reaches Twilio, and a test that
//  depends on their uptime fails for reasons that have nothing to do with this
//  codebase. What IS worth pinning is the judgement, because it is where this
//  change can go quietly wrong:
//
//    * a config.php CONSTANT still wins, so an install already configured that
//      way keeps working — and an EMPTY constant counts as UNSET, because
//      config.php ships all four as '' and treating those as explicit blanks
//      would permanently shadow the settings page;
//    * sms_status() never carries the auth TOKEN, only whether one is stored;
//    * sms_enabled() needs the switch AND all three details, so a half-filled
//      form can never make the enquiry form offer texts.
//
//  content_value() is stubbed BEFORE the require, the test-payouts.php trick —
//  the real one needs a database, and the resolution rules are the point.
// ============================================================

$GLOBALS['__sms_store'] = [];
function content_value($key)
{
    return (string) ($GLOBALS['__sms_store'][$key] ?? '');
}
// THE EMPTY-CONSTANT CASE IS THE SHIPPED DEFAULT, and define() cannot be undone
// inside one process — so it gets its own run. `php test-sms.php --empty`
// defines all four exactly as config.php ships them and asserts the stored
// settings still apply; the main run below spawns it and reports the result.
$EMPTY_MODE = in_array('--empty', $argv ?? [], true);
if ($EMPTY_MODE) {
    define('SMS_ENABLED', false);
    define('TWILIO_SID', '');
    define('TWILIO_TOKEN', '');
    define('TWILIO_FROM', '');
}

// sms.php's `require_once __DIR__ . '/db.php'` would pull in the real database
// bootstrap, so load the source with that require stripped. The functions under
// test are pure once content_value() exists.
$src = file_get_contents(__DIR__ . '/sms.php');
$src = preg_replace('/^\s*require_once __DIR__ \. \'\/db\.php\';\s*$/m', '', (string) $src);
$src = preg_replace('/^<\?php\s*/', '', (string) $src);
eval($src);

$fails = 0;
function schk($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  ✓ $name\n";
    } else {
        $fails++;
        echo "  ✗ $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}
function sms_store($map)
{
    $GLOBALS['__sms_store'] = $map;
}
$FULL = [
    'sms-enabled' => '1',
    'apikey-twilio-sid' => 'ACtest0000000000000000000000abcd',
    'apikey-twilio-token' => 'sekrit-token-value',
    'sms-from' => '+447700900000',
];

// ---- THE EMPTY-CONSTANT RUN ------------------------------------------------
// config.php ships SMS_ENABLED=false and all three TWILIO_* as ''. If an empty
// constant counted as an explicit blank, those defaults would permanently shadow
// the settings page and NOTHING the owner typed would ever apply — the settings
// would save, the page would look right, and no text would ever send. This is
// the single most important behaviour in the file, and it needs its own process
// because define() cannot be undone.
if ($EMPTY_MODE) {
    echo "\n== SMS: config.php's shipped empty constants do not shadow the page ==\n";
    sms_store([]);
    schk('empty consts, nothing stored → off', sms_enabled() === false);
    sms_store($FULL);
    schk('empty consts + saved settings → USABLE (the whole point)', sms_enabled() === true);
    schk('…the stored SID is what resolves', sms_setting('TWILIO_SID', 'apikey-twilio-sid') === $FULL['apikey-twilio-sid']);
    schk('…the stored number is what resolves', sms_setting('TWILIO_FROM', 'sms-from') === '+447700900000');
    schk('…and the page does NOT claim to be config-driven', sms_status()['from_config'] === false);
    echo "\n== Summary (empty-consts run) ==\n";
    echo $fails ? "  $fails CHECK(S) FAILED ❌\n" : "  empty-constant run passed ✅\n";
    exit($fails ? 1 : 0);
}

echo "\n== SMS: settings resolve, and the secret stays server-side ==\n";

// ---- 1. Off by default -----------------------------------------------------
// The shipped state. This is what made the enquiry form's opt-in box a promise
// nothing could keep: the box showed regardless of this being false.
sms_store([]);
schk('nothing configured → not switched on', sms_switched_on() === false);
schk('nothing configured → not usable', sms_enabled() === false);

// ---- 2. The settings page turns it on --------------------------------------
sms_store($FULL);
schk('all four settings → switched on', sms_switched_on() === true);
schk('all four settings → usable', sms_enabled() === true);

// ---- 3. HALF-FILLED IS NOT ON ----------------------------------------------
// Each detail is load-bearing. Missing any one of them must read as unusable, or
// the guest form would offer texts that every send then refuses.
foreach (['apikey-twilio-sid', 'apikey-twilio-token', 'sms-from'] as $missing) {
    $partial = $FULL;
    unset($partial[$missing]);
    sms_store($partial);
    schk("switched on but no $missing → still unusable", sms_enabled() === false);
    schk("…and the page can say WHY (on, not ready)", sms_switched_on() === true);
}

// ---- 4. The switch alone is not enough, and neither are the details alone ---
sms_store(['sms-enabled' => '1']);
schk('switch on, no details → unusable', sms_enabled() === false);
$noSwitch = $FULL;
unset($noSwitch['sms-enabled']);
sms_store($noSwitch);
schk('details filled, switch off → unusable (the owner decides when it starts)', sms_enabled() === false);

// ---- 5. THE AUTH TOKEN NEVER LEAVES THE SERVER -----------------------------
// The whole reason the settings field is write-only. A status payload that
// carried the token would put it in every admin browser session.
sms_store($FULL);
$st = sms_status();
$flat = json_encode($st);
schk('status reports a token IS stored', $st['token_set'] === true);
schk('…but never the token itself', strpos((string) $flat, 'sekrit-token-value') === false, (string) $flat);
schk('…and no key in the payload holds it', !in_array('sekrit-token-value', $st, true));
// The SID is an identifier, not a credential — but only its tail is sent, which
// is enough to confirm WHICH account without handing the whole thing back.
schk('the SID is reported as set', $st['sid_set'] === true);
schk('…by its last 4 only', $st['sid_tail'] === 'abcd' && strpos((string) $flat, 'ACtest0000') === false, (string) $flat);
schk('the sender number IS returned (the owner must be able to correct it)', $st['from'] === '+447700900000');
schk('status agrees with sms_enabled', $st['ready'] === true && $st['on'] === true);

// ---- 6. A CONFIG CONSTANT STILL WINS ---------------------------------------
// An install that already had SMS in config.php must keep working with an empty
// settings table — that is the whole compatibility promise.
sms_store([]);
define('TWILIO_SID', 'ACfromconfig000000000000000000ff');
define('TWILIO_TOKEN', 'config-token');
define('TWILIO_FROM', '+447700111222');
define('SMS_ENABLED', true);
schk('consts alone → usable with nothing stored', sms_enabled() === true);
schk('…and the page says it is config-driven', sms_status()['from_config'] === true);
schk('…so the owner is not invited to edit fields that cannot apply', sms_status()['ready'] === true);
schk('the const value is used, not a stored one', sms_setting('TWILIO_FROM', 'sms-from') === '+447700111222');
// …and a stored value does NOT override a const that is set.
sms_store(['sms-from' => '+447700999888']);
schk('a stored value cannot override a set const', sms_setting('TWILIO_FROM', 'sms-from') === '+447700111222');

echo "\n== SMS: UK numbers in, E.164 out ==\n";
// sms_send() refuses anything this returns '' for, so a malformed number is
// skipped rather than sent — worth pinning because the owner types the FROM
// number by hand on the new page.
schk('07 trunk → +44', sms_normalize_uk('07700 900123') === '+447700900123');
schk('spaces and punctuation are ignored', sms_normalize_uk('(07700) 900-123') === '+447700900123');
schk('44 without a plus → +44', sms_normalize_uk('447700900123') === '+447700900123');
schk('already E.164 passes through', sms_normalize_uk('+447700900123') === '+447700900123');
schk('empty → refused', sms_normalize_uk('') === '');
schk('nonsense → refused, not mangled', sms_normalize_uk('not a number') === '');
schk('too short → refused', sms_normalize_uk('0770') === '');

// The empty-constant run, in its own process (see the top of the file).
$out = [];
$rc = 0;
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --empty 2>&1', $out, $rc);
foreach ($out as $line) {
    if (strpos($line, '  ✓') === 0 || strpos($line, '  ✗') === 0 || strpos($line, '==') === 0) {
        echo $line . "\n";
    }
}
schk('the empty-constant run passed', $rc === 0, implode(' | ', $out));

echo "\n== Summary ==\n";
echo $fails ? "  $fails SMS CHECK(S) FAILED ❌\n\n" : "  ALL SMS CHECKS PASSED ✅\n\n";
exit($fails ? 1 : 0);
