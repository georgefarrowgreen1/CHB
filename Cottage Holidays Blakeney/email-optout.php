<?php
// ============================================================
//  email-optout.php — one-click unsubscribe from marketing-ish emails
//  (anniversary re-invites). Newsletter subscribers have their own token
//  flow (newsletter.php); past GUESTS aren't subscribers, so their emails
//  carry a signed link here instead.
//
//  GET  email-optout.php?e=<email>&t=<hmac>   → adds to the suppression list,
//       shows a small confirmation page. Idempotent; the token is a one-way
//       HMAC over the address (db.php email_optout_token) so the link can't
//       be forged to unsubscribe someone else en masse.
//  POST (same params) → RFC 8058 one-click List-Unsubscribe-Post target;
//       returns 200 with no body fuss (mail clients call this directly).
// ============================================================
require_once __DIR__ . '/db.php';

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');

$email = trim((string) ($_GET['e'] ?? ($_POST['e'] ?? '')));
$token = (string) ($_GET['t'] ?? ($_POST['t'] ?? ''));

$ok = $email !== '' && $token !== '' && hash_equals(email_optout_token($email), $token);
if ($ok) {
    $ok = email_optout_add($email);
    if ($ok) {
        log_activity('settings', 'email.optout', 'Guest opted out of occasional emails — ' . $email, [
            'entity' => 'email',
            'actor' => 'guest',
        ]);
    }
}

// One-click (RFC 8058) POSTs just need the 2xx.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    http_response_code($ok ? 200 : 400);
    echo $ok ? 'Unsubscribed' : 'Invalid link';
    exit();
}

http_response_code($ok ? 200 : 400);
$msg = $ok
    ? "You're unsubscribed — we won't send you occasional notes like that again. (Booking and payment emails about any stay you book are unaffected.)"
    : 'Sorry — this unsubscribe link is invalid.';
echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Email preferences — Cottage Holidays Blakeney</title></head>' .
    '<body style="margin:0;background:#f4efe4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b;">' .
    '<div style="max-width:520px;margin:60px auto;background:#fff;border-radius:16px;padding:36px 32px;box-shadow:0 8px 40px rgba(0,0,0,0.08);">' .
    '<div style="font-size:20px;font-weight:800;margin-bottom:10px;">Cottage Holidays Blakeney</div>' .
    '<p style="font-size:15px;line-height:1.6;color:#57524A;margin:0;">' . htmlspecialchars($msg, ENT_QUOTES, 'UTF-8') . '</p>' .
    '</div></body></html>';
