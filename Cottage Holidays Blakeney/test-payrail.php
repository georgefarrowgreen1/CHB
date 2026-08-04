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

// ---- THE ASK AND ITS CHASE MUST QUOTE THE SAME SUM --------------------------
// The request and the reminder chase the SAME money and were composed
// independently. Measured before this: the request said "£340.00 will be charged
// to your card today" (rental + the refundable deposit, which pay.php really does
// bundle) while the reminder — the one sent again and again until they pay — said
// only "£290.00". Both are handed the same payload; the reminder ignored damages.
$payload = array_merge(bk('Square card', 50.0), ['paid' => 290.0]);
$askT = payment_request_body($payload, $URL, '#C79A64', $BANK);
$chaseT = payment_reminder_body($payload, $URL, '#C79A64', $BANK);
foreach ([['request', $askT], ['reminder', $chaseT]] as [$which, $m]) {
    chk("the $which names the balance itself (£290.00)", strpos($m['text'], '£290.00') !== false);
    chk("the $which says what the card will ACTUALLY take (£340.00)", strpos($m['text'], '£340.00') !== false);
    chk("the $which explains the deposit rather than just adding it on", stripos($m['text'], 'refundable security deposit') !== false);
    chk("the $which states what is ALREADY paid", strpos($m['text'], 'Already paid: £290.00') !== false);
    chk("…and the $which's HTML says it too", strpos($m['html'], '340.00') !== false && strpos($m['html'], '290.00') !== false);
}
// THE HEADLINE FIGURE IS WHAT THE GUEST ACTUALLY PAYS. Both emails led with the
// rental balance while the card takes balance + deposit, so the one number that
// mattered was the one shown at its own size NOWHERE — only in a sentence below
// the fold (owner's screenshot: a £290.00 hero over a £340.00 charge). The hero
// is the real sum now, with the split directly under it.
foreach ([['request', $askT], ['reminder', $chaseT]] as [$which, $m]) {
    // email_amount renders label / figure / sub in that order — the figure is
    // the one in the big serif block, so assert it by POSITION, not presence.
    $bigPos = strpos($m['html'], '£340.00');
    $smallPos = strpos($m['html'], '£290.00');
    chk("the $which's HEADLINE figure is the £340.00 the card takes",
        $bigPos !== false && $smallPos !== false && $bigPos < $smallPos);
    // The split names the stage in the sender's own words ("remaining balance"
    // in the request, "balance" in the chase) — what must hold is the sum.
    chk("…and the $which splits it right under the figure",
        preg_match('/£290\.00 (remaining )?balance \+ £50\.00 refundable deposit/', $m['html']) === 1);
    chk("…so the $which's CTA asks for the same sum, not the rental half",
        strpos($m['text'], 'pay £340.00') !== false);
    chk("…and the $which still states the stay total and what is paid",
        strpos($m['html'], 'Of £630.00 total, £290.00 already paid.') !== false);
}
// A REMINDER ON THE TRANSFER RAIL MUST NOT SAY "charged to your card". The
// request had its own rail-aware copy; the reminder used the shared tail, which
// hardcoded the card sentence — so a BACS guest was told their card would be
// charged. One rail-aware composer now serves both.
$bacsChase = payment_reminder_body(array_merge(bk('Bank transfer', 50.0), ['paid' => 290.0]), $URL, '#C79A64', $BANK);
chk('bacs reminder: never claims a card will be charged',
    strpos($bacsChase['text'], 'charged to your card') === false && strpos($bacsChase['html'], 'charged to your card') === false);
chk('bacs reminder: asks for the full sum to send (£340.00)', strpos($bacsChase['text'], '£340.00') !== false);

// …and with NO deposit outstanding neither invents one, nor claims a payment that
// has not happened: "£0.00 already paid" on a fresh ask is noise, not information.
$plain = bk('Square card', 0.0);
$askP = payment_request_body($plain, $URL, '#C79A64', $BANK);
$chaseP = payment_reminder_body($plain, $URL, '#C79A64', $BANK);
chk('no deposit → the request adds no deposit sentence', stripos($askP['text'], 'refundable security deposit') === false);
chk('no deposit → the reminder adds none either', stripos($chaseP['text'], 'refundable security deposit') === false);
chk('nothing paid yet → the request claims no payment', stripos($askP['text'], 'already paid:') === false);
chk('nothing paid yet → the reminder claims none either', stripos($chaseP['text'], 'already paid:') === false);

// ---- "ALREADY PAID" IS WHAT LEFT THE GUEST'S CARD, IN BOTH DEPOSIT ERAS -----
// Once the deposit has been CHARGED (it rides the first payment), `damages` is 0
// and `paid` is the rental rail — so the balance chase read "£175.00 already
// paid" of "£700.00 total" at a guest whose card took £225 and whose
// confirmation, receipt, invoice and My Stays all say £225 of £750 (reported
// with a screenshot — the one document telling a different story). The payload
// now carries deposit_charged, and payment_money_facts folds it into BOTH the
// stay total and the paid figure, so the balance itself is unmoved.
$charged = array_merge(bk('Square card', 0.0), [
    'kind' => 'balance', 'amount' => 525.0, 'total' => 700.0,
    'paid' => 175.0, 'deposit_charged' => 50.0,
]);
$askC = payment_request_body($charged, $URL, '#C79A64', $BANK);
$chaseC = payment_reminder_body($charged, $URL, '#C79A64', $BANK);
foreach ([['request', $askC], ['reminder', $chaseC]] as [$which, $m]) {
    chk("the $which counts the charged deposit in what is already paid (£225.00)",
        strpos($m['text'], 'Already paid: £225.00') !== false);
    chk("…the $which says the deposit is inside that figure",
        strpos($m['text'], '(including your £50.00 refundable deposit)') !== false);
    chk("…and the $which never claims the rental-rail £175.00 as the paid figure",
        strpos($m['text'], '£175.00') === false && strpos($m['html'], '175.00') === false);
}
chk('the request quotes the full £750.00 stay, not the £700.00 rental',
    strpos($askC['text'], 'full stay total is £750.00') !== false && strpos($askC['html'], '750.00') !== false);
chk('…and the balance asked for is unmoved — the deposit adds equally to both sides',
    strpos($askC['text'], '£525.00') !== false);
// The facts themselves: the two deposit eras land on the SAME stay total, so no
// email's figures depend on when it happened to be sent.
$fRiding = payment_money_facts(['amount' => 175.0, 'total' => 700.0, 'damages' => 50.0, 'paid' => 0.0]);
$fCharged = payment_money_facts(['amount' => 525.0, 'total' => 700.0, 'damages' => 0.0, 'paid' => 175.0, 'deposit_charged' => 50.0]);
chk('stay total agrees across the deposit eras (riding vs charged)',
    abs($fRiding['stayTotal'] - 750.0) < 0.005 && abs($fCharged['stayTotal'] - 750.0) < 0.005);
chk('…and the rental rail stays available raw for the callers that mean it',
    abs($fCharged['paidRental'] - 175.0) < 0.005 && abs($fCharged['paid'] - 225.0) < 0.005);
// THE WIRING, not just the composer: the checks above hand the builders a payload
// carrying deposit_charged themselves, so request_booking_payment simply not
// sending it left every one of them green while the real emails kept the rental
// rail — measured by deleting the payload line, which failed nothing until this.
$mailW = (string) file_get_contents(__DIR__ . '/mailer.php');
chk('request_booking_payment derives the charged deposit from the hold state',
    preg_match("/function request_booking_payment[\s\S]{0,2500}\\\$depCharged = in_array\(\(\\\$b\['hold_status'\][\s\S]{0,120}'charged', 'captured', 'kept'/", $mailW) === 1);
chk('…and actually sends it with the payload',
    preg_match("/function request_booking_payment[\s\S]{0,4000}'deposit_charged' => \\\$depCharged,/", $mailW) === 1);
// The pay screen is the same fact on a different surface (its balance view read
// "£175.00 already paid" of "£700.00 total" too) — the summary must carry it and
// the client must fold it into BOTH sides.
$payW = (string) file_get_contents(__DIR__ . '/pay.php');
chk('the pay-screen summary carries the charged deposit',
    preg_match("/'depositCharged' => in_array\(\\\$holdStatus, \['charged', 'captured', 'kept'\]/", $payW) === 1);
$appW = (string) file_get_contents(__DIR__ . '/app.js');
chk('…and the client folds it into the total AND the paid figure',
    strpos($appW, 'Number(s.total) + dep + depCharged') !== false
    && strpos($appW, 'Number(s.alreadyPaid || 0) + depCharged') !== false);
// A CASH deposit counts as paid in the confirmation's own derivation too —
// hold_status is a card-rail fact, and $rentalPaid caps at the total, so a
// re-sent confirmation for £750 handed over in cash read "Paid so far £700 ·
// Balance remaining £50" about a settled stay. Same arithmetic as
// damages_collected; JS mirror displayGrand (gated in smoke-test §9).
$bkW = (string) file_get_contents(__DIR__ . '/bookings.php');
chk('the confirmation credits a cash-collected deposit as paid',
    preg_match('/\$cashDep = \$holdStatus === .none.[\s\S]{0,220}\$paidSoFar = round\(\$rentalPaid \+ \$chargedDep \+ \$cashDep, 2\);/', $bkW) === 1);

// THE CONFIRMATION SAYS WHEN, NOT JUST HOW MUCH. It stated the outstanding sum
// and never the date, so a plan the owner had agreed with a guest lived only in
// the back office. send_booking_emails SENDS rather than returning a body, so
// this is a wiring scan like the one above — but of BOTH halves, because either
// alone is decoration: the payload must carry the booking's own derived date,
// and the composer must render it against a positive balance.
$mlW = (string) file_get_contents(__DIR__ . '/mailer.php');
chk('the confirmation payload carries the booking-derived due date',
    preg_match("/'balance_due_date' => booking_balance_due_date\(\\\$b\)/", $bkW) === 1);
chk('…and the composer renders it only when something is actually outstanding',
    preg_match('/\$balNow > 0\.001 && !empty\(\$b\[.balance_due_date.\]\)/', $mlW) === 1);
chk('…in the house date form, never a raw SQL stamp',
    preg_match("/due by ' \. uk_date\(\(string\) \\\$b\['balance_due_date'\]\)/", $mlW) === 1);
chk('…and an unpaid booking still gets the date (this email lands before any ask)',
    preg_match('/elseif \(\$balNow > 0\.001 && \$dueByLine !== ..\)/', $mlW) === 1);

// ---- THE CASH DEPOSIT CAN BE RECORDED AT ALL -------------------------------
// Every display of a cash-collected deposit was made consistent (paid-above-
// rental = the deposit) and then the audit found the state was UNREACHABLE:
// reconcile_deposit clamped 'paid' to exactly the rental total and refused a
// deposit-inclusive partial, so the £50 in the drawer could never enter
// deposit_paid — invisible to the deposits-to-return queue, the duty and the
// return flow (which already handles cash: no charge → a MANUAL return row).
// Four links, each scanned because bookings.php is an endpoint (requiring it
// exits) — and each break-tested by reverting the site, which fails exactly one.
chk('reconcile_deposit adds the collected deposit on the full settlement only',
    preg_match('/function reconcile_deposit\(\$status, \$total, \$currentDep, \$proposedDep, \$withDeposit = 0\.0\)[\s\S]{0,220}round\(\$total \+ max\(0\.0, \(float\) \$withDeposit\), 2\)/', $bkW) === 1);
chk('set_payment derives it from the booking, gated to the cash rail',
    preg_match('/\$withDep =\s*\n\s*!empty\(\$in\[.deposit_collected.\]\) && \(\$b\[.hold_status.\] \?\? .none.\) === .none./', $bkW) === 1
    && strpos($bkW, ", \$in['deposit'] ?? null, \$withDep)") !== false);
chk('the reconciler leaves headroom for it — a card event must not erase the deposit',
    preg_match('/\$cap =\s*\n\s*\(\$b\[.hold_status.\] \?\? .none.\) === .none.\s*\n\s*\? round\(\$total \+ max\(0\.0, \(float\) \(\$b\[.agreed_booking_fee.\] \?\? 0\)\), 2\)/', $bkW) === 1);
// THE LEDGER ROW SHOWS WHAT THE CARD TOOK. payments.amount is rental-only, so
// the hub's charge row read "Deposit · £175.00" for a card that took £225
// (screenshot-reported). The payments action flags the row hold_payment_id
// points at with the carried deposit; ui-test-hub drives the client render, but
// its stub IS the endpoint — this pins the server half (the helper-tested-alone
// trap). Kind-restricted so a damages_return row can never carry the flag.
$bkW3 = (string) file_get_contents(__DIR__ . '/bookings.php');
chk('the payments action flags the charge the deposit rode',
    preg_match("/\\\$r\['deposit_carried'\] =\s*\n\s*\\\$hpid !== '' && \(string\) \\\$r\['square_payment_id'\] === \\\$hpid && in_array\(\\\$r\['kind'\], \['deposit', 'balance'\], true\)/", $bkW3) === 1);
$admW = (string) file_get_contents(__DIR__ . '/admin.js');
chk('Record Payment offers the deposit as a yes/no and sends the flag only on paid',
    strpos($admW, "vals.withdep === 'yes' && status === 'paid') payload.deposit_collected = true") !== false
    && preg_match('/askDep = dmg > 0 && \(booking\.holdStatus \|\| .none.\) === .none./', $admW) === 1);
// …and returning that cash deposit must NEVER refund a card charge: hold_status
// 'none' means the deposit was recorded by hand, so return_deposit records a
// MANUAL return instead of falling through to find_charge_for_refund — which, on
// a booking that also carries rental card rows, would push the guest's cash back
// onto their card. Break-tested by restoring the unconditional fallthrough.
chk('a hand-recorded deposit returns MANUALLY, never against a rental card charge',
    preg_match("/\(\\\$hs === 'none' \? null : find_charge_for_refund\(\\\$id, \\\$amount\)\)/", $bkW2 = (string) file_get_contents(__DIR__ . '/bookings.php')) === 1);
// ONE ask derivation: pay.php's summary/charge preamble used to re-derive the
// total/paid/due inline — a second copy of booking_amount_due's arithmetic, the
// two-copies shape behind most of this file's history. Break-tested by restoring
// the inline derivation.
$payW2 = (string) file_get_contents(__DIR__ . '/pay.php');
chk('pay.php asks booking_amount_due instead of re-deriving the ask',
    preg_match('/\$amt = booking_amount_due\(\$b, \$kind === .hold. \? .deposit. : \$kind\);/', $payW2) === 1
    && strpos($payW2, "\$amountDue = \$amt['due'];") !== false);
chk('…keeping the under-lock recompute its own deposit figure (retry safety)',
    // The figure now comes from booking_deposit_amount (the per-booking plan's
    // one derivation) — reverting to the global-pct round() would let the charge
    // disagree with the ask whenever a custom deposit is set.
    preg_match('/\$depositAmount = booking_deposit_amount\(\$b, \$total\);/', $payW2) === 1
    && preg_match('/\$depositAmount = round\(\$total \* \(\$depPct \/ 100\), 2\);/', $payW2) === 0
    && strpos($payW2, 'round(max(0, $depositAmount - $nowPaid), 2)') !== false);
// The figure was computed and thrown away — the payload has to carry it or no
// email can state it.
$mailS = file_get_contents(__DIR__ . '/mailer.php');
chk('the payload carries alreadyPaid through to the emails',
    preg_match("/'paid' => \\\$amt\\['alreadyPaid'\\]/", $mailS) === 1);

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
    // $reqKind since the link stopped naming a stage — the request's kind is a
    // hint the derivation may override, never the answer.
    strpos($pay, 'booking_payment_kind($b, $reqKind)') !== false);
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
// The pay screen now takes the shared figure THROUGH booking_amount_due (the
// stage-1 overhaul deleted its inline copy), so the claim is the delegation —
// the helper's own booking_paid_so_far read is pinned two lines below.
chk('the pay screen QUOTES the shared figure (via booking_amount_due)',
    strpos($payS, "\$alreadyPaid = \$amt['alreadyPaid'];") !== false);
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
    preg_match("/UPPER\\(status\\) NOT IN \\('COMPLETED','FAILED','REJECTED','MANUAL'\\)/", $rcS) === 1);
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

// ---- DON'T SEND IT TWICE ---------------------------------------------------
// Two layers, because neither is enough alone. The client disables the control whose
// handler is still running — but that does not survive a reload mid-request or a second
// device, which arrive as genuinely new requests. So anything that puts a message in
// front of a GUEST also asks the ledger of what has already been sent, and refuses a
// repeat inside a short window.
// There is deliberately NO third layer coalescing identical in-flight POSTs: apiPost is
// the app's only POST channel and serves reads too, so that guard could answer a read
// issued after a state change with one issued before it. Asserted below so it cannot
// come back by accident.
echo "\n== Don't send it twice ==\n";
chk('there is a shared "have we just sent this?" question', function_exists('recent_send_at'));
chk('the window is a real number of seconds, not zero', CHB_RESEND_GUARD_SECONDS > 0);
// Deliberately a WINDOW, not a permanent lock: chasing the same balance again next week
// is necessary. Only the second copy in the same breath is never wanted.
chk('…and short enough that a legitimate later chase is unaffected', CHB_RESEND_GUARD_SECONDS <= 900);
// The refusal wording is what the owner reads, so it has to be a sentence.
chk('"just now" for something seconds old', chb_ago('2026-01-01 12:00:00', strtotime('2026-01-01 12:00:20')) === 'just now');
chk('a minute reads as a minute', chb_ago('2026-01-01 12:00:00', strtotime('2026-01-01 12:01:00')) === 'a minute ago');
chk('two minutes reads as two', chb_ago('2026-01-01 12:00:00', strtotime('2026-01-01 12:02:10')) === '2 minutes ago');
chk('an unparseable timestamp still says something sensible', chb_ago('not a date') === 'just now');
$bkS2 = (string) file_get_contents(__DIR__ . '/bookings.php');
$dbS2 = (string) file_get_contents(__DIR__ . '/db.php');
chk('there is ONE composer for the refusal, so the call sites cannot drift',
    function_exists('resend_guard'));
chk('the payment request asks before emailing a second one',
    preg_match("/resend_guard\(\\\$id, 'payment\.request'/", $bkS2) === 1);
// The arrival email is the app's other BULK send, and its content is generated from the
// booking — so a second copy in the same breath is never a different message.
chk('so does the arrival email — the other send that goes over a whole set',
    preg_match("/resend_guard\(\\\$id, 'email\.arrival'/", $bkS2) === 1);
// NOT the confirmation, and that is a decision: add booking → record deposit → confirm
// fires two confirmations within a minute or two which say DIFFERENT things, so a window
// there would refuse a genuinely different message. Assert the reason is on the record,
// or the omission reads as an oversight to whoever audits this next.
chk('the confirmation is deliberately NOT guarded, and says why',
    strpos($bkS2, 'DELIBERATELY NOT resend_guard()ed') !== false
    && preg_match("/resend_guard\(\\\$id, 'email\.confirmation'/", $bkS2) === 0);
chk('…and the refusal names the guest and when it went, rather than failing silently',
    preg_match('/has just gone to \' \. \(\$who.*chb_ago\(\$already\)/s', $dbS2) === 1);
// THE REFUSAL HAS TO REACH THE OWNER. It answered 200 with an `error` key, and apiPost
// only throws on a non-2xx — so nothing inspected it: requestPayment toasted "Balance
// request sent — £NaN" and the bulk report counted it as sent and added its balance to
// the chased total. Both measured in a browser; ui-test-command drives them.
chk('a refused repeat comes back as a real status, not a 200 nobody inspects',
    preg_match("/'code' => 'already_sent',\s*\]\, 409\)/", $dbS2) === 1);
chk('…and carries a code, so a caller can tell "already went" from "failed"',
    strpos($dbS2, "'already_sent'") !== false);
// A MAIL FAILURE IS A FAILURE, in every send. Three of the four answered 200 with an
// `error` key — and apiPost only throws on a non-2xx, so a caller that did not hand-check
// the body reported a send that never happened: the inline balance action rendered a green
// "Balance request sent to Sarah" strip off previewAndSendEmail's boolean while a
// glassAlert said the opposite, requestPayment toasted "£NaN", and the bulk report counted
// it. send_arrival had always used 500; the others match it now.
chk('every send reports a mail failure with a failing status, not a 200',
    preg_match_all("/Email failed to send'\], 500\)/", $bkS2) === 3
    && preg_match_all("/Email failed to send'\], 200\)/", $bkS2) === 0
    // Single-quoted: in a double-quoted PHP string `\\$reason` is a backslash followed by
    // an INTERPOLATED variable, so the pattern silently became "…=> , 'email' => …".
    && preg_match('/\'error\' => \$reason, \'email\' => \$result\], 500\)/', $bkS2) === 1);
// The guard reads a log; if the log cannot be read it must not block a send the owner
// is asking for — a duplicate email is a smaller failure than being unable to chase.
chk('an unreadable log lets the send through rather than blocking it',
    preg_match('/function recent_send_at.*?catch.*?return \x27\x27;/s', $dbS2) === 1);
$appS = (string) file_get_contents(__DIR__ . '/app.js');
// The ratchet against reintroduction. apiPost carries reads (`email_logs`, `history`,
// `deposit_returns`, `recent_payments`), so a same-request-in-flight cache here can serve
// a pre-change answer to a post-change read — the failure it was meant to prevent, in
// reverse. If a future send genuinely needs collapsing, do it at the intent, not here.
chk('apiPost does not answer one POST with another one already in flight',
    strpos($appS, '__chbWriteInFlight') === false);
chk('…and the reason is recorded where the next reader will look',
    strpos($appS, 'NO IN-FLIGHT COALESCING HERE') !== false);
chk('a button whose handler is still running is disabled and announced busy',
    strpos($appS, "el.setAttribute('aria-busy', 'true')") !== false
    && preg_match("/r && typeof r\.then === 'function' && el\.tagName === 'BUTTON'/", $appS) === 1);
chk('apiPost carries the endpoint\'s code through, so the refusal is distinguishable',
    preg_match('/code: code \? String\(code\) : \x27\x27/', $appS) === 1
    && preg_match("/throw apiErr\(data\.error \|\| .*, res\.status, data\.code\)/", $appS) === 1);
// previewAndSendEmail returned whether the owner CONFIRMED and called it "sent" — so an
// inline act strip claimed success for a send that had failed or been refused, since the
// doSend callbacks handle their own errors and nothing threw here to notice.
chk('the preview-and-send helper reports the SEND, not the confirmation',
    preg_match('/went = \(await opts\.doSend\(\)\) !== false;/', $appS) === 1);
$adS = (string) file_get_contents(__DIR__ . '/admin.js');
chk('the bulk report separates "already had it" from "couldn\'t reach"',
    strpos($adS, "if (e && e.code === 'already_sent') already.push(x);") !== false
    && strpos($adS, 'already had theirs') !== false);

// ---- CONFIRMING A REFUND HAS ACTUALLY GONE --------------------------------
// Square's API lags what the owner can see on their own statement: a deposit refund
// taken out of the Square balance read "not yet confirmed settled here" for days while
// the money was demonstrably gone. The owner can now say so. The danger is the
// opposite one — under-fencing is how an account goes short — so the interesting
// checks here are the things it REFUSES to do.
echo "\n== Confirming a refund has gone ==\n";
chk('there is one definition of a DECIDED status', function_exists('payment_status_terminal'));
chk('settled and hand-settled are both decided',
    payment_status_terminal('COMPLETED') && payment_status_terminal('MANUAL'));
// FAILED/REJECTED are decided but NOT settled — the money did not go. Both facts
// matter: nothing may resurrect them as pending, and nothing may count them as returned.
chk('a failed refund is decided too, so nothing resurrects it as pending',
    payment_status_terminal('FAILED') && payment_status_terminal('REJECTED'));
chk('…but PENDING is not decided', !payment_status_terminal('PENDING'));
chk('an unknown value is not decided either', !payment_status_terminal('') && !payment_status_terminal('WHATEVER'));

$bkS3 = (string) file_get_contents(__DIR__ . '/bookings.php');
chk('the confirm action exists and is admin-only',
    preg_match("/action === 'confirm_return_settled'[\s\S]{0,200}require_admin\(\)/", $bkS3) === 1);
// The three things it must not do, all expressed in the one WHERE clause.
chk('…it only ever touches damages_return rows, never a rental charge',
    preg_match("/confirm_return_settled[\s\S]{0,1600}UPDATE payments SET status = 'MANUAL'[\s\S]{0,200}kind = 'damages_return'/", $bkS3) === 1);
chk('…and cannot resurrect a FAILED refund as settled',
    preg_match("/confirm_return_settled[\s\S]{0,1600}UPDATE payments SET status = 'MANUAL'[\s\S]{0,300}NOT IN \('COMPLETED','MANUAL','FAILED','REJECTED'\)/", $bkS3) === 1);
chk('…and it is logged as the owner\'s own assertion, not as something Square said',
    strpos($bkS3, 'deposit.confirm_settled') !== false && strpos($bkS3, 'confirmed settled by hand') !== false);

// THE CONFIRMATION HAS TO SURVIVE. Without these it would be undone within the hour:
// the poller re-asks Square, Square still says PENDING, and the row goes back to
// unsettled — a button that appears to work and quietly reverses itself.
$recS = (string) file_get_contents(__DIR__ . '/payments-reconcile.php');
chk('the poller does not re-ask about a hand-confirmed refund',
    strpos($recS, "NOT IN ('COMPLETED','FAILED','REJECTED','MANUAL')") !== false);
chk('…and refuses to write over a decided row even if one settles mid-poll',
    strpos($recS, '!payment_status_terminal(') !== false);
$hookS = (string) file_get_contents(__DIR__ . '/square-webhook.php');
chk('the refund webhook cannot downgrade a decided row either (events arrive out of order)',
    strpos($hookS, 'payment_status_terminal($refund[\'status\'])') !== false
    && strpos($hookS, "NOT IN ('COMPLETED','MANUAL','FAILED','REJECTED')") !== false);

// ---- A CUSTOM PRICE RENDERS AS ONE COHERENT LINE ---------------------------
// price_override (and an enquiry's agreed price) replace the rental TOTAL while
// per_night/nightly/tx_fee stay the standard snapshot — so the confirmation went
// out reading "£130.00 × 7 nights: £910.00 / fee £0.00 / Total £750.00": lines
// that cannot add up to their own total, on the guest's own document (reported
// with a screenshot). booking_price_is_custom (db.php) is the ONE decision; when
// true, every renderer prints an "Agreed price" line instead of the per-night +
// fee pair. JS mirror: priceIsCustom (app.js), gated in smoke-test.
chk('standard snapshot: lines explain the total, nothing is relabelled',
    booking_price_is_custom(910.00, 0.00, 910.00) === false);
chk('an override below the itemised sum is custom (the screenshot case)',
    booking_price_is_custom(910.00, 0.00, 700.00) === true);
chk('…and one above it is custom too — direction does not matter',
    booking_price_is_custom(650.00, 13.00, 700.00) === true);
chk('an override typed EQUAL to the standard price keeps the standard lines',
    booking_price_is_custom(686.27, 13.73, 700.00) === false);
chk('a half-penny of float noise is not a custom price',
    booking_price_is_custom(233.3333, 466.6667, 700.00) === false);
// THE WIRING. The helper alone proves nothing — both the text and HTML halves of
// the confirmation, and the invoice, must consult it (each break-tested by
// reverting the call site, which fails exactly one of these).
$mailS2 = (string) file_get_contents(__DIR__ . '/mailer.php');
chk('the confirmation decides custom-vs-standard once, via the shared helper',
    preg_match('/\$customPrice = booking_price_is_custom\(/', $mailS2) === 1);
chk('…the plain-text body branches on it',
    preg_match('/\$customPrice[\s\S]{0,700}Agreed price for your stay \(\{\$nightsTxt\}\)/', $mailS2) === 1);
chk('…and the HTML price box does too, not just the text half',
    preg_match('/\$customPrice\s*\n?\s*\?\s*\$pr\(\'Agreed price for your stay/', $mailS2) === 1);
$invS = (string) file_get_contents(__DIR__ . '/invoice.php');
chk('the server invoice takes the same branch — one booking, one shape of document',
    preg_match('/booking_price_is_custom\([\s\S]{0,200}Agreed price for your stay/', $invS) === 1);
// …AND A CUSTOM PRICE STILL FOLLOWS THE PAYMENT PROCEDURE. Rendering was the
// defect; these pin that the MONEY never had it: both places that derive an ask
// resolve price_override into the total BEFORE the deposit-percentage and
// balance maths, so deposit-then-balance (and the in-window full-amount upgrade,
// gated above) stage off the agreed figure. Order is the claim — an override
// applied after the pct line would quote a deposit off the wrong total. The
// client half is behavioural, in smoke-test (mapBookingFromApi →
// paymentSummary/bookingDue: £700 override → £175-shaped deposit staging, £525
// balance, settled at £700 with the £910 snapshot never owed).
$priS = (string) file_get_contents(__DIR__ . '/pricing.php');
// DRIVEN, not scanned. This was a source regex measuring CHARACTER DISTANCE
// between `price_override` and the deposit line, so an unrelated edit inside the
// function broke it while the claim stayed true — the shape this file has been
// replacing all along. The claim is that the override resolves into $total
// BEFORE the deposit share is taken of it: 25% of a £700 override is £175, not
// £227.50 (25% of the £910 snapshot it replaced).
$ovr = [
    'id' => 0, 'prop_key' => 'jollyboat', 'check_in' => date('Y-m-d', strtotime('+200 days')),
    'check_out' => date('Y-m-d', strtotime('+207 days')), 'adults' => 2, 'children' => 0,
    'agreed_total' => 910.0, 'price_override' => 700.0, 'deposit_paid' => 0.0,
    'deposit_pct_override' => 25.0, 'deposit_amount_override' => null, 'balance_due_date' => null,
    'damages_deposit' => 0.0, 'hold_status' => 'none', 'hold_amount' => 0.0,
];
$ovrDue = booking_amount_due($ovr, 'deposit');
chk('booking_amount_due asks off the override-resolved total (£' . number_format((float) ($ovrDue['due'] ?? 0), 2) . ')',
    abs((float) $ovrDue['due'] - 175.0) < 0.005);
chk('...and never off the snapshot the override replaced',
    abs((float) $ovrDue['due'] - 227.5) > 0.005);
chk('...with the balance the whole overridden stay',
    abs((float) booking_amount_due($ovr, 'balance')['due'] - 700.0) < 0.005);
$payS2 = (string) file_get_contents(__DIR__ . '/pay.php');
// Stage-1 overhaul: the override resolution moved INSIDE booking_amount_due
// (pinned above); pay.php's claim is now that its total IS the helper's.
chk('pay.php charges off the same override-resolved total (delegated)',
    preg_match('/\$amt = booking_amount_due\(\$b,[\s\S]{0,120}\$total = \$amt\[.total.\];/', $payS2) === 1);
// AND THE RENTAL FLOOR FOLLOWS THE OVERRIDE IN BOTH DIRECTIONS. It used to be
// max()'d in, which is wrong in the direction overrides are actually used — a
// DISCOUNT: agreed £700 against a £910 snapshot, £750 paid in cash, and
// damages_collected read paid − rental as negative, so the £50 deposit the owner
// was genuinely holding reported as NOT collected (never listed to return,
// unreturnable — return_deposit caps at £0) while accounts.php counted it as
// taxable rental income. The card rail dodged it (hold_status 'charged' short-
// circuits before the rental maths), which is why it survived: only cash/BACS
// bookings with a discounted agreed price ever hit this branch.
$ovb = ['agreed_nightly' => 910.0, 'agreed_txn_fee' => 0.0];
chk('a discounted override IS the rental price, not a floor under the snapshot',
    abs(booking_rental_price($ovb + ['price_override' => 700.0]) - 700.0) < 0.005);
chk('…a raised override still wins exactly as before',
    abs(booking_rental_price($ovb + ['price_override' => 1200.0]) - 1200.0) < 0.005);
chk('…and no override keeps the snapshot sum',
    // array_merge, NOT `+`: the union operator keeps the LEFT side's keys, so
    // `$ovb + [...]` silently discarded the fee this case exists to add.
    abs(booking_rental_price(array_merge($ovb, ['agreed_txn_fee' => 13.5])) - 923.5) < 0.005);
chk('…an empty-string override (unset form field) is no override',
    abs(booking_rental_price($ovb + ['price_override' => '']) - 910.0) < 0.005);
// The consequence, in damages_collected's own arithmetic (its 'none' branch is
// min(agreed deposit, paid − rental)): the £50 cash deposit is collectable again.
$cashPaid = 750.0;
$collected = max(0.0, min(50.0, $cashPaid - booking_rental_price($ovb + ['price_override' => 700.0])));
chk('the £50 cash deposit on a discounted booking reads as collected', abs($collected - 50.0) < 0.005);
// …and a legacy override with the deposit folded IN still cannot over-return:
// paid equals the override there, so nothing sits above the rental.
$legacy = max(0.0, min(50.0, 700.0 - booking_rental_price($ovb + ['price_override' => 700.0])));
chk('…while a deposit-folded legacy override still collects £0 (no over-return)', $legacy === 0.0);

// ---- THE RECEIPT AND THE DEPOSIT-RETURN EMAIL, pinned -----------------------
// The full payment-email sweep found both composing coherent figures — and
// carrying ZERO gate coverage, so that coherence was one edit from silently
// gone. The receipt's two load-bearing facts: its HEADLINE is what the card
// took (amount + deposit_charged — the ledger-row lesson, £175 shown for a
// £225 charge, must not recur here), and its paid-so-far line stays LABELLED
// "Rental" beside its own rental total (coherent because labelled — the frame
// is fine exactly as long as it says which frame it is).
$mailR = (string) file_get_contents(__DIR__ . '/mailer.php');
// DRIVEN, not read. These two were source scans against send_payment_receipt,
// and splitting the pure composer out from the sender moved the lines they
// pointed at — which is the weakness of the shape, not an accident of this
// edit: a scan proves an ingredient is present, never that it is used. A £300
// rental beside a £50 refundable deposit is the £175-shown-for-a-£225-charge
// case, and it must read £350.
$rHead = payment_receipt_body([
    'name' => 'Cara Lyon', 'email' => 'c@example.com', 'prop_key' => 'jollyboat', 'prop_name' => 'Jollyboat',
    'ref' => 'CHB-000042', 'kind' => 'deposit', 'amount' => 300.0, 'total' => 700.0,
    'paid_so_far' => 300.0, 'balance' => 400.0, 'fully_paid' => false, 'deposit_charged' => 50.0,
]);
chk("the receipt's headline is what the card took, not the rental portion",
    strpos($rHead['text'], '£350.00') !== false && strpos($rHead['html'], '£350.00') !== false);
chk('…and the refundable deposit is named as the difference', strpos($rHead['text'], 'refundable damage deposit of £50.00') !== false);
// Coherent because LABELLED: the paid-so-far line is the rental rail beside its
// own rental total, and saying which frame it is, is what makes that fine.
chk('…and its paid-so-far line is labelled as the RENTAL rail',
    strpos($rHead['text'], 'Rental paid so far: £300.00 of £700.00') !== false
    && strpos($rHead['html'], 'Rental paid so far') !== false);
// The deposit-return email: a PARTIAL return must state what was retained (the
// difference against what was held, with the reason), and a hand-recorded
// return must not say "to the card you paid with" — the manual flag carries
// the honest wording, wired from return_deposit's own MANUAL outcome.
chk('a partial deposit return states the retained difference',
    preg_match("/function send_deposit_return_email[\s\S]{0,700}\\\$retained = round\(max\(0, \\\$held - \(float\) \\\$b\['amount'\]\), 2\);/", $mailR) === 1);
chk('…and a manual return never claims the card rail',
    preg_match("/function send_deposit_return_email[\s\S]{0,900}!empty\(\\\$b\['manual'\]\) \? 'by the method we agreed' : 'to the card you paid with'/", $mailR) === 1
    && strpos($bkW3, "'manual' => \$status === 'MANUAL',") !== false);

echo "\n== The per-booking payment plan (migration-103) ==\n";
// booking_deposit_amount — the ONE deposit derivation. Pure paths only here (the
// default path falls to square_deposit_pct(), which needs the DB — its wiring is
// pinned by scan below and driven for real in test-integration).
chk('a 30% override on £890 asks £267.00', booking_deposit_amount(['deposit_pct_override' => 30], 890.0) === 267.0);
chk('a fixed £300 override asks exactly that', booking_deposit_amount(['deposit_amount_override' => 300], 890.0) === 300.0);
chk('a fixed override larger than the stay is capped at the total (a typo, not a plan)',
    booking_deposit_amount(['deposit_amount_override' => 1000], 890.0) === 890.0);
chk('the fixed amount wins when both are somehow stored (set_payment_plan refuses both, reads stay deterministic)',
    booking_deposit_amount(['deposit_amount_override' => 300, 'deposit_pct_override' => 30], 890.0) === 300.0);
chk('pence stay exact (12.5% of £333 → £41.63)', booking_deposit_amount(['deposit_pct_override' => 12.5], 333.0) === 41.63);
$priS3 = (string) file_get_contents(__DIR__ . '/pricing.php');
chk('an out-of-range pct is "not set", never a 0% ask (source: the (0,100] gate falls through to the site pct)',
    preg_match('/function booking_deposit_amount[\s\S]{0,700}\$pct > 0 && \$pct <= 100[\s\S]{0,300}square_deposit_pct\(\)/', $priS3) === 1);

// booking_balance_due_date + the window it drives. A CUSTOM date is "due BY that
// day" (inclusive — the day the owner named is the day the full amount is
// asked); the STANDARD path keeps its original strict boundary, gated both
// sides elsewhere in this file.
$today = date('Y-m-d');
chk('a custom due date is returned verbatim', booking_balance_due_date(['balance_due_date' => '2027-09-14', 'check_in' => '2027-09-28']) === '2027-09-14');
chk('no plan → check-in minus the window', booking_balance_due_date(['check_in' => date('Y-m-d', strtotime('+40 days'))]) === date('Y-m-d', strtotime('+10 days')));
chk('no check-in and no plan → null (nothing to anchor on)', booking_balance_due_date([]) === null);
$cin = date('Y-m-d', strtotime('+60 days')); // far out, so the standard window never interferes
chk('custom due YESTERDAY → inside the window (full amount due)',
    booking_within_balance_window(['check_in' => $cin, 'balance_due_date' => date('Y-m-d', strtotime('-1 day'))]) === true);
chk('custom due TODAY → inside (due BY today means today)',
    booking_within_balance_window(['check_in' => $cin, 'balance_due_date' => $today]) === true);
chk('custom due TOMORROW → outside (the owner said hold off)',
    booking_within_balance_window(['check_in' => $cin, 'balance_due_date' => date('Y-m-d', strtotime('+1 day'))]) === false);
chk('…so the pay-in-full upgrade moves with the plan: a deposit link opened on the custom due date charges everything',
    booking_payment_kind(['check_in' => $cin, 'balance_due_date' => $today], 'deposit') === 'balance');
chk('…and stays a deposit the day before it', booking_payment_kind(['check_in' => $cin, 'balance_due_date' => date('Y-m-d', strtotime('+1 day'))], 'deposit') === 'deposit');

// A MOVED BOOKING TAKES ITS PLAN WITH IT (booking_replan_on_move).
// The defect this exists for, stated as its own case: `update` writes check_in
// and used to leave the custom date behind, so a booking could be MOVED INTO the
// state set_payment_plan refuses. Reproduced before the fix: a guest who arrived
// five days ago, with a due date three weeks out, read within_window FALSE — so
// the app asked a guest standing in the cottage for a deposit, and the chaser
// would not have chased the balance until after they had gone home.
$mvIn = date('Y-m-d', strtotime('+92 days'));
$mvDue = date('Y-m-d', strtotime('+62 days'));   // 30 days before arrival, as agreed
$mvNew = date('Y-m-d', strtotime('+32 days'));   // the stay is pulled 60 days earlier
$mv = booking_replan_on_move($mvIn, $mvNew, $mvDue);
chk('a moved stay takes its due date with it — the INTERVAL was the agreement',
    $mv['due'] === date('Y-m-d', strtotime('+2 days')) && $mv['changed'] === true && $mv['reason'] === 'shifted');
chk('…so the re-anchored date is still on or before the new check-in', $mv['due'] <= $mvNew);
chk('…and the invariant holds for a stay pushed LATER too',
    booking_replan_on_move($mvIn, date('Y-m-d', strtotime('+150 days')), $mvDue)['due'] === date('Y-m-d', strtotime('+120 days')));
chk('a stay moved so far forward the date would be behind us drops to the site standard, not an impossible plan',
    booking_replan_on_move($mvIn, date('Y-m-d', strtotime('+5 days')), $mvDue) === ['due' => null, 'changed' => true, 'reason' => 'past']);
chk('no custom date → nothing to re-anchor', booking_replan_on_move($mvIn, $mvNew, null)['changed'] === false);
chk('dates unchanged → nothing to re-anchor', booking_replan_on_move($mvIn, $mvIn, $mvDue)['changed'] === false);
// Defensive: a legacy row already out of shape is clamped rather than carried further out.
chk('a due date already past check-in is clamped to check-in, never left beyond it',
    booking_replan_on_move($mvIn, date('Y-m-d', strtotime('+95 days')), date('Y-m-d', strtotime('+99 days')))['due'] === date('Y-m-d', strtotime('+95 days')));
// WIRING — the update action must actually call it, or the helper is decoration.
$upSrc = file_get_contents(__DIR__ . '/bookings.php');
chk('bookings.php update calls booking_replan_on_move', strpos($upSrc, 'booking_replan_on_move(') !== false);
chk('…and persists the result to balance_due_date', strpos($upSrc, ",balance_due_date=?';") !== false);

// WIRING — the chaser follows the booking's own date in SQL (the COALESCE is
// booking_balance_due_date's SQL form; for a NULL plan it is byte-for-byte the
// old interval condition), and the two passes stay mutually exclusive: the
// request fires ON/AFTER the due date, the deposit recovery only BEFORE it.
$pdS = (string) file_get_contents(__DIR__ . '/payments-due.php');
chk('the balance request pass waits for the booking\'s own due date',
    preg_match('/balance_requested_at IS NULL[\s\S]{0,300}COALESCE\(balance_due_date, DATE_SUB\(check_in, INTERVAL \? DAY\)\) <= CURDATE\(\)/', $pdS) === 1);
chk('the abandoned-deposit recovery stays strictly BEFORE it (mutually exclusive by construction)',
    preg_match('/deposit_requested_at IS NOT NULL[\s\S]{0,400}COALESCE\(balance_due_date, DATE_SUB\(check_in, INTERVAL \? DAY\)\) > CURDATE\(\)/', $pdS) === 1);

// WIRING — set_payment_plan's refusals, each a different way the plan could lie:
// both deposit forms at once, a share over 100%, a deposit bigger than the stay,
// a date already gone, a date after arrival. And the store is parameterised
// against the three columns in one statement.
// payment_plan_parse now lives in pricing.php — bookings.php is a ROUTED
// endpoint, so enquiry approval could not have reached the validator there
// without running its routing. The refusals are scanned where they live; the
// CALL SITES are asserted separately below, which is what stops the move from
// quietly orphaning one of them.
$plPlan = (string) file_get_contents(__DIR__ . '/pricing.php');
$bkPlan = (string) file_get_contents(__DIR__ . '/bookings.php');
$eaPlan = (string) file_get_contents(__DIR__ . '/enquiry-actions.php');
chk('set_payment_plan refuses both deposit forms at once', strpos($plPlan, 'not both') !== false);
chk('…a percentage outside (0,100]', strpos($plPlan, 'must be between 0 and 100') !== false);
chk('…a deposit larger than the stay', strpos($plPlan, 'more than the stay costs') !== false);
chk('…a due date already gone', strpos($plPlan, 'due date has already passed') !== false);
chk('…and one after check-in', strpos($plPlan, 'by check-in') !== false);
// THREE call sites, ONE validator: the Add form, the hub's Edit-plan dialog and
// now enquiry approval must all refuse the same things in the same words.
chk('bookings.php still routes its two plan writes through it', substr_count($bkPlan, 'payment_plan_parse(') === 2);
chk('…and enquiry approval uses the SAME validator, not a second one',
    strpos($eaPlan, 'payment_plan_parse(') !== false);
chk('…parsing BEFORE the lock, so a refusal (which json_out-EXITS) cannot strand the calendar',
    strpos($eaPlan, 'payment_plan_parse(') < strpos($eaPlan, "if (!book_lock(\$e['prop_key']))"));
chk('…and the approval INSERT carries the three plan columns',
    strpos($eaPlan, 'deposit_pct_override,deposit_amount_override,balance_due_date') !== false);
chk('the plan stores all three fields in one parameterised write',
    strpos($bkPlan, 'SET deposit_pct_override = ?, deposit_amount_override = ?, balance_due_date = ? WHERE id = ?') !== false);

// WIRING — the manual reminder: rides request_payment with reminder wording
// (the same third argument the cron's reminder pass passes), is refused before
// anything has been asked for, and stamps balance_reminded_at so the cron's own
// reminders space off it.
chk('a reminder is refused before any request has gone', strpos($bkPlan, 'Nothing has been asked for yet') !== false);
chk('the manual reminder sends the reminder composer, not a fresh ask',
    preg_match('/\$res = request_booking_payment\(\$b, \$kind, \$isReminder\);/', $bkPlan) === 1);
chk('…and stamps balance_reminded_at', preg_match('/if \(\$isReminder\) \{[\s\S]{0,120}SET balance_reminded_at = NOW\(\)/', $bkPlan) === 1);
chk('a manual deposit ask arms the recovery stamp without clobbering the first one',
    strpos($bkPlan, 'SET deposit_requested_at = COALESCE(deposit_requested_at, NOW())') !== false);

// The guest pay screen states WHEN the balance is due, from the booking's own
// plan — the summary must carry booking_balance_due_date (custom date wins,
// else standard), or the client line is decoration with no data.
chk('the pay summary carries the plan-derived due date',
    strpos((string) file_get_contents(__DIR__ . '/pay.php'), "'balanceDueDate' => booking_balance_due_date(") !== false);

// ---- ONE pay link: no stage in the URL, the stage read off the booking -------
//
//  A pay URL used to end &k=deposit or &k=balance — a claim about the booking
//  made when the email was SENT, and stale the moment anything was paid. The
//  link now names no stage and booking_payment_kind reads it off the booking on
//  open, so ONE link asks for whatever the plan wants next and keeps up as the
//  plan moves on. Measured before the change: a 60-day-out booking whose £200
//  deposit was already settled resolved to 'deposit', due £0.00 — the guest
//  reopening their own link got a £0 payment screen instead of their balance.
echo "\n== One pay link (stage derived, never in the URL) ==\n";
$payB = function ($daysOut, $paid, $due = null) {
    return [
        // NO id: booking_paid_so_far consults the card LEDGER for a real one, and
        // db() exits rather than throwing, so an id would take this suite to a
        // database it deliberately does not have. Without one it reads
        // deposit_paid, which is exactly the figure these cases are about.
        'prop_key' => 'jollyboat', 'adults' => 2, 'children' => 0,
        'check_in' => date('Y-m-d', strtotime("+$daysOut days")),
        'check_out' => date('Y-m-d', strtotime('+' . ($daysOut + 3) . ' days')),
        // A per-booking 25% plan rather than the site default: identical
        // arithmetic (£200 of £800), and it keeps this suite off the database —
        // square_deposit_pct() reads the content table, and db() EXITS rather
        // than throwing, so there would be nothing to catch.
        'balance_due_date' => $due, 'deposit_pct_override' => 25.0, 'deposit_amount_override' => null,
        'agreed_total' => 800.0, 'price_override' => null, 'deposit_paid' => $paid,
    ];
};
// The stage moves with the money, with NO hint at all — this is the link.
chk('nothing paid, well outside the window -> deposit', booking_payment_kind($payB(60, 0)) === 'deposit');
chk('deposit settled, still outside the window -> balance (the link keeps up)', booking_payment_kind($payB(60, 200)) === 'balance');
chk('inside the balance window -> balance whatever is paid', booking_payment_kind($payB(10, 0)) === 'balance');
// …and the FIGURE follows the stage, which is the whole point.
$k = booking_payment_kind($payB(60, 200));
chk('…and that link asks for the remaining £600, not a settled £0',
    abs(booking_amount_due($payB(60, 200), $k)['due'] - 600.0) < 0.005);
chk('the old behaviour is what it replaces (a bare deposit hint still reads £0)',
    abs(booking_amount_due($payB(60, 200), 'deposit')['due'] - 0.0) < 0.005);
// MONOTONIC: no route makes a link ask for LESS than it did.
chk('a fresh booking is unchanged — deposit, £200', booking_payment_kind($payB(60, 0)) === 'deposit'
    && abs(booking_amount_due($payB(60, 0), 'deposit')['due'] - 200.0) < 0.005);
chk('an explicit balance ask (Pay in full) is honoured outside the window', booking_payment_kind($payB(60, 0), 'balance') === 'balance');
chk('the legacy hold flow passes through untouched', booking_payment_kind($payB(60, 0), 'hold') === 'hold');
// The QUOTE and the CHARGE must agree: the pay screen posts back the stage it
// showed, and an explicit 'deposit' suppresses the settled-deposit upgrade so a
// payment landing mid-flow cannot take the balance off a deposit screen.
chk('an explicit deposit (what the screen quoted) is honoured, so quote == charge',
    booking_payment_kind($payB(60, 200), 'deposit') === 'deposit');
chk('…but the WINDOW still overrides even an explicit deposit',
    booking_payment_kind($payB(10, 200), 'deposit') === 'balance');
// NB booking_deposit_settled's "a booking with no price is not settled" guard is
// NOT driven here and deliberately so: reaching it needs booking_amount_due's
// total<=0 branch, which calls get_rate(), and db() EXITS rather than throwing —
// this suite is database-free by design. It is belt-and-braces anyway: pay.php
// 404s a row with no snapshot AND no property rate before the stage is asked for.
// WIRING — the helpers being right proved nothing while a builder still baked a
// stage into the URL. Every builder is scanned, and pay.php must derive.
// NB the URL is BUILT BY CONCATENATION, so a naive /index\.html\?pay=[^']*&k=/
// cannot span it — it stops at the closing quote after `pay=`. The first version
// of this check did exactly that and passed with `&k=` put straight back into
// mailer.php. Take the whole STATEMENT (to its semicolon) and look in that.
foreach (['mailer.php' => 'the emailed link', 'bookings.php' => 'the owner\'s copied link', 'email-samples.php' => 'the email preview'] as $f => $what) {
    $src = (string) file_get_contents(__DIR__ . '/' . $f);
    $found = preg_match_all('/index\.html\?pay=.*?;/s', $src, $m);
    chk("$what builds a pay URL at all (vacuity guard)", $found >= 1);
    $withStage = array_filter($m[0], fn($stmt) => strpos($stmt, '&k=') !== false);
    chk("$what carries no stage in the URL", count($withStage) === 0);
}
chk('pay.php derives the stage from the booking, not from the request',
    strpos((string) file_get_contents(__DIR__ . '/pay.php'), 'booking_payment_kind($b, $reqKind)') !== false);
chk('…and an absent/unknown kind becomes null, not a silent "deposit" preference',
    strpos((string) file_get_contents(__DIR__ . '/pay.php'), "in_array(\$reqKind, ['deposit', 'balance', 'hold'], true) ? \$reqKind : null") !== false);
chk('the client stops reading a stale k=deposit off the URL',
    strpos((string) file_get_contents(__DIR__ . '/app.js'), "usp.get('k') === 'balance' ? 'balance' : null") !== false);
chk('…and pins the resolved stage so the charge asks for what was quoted',
    strpos((string) file_get_contents(__DIR__ . '/app.js'), "if (s.kind === 'deposit' || s.kind === 'balance' || s.kind === 'hold') payState.kind = s.kind;") !== false);

// ---- AUTOPAY: never take money without a recorded, current agreement -------
//
//  The rule the whole feature exists to obey. A stored card is not permission,
//  and permission is for A SUM ON A DATE — not a standing licence. Every state
//  except 'armed' must behave exactly as the app did before autopay existed,
//  which is what makes this safe to ship: no consent, no change.
echo "\n== Autopay — permission, and the eight ways it is refused ==\n";
$ap = function ($over = []) {
    return array_merge([
        'prop_key' => 'jollyboat', 'adults' => 2, 'children' => 0,
        'check_in' => date('Y-m-d', strtotime('+60 days')),
        'check_out' => date('Y-m-d', strtotime('+63 days')),
        'balance_due_date' => null, 'deposit_pct_override' => 25.0, 'deposit_amount_override' => null,
        'agreed_total' => 800.0, 'price_override' => null, 'deposit_paid' => 200.0,
        'agreed_booking_fee' => 0.0, 'hold_status' => 'charged',
        'autopay_consent_at' => null, 'autopay_card_id' => null,
        'autopay_amount' => null, 'autopay_due' => null,
        'autopay_revoked_at' => null,
    ], $over);
};
$dueDay = date('Y-m-d', strtotime(date('Y-m-d', strtotime('+60 days')) . ' -' . payment_balance_days() . ' days'));
// The consenting booking: deposit paid, £600 balance, agreed to both.
$agreed = ['autopay_consent_at' => '2026-04-24 10:00:00', 'autopay_card_id' => 'ccof:abc123',
           'autopay_amount' => 600.0, 'autopay_due' => $dueDay];

// THE DEFAULT IS OFF, for every booking that has ever existed.
$st = booking_autopay_state($ap());
chk('a booking nobody agreed to is OFF', $st[0] === 'off');
chk('…and may never be charged', booking_autopay_may_charge($ap()) === false);
// A CARD ON FILE IS NOT PERMISSION — the trap this whole design exists to avoid.
$st = booking_autopay_state($ap(['autopay_card_id' => 'ccof:abc123']));
chk('a saved card WITHOUT consent is still OFF — a card is not permission', $st[0] === 'off');
chk('…and still may not be charged', booking_autopay_may_charge($ap(['autopay_card_id' => 'ccof:abc123'])) === false);

// AGREED, MATCHING, WITH A CARD → the only state that may charge.
$st = booking_autopay_state($ap($agreed));
chk('agreed, current and matching → ARMED', $st[0] === 'armed');
chk('…and the reason names the sum and the day', strpos($st[1], '£600.00') !== false && strpos($st[1], uk_date($dueDay)) !== false);
chk('…but NOT before the agreed day', booking_autopay_may_charge($ap($agreed), date('Y-m-d')) === false);
chk('…and yes on the day itself', booking_autopay_may_charge($ap($agreed), $dueDay) === true);
chk('…and still yes the day after — a failed run must not skip the payment',
    booking_autopay_may_charge($ap($agreed), date('Y-m-d', strtotime($dueDay . ' +1 day'))) === true);

// WITHDRAWN.
chk('switched off → REVOKED, never charges',
    booking_autopay_state($ap($agreed + ['autopay_revoked_at' => '2026-05-01 09:00:00']))[0] === 'revoked'
    && booking_autopay_may_charge($ap(array_merge($agreed, ['autopay_revoked_at' => '2026-05-01 09:00:00'])), $dueDay) === false);

// THE TERMS MOVED — consent does not stretch. Both halves, because a plan edit
// can change either the figure or the day.
$moreMoney = $ap(array_merge($agreed, ['agreed_total' => 900.0]));
chk('the owner raised the price → STALE, ask again',
    booking_autopay_state($moreMoney)[0] === 'stale' && booking_autopay_may_charge($moreMoney, $dueDay) === false);
$newDate = $ap(array_merge($agreed, ['balance_due_date' => date('Y-m-d', strtotime($dueDay . ' +7 days'))]));
chk('the owner moved the due date → STALE, ask again',
    booking_autopay_state($newDate)[0] === 'stale' && booking_autopay_may_charge($newDate, $dueDay) === false);
chk('…and a LOWER price is stale too — consent is for a sum, not a ceiling',
    booking_autopay_state($ap(array_merge($agreed, ['agreed_total' => 700.0])))[0] === 'stale');

// NOTHING LEFT / NO CARD.
chk('already settled → SETTLED, nothing to take',
    booking_autopay_state($ap(array_merge($agreed, ['deposit_paid' => 800.0])))[0] === 'settled');
chk('consent but no card on file → NOCARD, ask as usual',
    booking_autopay_state($ap(array_merge($agreed, ['autopay_card_id' => null])))[0] === 'nocard');

// WHAT THEY ARE AGREEING TO, at the moment of asking.
$terms = booking_autopay_terms($ap(['deposit_paid' => 0.0, 'hold_status' => 'none']));
chk('the terms offered are the BALANCE and its date', $terms && abs($terms['amount'] - 600.0) < 0.005 && $terms['due'] === $dueDay);
chk('…nothing to schedule once it is all paid', booking_autopay_terms($ap(['deposit_paid' => 800.0])) === null);
chk('…and the legacy hold flow is never scheduled',
    booking_autopay_terms($ap(['check_in' => date('Y-m-d', strtotime('+2 days')), 'deposit_paid' => 0.0])) === null);

// WIRING — the collector is deliberately NOT built yet, and that is asserted so
// nobody wires a charger to these helpers without the rest of the safeguards.
$paySrc = (string) file_get_contents(__DIR__ . '/pay.php');
chk('nothing charges on a schedule yet — the state machine lands first',
    strpos($paySrc, 'booking_autopay_may_charge') === false);

// ---- A declined guest is told what to DO -----------------------------------
//  Both refusal sites printed Square's own `detail`, which is written for a
//  developer reading an API response — and at worst leaks the code itself
//  ("CARD_DECLINED_VERIFICATION_REQUIRED" was seen live here during the 3-D
//  Secure work). This is the one failure a customer ever sees.
echo "\n== Declines speak to the guest, not the developer ==\n";
$dm = 'payment_decline_message';
chk('a plain decline says try another card or ring the bank',
    stripos($dm('CARD_DECLINED'), 'another card') !== false && stripos($dm('CARD_DECLINED'), 'bank') !== false);
chk('the 3-D Secure case explains the CHECK rather than naming the code',
    stripos($dm('CARD_DECLINED_VERIFICATION_REQUIRED'), 'really you') !== false);
chk('a wrong CVV points at the three digits on the back',
    stripos($dm('VERIFY_CVV_FAILURE'), 'three digits') !== false);
chk('an expired card says to use another, not to retry',
    stripos($dm('CARD_EXPIRED'), 'expired') !== false && stripos($dm('CARD_EXPIRED'), 'try again') === false);
chk('a temporary fault says nothing was charged', stripos($dm('TEMPORARY_ERROR'), 'nothing was charged') !== false);
chk('lower-case and padded codes still map', $dm('  card_expired  ') === $dm('CARD_EXPIRED'));
// NEVER leak the machinery, whatever the code.
$codes = ['CARD_DECLINED','GENERIC_DECLINE','INSUFFICIENT_FUNDS','CARD_DECLINED_VERIFICATION_REQUIRED',
          'VERIFY_CVV_FAILURE','VERIFY_AVS_FAILURE','INVALID_CARD','INVALID_EXPIRATION','CARD_EXPIRED',
          'CARD_NOT_SUPPORTED','CVV_FAILURE','EXPIRATION_FAILURE','PAYMENT_LIMIT_EXCEEDED',
          'TEMPORARY_ERROR','GATEWAY_TIMEOUT','SOMETHING_WE_HAVE_NEVER_SEEN',''];
$leak = array_filter($codes, function ($c) use ($dm) {
    $m = $dm($c);
    return preg_match('/[A-Z_]{6,}|\bhttps?:|\{|\}|SQLSTATE/', $m) === 1;
});
chk('no message anywhere leaks a code, a URL or markup (' . implode(',', $leak) . ')', count($leak) === 0);
$short = array_filter($codes, function ($c) use ($dm) { return strlen($dm($c)) < 25 || strlen($dm($c)) > 190; });
chk('every message is a readable sentence, not a fragment or an essay', count($short) === 0);
// An UNKNOWN code must not guess — it falls back, and the caller's fallback wins
// over the generic one so each site keeps its own wording.
chk('an unknown code uses the caller\'s fallback', $dm('WHO_KNOWS', 'Site-specific words.') === 'Site-specific words.');
chk('…and with no fallback, an honest generic line', stripos($dm('WHO_KNOWS'), 'declined') !== false);
// WIRING — the mapper being right proves nothing while a site still prints prose.
$paySrc2 = (string) file_get_contents(__DIR__ . '/pay.php');
chk('both pay.php refusal sites go through the mapper',
    substr_count($paySrc2, 'payment_decline_message(') === 2);
chk('…and neither prints Square\'s raw detail at the guest any more',
    strpos($paySrc2, "errors'][0]['detail']") === false);

// ============================================================
//  THE PAYMENT QUOTE — the figure the guest read is the figure that leaves.
//  pay.php derives the amount twice, and between the two the owner can edit the
//  plan, change the price or the deposit, or another payment can land. The
//  summary signs what it displayed; the charge checks its own under-lock figure
//  against that and stops rather than taking a sum nobody agreed to.
// ============================================================
echo "\n-- payment quote --\n";
$Q = payment_quote_sign(42, 'balance', 225.0);
chk('a quote of ours verifies against the charge it names', payment_quote_check($Q, 42, 'balance', 225.0) === true);
chk('trailing pence are normalised, so 225 and 225.00 are one figure', payment_quote_check(payment_quote_sign(42, 'balance', 225), 42, 'balance', 225.0) === true);
// EACH FIELD IS BOUND. A quote that verified against a different sum, booking or
// stage would be a quote that authorised nothing in particular.
chk('a different AMOUNT is refused', payment_quote_check($Q, 42, 'balance', 300.0) === false);
chk('a penny more is refused — this is money, not a tolerance', payment_quote_check($Q, 42, 'balance', 225.01) === false);
chk('a different BOOKING is refused', payment_quote_check($Q, 43, 'balance', 225.0) === false);
chk('a different STAGE is refused', payment_quote_check($Q, 42, 'deposit', 225.0) === false);
chk('a tampered signature is refused', payment_quote_check(substr($Q, 0, -1) . 'x', 42, 'balance', 225.0) === false);
chk('a quote with the amount edited in place is refused', payment_quote_check('42:balance:100.00:' . substr($Q, strrpos($Q, ':') + 1), 42, 'balance', 100.0) === false);
chk('rubbish is refused, not waved through', payment_quote_check('nonsense', 42, 'balance', 225.0) === false);
// The three fields must be inside the HMAC, not merely alongside it. Comparing
// whole strings would still catch an edited body, so this reads the SIGNATURE
// alone — if the amount were outside it, one tag would serve every figure and a
// forged quote would only need arithmetic.
$tag = function ($q) {
    return substr($q, strrpos($q, ':') + 1);
};
chk('the AMOUNT is signed, not just carried', $tag(payment_quote_sign(42, 'balance', 225.0)) !== $tag(payment_quote_sign(42, 'balance', 300.0)));
chk('the BOOKING is signed', $tag(payment_quote_sign(42, 'balance', 225.0)) !== $tag(payment_quote_sign(43, 'balance', 225.0)));
chk('the STAGE is signed', $tag(payment_quote_sign(42, 'balance', 225.0)) !== $tag(payment_quote_sign(42, 'deposit', 225.0)));
// And the tag must be a SECRET. Without APP_SECRET in it, anyone could compute a
// valid quote for any figure — the string comparison would happily accept it,
// so no round-trip check can see this. Read the source instead.
$sigSrc = (function () {
    $r = new ReflectionFunction('payment_quote_sign');
    return implode('', array_slice(file($r->getFileName()), $r->getStartLine() - 1, $r->getEndLine() - $r->getStartLine() + 1));
})();
chk('...and only this site can compute it', strpos($sigSrc, 'hash_hmac') !== false && strpos($sigSrc, 'APP_SECRET') !== false);
chk('the quote is compared in constant time', strpos(file_get_contents(__DIR__ . '/db.php'), 'hash_equals(payment_quote_sign(') !== false);
// ABSENT is the one case that PROCEEDS: a client too old to send a quote must
// still be able to pay, and since a quote can only ever refuse, its absence
// costs no guarantee the pre-quote endpoint had.
chk('no quote at all means "carry on as before"', payment_quote_check('', 42, 'balance', 225.0) === null);
chk('...and a missing key reads the same way', payment_quote_check(null, 42, 'balance', 225.0) === null);
// What the refusal may quote back at the guest. An unsigned figure is a CLAIM,
// and a claim is not something to state to someone as a fact about their money.
chk('the signed figure can be read back for the refusal wording', payment_quote_amount($Q, 42, 'balance') === 225.0);
chk('an unsigned figure is not readable', payment_quote_amount('42:balance:225.00:deadbeef', 42, 'balance') === null);
chk('a figure signed for another booking is not readable', payment_quote_amount($Q, 43, 'balance') === null);
chk('a malformed string is not readable', payment_quote_amount('42:balance', 42, 'balance') === null);

// WIRING. Testing the helper alone passes with pay.php reverted — the trap this
// codebase keeps walking into — so both call sites are asserted.
$paySrcQ = file_get_contents(__DIR__ . '/pay.php');
chk('the summary signs the total it displays (rental + bundled deposit)',
    preg_match("/'quote'\s*=>\s*payment_quote_sign\(\\\$bookingId,\s*\\\$kind,\s*round\(\\\$amountDue \+ \\\$damagesDue, 2\)\)/", $paySrcQ) === 1);
// Checked against the UNDER-LOCK $chargeTotal, not the pre-lock figure: the
// pre-lock one is what the summary already saw, so comparing it to itself would
// pass while the sum that actually charges had moved.
chk('the charge checks the under-lock figure it is about to take',
    preg_match('/payment_quote_check\(\$in\[.quote.\] \?\? .., \$bookingId, \$kind, \$chargeTotal\) === false/', $paySrcQ) === 1);
// Scoped to the CHARGE branch: /v2/payments appears earlier in the legacy
// authorize branch too, and measuring against that one passes whatever the
// charge branch does.
chk('...and that check sits BEFORE the Square call', (function () use ($paySrcQ) {
    $branch = strpos($paySrcQ, "if (\$action === 'charge')");
    if ($branch === false) {
        return false; // vacuity: the branch must exist for this to mean anything
    }
    $chk = strpos($paySrcQ, 'payment_quote_check(', $branch);
    $sq = strpos($paySrcQ, "square_api('POST', '/v2/payments'", $branch);
    return $chk !== false && $sq !== false && $chk < $sq;
})());
chk('...releasing the booking lock on the way out', preg_match('/payment_quote_check.*?\n\s*book_unlock/s', $paySrcQ) === 1);
chk('...and telling the client WHY, so it can redraw rather than dead-end', strpos($paySrcQ, "'code' => 'amount_changed'") !== false);
chk('...as a 409, the shape apiPost carries a code on', preg_match("/'code' => 'amount_changed',.*?\n.*?\n\s*\],\n\s*409,/s", $paySrcQ) === 1);
// THE MONOTONIC GUARANTEE, which is what makes it safe to hand a signed figure
// to a client at all: the quote may stop a charge, never set one. If a quoted
// amount could reach $chargeTotal or $pence, a stale quote would be a way to
// underpay.
chk('a quoted amount never becomes the sum charged',
    preg_match('/\$(chargeTotal|amountDue|damagesDue|pence)\s*=[^;]*payment_quote/', $paySrcQ) !== 1);
$appSrcQ = file_get_contents(__DIR__ . '/app.js');
chk('the pay screen keeps the quote it was given', strpos($appSrcQ, 'payState.quote = typeof s.quote') !== false);
chk('...and sends it back with the charge', preg_match("/action: 'charge',(.|\n)*?quote: payState\.quote,/", $appSrcQ) === 1);
chk('...and a refused amount REDRAWS the screen rather than just erroring',
    preg_match("/code === 'amount_changed'(.|\n){0,200}openPayView/", $appSrcQ) === 1);
// The label the guest taps is part of the figure. Restoring a remembered
// "Pay £225" after the screen has been redrawn at £300 re-states the number the
// server has just refused.
chk('...without putting the stale figure back on the button',
    strpos($appSrcQ, "if (btn.textContent === 'Processing…') btn.textContent = orig;") !== false);

// ============================================================
//  THE TWO EMAILS AUTOMATIC COLLECTION OWES THE GUEST — driven through the REAL
//  composers. Both were first gated by reading mailer.php's source, which
//  proved the words EXIST and not that they are ever reached: break-testing
//  showed the check passing with the branch that selects them forced dead. The
//  bodies were split into pure *_body() builders (the payment_request_body
//  pattern) precisely so this can drive them.
// ============================================================
echo "\n-- the receipt for a charge nobody typed anything for --\n";
$rcpt = [
    'name' => 'Cara Lyon', 'email' => 'c@example.com', 'prop_key' => 'jollyboat', 'prop_name' => 'Jollyboat',
    'ref' => 'CHB-000042', 'kind' => 'balance', 'amount' => 300.0, 'total' => 400.0,
    'paid_so_far' => 400.0, 'balance' => 0.0, 'fully_paid' => true, 'deposit_charged' => 0.0,
    'invoice_url' => 'https://example.test/invoice.php?b=42&token=t',
];
$manual = payment_receipt_body($rcpt);
$auto = payment_receipt_body($rcpt + ['automatic' => true]);
// A guest who was not at the keyboard must not be thanked for something they
// just did. That reads as an acknowledgement of an action they will not
// remember taking — which is how an authorised charge becomes a disputed one.
chk('a payment they made is a thank-you', strpos($manual['text'], "Thank you — we've received your") !== false);
chk('a collection is not', strpos($auto['text'], "Thank you — we've received your") === false);
chk('...it says the charge was arranged', strpos($auto['text'], "As arranged, we've now collected your") !== false);
chk('...and that nothing was needed from them', strpos($auto['text'], 'Nothing was needed from you.') !== false);
chk('the HTML half agrees with the text half', strpos($auto['html'], 'as arranged, we&#039;ve now collected your') !== false || strpos($auto['html'], "as arranged, we've now collected your") !== false);
chk('the HTML half of a manual payment still thanks them', strpos($auto['html'], "thank you — we've received your") === false && strpos($manual['html'], "thank you — we've received your") !== false);
// The subject is read before the mail is opened, so it carries the distinction too.
chk('the subject names a collection', $auto['subject'] === 'Balance collected — Jollyboat');
chk('...and a payment is still "Payment received"', $manual['subject'] === 'Payment received — Jollyboat');
// Everything else about the two must be identical — this is a wording branch,
// not a second receipt.
chk('both quote the same figure', strpos($auto['text'], '£300.00') !== false && strpos($manual['text'], '£300.00') !== false);
chk('both carry the invoice link', strpos($auto['text'], 'invoice.php?b=42') !== false && strpos($manual['text'], 'invoice.php?b=42') !== false);
chk('both carry the reference', strpos($auto['text'], 'CHB-000042') !== false && strpos($manual['text'], 'CHB-000042') !== false);

echo "\n-- the notice that goes out before the money moves --\n";
$nb = ['id' => 42, 'name' => 'Cara Lyon', 'email' => 'c@example.com', 'prop_key' => 'jollyboat', 'prop_name' => 'Jollyboat', 'autopay_amount' => 300.0, 'autopay_due' => '2026-08-20'];
$nt = autopay_notice_body($nb, 'https://example.test/index.html?pay=t&b=42');
chk('it states the sum', strpos($nt['text'], '£300.00') !== false && strpos($nt['html'], '£300.00') !== false);
chk('...and the day, in the house date form', strpos($nt['text'], '20/08/2026') !== false);
chk('...both of them in the subject, which may be all they read', strpos($nt['subject'], '£300.00') !== false && strpos($nt['subject'], '20/08/2026') !== false);
chk('...and the cottage', strpos($nt['html'], 'Jollyboat') !== false);
// NOT A PAYMENT REQUEST. There is nothing for the guest to do, so it must not
// read like a chase — no balance owing, no urgency, no "pay now".
chk('there is nothing to do, and it says so', strpos($nt['text'], "There's nothing to do") !== false);
chk('it does not chase', stripos($nt['text'], 'pay now') === false && stripos($nt['text'], 'outstanding') === false && stripos($nt['text'], 'overdue') === false);
chk('it is not headed as a request', stripos($nt['subject'], 'payment request') === false && stripos($nt['subject'], 'balance due') === false);
// The way out has to be IN the notice. A warning with no off switch is a
// warning you can only act on by finding the site yourself.
chk('it says how to stop it', strpos($nt['text'], 'turn it off') !== false);
chk('...and links the booking page where that lives', strpos($nt['text'], 'index.html?pay=') !== false && strpos($nt['html'], 'index.html?pay=') !== false);
chk('a guest with no email is refused rather than sent nowhere', ($r = send_autopay_notice(['name' => 'x', 'email' => '']))['ok'] === false);

// WIRING — the composers alone pass with the call sites removed.
$apSrcR = file_get_contents(__DIR__ . '/autopay-lib.php');
chk('a collection actually sends the receipt', strpos($apSrcR, 'autopay_send_receipt($b, $sqId, $rental, $damages);') !== false);
chk('...marked automatic', strpos($apSrcR, "'automatic' => true,") !== false);
chk('the daily run actually sends the notices', strpos(file_get_contents(__DIR__ . '/autopay-run.php'), 'autopay_notice_run($today)') !== false);

// ============================================================
//  A COMPED STAY IS NOT AN UNPRICED ONE
//
//  Found by driving booking_amount_due with hostile inputs: a booking whose
//  price_override the owner had set to 0 — the natural way to give a stay away
//  — was quoted the FULL RATE CARD, because the rate-card fallback fires on
//  `$total <= 0` and cannot tell "no price recorded" from "priced at nothing".
//  Measured: booking_rental_price said £0.00 and booking_amount_due said
//  £910.00 for the same booking. pay.php derives its charge from the second, so
//  the guest would have been asked for and charged the whole price of a free
//  stay. Two definitions, disagreeing by the entire value of the stay.
//
//  bookings.php already made the distinction and documented WHY the fallback
//  exists — legacy pre-snapshot rows, where agreed_total is NULL. It was the
//  outlier that revealed pricing.php and square-webhook.php were missing it.
// ============================================================
echo "\n-- a recorded price of zero IS a price --\n";
chk('a comped stay carries a price', booking_has_price(['price_override' => 0.0, 'agreed_total' => 0.0]));
chk('...however the zero is typed', booking_has_price(['price_override' => '0', 'agreed_total' => null]));
chk('an ordinary priced stay carries one', booking_has_price(['price_override' => null, 'agreed_total' => 910.0]));
chk('an override alone is enough', booking_has_price(['price_override' => 750.0, 'agreed_total' => null]));
// The case the fallback genuinely exists for, and which must keep working: a
// legacy pre-snapshot row with no price at all.
chk('a legacy row with NO price does not', !booking_has_price(['price_override' => null, 'agreed_total' => null]));
chk('...nor an empty string, which is how a cleared field arrives', !booking_has_price(['price_override' => '', 'agreed_total' => '']));
chk('...nor a row missing the columns entirely', !booking_has_price([]));
// WIRING — the predicate alone passes with every call site reverted, which is
// exactly how two of the three sites came to be missing this in the first place.
$prcSrc = (string) file_get_contents(__DIR__ . '/pricing.php');
$whSrc = (string) file_get_contents(__DIR__ . '/square-webhook.php');
$bkSrc2 = (string) file_get_contents(__DIR__ . '/bookings.php');
chk('booking_amount_due asks the predicate, not the figure', strpos($prcSrc, '$total <= 0 && !booking_has_price($b)') !== false);
chk('the Square webhook asks it too', strpos($whSrc, '$total <= 0 && !booking_has_price($b)') !== false);
chk('...and the bookings write path', strpos($bkSrc2, '$total <= 0 && !booking_has_price($b)') !== false);
chk('no bare `$total <= 0` fallback is left anywhere',
    preg_match('/\$total <= 0\)\s*\{\s*\n\s*\$rate = get_rate/', $prcSrc . $whSrc . $bkSrc2) !== 1);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail PAY-RAIL CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass PAY-RAIL CHECKS PASSED \u{2705}\n";
