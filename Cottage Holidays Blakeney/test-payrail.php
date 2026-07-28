<?php
// ============================================================
//  test-payrail.php — guards WHICH RAIL a chase email puts a guest on.
//  A guest who paid by card keeps the Square link; one who paid in cash or by
//  transfer is asked for a bank transfer instead, because sending them a card
//  link asks them to switch rails mid-booking.
//
//  Pure functions only — no DB, no SMTP. payment_rail() is the decision and the
//  two *_body() builders are the real composers the senders call, so this covers
//  the WIRING as well as the helper: testing payment_rail() alone passes with
//  either call site reverted to a hardcoded card button (break-tested).
//  Run:  php test-payrail.php
// ============================================================
require_once __DIR__ . '/db.php'; // payment_rail
require_once __DIR__ . '/mailer.php'; // payment_cta + the two body builders

$pass = 0;
$fail = 0;
function chk($name, $cond)
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \u{2713} $name\n";
    } else {
        $fail++;
        echo "  \u{2717} $name\n";
    }
}

$URL = 'https://example.test/index.html?pay=tok&b=7&k=balance';
$BANK = "Cottage Holidays Blakeney\nSort code: 00-00-00\nAccount: 12345678";
// Derived, never written down: a wall-clock date in an assertion is only verified
// on the day it runs (the search-test lesson).
$IN10 = date('Y-m-d', strtotime('+10 days'));
$OUT = date('Y-m-d', strtotime('+17 days'));

// A booking payload in the shape request_booking_payment() builds.
function bk($method, $damages = 0)
{
    global $IN10, $OUT;
    return [
        'name' => 'Sarah Pemberton',
        'email' => 'sarah@example.test',
        'prop_key' => 'jollyboat',
        'prop_name' => 'Jollyboat',
        'check_in' => $IN10,
        'check_out' => $OUT,
        'kind' => 'balance',
        'amount' => 290.0,
        'total' => 580.0,
        'damages' => $damages,
        'payment_method' => $method,
    ];
}

echo "== The rail decision ==\n";
// EMPTY is the one that must stay on card: nothing recorded means nothing paid,
// and the link is that guest's only way to pay.
chk("empty method → card (nothing paid yet — the link is their only way)", payment_rail(['payment_method' => '']) === 'card');
chk('missing method → card', payment_rail([]) === 'card');
chk('null method → card', payment_rail(['payment_method' => null]) === 'card');
chk("'Square card' (what pay.php stamps) → card", payment_rail(['payment_method' => 'Square card']) === 'card');
chk("owner typed 'Card' → card", payment_rail(['payment_method' => 'Card']) === 'card');
chk('case and padding do not matter', payment_rail(['payment_method' => '  CARD  ']) === 'card');
chk("'Card machine' → card", payment_rail(['payment_method' => 'Card machine']) === 'card');
foreach (['Cash', 'cash', 'Bank transfer', 'bank', 'BACS', 'Cheque', 'PayPal', 'Transfer'] as $m) {
    chk("'$m' → bacs", payment_rail(['payment_method' => $m]) === 'bacs');
}

echo "\n== The REMINDER email follows the rail ==\n";
$card = payment_reminder_body(bk('Square card'), $URL, '#C79A64', $BANK);
chk('card: the pay link is in the text half', strpos($card['text'], $URL) !== false);
chk('card: …and the button is in the html half', strpos($card['html'], 'Pay securely by card') !== false);
chk('card: the Square line rides with it', strpos($card['html'], 'Powered by Square') !== false);
chk('card: no bank details leak in', strpos($card['html'], '12345678') === false);

$cash = payment_reminder_body(bk('Cash'), $URL, '#C79A64', $BANK);
chk('cash: the pay link is GONE from the text half', strpos($cash['text'], $URL) === false);
chk('cash: …and from the html half', strpos($cash['html'], $URL) === false);
chk('cash: no "Pay securely by card" button', strpos($cash['html'], 'Pay securely by card') === false);
chk('cash: no "Powered by Square" under bank details', strpos($cash['html'], 'Powered by Square') === false);
chk('cash: the bank details are in the text half', strpos($cash['text'], '12345678') !== false);
chk('cash: …and in the html half', strpos($cash['html'], '12345678') !== false);
chk('cash: it says what to do', stripos($cash['text'], 'bank transfer') !== false && stripos($cash['html'], 'bank transfer') !== false);
chk('cash: the amount is still stated', strpos($cash['text'], '£290.00') !== false && strpos($cash['html'], '£290.00') !== false);
chk('cash: the subject is unchanged — only the mechanism differs', $cash['subject'] === $card['subject']);

$none = payment_reminder_body(bk('Cash'), $URL, '#C79A64', '');
chk('cash, no details on file: still no card link', strpos($none['text'], $URL) === false && strpos($none['html'], 'Pay securely by card') === false);
chk('cash, no details on file: says something actionable instead of a blank block', stripos($none['text'], 'reply') !== false && stripos($none['html'], 'reply') !== false);

echo "\n== The first REQUEST email follows the same rail ==\n";
// Same journey: chasing the same balance must not switch mechanism between the
// first ask and the follow-ups.
$rCard = payment_request_body(bk('Square card'), $URL, '#C79A64', $BANK);
chk('card: the pay link is there', strpos($rCard['text'], $URL) !== false && strpos($rCard['html'], 'Pay securely by card') !== false);
$rCash = payment_request_body(bk('Cash'), $URL, '#C79A64', $BANK);
chk('cash: no pay link', strpos($rCash['text'], $URL) === false && strpos($rCash['html'], 'Pay securely by card') === false);
chk('cash: bank details instead', strpos($rCash['text'], '12345678') !== false && strpos($rCash['html'], '12345678') !== false);
$rNone = payment_request_body(bk('Cash'), $URL, '#C79A64', '');
chk('cash, no details on file: asks them to reply', stripos($rNone['text'], 'reply') !== false && strpos($rNone['text'], $URL) === false);
// A brand-new booking has no method recorded, so nothing about the deposit ask changes.
$rNew = payment_request_body(array_merge(bk(''), ['kind' => 'deposit']), $URL, '#C79A64', $BANK);
chk('a fresh booking (no method) still gets the card link', strpos($rNew['text'], $URL) !== false);

echo "\n== The refundable deposit sentence follows the rail too ==\n";
// "…will be charged to your card today" is a CARD sentence; on the transfer rail
// nothing is charged to anything, the guest sends it.
$dCard = payment_request_body(bk('Square card', 75), $URL, '#C79A64', $BANK);
chk('card: says it will be charged to their card', strpos($dCard['text'], 'charged to your card today') !== false);
chk('card: and states the combined figure (£290 + £75)', strpos($dCard['text'], '£365.00') !== false);
$dCash = payment_request_body(bk('Cash', 75), $URL, '#C79A64', $BANK);
chk('cash: never claims a card will be charged', strpos($dCash['text'], 'charged to your card') === false && strpos($dCash['html'], 'charged to your card') === false);
chk('cash: asks them to send the combined figure instead', strpos($dCash['text'], 'please send £365.00 in total') !== false);

echo "\n== The owner's bank details are FREE TEXT going into guest HTML ==\n";
$evil = payment_reminder_body(bk('Cash'), $URL, '#C79A64', "Acme & Co <script>alert(1)</script>\nSort: 00-00-00");
chk('markup in the details is escaped, not rendered', strpos($evil['html'], '<script>') === false && strpos($evil['html'], '&lt;script&gt;') !== false);
chk('an ampersand is escaped exactly once', strpos($evil['html'], 'Acme &amp; Co') !== false && strpos($evil['html'], '&amp;amp;') === false);
chk('the line breaks the owner typed survive as <br>', strpos($evil['html'], '<br') !== false);
chk('the plain-text half keeps them raw', strpos($evil['text'], "\nSort: 00-00-00") !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail PAY-RAIL CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass PAY-RAIL CHECKS PASSED \u{2705}\n";
