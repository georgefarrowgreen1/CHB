<?php
// ============================================================
//  test-devices.php — Devices: what each device is called, how it signed in,
//  when a sign-in is news, and when the list can say it is complete (dev/CI only).
//
//      php test-devices.php
//
//  devices-lib.php's top half is PURE, so it is driven here with no database.
//  The rows, the endpoint and the sign-outs are gated end to end by
//  test-integration §82; the Security page by ui-test-devices.js.
// ============================================================
error_reporting(E_ALL);
require_once __DIR__ . '/devices-lib.php';

$fail = 0;
$pass = 0;
function dvc($name, $cond, $extra = '')
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

// Real user agents, as each browser sends them.
$UA = [
    'iphoneSafari' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    'iphoneApp' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'iphoneChrome' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
    'iphoneFirefox' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15',
    'ipadOld' => 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
    'macSafari' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    'macChrome' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'winEdge' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.65',
    'winFirefox' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'androidChrome' => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.81 Mobile Safari/537.36',
    'androidTablet' => 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.81 Safari/537.36',
    'samsung' => 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    'chromebook' => 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'linuxFirefox' => 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
];
$L = fn($k, $hint = '') => devices_label($UA[$k], $hint);

echo "\n== §1 what a device is called ==\n";
dvc('an iPhone in Safari', $L('iphoneSafari') === ['label' => 'iPhone · Safari', 'kind' => 'phone'], json_encode($L('iphoneSafari')));
dvc('the installed app on an iPhone, told by the page', $L('iphoneSafari', 'app')['label'] === 'iPhone · App');
dvc('…and known without a hint: an iPhone browser with no Safari token is the app', $L('iphoneApp')['label'] === 'iPhone · App', json_encode($L('iphoneApp')));
dvc('…but a hint saying "a browser tab" wins over that guess (an in-app browser is not our app)', $L('iphoneApp', 'web')['label'] === 'iPhone · Browser', json_encode($L('iphoneApp', 'web')));
dvc('Chrome and Firefox on an iPhone say which they are', $L('iphoneChrome')['label'] === 'iPhone · Chrome' && $L('iphoneFirefox')['label'] === 'iPhone · Firefox');
dvc('an iPad that says so', $L('ipadOld') === ['label' => 'iPad · Safari', 'kind' => 'tablet']);
dvc('an iPad whose Safari calls itself a Mac, told by the page', $L('macSafari', 'ipad.web') === ['label' => 'iPad · Safari', 'kind' => 'tablet'], json_encode($L('macSafari', 'ipad.web')));
dvc('…and the iPad app', $L('macSafari', 'ipad.app')['label'] === 'iPad · App');
dvc('a Mac without the hint stays a Mac', $L('macSafari') === ['label' => 'Mac · Safari', 'kind' => 'laptop'] && $L('macChrome')['label'] === 'Mac · Chrome');
dvc('Edge says Edge, though its agent also says Chrome and Safari', $L('winEdge') === ['label' => 'Windows PC · Edge', 'kind' => 'desktop'], json_encode($L('winEdge')));
dvc('Firefox on Windows', $L('winFirefox')['label'] === 'Windows PC · Firefox');
dvc('an Android phone and an Android tablet', $L('androidChrome') === ['label' => 'Android phone · Chrome', 'kind' => 'phone'] && $L('androidTablet') === ['label' => 'Android tablet · Chrome', 'kind' => 'tablet']);
dvc('Samsung Internet, though it also says Chrome', $L('samsung')['label'] === 'Android phone · Samsung Internet');
dvc('a Chromebook and a Linux PC', $L('chromebook')['label'] === 'Chromebook · Chrome' && $L('linuxFirefox')['label'] === 'Linux PC · Firefox');
dvc('nothing to go on is named honestly, never guessed', devices_label('', '') === ['label' => 'Unknown device · Browser', 'kind' => 'desktop']);
dvc('the hint is a closed vocabulary: anything else is ignored', devices_hint_flags('app.ipad.evil.<script>.web.app') === ['app', 'ipad', 'web'] && devices_hint_flags('') === [] && devices_hint_flags(str_repeat('app.', 50)) === ['app']);

echo "\n== §2 how it signed in ==\n";
$words = array_map('devices_how_words', ['passkey', 'password', 'password_code', 'code', 'invite', 'reset', 'staging']);
dvc('each way in has its words', $words === ['Passkey', 'Password', 'Password and emailed code', 'Emailed code', 'Invite link', 'Password reset link', 'Staging sign-in'], json_encode($words));
dvc('a session from before the list began, or anything unknown, says it was not recorded', devices_how_words('earlier') === 'Not recorded' && devices_how_words('') === 'Not recorded' && devices_how_words('x') === 'Not recorded');

echo "\n== §3 when a sign-in is news ==\n";
dvc('a device never used before, with other sign-ins already on record, is news', devices_is_new(false, false, 3, 'code', false));
dvc('…not the same browser signing in again', !devices_is_new(true, false, 3, 'code', false));
dvc('…not a device two-step already trusts', !devices_is_new(false, true, 3, 'password', false));
dvc('…not the first sign-in they ever make', !devices_is_new(false, false, 0, 'invite', false));
dvc('…not a session recorded late (from before the list began)', !devices_is_new(false, false, 3, 'earlier', false));
dvc('…and never on the staging copy', !devices_is_new(false, false, 3, 'password', true));

echo "\n== §4 when the list can say it is complete ==\n";
$ttl = 60 * 86400;
$now = strtotime('2026-12-01 12:00:00');
dvc('just after the list began, a device from before it may still be out there', devices_partial('2026-11-20 09:00:00', $now, $ttl));
dvc('a whole session lifetime later, every such session has lapsed', !devices_partial('2026-09-20 09:00:00', $now, $ttl));
dvc('with no record of when it began, it claims nothing either way', !devices_partial(null, $now, $ttl) && !devices_partial('', $now, $ttl));

echo "\n== §5 the wiring ==\n";
$src = fn($f) => (string) file_get_contents(__DIR__ . '/' . $f);
$noComments = fn($s) => preg_replace('~^\s*//.*$~m', '', $s);
$db = $noComments($src('db.php'));
dvc('db.php loads the devices lib for every request', strpos($db, "require_once __DIR__ . '/devices-lib.php';") !== false);
dvc('every request asks whether this device is still signed in', preg_match('/function admin_session_check\(\): void\s*\{.*?if \(!devices_session_check\(\$row\)\)/s', $db) === 1);
dvc('…and a device signed out is told why, once', strpos($db, "\$_SESSION['admin_ended'] = 'device';") !== false && strpos($src('auth.php'), "\$ended = (string) (\$_SESSION['admin_ended'] ?? '');") !== false);
dvc('every sign-in is recorded with how it happened', preg_match('/function admin_session_begin\(\$id, string \$how = \'\'\): array.*?return devices_record\(\$id, \$how\);/s', $db) === 1);
dvc('logging out ends this device\'s row', preg_match('/function session_end_signed_in\(\)\s*\{.*?devices_end\(\(int\) \$_SESSION\[\'admin_sess\'\], \'logout\'\);/s', $db) === 1);
$auth = $src('auth.php');
foreach (['password', 'password_code', 'invite', 'reset', 'code', 'staging'] as $via) {
    dvc("auth.php passes how it signed in: $via", strpos($auth, ", '$via');") !== false || strpos($auth, ", '$via'); //") !== false);
}
dvc('passkeys.php records a passkey sign-in', strpos($src('passkeys.php'), "admin_session_begin((int) \$cred['admin_id'], 'passkey')") !== false);
dvc('a new device is told about, from both doors', substr_count($auth . $src('passkeys.php'), 'devices_alert_new(') === 2);
dvc('a password change and a reset take the other devices off the list', strpos($auth, "devices_end_others((int) \$_SESSION['admin_id'], (int) (\$_SESSION['admin_sess'] ?? 0), 'password');") !== false && strpos($auth, "devices_end_others((int) \$row['id'], 0, 'reset');") !== false);
dvc('removing someone takes theirs off too', strpos($src('people.php'), "devices_end_others((int) \$row['id'], 0, 'removed', \$myId);") !== false);
dvc('a device\'s alerts are tied to it when they are turned on', strpos($src('push.php'), 'admin_session_id) VALUES') !== false);
dvc('the nightly job lets an unused device go', strpos($src('self-repair.php'), 'devices_prune()') !== false);
$dp = $src('devices.php');
dvc('devices.php keeps the session (signing out your others re-stamps this one)', strpos($dp, "define('CHB_KEEPS_SESSION', true);") !== false && strpos($dp, "\$_SESSION['admin_epoch'] =") !== false);
dvc('…refuses the device you are using', strpos($dp, "'code' => 'this_device'") !== false);
dvc('…signs out everywhere by the epoch, so a session from before the list began goes too', strpos($dp, 'UPDATE admins SET auth_epoch = auth_epoch + 1 WHERE id = ?') !== false);
dvc('…and emails the person when a Super User did it', substr_count($dp, 'devices_tell_signed_out(') === 2);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail DEVICES CHECK(S) FAILED \xE2\x9D\x8C\n";
    exit(1);
}
echo "  ALL $pass DEVICES CHECKS PASSED \xE2\x9C\x85\n";
