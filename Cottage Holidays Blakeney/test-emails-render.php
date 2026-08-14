<?php
// ============================================================================
//  test-emails-render.php — EVERY email template is built, and every colour in
//  the result is legible. CI-wired, deploy-excluded, no database and no SMTP.
//
//  WHY THIS EXISTS. test-payrail drives ten of mailer.php's composers hard (540
//  checks) because those ten are PURE — they take the accent, the bank details
//  and the host name as arguments precisely so a test can reach them. The other
//  eighteen resolve their own dependencies and so could only ever be proved to
//  PARSE: `php -l` in CI, and nothing more. A fatal in send_hold_request or
//  send_refund_email would have shipped, and the first person to find out would
//  be a guest not receiving an email nobody knew had failed.
//
//  HOW IT REACHES THEM. mailer.php is copied to a temp file with a capture
//  spliced into the head of BOTH smtp_send and smtp_send_batch (send_owner posts
//  through the batch one, so patching only the first renders every owner-facing
//  email as "nothing captured"). Each composer therefore builds its true HTML and
//  hands it over instead of posting it. The db.php helpers they reach for are
//  stubbed above the require — db() itself THROWS here, which is the point: a
//  composer that grows a content_value() call fails this gate loudly rather than
//  quietly needing a database.
//
//  TWO SECTIONS.
//    §1 every template renders, with both halves and a subject.
//    §2 every coloured text node in the rendered HTML clears WCAG AA against the
//       background it actually inherits.
//
//  §2 is the email half of a11y-test.js §1, and it exists because that gate
//  stopped at the edge of the browser. Measured when it was written: SIXTEEN
//  ink/ground/size combinations below AA across the 21 templates — the worst
//  email_amount's 34px figure at 2.00:1, i.e. the one number a refund email
//  exists to state, and an unsubscribe link at 2.12:1. It is pure arithmetic on
//  the rendered output: no browser, no screenshot, so it cannot flake the way a
//  pixel-sampling crawler does (see a11y-test's header for the three rounds of
//  false failures that lesson cost).
// ============================================================================

$pass = 0;
$fail = 0;
function chk($label, $ok)
{
    global $pass, $fail;
    if ($ok) {
        $pass++;
        echo "  \u{2713} $label\n";
    } else {
        $fail++;
        echo "  \u{2717} $label\n";
    }
}

$APP = __DIR__;
// ---- the helpers mailer.php expects from db.php (which would exit without a DB) ----
define('MAIL_ENABLED', true); // see the capture splice below — nothing leaves this process
define('SITE_NAME', 'Cottage Holidays Blakeney');
define('OWNER_NOTIFY_EMAIL', 'owner@example.test');
define('PAYMENT_BALANCE_DAYS', 30);
function uk_date($iso) { $t = strtotime((string) $iso); return $t ? date('d/m/Y', $t) : (string) $iso; }
function site_base_url() { return 'https://cottageholidaysblakeney.co.uk/'; }
function first_name($full, $fallback = '') {
    $full = trim((string) $full);
    if ($full === '') { return $fallback; }
    $p = preg_split('/\s+/', $full);
    return $p[0] !== '' ? $p[0] : $fallback;
}
function prop_display($k) {
    $m = ['jollyboat' => 'Jollyboat', '21a' => '21A Westgate', 'pimpernel' => 'Pimpernel Cottage'];
    return ['name' => $m[$k] ?? $k, 'accent' => '#43a047'];
}
function occupancy_limits($k = null) { return ['maxAdults' => 2, 'maxChildren' => 0, 'maxTotal' => 2]; } // arity mirrors db.php's (0-arg) — see rate_limit above
function content_value($k, $d = null) {
    $c = [
        'host-name' => 'George', 'contact-phone' => '01263 000000',
        'bacs-details' => "Cottage Holidays Blakeney\nSort code: 00-00-00\nAccount: 12345678",
    ];
    return $c[$k] ?? $d;
}
// ARITY MIRRORS db.php's, and it is not cosmetic: PHPStan analyses the whole set
// as one, so a 0-arg stub made every real 4-arg call site in the app an
// `arguments.count` error — 95 of them in CI. Third time this file has done it
// (see rate_limit and occupancy_limits above).
function log_activity($category, $action, $summary, $opts = []) {}
function db() { throw new RuntimeException('no database in this renderer'); }
function booking_ledger_net($id) { return 0.0; }
function damages_returned($id) { return 0.0; }
function damages_collected($b) { return (float) ($b['hold_amount'] ?? 0); }
function guest_reg_token($id) { return 'regtok'; }
function invoice_token($id) { return 'invtok'; }
function pay_token($id) { return 'paytok'; }
function square_enabled() { return true; }
// Signature MIRRORS db.php's real rate_limit — PHPStan analyses the whole file
// set as one (the three-ok() lesson), so a zero-arg stub here re-types every
// real call site in auth.php/messages.php/… as "invoked with 3 parameters,
// 0 required" the moment those files are re-analysed.
function rate_limit($key = '', $max = 8, $windowMin = 10) { return true; }
// Verbatim from db.php — both pure, so the decisions in these renders are the real ones.
function booking_price_is_custom($nightly, $txFee, $rentalTotal) {
    return abs(((float) $nightly + (float) $txFee) - (float) $rentalTotal) > 0.005;
}
function payment_rail($b) {
    $m = strtolower(trim((string) ($b['payment_method'] ?? '')));
    if ($m === '') { return 'card'; }
    return preg_match('/card|square|stripe|visa|mastercard|amex|contactless|apple ?pay|google ?pay/', $m) ? 'card' : 'bacs';
}

// ---- capture instead of send ----
$src = file_get_contents($APP . '/mailer.php');
$needle = "    \$extraHeaders = [],\n) {\n";
if (strpos($src, $needle) === false) { fwrite(STDERR, "could not find smtp_send signature\n"); exit(1); }
$src = str_replace(
    $needle,
    $needle . "    \$GLOBALS['CAP'][] = ['to' => \$toEmail, 'subject' => \$subject, 'html' => \$bodyHtml, 'text' => \$bodyText];\n    return ['ok' => true, 'captured' => true];\n",
    $src,
    // only the first (smtp_send, not smtp_send_batch)
);
// send_owner() posts through smtp_send_BATCH, so that needs the same treatment or
// every owner-facing email renders as nothing captured.
$nb = "function smtp_send_batch(\$messages)\n{\n";
if (strpos($src, $nb) === false) { fwrite(STDERR, "could not find smtp_send_batch\n"); exit(1); }
$src = str_replace(
    $nb,
    $nb . "    foreach (\$messages as \$m) { \$GLOBALS['CAP'][] = ['to' => \$m['to'] ?? '', 'subject' => \$m['subject'] ?? '', 'html' => \$m['html'] ?? null, 'text' => \$m['text'] ?? '']; }\n    return array_map(fn(\$m) => ['ok' => true, 'captured' => true], \$messages);\n",
    $src,
);
// The capture copies live in the system temp dir, NOT the app directory. They were
// written beside the app at first, and an aborted run (a fatal, a Ctrl-C) left one
// behind — where test-auth-posture.php promptly failed it as an unregistered
// web-reachable endpoint. A test's scratch file has no business in the deploy tree.
// Safe to move: mailer.php has no requires of its own, and this harness supplies
// db.php's helpers itself.
$tmp = tempnam(sys_get_temp_dir(), 'chb_mailer_') . '.php';
file_put_contents($tmp, $src);

require_once $APP . '/pricing.php';
require_once $tmp;
@unlink($tmp);

$GLOBALS['CAP'] = [];

// ---- fixtures: one believable booking, guest and enquiry ---------------------
$RATE = ['prop_key' => 'jollyboat', 'couple_rate' => 130, 'extra_adult_rate' => 0, 'child_rate' => 0,
    'booking_fee' => 50, 'transaction_pct' => 3, 'weekend_pct' => 0, 'weekend_days' => '',
    'check_in_time' => '15:00', 'check_out_time' => '10:00', 'address' => 'Jollyboat, High Street, Blakeney NR25 7AL',
    'accent' => '#43a047', 'min_nights' => 2];
// Lifted VERBATIM from email-samples.php's own dummy booking — the fixture the owner's
// "send me samples" button already uses, so these renders are what that button produces.
$B = [
    'id' => 0, 'ref' => 'TEST-0001', 'name' => 'Test Guest', 'email' => 'guest@example.test',
    'phone' => '01234 567890', 'prop_key' => 'jollyboat', 'prop_name' => 'Jollyboat',
    'check_in' => date('Y-m-d', strtotime('+30 days')), 'check_out' => date('Y-m-d', strtotime('+33 days')),
    'check_in_time' => '15:00', 'check_out_time' => '10:00', 'nights' => 3,
    'adults' => 2, 'children' => 0, 'payment' => 'deposit',
    'address' => '123 Test Street, Blakeney, Norfolk NR25 7XX',
    'per_night' => 130.0, 'nightly' => 390.0, 'tx_pct' => 3, 'tx_fee' => 11.7,
    'damages_deposit' => 75.0, 'total' => 401.70, 'kind' => 'deposit', 'amount' => 175.43,
    'held' => 75.0, 'manual' => false, 'reason' => 'Sample reason (sample email only)',
    'refund' => 175.43, 'card' => true, 'fully_paid' => false, 'balance' => 301.27,
    'balance_due' => 301.27,
    'paid_so_far' => 175.43, 'reviewUrl' => site_base_url() . 'index.html', 'googleUrl' => '',
    // extras the newer composers read
    'hold_status' => 'charged', 'hold_amount' => 75.0, 'payment_method' => 'Square card',
    'deposit_paid' => 175.43, 'agreed_total' => 401.70, 'agreed_per_night' => 130,
    'agreed_nights' => 3, 'agreed_nightly' => 390, 'agreed_booking_fee' => 75,
    'agreed_txn_pct' => 3, 'agreed_txn_fee' => 11.7, 'price_override' => null,
    'balance_due_date' => date('Y-m-d', strtotime('+16 days')), 'deposit_pct_override' => null, 'deposit_amount_override' => null,
    'approve_url' => site_base_url() . 'enquiry-action.php?a=approve&id=7&t=tok',
    'decline_url' => site_base_url() . 'enquiry-action.php?a=decline&id=7&t=tok',
    'status' => 'COMPLETED', 'notes' => '', 'created_at' => date('Y-m-d H:i:s'),
    'terms_accepted_at' => date('Y-m-d H:i:s'), 'no_dogs_at' => date('Y-m-d H:i:s'),
    // the automatic-collection fields those two composers read
    'autopay_amount' => 119.18, 'autopay_n' => 3, 'autopay_due' => date('Y-m-d', strtotime('+27 days')),
    'autopay_next_at' => date('Y-m-d', strtotime('+7 days')), 'autopay_consent_at' => date('Y-m-d H:i:s'),
];
$ENQ = [
    'id' => 7, 'name' => 'Sarah Pemberton', 'email' => 'sarah@example.com', 'phone' => '07700 900222',
    'prop_key' => 'jollyboat', 'check_in' => '2026-09-05', 'check_out' => '2026-09-09',
    'adults' => 2, 'children' => 0, 'message' => 'Is parking available, and can we arrive late?',
    'created_at' => '2026-06-01 09:00:00', 'agreed_price' => null,
    'approve_url' => site_base_url() . 'enquiry-action.php?a=approve&id=7&t=tok',
    'decline_url' => site_base_url() . 'enquiry-action.php?a=decline&id=7&t=tok',
    'prop_name' => 'Jollyboat', 'nights' => 4,
];
$PAYURL = site_base_url() . 'index.html?pay=paytok&b=42&k=balance';

// Each entry: label, group, and a closure that triggers the real composer.
$JOBS = [
  ['enquiry-ack', 'guest', fn() => send_enquiry_ack($ENQ, false)],
  ['booking-confirmation', 'guest', fn() => send_booking_emails($B)],
  ['payment-request', 'guest', fn() => send_payment_request($B, $PAYURL)],
  ['payment-reminder', 'guest', fn() => send_payment_reminder($B, $PAYURL)],
  ['payment-receipt', 'guest', fn() => send_payment_receipt($B)],
  ['arrival-info', 'guest', fn() => send_arrival_email($B)],
  ['magic-link', 'guest', fn() => send_magic_link_email(['name' => 'Debbie McGoldrick', 'email' => 'debbie@example.com'], site_base_url() . 'index.html?token=abc')],
  ['deposit-return', 'guest', fn() => send_deposit_return_email($B)],
  ['cancellation', 'guest', fn() => send_cancellation_email($B)],
  ['review-request', 'guest', fn() => send_review_request_email($B)],
  // THE THIRTEEN THAT COMPOSED INLINE in a route or a cron script. Until they had pure
  // builders in mailer.php nothing could render them, so a fatal in any one shipped and
  // the owner found out by not being told about a review. Driven through the same
  // send_owner/smtp_send capture as the rest, so §2 measures their colours too.
  ['mail-test', 'owner', function () { $m = owner_mail_test_body(); return smtp_send('o@x.co', 'Owner', $m['subject'], $m['text'], $m['html']); }],
  ['admin-code', 'owner', function () { $m = admin_code_body('428 913'); return send_owner($m['subject'], $m['text'], $m['html']); }],
  ['backup-report', 'owner', function () { $m = backup_report_body('412 KB', 'Photos are archived separately (18.4 MB).'); return send_owner($m['subject'], $m['text'], $m['html']); }],
  ['guest-chat', 'guest', function () { $m = guest_chat_body('Wren', 'The key safe code is 1066.', 'https://example.test/p/1.jpg', true); return smtp_send('g@x.co', 'Wren', $m['subject'], $m['text'], $m['html']); }],
  ['guest-message', 'guest', function () { $m = guest_message_body('Wren', 'Your welcome book is ready.'); return smtp_send('g@x.co', 'Wren', $m['subject'], $m['text'], $m['html']); }],
  ['enquiry-nudge', 'guest', function () { $m = enquiry_nudge_body('Sam', 'Jollyboat', '15/08/2026 to 19/08/2026', site_base_url(), '#43a047', false); return send_owner($m['subject'], $m['text'], $m['html']); }],
  ['enquiry-nudge-gone', 'guest', function () { $m = enquiry_nudge_body('Sam', 'Jollyboat', '15/08/2026 to 19/08/2026', site_base_url(), '#43a047', true); return send_owner($m['subject'], $m['text'], $m['html']); }],
  ['enquiry-rescue', 'guest', function () { $m = enquiry_rescue_body('Sam', 'Jollyboat', '15/08/2026 to 19/08/2026', site_base_url(), '#43a047'); return send_owner($m['subject'], $m['text'], $m['html']); }],
  // The plain-text owner notes carry no 'html' of their own: send_owner() supplies the
  // house shell via owner_alert_text_html(), so driving them through send_owner is what
  // renders the document §2 then measures.
  ['owner-review', 'owner', function () { $m = owner_note_review('Test Guest', 'Jollyboat', 5, 'A lovely week.'); return send_owner($m['subject'], $m['text']); }],
  ['owner-lead', 'owner', function () { $m = owner_note_lead('Test Guest', 'Jollyboat', 4, 'Really enjoyed it.', 'g@x.co', '07700 900123'); return send_owner($m['subject'], $m['text']); }],
  ['owner-experience', 'owner', function () { $m = owner_note_experience('Test Guest', 'Seal trip', 'Worth adding.', 'https://example.test/seals', '07700 900123'); return send_owner($m['subject'], $m['text']); }],
  ['owner-chat-new', 'owner', function () { $m = owner_note_chat_new('Test Guest', 'g@x.co', 'Parking for two cars?', true); return send_owner($m['subject'], $m['text']); }],
  ['owner-chat-reply', 'owner', function () { $m = owner_note_chat_reply('Test Guest', 'g@x.co', 'That works, thank you.', true, ' [#ab12]'); return send_owner($m['subject'], $m['text']); }],
  ['owner-push-fallback', 'owner', function () { $m = owner_note_push_fallback('Payment received — £175.43', 'Test Guest has paid their deposit.'); return send_owner($m['subject'], $m['text']); }],
  // THE LAST FOUR — the two script-level weeklies, the mailbox reply and the newsletter.
  // The weeklies get a fixture payload: the ?force=1 buttons already send the real thing
  // with real data, so what a fixture is for is proving the TEMPLATE builds and that
  // every colour in it clears AA.
  ['owner-digest', 'owner', function () use ($B) {
      return send_owner(...array_values(owner_digest_body([
          'newBookings' => 3, 'newValue' => 1290.0, 'received' => 870.5,
          'arrivals' => [['check_in' => $B['check_in'], 'name' => 'Wren Hollis', 'prop_key' => 'jollyboat']],
          'owedCount' => 2, 'owedSum' => 440.0, 'pending' => 1, 'occPct' => 68,
          'misses' => [['t' => 'is there a hot tub', 'n' => 3]],
          'actTotal' => 12,
          'actAttention' => [['summary' => 'A calendar feed has not imported for 2 days', 'severity' => 'warn']],
      ])));
  }],
  ['weekly-analytics', 'owner', function () {
      return send_owner(...array_values(weekly_analytics_body([
          'views' => 412, 'uniq' => 318, 'convPct' => 2.4, 'bookings' => 3, 'enquiries' => 7,
          'topChannel' => 'Google', 'topPage' => '/cottages/jollyboat', 'noResult' => 4,
          'dropPct' => -35, 'deltaTxt' => '+12%', 'siteUrl' => site_base_url(),
      ])));
  }],
  ['mailbox-reply', 'owner', function () {
      $m = mailbox_reply_body(
          'Re: your enquiry about Jollyboat',
          "Hello,\n\nYes, those dates are free, and there is parking right outside the cottage.\n\n" .
              'Just let us know roughly when to expect you.',
      );
      return smtp_send('g@x.co', 'Guest', $m['subject'], $m['text'], $m['html']);
  }],
  ['newsletter', 'guest', function () {
      $m = newsletter_body('Autumn on the north Norfolk coast', 'The seals are back at Blakeney Point.', 'The seals are back at Blakeney Point.', site_base_url() . 'index.html?unsub=tok');
      return smtp_send('g@x.co', 'Subscriber', $m['subject'], $m['text'], $m['html']);
  }],
  ['autopay-notice', 'guest', fn() => send_autopay_notice($B, $PAYURL)],
  ['autopay-failure', 'guest', fn() => send_autopay_failure($B, 'card_declined', false, '2026-07-20')],
  ['refund', 'guest', fn() => send_refund_email($B)],
  ['anniversary', 'guest', fn() => send_anniversary_email($B)],
  ['enquiry-reply', 'guest', fn() => send_enquiry_reply_email(array_merge($ENQ, ['price' => null]), 'About your stay at Jollyboat', "Hello Sarah,\n\nYes — there's parking for one car right outside, and a late arrival is no trouble at all. Just let us know roughly when to expect you.\n\nThe dates you asked about are free.", 'enquiry')],
  ['direct-followup', 'guest', fn() => send_direct_followup_email($B)],
  ['hold-request', 'guest', fn() => send_hold_request($B, $PAYURL)],
  ['hold-released', 'guest', fn() => send_hold_released($B)],
  ['owner-new-enquiry', 'owner', fn() => send_owner_enquiry_email($ENQ)],
  ['owner-payment', 'owner', fn() => send_owner_payment_notice(array_merge($B, ['kind' => 'balance', 'amount' => 452.12, 'status' => 'COMPLETED', 'prop_name' => 'Jollyboat']))],
];


// ============================================================================
//  §0  THIS FILE — AND EVERY OTHER TEST — STAYS OFF THE HOST
// ============================================================================
// test-auth-posture.php's own header says "'dev' files must appear in deploy.yml's
// exclusions", and then it filters `test-*` out of its registry entirely — so the one
// class of file that rule was written for was the class nothing checked, and a new
// test-*.php shipped to the live host by default. deploy.yml also strips TWICE, once
// for production and once for staging, and a list somebody has to remember to extend
// in two places is the shape check-versions already learned to derive rather than
// hardcode.
echo "-- \u{00A7}0 no test file ships --\n";
$dep = @file_get_contents(dirname($APP) . '/.github/workflows/deploy.yml');
if ($dep === false) {
    // Running outside a checkout (or from the deployed tree, where this file is not
    // supposed to exist at all). Not a failure; just nothing to say.
    chk('deploy.yml not present — skipping the strip check', true);
} else {
    $rmLines = [];
    foreach (explode("\n", $dep) as $line) {
        if (strpos($line, 'rm -f') !== false) {
            $rmLines[] = $line;
        }
    }
    // Vacuity guard: with no rm lines found, everything below passes trivially.
    chk('deploy.yml still strips files (' . count($rmLines) . ' rm lines found)', count($rmLines) >= 2);
    $tests = array_map('basename', glob($APP . '/test-*.php'));
    $shipped = [];
    foreach ($tests as $t) {
        $seen = 0;
        foreach ($rmLines as $line) {
            if (strpos($line, '/' . $t . '"') !== false) {
                $seen++;
            }
        }
        if ($seen < 2) {
            $shipped[] = $t . ($seen ? ' (only ' . $seen . ' of the 2 passes)' : '');
        }
    }
    chk('every test-*.php is stripped from BOTH deploy passes (' . count($tests) . ' checked)', $shipped === []);
    if ($shipped) {
        echo '        would ship: ' . implode(', ', $shipped) . "\n";
    }
}

// ============================================================================
//  §1  EVERY TEMPLATE RENDERS
// ============================================================================
echo "\n-- \u{00A7}1 every template builds --\n";
$RENDERED = [];
$missing = [];
foreach ($JOBS as [$name, $group, $fn]) {
    $before = count($GLOBALS['CAP']);
    $err = '';
    try {
        $fn();
    } catch (\Throwable $e) {
        $err = $e->getMessage();
    }
    $got = array_slice($GLOBALS['CAP'], $before);
    if ($err !== '') {
        chk("$name — builds without throwing", false);
        echo "        threw: $err\n";
        $missing[] = $name;
        continue;
    }
    if (!$got) {
        chk("$name — produces a message", false);
        $missing[] = $name;
        continue;
    }
    foreach ($got as $i => $m) {
        $RENDERED[$name . ($i ? '-' . ($i + 1) : '')] = $m;
    }
    // Both halves and a subject. A composer that returns HTML and no text half is
    // half an email — plain-text clients and every accessibility path read that one.
    $ok = true;
    foreach ($got as $m) {
        if (trim((string) ($m['subject'] ?? '')) === '') { $ok = false; }
        if (strlen((string) ($m['text'] ?? '')) < 40) { $ok = false; }
        if (strpos((string) ($m['html'] ?? ''), '<!DOCTYPE html>') !== 0) { $ok = false; }
    }
    chk("$name — subject, text half and a full HTML document", $ok);
}
chk('every one of the ' . count($JOBS) . ' templates rendered', $missing === []);

// The point of the gate is COVERAGE, so it asserts its own reach: every composer
// mailer.php defines must be exercised here, or the list above has fallen behind
// the file. Transport and thin wrappers are named exclusions with a reason.
$mlSrc = (string) file_get_contents($APP . '/mailer.php');
preg_match_all('/^function (send_[a-z_]+)\(/m', $mlSrc, $mm);
$EXCLUDE = [
    'send_owner' => 'the transport for every owner email, driven by all of them',
    'send_arrival_for_booking' => 'a DB lookup wrapper around send_arrival_email',
    'send_autopay_notice' => 'thin sender over autopay_notice_body, driven below',
    'send_autopay_failure' => 'thin sender over autopay_failure_body, driven below',
    // The PURE builder behind send_cancellation_email, which IS driven below — and
    // test-payrail drives this one directly with no DB, which is the whole reason it
    // takes host_name on its payload rather than calling content_value().
    'send_cancellation_email_body' => 'pure builder under send_cancellation_email',
];
$declared = array_diff($mm[1], array_keys($EXCLUDE));
$driven = [];
foreach ($JOBS as [$n, $g, $f]) {
    $driven[] = $n;
}
$src = (string) file_get_contents(__FILE__);
$unreached = [];
foreach ($declared as $fn) {
    if (!preg_match('/(?<![a-z_])' . preg_quote($fn, '/') . '\s*\(/', substr($src, strpos($src, '$JOBS = ['))) ) {
        $unreached[] = $fn;
    }
}
chk('no composer in mailer.php is left unreached (' . count($declared) . ' covered)', $unreached === []);
if ($unreached) {
    echo "        never driven: " . implode(', ', $unreached) . "\n";
}

// THE OWNER CAN LOOK AT EVERY ONE OF THEM. email-samples.php is the "send me a
// sample" screen, and its registry had drifted to 13 of the 19 real senders —
// omitting BOTH automatic-payment emails, the enquiry acknowledgement and the
// owner's own new-enquiry notification. It looked decided and was accidental, which
// is precisely what a registry does when nothing checks it. The exclusions are the
// same shape as above: transport, thin wrappers, and the two composers that have
// their own live preview inside the back office.
$smpSrc = (string) file_get_contents($APP . '/email-samples.php');
// NB this list is written out in full and does NOT reuse $EXCLUDE. Deriving it from
// the render exclusions was the first version and it was VACUOUS: $EXCLUDE holds the
// two autopay SENDERS (thin wrappers over their pure builders, which §1 drives
// instead) — and those two are exactly the previews that were missing, so inheriting
// it made the check skip the thing it was written to catch. Break-tested.
$PREVIEW_EXCLUDE = [
    'send_owner' => 'the transport, not an email of its own',
    'send_arrival_for_booking' => 'a DB lookup wrapper around send_arrival_email',
    'send_cancellation_email_body' => 'pure builder under send_cancellation_email',
    'send_enquiry_reply_email' => 'previewed live in the enquiry composer itself',
];
$noPreview = [];
foreach ($mm[1] as $fn) {
    if (isset($PREVIEW_EXCLUDE[$fn])) {
        continue;
    }
    if (!preg_match('/(?<![a-z_])' . preg_quote($fn, '/') . '\s*\(/', $smpSrc)) {
        $noPreview[] = $fn;
    }
}
chk('the owner can preview every email the app sends', $noPreview === []);
if ($noPreview) {
    echo "        no entry in email-samples.php: " . implode(', ', $noPreview) . "\n";
}

// ============================================================================
//  §2  EVERY COLOUR IN THE RESULT IS LEGIBLE
// ============================================================================
echo "\n-- \u{00A7}2 contrast, by arithmetic on the rendered output --\n";

// Relative luminance and contrast ratio, WCAG 2.1 §1.4.3 verbatim.
function em_lum(string $hex): float
{
    $hex = ltrim($hex, '#');
    if (strlen($hex) === 3) {
        $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
    }
    $out = 0.0;
    foreach ([[0, 0.2126], [2, 0.7152], [4, 0.0722]] as [$i, $w]) {
        $c = hexdec(substr($hex, $i, 2)) / 255;
        $out += $w * ($c <= 0.03928 ? $c / 12.92 : pow(($c + 0.055) / 1.055, 2.4));
    }
    return $out;
}
function em_ratio(string $a, string $b): float
{
    $la = em_lum($a);
    $lb = em_lum($b);
    $hi = max($la, $lb);
    $lo = min($la, $lb);
    return ($hi + 0.05) / ($lo + 0.05);
}

// Walk the document keeping a stack of the inherited background, because an ink is
// only legible relative to the ground it ACTUALLY sits on — the first version of
// this measured everything against white and reported the tinted panels as fine.
// The root is the shell's own outer ground.
function em_scan(string $html): array
{
    $out = [];
    $bg = ['#ECE5D7'];
    $depth = 0;
    preg_match_all('#<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>#', $html, $tags, PREG_SET_ORDER);
    $void = ['br' => 1, 'img' => 1, 'meta' => 1, 'link' => 1, 'hr' => 1, 'input' => 1];
    foreach ($tags as $t) {
        [$whole, $close, $tag, $attrs] = $t;
        $tag = strtolower($tag);
        if ($close === '/') {
            if (count($bg) > 1) {
                array_pop($bg);
            }
            continue;
        }
        $selfClose = isset($void[$tag]) || substr(rtrim($attrs), -1) === '/';
        $style = '';
        if (preg_match('/style\s*=\s*"([^"]*)"/i', $attrs, $m)) {
            $style = $m[1];
        }
        $here = end($bg);
        if (preg_match('/background(?:-color)?\s*:\s*(#[0-9A-Fa-f]{3,6})\b/i', $style, $m)) {
            $here = $m[1];
        } elseif (preg_match('/bgcolor\s*=\s*"(#[0-9A-Fa-f]{3,6})"/i', $attrs, $m)) {
            $here = $m[1];
        }
        if (preg_match('/(?<!-)\bcolor\s*:\s*(#[0-9A-Fa-f]{3,6})\b/i', $style, $m)) {
            $fs = preg_match('/font-size\s*:\s*([\d.]+)px/i', $style, $f) ? (float) $f[1] : 15.0;
            $fw = 400;
            if (preg_match('/font-weight\s*:\s*(\d+|bold)/i', $style, $w)) {
                $fw = $w[1] === 'bold' ? 700 : (int) $w[1];
            }
            $out[] = ['ink' => $m[1], 'bg' => $here, 'size' => $fs, 'weight' => $fw, 'tag' => $tag];
        }
        if (!$selfClose) {
            $bg[] = $here;
        }
    }
    return $out;
}

$nodes = 0;
$below = [];
foreach ($RENDERED as $name => $m) {
    foreach (em_scan((string) $m['html']) as $n) {
        $nodes++;
        $r = em_ratio($n['ink'], $n['bg']);
        // WCAG large text: >=24px, or >=18.66px at 700+. Everything else needs 4.5.
        $large = $n['size'] >= 24 || ($n['size'] >= 18.66 && $n['weight'] >= 700);
        if ($r < ($large ? 3.0 : 4.5)) {
            $below[] = sprintf('%s: %s on %s at %spx = %.2f:1', $name, $n['ink'], $n['bg'], $n['size'], $r);
        }
    }
}
// A gate that measures nothing passes everything — the vacuity guard a11y-test §1b
// and smoke-test §7 both carry. 300+ is the observed floor across the 21 templates.
chk("the scanner actually found coloured text ($nodes nodes)", $nodes >= 250);
chk('no email text sits below WCAG AA', $below === []);
foreach (array_slice($below, 0, 12) as $b) {
    echo "        $b\n";
}
if (count($below) > 12) {
    echo "        … and " . (count($below) - 12) . " more\n";
}

// The two tokens are the ONE definition each, so they are asserted directly as
// well — a repointed call site is worthless if the token itself drifts.
chk('email_muted_ink clears AA on all three grounds',
    em_ratio(email_muted_ink(), '#FFFFFF') >= 4.5
    && em_ratio(email_muted_ink(), '#FAF6EC') >= 4.5
    && em_ratio(email_muted_ink(), '#ECE5D7') >= 4.5);
chk('email_accent_ink clears AA on all three grounds',
    em_ratio(email_accent_ink(), '#FFFFFF') >= 4.5
    && em_ratio(email_accent_ink(), '#FAF6EC') >= 4.5
    && em_ratio(email_accent_ink(), '#ECE5D7') >= 4.5);
// And the accent stays a FILL: the button's own ink has to clear it. This is the
// half that makes the ink/fill split coherent rather than just two more colours.
chk('the accent works as a button fill under its own ink',
    em_ratio('#3A2E1E', '#C79A64') >= 4.5 && em_ratio('#3A2E1E', '#D6A785') >= 4.5);

// ============================================================================
//  §4  THE OWNER'S "EMAIL ME SAMPLES" BUTTON ACTUALLY SENDS ALL OF THEM
// ============================================================================
// §3 proves every email HAS a registry entry. That is not the same as the entry
// WORKING: #1027 found email-samples.php handing the money composers a booking row
// where they expect a derived payload, so the owner's own preview quoted figures no
// guest would ever see — with a perfectly valid registry entry. The only check that
// catches that is running the thing.
//
// WHAT THIS SECTION DOES NOT PROVE, so nobody assumes it does: it shows every sample
// is REACHABLE and DELIVERS, not that its figures are right. Break-tested — putting a
// non-numeric total into a fixture still sends happily (PHP casts it to 0.0), so a
// wrong number passes here. The arithmetic is test-payrail's job, which drives the
// money composers against expected values; this one guards the affordance.
//
// chb_send_sample_emails() is a plain function (require_admin() guards the route
// BELOW it), so it can be driven here. Its own requires are stripped: this harness
// has already supplied db.php's helpers and the capture-spliced mailer.
echo "\n-- \u{00A7}4 every sample actually sends --\n";
$smpTmp = tempnam(sys_get_temp_dir(), 'chb_samples_') . '.php';
// Strip its requires at ANY indentation: chb_send_sample_emails() re-requires
// mailer.php from INSIDE the function body, and an anchored ^require_once missed it,
// so the real mailer clashed with this harness's capture-spliced copy.
$smp = preg_replace(
    '#^\s*require_once __DIR__ \. \'/(db|mailer)\.php\';$#m',
    '// require stripped for the harness',
    $smpSrc,
);
// NB no tail-stripping is needed: email-samples.php already guards its route with
// `if (basename($_SERVER['SCRIPT_NAME']) === 'email-samples.php')`, so including the
// file defines the function and does nothing else. (Cutting the tail by hand was the
// first attempt and it sliced mid-block.)
// The copy lives outside the app directory, so its own __DIR__ would resolve to the
// temp dir — and the waitlist sample requires waitlist-lib.php relative to it. Pin
// __DIR__ to the real app directory in the copy. (Found by the gate: "Failed opening
// required '/tmp/waitlist-lib.php'".)
$smp = str_replace('__DIR__', var_export($APP, true), $smp);
file_put_contents($smpTmp, $smp);
$before = count($GLOBALS['CAP']);
$sampleRes = null;
$sampleErr = '';
try {
    require_once $smpTmp;
    $sampleRes = chb_send_sample_emails('all', '[SAMPLE] ');
} catch (\Throwable $e) {
    $sampleErr = $e->getMessage();
}
@unlink($smpTmp);
chk('the sample sender runs at all' . ($sampleErr !== '' ? " — $sampleErr" : ''), $sampleErr === '');
if (is_array($sampleRes)) {
    $results = $sampleRes['results'] ?? [];
    $failed = [];
    foreach ($results as $r) {
        if (empty($r['ok'])) {
            $failed[] = ($r['label'] ?? $r['which'] ?? '?') . ': ' . ($r['error'] ?? 'no reason given');
        }
    }
    chk('it reports every sample as sent (' . count($results) . ' samples)', $results !== [] && $failed === []);
    foreach (array_slice($failed, 0, 10) as $f) {
        echo "        $f\n";
    }
    // And the transport really was handed that many messages — a sender that
    // reports ok without composing anything is the failure this pairs against.
    $captured = count($GLOBALS['CAP']) - $before;
    chk("the transport received one message per sample ($captured captured)", $captured >= count($results));
    // MARKED AS A SAMPLE — asserted where the marking actually happens. The
    // "[SAMPLE] " prefix is applied by smtp_TRANSMIT, which is downstream of the
    // smtp_send this harness splices, so the captured subjects here genuinely cannot
    // show it and a check on them would be measuring the harness. Both halves of the
    // real mechanism are checked instead: the sender sets the global, and the
    // transport prepends it. Without the marking, a sample is indistinguishable from
    // a real email in the owner's inbox.
    chk('the sample sender marks its messages', strpos($smpSrc, "\$GLOBALS['__chb_test_prefix'] = \$prefix;") !== false);
    chk('...and the transport prepends that mark to the subject',
        preg_match("/if \\(!empty\\(\\\$GLOBALS\\['__chb_test_prefix'\\]\\)\\) \\{\\s*\\n\\s*\\\$subject = \\\$GLOBALS\\['__chb_test_prefix'\\] \\. \\\$subject;/", $mlSrc) === 1);
    chk('...and clears it afterwards, so a real send is never marked',
        substr_count($smpSrc, "unset(\$GLOBALS['__chb_test_prefix']);") >= 2);

    // The owner is the only recipient. A sample addressed to a guest fixture would
    // be a real email to a stranger.
    $toOwner = true;
    foreach (array_slice($GLOBALS['CAP'], $before) as $m) {
        if (trim((string) ($m['to'] ?? '')) === '') {
            $toOwner = false;
        }
    }
    chk('and addressed somewhere, never a blank recipient', $toOwner);
}

// ============================================================================
//  §5  NO RETIRED INK ANYWHERE AN EMAIL IS COMPOSED
// ============================================================================
// §2 measures the RENDERED output, which is the strongest check there is — but it
// can only see the 21 templates mailer.php composes. Eleven other files build emails
// too, script-level in a cron or inline in a route, so nothing renders them and §2
// is blind to them. Measured: the weekly owner digest and the weekly analytics email
// were still setting #8E877A as TEXT (3.56:1) after that ink was retired from
// mailer.php, and the chat notification's "View the photo" link was #B07A3F
// (3.68:1) — i.e. the contrast fix was narrower than it looked, and nothing said so.
//
// This is a SOURCE ratchet, and deliberately narrow about what it forbids: a retired
// ink used as `color:` (text). The same hexes are still legitimate as FILLS — the
// accent bar email_shell draws, the swatch email_h puts beside a heading — so
// forbidding the value outright would fail on correct code and get worked around.
echo "\n-- \u{00A7}5 no retired ink used as text, in any email-composing file --\n";
$RETIRED = [
    '#8E877A' => '3.56:1 on white — use email_muted_ink()',
    '#9A927F' => '3.09:1 on white — use email_muted_ink()',
    '#A0987F' => '2.67:1 on the tinted panel — use email_muted_ink()',
    '#A79E8A' => '2.12:1 on the outer ground — use email_muted_ink()',
    '#B07A3F' => '3.68:1 on white — use email_accent_ink()',
    '#C79A64' => 'the accent as TEXT is 2.55:1 — use email_accent_ink() (it stays fine as a FILL)',
    '#D6A785' => 'as TEXT it is 2.16:1 — use email_accent_ink() (it stays fine as a FILL)',
    '#ffb74d' => '1.73:1 as 13px text — use email_warn_ink() (fine as a FILL)',
    '#e57373' => '2.99:1 as text — use email_alert_ink() (fine as a FILL)',
];
$composers = [];
foreach (glob($APP . '/*.php') as $f) {
    $b = basename($f);
    if (strpos($b, 'test-') === 0) {
        continue;
    }
    $src = (string) file_get_contents($f);
    // "Composes an email" = reaches for the design system's blocks.
    if (preg_match('/(?<![a-z_])email_(shell|p|h|rows|note|btn|amount|footnote|money_rows)\s*\(/', $src)) {
        $composers[$b] = $src;
    }
}
// Vacuity guard: if the discovery stops finding files, everything below passes. The floor
// went 8 → 4 → 2 as the compositions moved into mailer.php's builders, and 2 is the END
// STATE: mailer.php, plus waitlist-lib.php, whose wl_send() is already a plain callable
// taking a row (a builder that happens to live next to the waitlist rules). mailer.php is
// asserted BY NAME too, since a count alone would pass on two files that happened not to
// include the real one.
chk(
    'found the files that compose emails (' . implode(', ', array_keys($composers)) . ')',
    count($composers) >= 2 && isset($composers['mailer.php']),
);
$offenders = [];
foreach ($composers as $b => $src) {
    // Strip line comments first — this file NAMES every retired ink in the table
    // above, and the negative-scan-sees-its-own-explanation trap has already been
    // walked into twice in test-payrail.
    $body = (string) preg_replace('#^\s*//.*$#m', '', $src);
    foreach ($RETIRED as $hex => $why) {
        // Only as an ink: `color:<hex>`, never background/border/bgcolor.
        if (preg_match('/(?<!-)\bcolor\s*:\s*' . preg_quote($hex, '/') . '\b/i', $body)) {
            $offenders[] = "$b uses $hex as text — $why";
            continue;
        }
        // …AND THE CONCATENATED FORM, which is how the real one was written. The digest
        // set its needs-attention ink as `'…;color:' . ($sev === 'action' ? '#e57373' :
        // '#ffb74d') . ';…'` — the hex is a separate string literal, so the adjacent
        // match above could not see it and reported "no retired ink" while a 1.73:1 amber
        // was shipping. §2's measurement of the RENDERED output is what actually caught
        // it; this makes the source scan able to see the same shape. The window is short
        // and anchored on `color:` closing its own quote, so a FILL (bgcolor=, background:)
        // is still out of scope.
        if (preg_match('/(?<!-)\bcolor\s*:[^;\'"]*\'\s*\.[^;]{0,240}' . preg_quote($hex, '/') . '/is', $body)) {
            $offenders[] = "$b uses $hex as text, via concatenation — $why";
        }
    }
}
chk('no retired ink is set as text anywhere', $offenders === []);
foreach (array_slice($offenders, 0, 10) as $o) {
    echo "        $o\n";
}

@unlink($tmp);
echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail EMAIL-RENDER CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass EMAIL-RENDER CHECKS PASSED \u{2705}\n";
