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
// Memoised for the life of the REQUEST, because content_value() is an uncached
// SELECT and these are read in loops: payments-due.php calls sms_notify_booking()
// once per booking it chases (4 reads each), sms_send() resolves three more per
// message, and rates_public_payload() — the PUBLIC boot payload — asks on every
// anonymous first paint and every live-update tick. Collapsing four boot calls
// into one bootstrap request was a deliberate decision on this shared host, and
// four fresh queries per guest would quietly hand that back. A save happens in a
// different request, so there is nothing to invalidate.
//
// Held in a GLOBAL rather than a function-static purely so it can be cleared:
// test-sms.php changes the stored settings many times inside one process.
function sms_settings_reset()
{
    $GLOBALS['__sms_memo'] = ['set' => [], 'on' => null];
    return true;
}
function sms_setting($const, $key)
{
    if (!isset($GLOBALS['__sms_memo'])) {
        sms_settings_reset();
    }
    if (array_key_exists($key, $GLOBALS['__sms_memo']['set'])) {
        return $GLOBALS['__sms_memo']['set'][$key];
    }
    $out = '';
    if (defined($const)) {
        $out = trim((string) constant($const));
    }
    if ($out === '') {
        $out = trim((string) content_value($key));
    }
    $GLOBALS['__sms_memo']['set'][$key] = $out;
    return $out;
}
// The master switch. SMS_ENABLED is a BOOLEAN const, so it cannot use
// sms_setting() — `false` and "not set" are the same string there. A const set
// to true forces it on; otherwise the stored toggle decides.
function sms_switched_on()
{
    if (!isset($GLOBALS['__sms_memo'])) {
        sms_settings_reset();
    }
    if ($GLOBALS['__sms_memo']['on'] !== null) {
        return $GLOBALS['__sms_memo']['on'];
    }
    $on = (defined('SMS_ENABLED') && SMS_ENABLED) ? true : content_value(SMS_KEY_ON) === '1';
    $GLOBALS['__sms_memo']['on'] = $on;
    return $on;
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

// ---- ONE SEGMENT, OR YOU ARE PAYING THREE TIMES ---------------------------
// A text is BILLED PER SEGMENT. The GSM-7 alphabet fits 160 characters in one;
// a single character outside it switches the whole message to UCS-2, where a
// segment holds 70. So one invisible typographic character triples the cost of
// every message that contains it — measured, the balance nudge billed as THREE
// texts and the arrival nudge as TWO, purely because of an em dash. The pound
// sign is fine (GSM-7 includes it); the dash was not.
//
// Fixing the two strings would have fixed today's copy and nothing else: the
// next person to type a curly apostrophe, an ellipsis or an en dash would have
// re-broken it silently, with the Twilio bill as the only symptom. So the
// alphabet is stated here, every outgoing message is normalised through
// sms_plain(), and test-sms.php asserts each one is a single GSM-7 segment.
// NB the `\$` escape is load-bearing: PHP identifiers may contain bytes >= 0x80,
// so in a double-quoted string `$¥` parses as a VARIABLE named ¥ — which would
// silently drop both characters from the alphabet and make every message
// containing a pound-adjacent symbol measure as UCS-2. The parser catches it
// here only because this is a const; inside an ordinary string it would just be
// wrong. test-sms.php asserts `$` and `¥` are both present.
const SMS_GSM7 =
    "@£\$¥èéùìòÇ\nØø\rÅå_ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" .
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" .
    "ΔΦΓΛΩΠΨΣΘΞ";
// These cost TWO GSM-7 characters each (escape + char), not one.
const SMS_GSM7_EXT = "^{}\\[~]|€";
// Typographic characters an English sentence acquires from a word processor, or
// from someone typing properly, mapped to the plain equivalent. Anything NOT in
// here is left alone on purpose: a name with an unusual accent should arrive
// spelled correctly as a two-segment message rather than mangled as a one.
const SMS_PLAIN_MAP = [
    "\u{2014}" => '-',   // em dash — the one that was costing money
    "\u{2013}" => '-',   // en dash
    "\u{2012}" => '-',   // figure dash
    "\u{2212}" => '-',   // minus sign
    "\u{2026}" => '...', // ellipsis
    "\u{2018}" => "'",   // curly quotes
    "\u{2019}" => "'",
    "\u{201A}" => "'",
    "\u{201C}" => '"',
    "\u{201D}" => '"',
    "\u{201E}" => '"',
    "\u{2022}" => '*',   // bullet
    "\u{00A0}" => ' ',   // non-breaking space
    "\u{2007}" => ' ',
    "\u{202F}" => ' ',
    "\u{2032}" => "'",   // prime / double prime
    "\u{2033}" => '"',
    "\u{2122}" => 'TM',
    "\u{00AD}" => '',    // soft hyphen: invisible, and still forces UCS-2
];
function sms_plain($text)
{
    return strtr((string) $text, SMS_PLAIN_MAP);
}
// What a message will actually cost. Returns the encoding, the character count
// and the number of segments it bills as.
function sms_segments($text)
{
    $text = (string) $text;
    $chars = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $gsm = preg_split('//u', SMS_GSM7, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $ext = preg_split('//u', SMS_GSM7_EXT, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $units = 0;
    $unicode = false;
    foreach ($chars as $c) {
        if (in_array($c, $ext, true)) {
            $units += 2;
        } elseif (in_array($c, $gsm, true)) {
            $units += 1;
        } else {
            $unicode = true;
            break;
        }
    }
    $n = count($chars);
    if ($unicode) {
        // UCS-2: 70 per single message, 67 each once it has to be concatenated.
        return ['encoding' => 'UCS-2', 'chars' => $n, 'segments' => $n <= 70 ? 1 : (int) ceil($n / 67)];
    }
    // GSM-7: 160 single, 153 each concatenated.
    return ['encoding' => 'GSM-7', 'chars' => $n, 'segments' => $units <= 160 ? 1 : (int) ceil($units / 153)];
}

// ---- THE MESSAGES ----------------------------------------------------------
// Every text this site can send is written HERE, in one place. They were inline
// at their three call sites, which is why nothing could check that they all fit
// a single segment — and why two of them quietly did not. Sentences end with a
// full stop rather than a dash: it reads better AND stays inside GSM-7.
function sms_body_balance($checkInUk, $amount = null)
{
    return sms_plain(
        'Cottage Holidays Blakeney: the balance' .
            ($amount !== null ? ' of £' . number_format((float) $amount, 2) : '') .
            ' for your ' . $checkInUk . ' stay is now due. ' .
            'Please check your email for the secure payment link.',
    );
}
function sms_body_arrival($checkInUk)
{
    return sms_plain(
        'Cottage Holidays Blakeney: your stay starts ' . $checkInUk . '. ' .
            "We've emailed your arrival info, directions and key details. See you soon!",
    );
}
function sms_body_test()
{
    return sms_plain('Cottage Holidays Blakeney: this is a test message from your back office. Texts are working.');
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
    // Normalised at the CHOKE POINT, so a message composed anywhere — including
    // one written later by someone who has never read this file — cannot cost
    // three segments because of a character they cannot see.
    $body = sms_plain(trim((string) $body));
    $body = mb_substr($body, 0, 480);
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
