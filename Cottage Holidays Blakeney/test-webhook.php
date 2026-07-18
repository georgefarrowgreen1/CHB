<?php
// Unit test for the Square webhook signature check (db.php
// square_webhook_signature_ok) — the exact HMAC scheme square-webhook.php uses to
// authenticate Square's POSTs. A correctly-signed body must verify; a wrong key,
// tampered body, wrong URL or missing signature must all be rejected.
require_once __DIR__ . '/db.php';

$fail = 0;
function chk($name, $cond)
{
    global $fail;
    echo '  ' . ($cond ? "\u{2713}" : "\u{2717}") . " $name\n";
    if (!$cond) {
        $fail++;
    }
}

$url = 'https://example.test/square-webhook.php';
$key = 'test-signing-key-abc123';
$body = '{"type":"refund.updated","data":{"object":{"refund":{"id":"R1","status":"COMPLETED"}}}}';
$good = base64_encode(hash_hmac('sha256', $url . $body, $key, true));

chk('a correctly-signed request verifies', square_webhook_signature_ok($url, $body, $key, $good) === true);
chk('a wrong signing key is rejected', square_webhook_signature_ok($url, $body, 'other-key', $good) === false);
chk('a tampered body is rejected', square_webhook_signature_ok($url, $body . ' ', $key, $good) === false);
chk('a wrong notification URL is rejected', square_webhook_signature_ok('https://evil.test/x', $body, $key, $good) === false);
chk('a missing signature is rejected', square_webhook_signature_ok($url, $body, $key, '') === false);
chk('an empty signing key is rejected (webhook not wired up)', square_webhook_signature_ok($url, $body, '', $good) === false);

echo $fail ? "\n  $fail WEBHOOK CHECK(S) FAILED \u{274C}\n" : "\n  WEBHOOK SUITE PASSED \u{2705}\n";
exit($fail ? 1 : 0);
