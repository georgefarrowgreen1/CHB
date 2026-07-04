<?php
// ============================================================
//  test-reply.php — guards the reply-by-email core logic (CI + local).
//  Pure functions only (no DB): the signed thread token and the quoted-
//  history stripping. Run:  php test-reply.php
// ============================================================
define('REPLY_INBOX', 'reply@cottageholidaysblakeney.co.uk');   // before db.php/config
require_once __DIR__ . '/db.php';        // msg_reply_token / verify / address
require_once __DIR__ . '/chat-lib.php';  // strip_quoted_reply

$pass = 0; $fail = 0;
function chk($name, $cond) { global $pass, $fail; if ($cond) { $pass++; echo "  \u{2713} $name\n"; } else { $fail++; echo "  \u{2717} $name\n"; } }

echo "== Reply token ==\n";
$tok = msg_reply_token(42);
chk('token verifies to its thread id', msg_reply_verify($tok) === 42);
chk('tampered thread id rejected', msg_reply_verify('43x' . substr($tok, strpos($tok, 'x') + 1)) === 0);
chk('garbage token rejected', msg_reply_verify('not-a-token') === 0);
chk('plus reply address carries the token', msg_reply_address(42) === 'reply+' . $tok . '@cottageholidaysblakeney.co.uk');

// The inbound gateway pulls the token from a plus-recipient or an In-Reply-To.
$find = function ($hay) {
    if (preg_match('/\+(\d+x[0-9a-f]{16})@/', $hay, $m)) return $m[1];
    if (preg_match('/(\d+x[0-9a-f]{16})/', $hay, $m)) return $m[1];
    return '';
};
chk('token found in plus-recipient', msg_reply_verify($find('reply+' . $tok . '@x.co.uk')) === 42);
chk('token found in In-Reply-To', msg_reply_verify($find('<msg.' . $tok . '@x.co.uk>')) === 42);

echo "== Quoted-history stripping ==\n";
$gmail = "Yes, 1-8 August is free — shall I pencil you in?\n\nOn Fri, 4 Jul 2026 at 10:12, Cottage Holidays <reply@x> wrote:\n> Someone sent you a message\n> \"is jollyboat free?\"";
chk('gmail quote stripped', strip_quoted_reply($gmail) === "Yes, 1-8 August is free — shall I pencil you in?");
$outlook = "Sounds good, see you then.\r\n\r\n________________________________\r\nFrom: noreply@x\r\nSent: Friday\r\nSubject: New message\r\nbody...";
chk('outlook divider stripped', strip_quoted_reply($outlook) === "Sounds good, see you then.");
$sig = "Perfect, booked.\n\n-- \nGeorge\nCottage Holidays Blakeney";
chk('signature stripped', strip_quoted_reply($sig) === "Perfect, booked.");
$plain = "Just a normal reply with no quote.";
chk('plain reply untouched', strip_quoted_reply($plain) === $plain);

echo "\n" . ($fail === 0 ? "All reply checks passed.\n" : "$fail CHECK(S) FAILED\n");
exit($fail ? 1 : 0);
