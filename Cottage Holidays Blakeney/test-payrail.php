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
require_once __DIR__ . '/pricing.php'; // booking_payment_kind + the balance window
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

// ============================================================
//  A BOOKING INSIDE THE BALANCE WINDOW IS ASKED TO PAY IN FULL.
//  Booking made close to arrival → the whole amount is already due, so a deposit
//  request is wrong twice over: the guest is asked for 25% and then chased for the
//  rest days later. enquiry-actions.php got this right on approval; bookings.php's
//  request_payment took `kind` from the CLIENT and defaulted to 'deposit', so the
//  booking hub emailed "Pay your deposit — £X" while its own banner beside the
//  button read "Nothing received yet — £Y due" with the full figure.
//  Dates are DERIVED, never written down (the search-test clock lesson).
// ============================================================
$win = payment_balance_days();
$at = fn($days) => ['check_in' => date('Y-m-d', strtotime(($days >= 0 ? '+' : '-') . abs($days) . ' days'))];

chk("the balance window is a positive number of days ({$win})", $win > 0);
// Inside the window: whatever is asked for, the answer is pay-in-full.
chk('booked inside the window → asking for a deposit yields BALANCE', booking_payment_kind($at($win - 5), 'deposit') === 'balance');
chk('…and the default (no kind given) is BALANCE too', booking_payment_kind($at($win - 5)) === 'balance');
chk('arriving today → BALANCE', booking_payment_kind($at(0), 'deposit') === 'balance');
chk('already started → BALANCE', booking_payment_kind($at(-5), 'deposit') === 'balance');
// Outside it: unchanged — a deposit is still correct, and this is what stops the
// fix becoming "always charge everything".
chk('booked well outside the window → a deposit stays a DEPOSIT', booking_payment_kind($at($win + 30), 'deposit') === 'deposit');
chk('…and an explicit balance request is still honoured', booking_payment_kind($at($win + 30), 'balance') === 'balance');
// The boundary, asserted from BOTH sides so it can't drift by a day.
chk("one day inside the boundary (+" . ($win - 1) . ") → BALANCE", booking_payment_kind($at($win - 1), 'deposit') === 'balance');
chk("exactly on the boundary (+{$win}) → DEPOSIT", booking_payment_kind($at($win), 'deposit') === 'deposit');
// The legacy card-authorisation flow is not a deposit and must pass through.
chk("the legacy 'hold' flow is untouched", booking_payment_kind($at(1), 'hold') === 'hold');
// A booking with no check-in date must not be forced into pay-in-full.
chk('a booking with no check-in date keeps the requested kind', booking_payment_kind(['check_in' => null], 'deposit') === 'deposit');

// WIRING — the rule is worthless if a call site still decides for itself. These
// endpoints need a DB to execute, so assert the source routes through the helper;
// break-tested by restoring the client-trusting line.
$bk = (string) file_get_contents(__DIR__ . '/bookings.php');
chk('bookings.php derives the kind from the window, not the client',
    strpos($bk, 'booking_payment_kind($b, $asked)') !== false);
chk('…and no longer takes the request kind as final',
    strpos($bk, "\$kind = (\$in['kind'] ?? 'deposit') === 'balance'") === false);
$pay = (string) file_get_contents(__DIR__ . '/pay.php');
chk('pay.php upgrades the kind before pricing the charge',
    strpos($pay, 'booking_payment_kind($b, $kind)') !== false);
$enq = (string) file_get_contents(__DIR__ . '/enquiry-actions.php');
chk('enquiry-actions.php uses the shared rule (one definition, not two)',
    strpos($enq, 'booking_payment_kind($bk)') !== false
        && strpos($enq, '$daysToCheckIn < payment_balance_days()') === false);

// ---- MONEY AUDIT: one definition of "already paid" -------------------------
// booking_paid_so_far() is max(bookings.deposit_paid, the card ledger). The CHARGE
// always took the max; the EMAIL and the pay SCREEN read deposit_paid alone, so with
// the ledger ahead of the reconciled figure the guest was asked for MORE than the card
// would take — and at the extreme was told £220 was due and then got "already paid in
// full". Three call sites, two answers. The arithmetic is one max(); what is worth
// gating is that all three sites ask the shared question.
echo "\n== Money audit: one paid-so-far definition ==\n";
chk('booking_paid_so_far exists and is the shared answer', function_exists('booking_paid_so_far'));
// Its FALLBACKS are the testable part without a database: a booking with no id, and a
// DB error, must both fall back to the recorded figure — a guest asked for slightly too
// much is recoverable, a guest asked for nothing is not.
chk('with no booking id it falls back to the recorded figure',
    abs(booking_paid_so_far(['deposit_paid' => 120.5]) - 120.5) < 0.005);
chk('an absent deposit_paid reads as zero, not as an error', booking_paid_so_far([]) === 0.0);
// The ledger-query fallback is NOT exercised here on purpose: db() exits with JSON on
// an unreachable database rather than throwing, so calling it with an id in this
// DB-less suite would kill the run rather than take the catch. (Writing that check is
// how the overstated comment on the helper — "falls back on a DB error" — was caught;
// the catch really covers a failing QUERY, i.e. an un-migrated payments table.) What is
// checkable without a database is that the guard is there and returns the recorded
// figure rather than propagating.
$dbSrc = (string) file_get_contents(__DIR__ . '/db.php');
chk('a failing ledger query falls back to the recorded figure rather than propagating',
    preg_match('/function booking_paid_so_far.*?try \{.*?booking_ledger_net\(\$id\).*?catch.*?return \$recorded;/s', $dbSrc) === 1);

$payS = (string) file_get_contents(__DIR__ . '/pay.php');
$priceS = (string) file_get_contents(__DIR__ . '/pricing.php');
chk('the pay screen QUOTES the shared figure', strpos($payS, '$alreadyPaid = booking_paid_so_far($b);') !== false);
chk('the CHARGE uses it too, on a deposit_paid re-read under the lock',
    strpos($payS, "booking_paid_so_far(['id' => \$bookingId, 'deposit_paid' => \$bookingPaid])") !== false);
chk('the EMAIL uses it (booking_amount_due)', strpos($priceS, '$alreadyPaid = booking_paid_so_far($b);') !== false);
chk('…and none of the three reads deposit_paid alone for this any more',
    strpos($payS, "\$alreadyPaid = round((float) (\$b['deposit_paid']") === false
    && strpos($priceS, "\$alreadyPaid = round((float) (\$b['deposit_paid']") === false);

// ---- MONEY AUDIT: ledger status is case-proof, both ends ------------------
echo "\n== Money audit: ledger status normalisation ==\n";
chk('a status is normalised on the way in', payment_status_norm(' completed ') === 'COMPLETED');
chk('a recognised status is accepted whatever its case', payment_status_known('pending') && payment_status_known('MANUAL'));
chk('an unrecognised status is refused, not written over a good one',
    !payment_status_known('') && !payment_status_known('weird') && !payment_status_known(null));
$dbS = (string) file_get_contents(__DIR__ . '/db.php');
$bkS = (string) file_get_contents(__DIR__ . '/bookings.php');
$rcS = (string) file_get_contents(__DIR__ . '/payments-reconcile.php');
$whS = (string) file_get_contents(__DIR__ . '/square-webhook.php');
// The four readers accounts.php had already case-folded and these had not, so one row
// could be counted by some money queries and not others.
chk('booking_ledger_net case-folds (the primitive every paid/refund calc builds on)',
    preg_match("/UPPER\(status\) IN \('COMPLETED','APPROVED'\)/", $dbS) === 1
    && preg_match("/UPPER\(status\) NOT IN \('FAILED','REJECTED'\)/", $dbS) === 1);
chk('find_charge_for_refund case-folds',
    preg_match("/kind IN \('deposit','balance'\) AND UPPER\(status\) IN \('COMPLETED','APPROVED'\)/", $bkS) === 1);
// The filter now lives ONCE, in damages_returned_map — bookings.php delegates to it.
chk('the returned-so-far filter is stated once, case-folded',
    preg_match("/kind = 'damages_return' AND \(status IS NULL OR UPPER\(status\) NOT IN \('FAILED','REJECTED'\)\)/", $dbS) === 1);
chk('damages_returned — the double-return guard — delegates to it',
    preg_match('/function damages_returned\(\$bookingId\)\s*\{[^}]*damages_returned_map\(\[\(int\) \$bookingId\]\)/s', $bkS) === 1);
chk('the reconciler case-folds when picking rows to re-poll',
    preg_match("/UPPER\(status\) NOT IN \('COMPLETED','FAILED','REJECTED'\)/", $rcS) === 1);
// And every writer normalises, so it cannot recur for new rows.
chk('the ledger insert normalises', substr_count($bkS, 'payment_status_norm($status)') >= 2);
chk('the reconciler normalises and validates', strpos($rcS, 'payment_status_known($status)') !== false && strpos($rcS, 'payment_status_norm($status)') !== false);
chk('the webhook normalises both of its writes', substr_count($whS, 'payment_status_norm($status)') >= 2);
// THE REFUND BRANCH was the unguarded one: it wrote `$refund['status'] ?? ''` straight
// in, so an event carrying no status blanked a good one on a money row.
chk('the REFUND webhook branch validates before overwriting a status',
    strpos($whS, "payment_status_known(\$refund['status'] ?? '')") !== false
    && strpos($whS, "payment_status_norm(\$refund['status'])") !== false);
chk('…and no longer writes an unvalidated value',
    strpos($whS, "->execute([(string) (\$refund['status'] ?? ''), (string) \$refund['id']])") === false);

// ---- MONEY AUDIT: the cancellation refund is capped ----------------------
// ---- MONEY AUDIT 2: a FAILED refund is not money returned ------------------
// Three display sites summed damages_return with NO status filter while the guard
// excluded FAILED/REJECTED. The worst of them fed the "Deposits to return" queue and
// its Needs-you duty, so a failed refund dropped the deposit off the owner's to-do
// list and was never re-tried — and my-bookings.php showed the GUEST money back they
// had never received.
echo "\n== Money audit: a FAILED refund is not a return ==\n";
$mybS = (string) file_get_contents(__DIR__ . '/my-bookings.php');
chk('there is one shared map for what has actually gone back', function_exists('damages_returned_map'));
chk('the admin booking rows use it', preg_match('/\$ret = damages_returned_map\(\);/', $bkS) === 1);
chk('the deposit_returns queue uses it', preg_match('/foreach \(damages_returned_map\(\) as \$bid => \$t\)/', $bkS) === 1);
chk("the guest's own account uses it", strpos($mybS, 'damages_returned_map($ids)') !== false);
// …and none of them keeps its own unfiltered copy of the SQL.
chk('no unfiltered damages_return sum is left anywhere',
    preg_match("/kind = 'damages_return' GROUP BY booking_id/", $bkS) !== 1
    && preg_match("/kind = 'damages_return' AND booking_id IN/", $mybS) !== 1);

// ---- MONEY AUDIT 2: the guest INVOICE ------------------------------------
// A money document the guest can open, and it had two wrong figures.
echo "\n== Money audit: the guest invoice ==\n";
$invS = (string) file_get_contents(__DIR__ . '/invoice.php');
chk('the invoice quotes the SHARED paid-so-far figure, not deposit_paid alone',
    strpos($invS, 'booking_paid_so_far($b)') !== false
    && strpos($invS, "round((float) (\$b['deposit_paid'] ?? 0) + (\$depositCharged") === false);
// agreed_booking_fee is RE-SNAPSHOTTED when a stay changes; hold_amount is what was
// actually taken. Extending a booking whose deposit was already charged therefore made
// the invoice bill the new figure and count it as paid.
chk('…and bills the deposit ACTUALLY charged (hold_amount), not the re-snapshotted one',
    strpos($invS, '$damages = round((float) $b[\'hold_amount\'], 2);') !== false
    && strpos($invS, '$depositCharged && (float) ($b[\'hold_amount\'] ?? 0) > 0') !== false);

// ---- MONEY AUDIT 2: the sweep's liability join ---------------------------
// A legacy CAPTURED hold writes kind='damages' keyed on the same hold_payment_id with
// the DEPOSIT as its amount, so an unrestricted join read that as the charge's rental
// portion and apportioned the fee against a doubled gross.
echo "\n== Money audit: the liability join ==\n";
$acctS2 = (string) file_get_contents(__DIR__ . '/accounts.php');
chk('the liability join only matches RENTAL rows',
    preg_match("/LEFT JOIN payments p ON p\.square_payment_id = b\.hold_payment_id\s*\n\s*AND p\.kind IN \('deposit','balance'\)/", $acctS2) === 1);

echo "\n== Money audit: capped cancellation refund ==\n";
// The per-row 'refund' action capped by booking_ledger_net; cancel took a free-typed
// figure with no cap, so a typo was only caught by Square rejecting it — which aborts
// the cancellation too, leaving the owner unable to cancel at all.
if (preg_match("/if \(\\\$action === 'cancel'\)(.*?)\\\$emailResult = null;/s", $bkS, $cm)) {
    // Matched on the ENFORCEMENT, not just the computation: checking that
    // booking_ledger_net is called passed with the comparison replaced by if(false),
    // i.e. a cap that is worked out and then ignored.
    chk('cancel caps the refund by what is still refundable',
        strpos($cm[1], 'booking_ledger_net($id)') !== false
        && preg_match('/\$cancelCap !== null && \$refundAmount > \$cancelCap \+ 0\.001/', $cm[1]) === 1);
    chk('…and says the figure, in the same words as the per-row refund',
        strpos($cm[1], 'is still refundable on this booking.') !== false);
    chk('an unreadable ledger still leaves it to Square rather than blocking a cancel',
        strpos($cm[1], '$cancelCap = null; // ledger unreadable') !== false);
} else {
    chk('the cancel block is present in bookings.php', false);
}

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail PAY-RAIL CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass PAY-RAIL CHECKS PASSED \u{2705}\n";
