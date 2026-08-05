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

// THE CANDIDATE-URL VERIFICATION — the 401-every-delivery fix. Square signs the
// exact registered notification_url (always https); the app reconstructs the URL
// per-request, and a TLS-terminating proxy or a www/apex host difference made
// the two diverge, rejecting every legitimate delivery. square-webhook.php now
// tries every legitimate form of THIS endpoint. Simulate that loop here.
echo "\n== The candidate-URL verification (the live 401 fix) ==\n";
$verifyAny = function ($candidates, $body, $key, $sig) {
    foreach ($candidates as $c) {
        if (square_webhook_signature_ok($c, $body, $key, $sig)) {
            return $c;
        }
    }
    return '';
};
// Square signed the HTTPS apex form; the request reached PHP as http (proxy) —
// so the reconstructed http URL fails, but the https candidate matches.
$signed = 'https://cottageholidaysblakeney.co.uk/square-webhook.php';
$sigApex = base64_encode(hash_hmac('sha256', $signed . $body, $key, true));
$reconstructedHttp = 'http://cottageholidaysblakeney.co.uk/square-webhook.php';
chk('the reconstructed http URL alone would REJECT the real event (the bug)',
    square_webhook_signature_ok($reconstructedHttp, $body, $key, $sigApex) === false);
$cands = ['https://www.cottageholidaysblakeney.co.uk/square-webhook.php', $signed, $reconstructedHttp];
chk('...but trying the https apex candidate verifies it', $verifyAny($cands, $body, $key, $sigApex) === $signed);
// The www variance, the other direction: signed www, apex candidates present.
$signedWww = 'https://www.cottageholidaysblakeney.co.uk/square-webhook.php';
$sigWww = base64_encode(hash_hmac('sha256', $signedWww . $body, $key, true));
chk('a www-signed event verifies against the www candidate',
    $verifyAny(['https://cottageholidaysblakeney.co.uk/square-webhook.php', $signedWww], $body, $key, $sigWww) === $signedWww);
// Still secure: no candidate list rescues a forgery with the WRONG key.
chk('a forged signature is rejected by every candidate',
    $verifyAny($cands, $body, 'wrong-key', $sigApex) === '');
// The wiring: the endpoint loops candidates and pins the match; setup stores the
// registered URL; both read the ONE key constant. (Helper-tested-alone trap.)
$whSrc = (string) file_get_contents(__DIR__ . '/square-webhook.php');
chk('square-webhook.php verifies against the candidate list, not one URL',
    strpos($whSrc, 'foreach (square_webhook_url_candidates() as $cand)') !== false && strpos($whSrc, 'square_webhook_url($url)') === false);
chk('...and pins the matched URL so the store becomes the source of truth',
    strpos($whSrc, 'content_set_scalar(SQUARE_WEBHOOK_URL_KEY, $matchedUrl)') !== false);
$suSrc = (string) file_get_contents(__DIR__ . '/square-setup.php');
chk('square-setup.php stores the registered notification_url', strpos($suSrc, 'content_set_scalar(SQUARE_WEBHOOK_URL_KEY, $registeredUrl)') !== false);

echo $fail ? "\n  $fail WEBHOOK CHECK(S) FAILED \u{274C}\n" : "\n  WEBHOOK SUITE PASSED \u{2705}\n";
exit($fail ? 1 : 0);
