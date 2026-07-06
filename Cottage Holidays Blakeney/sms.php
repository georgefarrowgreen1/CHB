<?php
// ============================================================
//  sms.php — OPTIONAL transactional SMS (balance-due + pre-arrival nudges).
//
//  A NO-OP until the owner sets SMS_ENABLED + TWILIO_* in config.php AND the
//  guest ticked "text me booking updates" on their enquiry. Service messages
//  about the guest's OWN booking only — never marketing. Uses Twilio's REST API.
//  See SETUP-SMS.md.
// ============================================================
require_once __DIR__ . '/db.php';

// Is a provider fully configured?
function sms_enabled()
{
    return defined('SMS_ENABLED') &&
        SMS_ENABLED &&
        defined('TWILIO_SID') &&
        TWILIO_SID &&
        defined('TWILIO_TOKEN') &&
        TWILIO_TOKEN &&
        defined('TWILIO_FROM') &&
        TWILIO_FROM;
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
        $sid = TWILIO_SID;
        $ch = curl_init('https://api.twilio.com/2010-04-01/Accounts/' . rawurlencode($sid) . '/Messages.json');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_USERPWD => $sid . ':' . TWILIO_TOKEN,
            CURLOPT_POSTFIELDS => http_build_query(['To' => $num, 'From' => TWILIO_FROM, 'Body' => $body]),
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
        return ['ok' => false, 'error' => 'HTTP ' . $code];
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
