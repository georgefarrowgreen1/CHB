<?php
// ============================================================
//  sms.php — OPTIONAL transactional SMS (balance-due + pre-arrival nudges).
//
//  A NO-OP until Twilio is configured AND the guest ticked "text me booking
//  updates" on their enquiry. Service messages about the guest's OWN booking
//  only — never marketing. Uses Twilio's REST API.
//
//  SETTINGS LIVE IN MANAGE → TEXT MESSAGES, not config.php. They were config
//  constants, which meant switching SMS on required editing a PHP file on the
//  host — so the enquiry form offered "Text me booking updates" to every guest
//  while nothing could ever send one, and there was no screen anywhere that
//  said so. The four values are owner-editable now (the `apikey-` ones
//  encrypted at rest, like the WorldTides and Square webhook keys), and
//  `sms_status()` is what the settings page and the guest form both read.
//
//  A config CONSTANT STILL WINS where one is set — same precedence as
//  square_webhook_signing_key() — so an existing install that already had
//  SMS_ENABLED + TWILIO_* in config.php keeps working untouched and does not
//  need the settings page at all.
// ============================================================
require_once __DIR__ . '/db.php';

// Content keys behind the settings page. The two `apikey-` ones are PRIVATE
// (is_private_content_key → encrypted at rest); the other two are INTERNAL
// (owner-only, never on the anonymous content GET). All four are classified in
// db.php — test-content-keys.php fails the build otherwise.
const SMS_KEY_SID = 'apikey-twilio-sid';
const SMS_KEY_TOKEN = 'apikey-twilio-token';
const SMS_KEY_FROM = 'sms-from';
const SMS_KEY_ON = 'sms-enabled';

// One value, config const first then the stored setting. `$const` may be absent
// or empty on a host that never configured it — an empty constant is treated as
// UNSET rather than as an explicit blank, or defining the four consts as ''
// (which config.php ships as the default!) would permanently shadow the
// settings page and nothing the owner typed would ever apply.
function sms_setting($const, $key)
{
    if (defined($const)) {
        $v = trim((string) constant($const));
        if ($v !== '') {
            return $v;
        }
    }
    return trim((string) content_value($key));
}
// The master switch. SMS_ENABLED is a BOOLEAN const, so it cannot use
// sms_setting() — `false` and "not set" are the same string there. A const set
// to true forces it on; otherwise the stored toggle decides.
function sms_switched_on()
{
    if (defined('SMS_ENABLED') && SMS_ENABLED) {
        return true;
    }
    return content_value(SMS_KEY_ON) === '1';
}
// Is a provider fully configured AND switched on? Every send path gates on this.
function sms_enabled()
{
    return sms_switched_on() &&
        sms_setting('TWILIO_SID', SMS_KEY_SID) !== '' &&
        sms_setting('TWILIO_TOKEN', SMS_KEY_TOKEN) !== '' &&
        sms_setting('TWILIO_FROM', SMS_KEY_FROM) !== '';
}
// What the settings page shows. NEVER carries the auth token — only whether one
// is stored — so the secret has no route back to any browser (the same rule
// content.php's get_all applies to the Square webhook key).
function sms_status()
{
    $sid = sms_setting('TWILIO_SID', SMS_KEY_SID);
    $token = sms_setting('TWILIO_TOKEN', SMS_KEY_TOKEN);
    $from = sms_setting('TWILIO_FROM', SMS_KEY_FROM);
    $byConst = defined('SMS_ENABLED') && SMS_ENABLED && defined('TWILIO_TOKEN') && trim((string) TWILIO_TOKEN) !== '';
    return [
        'on' => sms_switched_on(),
        'ready' => sms_enabled(),
        // The SID is an account identifier, not a credential — showing the last
        // few characters lets the owner confirm WHICH account is wired up
        // without handing the whole thing back.
        'sid_set' => $sid !== '',
        'sid_tail' => $sid === '' ? '' : substr($sid, -4),
        'token_set' => $token !== '',
        'from' => $from,
        // Where the live values come from, so the page never invites an edit it
        // cannot honour: a config.php const silently outranks anything typed.
        'from_config' => $byConst,
    ];
}

// Normalise a UK number to E.164 (+44…). Returns '' if it doesn't look valid, so
// a malformed number is simply skipped rather than sent.
function sms_normalize_uk($raw)
{
    $d = preg_replace('/[^\d+]/', '', (string) $raw);
    if ($d === '') {
        return '';
    }
    if (strpos($d, '+') === 0) {
        return preg_match('/^\+\d{8,15}$/', $d) ? $d : '';
    }
    if (preg_match('/^0(\d{9,10})$/', $d, $m)) {
        return '+44' . $m[1]; // 07… trunk → +44…
    }
    if (preg_match('/^44(\d{9,10})$/', $d, $m)) {
        return '+44' . $m[1];
    }
    return '';
}

// Low-level send. Returns ['ok'=>bool, 'error'?=>string]. Never throws.
function sms_send($to, $body)
{
    if (!sms_enabled()) {
        return ['ok' => false, 'error' => 'SMS disabled'];
    }
    $num = sms_normalize_uk($to);
    if ($num === '') {
        return ['ok' => false, 'error' => 'Invalid number'];
    }
    $body = mb_substr(trim((string) $body), 0, 480);
    if ($body === '') {
        return ['ok' => false, 'error' => 'Empty body'];
    }
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'No cURL'];
    }
    try {
        // Resolved, not read off the constants — otherwise the settings page
        // could report itself ready while every send still reached for a config
        // const that isn't there (fatal on an install that never defined them).
        $sid = sms_setting('TWILIO_SID', SMS_KEY_SID);
        $token = sms_setting('TWILIO_TOKEN', SMS_KEY_TOKEN);
        $from = sms_setting('TWILIO_FROM', SMS_KEY_FROM);
        $ch = curl_init('https://api.twilio.com/2010-04-01/Accounts/' . rawurlencode($sid) . '/Messages.json');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_USERPWD => $sid . ':' . $token,
            CURLOPT_POSTFIELDS => http_build_query(['To' => $num, 'From' => $from, 'Body' => $body]),
            CURLOPT_TIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $resp = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($resp === false) {
            return ['ok' => false, 'error' => $err ?: 'send failed'];
        }
        if ($code >= 200 && $code < 300) {
            return ['ok' => true];
        }
        // Twilio's own sentence when it has one ("The 'From' number ... is not a
        // valid, SMS-capable Twilio number"), because "HTTP 400" tells the owner
        // nothing on a setup screen whose whole job is getting this right. Their
        // messages are written for people; bounded, and never the raw body.
        $why = '';
        try {
            $j = json_decode((string) $resp, true);
            if (is_array($j) && !empty($j['message'])) {
                $why = mb_substr(trim((string) $j['message']), 0, 200);
            }
        } catch (\Throwable $e) {
        }
        return ['ok' => false, 'error' => $why !== '' ? $why : 'HTTP ' . $code];
    } catch (\Throwable $e) {
        return ['ok' => false, 'error' => 'exception'];
    }
}

// Convenience: text a booking's guest IFF SMS is configured, they opted in, and
// they gave a number. Best-effort; never throws. Returns whether a text was sent.
function sms_notify_booking($b, $body)
{
    try {
        if (!sms_enabled() || empty($b['sms_opt_in']) || empty($b['phone'])) {
            return false;
        }
        $r = sms_send($b['phone'], $body);
        return !empty($r['ok']);
    } catch (\Throwable $e) {
        return false;
    }
}
