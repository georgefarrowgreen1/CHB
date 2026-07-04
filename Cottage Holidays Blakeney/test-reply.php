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
// The real-world miss: iOS Mail attribution WRAPPED onto two lines, quote has no ">".
$iosWrapped = "Sounds great, see you soon!\n\nOn 4 Jul 2026, at 19:59, Cottage Holidays Blakeney\n<bookings\@x.co.uk> wrote:\n\nSomeone has sent you a message via the website chat.\n\nFrom: George (george\@icloud.com)\n\n\"Boo\"\n\nJust reply to this email and the guest gets it on the website and by email.";
chk('wrapped iOS attribution stripped', strip_quoted_reply($iosWrapped) === "Sounds great, see you soon!");
// Owner replied with NO added text → whole body is our quoted notification → empty.
$quoteOnly = "On 4 Jul 2026, at 19:59, Cottage Holidays Blakeney\n<bookings\@x.co.uk> wrote:\n\nSomeone has sent you a message via the website chat.\n\n\"Boo\"\n\nJust reply to this email and the guest gets it on the website and by email.";
chk('quote-only reply → empty (skipped)', strip_quoted_reply($quoteOnly) === '');
// No attribution at all, quote not ">"-prefixed → cut at our known phrase.
$noAttrib = "Yep all good.\n\nSomeone has sent you a message via the website chat.\n\n\"Boo\"";
chk('our-phrase cut with no attribution', strip_quoted_reply($noAttrib) === "Yep all good.");
// Guest-side relay quoted back.
$guestQuote = "Thanks!\n\nYou have a new message from Cottage Holidays Blakeney:\n\n\"see you then\"";
chk('guest relay phrase cut', strip_quoted_reply($guestQuote) === "Thanks!");

echo "== Zero-setup mailbox parsing ==\n";
require_once __DIR__ . '/mailbox-read.php';   // endpoint block is basename-guarded → no side effects
// POP3 UIDL listing
$uidls = pop3_parse_uidl("+OK\r\n1 aaa111\r\n2 bbb222\r\n3 ccc333\r\n.\r\n");
chk('UIDL parsed to [no=>uid]', $uidls === [1 => 'aaa111', 2 => 'bbb222', 3 => 'ccc333']);
// derived POP host
chk('pop host derived from smtp host', mailbox_pop_host() !== '' && strpos(mailbox_pop_host(), 'pop') === 0 ? true : (mailbox_pop_host() === '' ? true : false));
// From-address extraction
chk('from "Name <addr>" → addr', mailbox_from_addr('George Farrow <george@icloud.com>') === 'george@icloud.com');
chk('from bare addr', mailbox_from_addr('george@icloud.com') === 'george@icloud.com');
// A realistic quoted-printable reply, token in In-Reply-To
$rawQP = "From: George <george@icloud.com>\r\n"
       . "Subject: Re: New website message\r\n"
       . "In-Reply-To: <msg." . $tok . "@cottageholidaysblakeney.co.uk>\r\n"
       . "Content-Type: text/plain; charset=UTF-8\r\n"
       . "Content-Transfer-Encoding: quoted-printable\r\n"
       . "\r\n"
       . "Yes =E2=80=94 1-8 August is free.\r\n\r\nOn Fri wrote:\r\n> old stuff";
$p = parse_email_message($rawQP);
chk('QP body decoded', strpos($p['body'], 'August is free') !== false);
chk('token found from In-Reply-To', msg_reply_verify(mailbox_token_in($p)) === 42);
chk('sender parsed', mailbox_from_addr($p['from']) === 'george@icloud.com');
chk('cleaned reply drops the quote', strip_quoted_reply($p['body']) === "Yes — 1-8 August is free.");
// Multipart/alternative — take text/plain
$b = 'BOUND123';
$rawMP = "From: a@b.com\r\nSubject: Re: hi [#" . $tok . "]\r\nContent-Type: multipart/alternative; boundary=\"$b\"\r\n\r\n"
       . "--$b\r\nContent-Type: text/plain\r\n\r\nHello there plain\r\n--$b\r\nContent-Type: text/html\r\n\r\n<p>Hello there html</p>\r\n--$b--\r\n";
$pm = parse_email_message($rawMP);
chk('multipart text/plain extracted', trim($pm['body']) === 'Hello there plain');
chk('token found from subject tag', msg_reply_verify(mailbox_token_in($pm)) === 42);

echo "\n" . ($fail === 0 ? "All reply checks passed.\n" : "$fail CHECK(S) FAILED\n");
exit($fail ? 1 : 0);
