<?php
// ============================================================
//  email-samples.php — send [SAMPLE]-marked copies of every guest-facing
//  email to the owner's inbox, so they can see exactly what guests receive
//  without making a real booking. Available on the LIVE site (admin-only);
//  the staging Test centre reuses the same sender with a [TEST] prefix.
//
//  POST {action:'send', which:'all'|<key>}  →  {ok, to, sent, results:[…]}
// ============================================================
require_once __DIR__ . '/db.php';

// Build + send the samples. Returns the JSON-ready result array.
// $prefix is prepended to every subject line so samples are unmistakable.
function chb_send_sample_emails($which = 'all', $prefix = '[SAMPLE] ')
{
    require_once __DIR__ . '/mailer.php';
    if (!defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) {
        return ['ok' => false, 'error' => 'No owner email is set in config.php (OWNER_NOTIFY_EMAIL).'];
    }
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        return ['ok' => false, 'error' => 'Email is switched off (MAIL_ENABLED is false).'];
    }

    $owner = OWNER_NOTIFY_EMAIL;

    // A live cottage to name in the samples (falls back to a placeholder).
    $propKey = '';
    $propName = 'A Test Cottage';
    try {
        $row = db()
            ->query('SELECT prop_key, name FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name LIMIT 1')
            ->fetch();
        if ($row) {
            $propKey = $row['prop_key'];
            $propName = $row['name'];
        }
    } catch (\Throwable $e) {
    }

    $base = function_exists('site_base_url') ? site_base_url() : '';
    $ci = date('Y-m-d', strtotime('+30 days'));
    $co = date('Y-m-d', strtotime('+33 days'));

    // One fully-populated dummy booking covering every key the send_* functions read.
    $b = [
        'id' => 0,
        'ref' => 'TEST-0001',
        'name' => 'Test Guest',
        'email' => $owner,
        'phone' => '01234 567890',
        'prop_key' => $propKey,
        'prop_name' => $propName,
        'check_in' => $ci,
        'check_out' => $co,
        'check_in_time' => '15:00',
        'check_out_time' => '10:00',
        'nights' => 3,
        'adults' => 2,
        'children' => 0,
        'payment' => 'deposit',
        'address' => '123 Test Street, Blakeney, Norfolk NR25 7XX',
        'per_night' => 130.0,
        'nightly' => 390.0,
        'tx_pct' => 3,
        'tx_fee' => 11.7,
        'damages_deposit' => 75.0,
        'total' => 476.7,
        'kind' => 'deposit',
        'amount' => 119.18,
        'held' => 75.0,
        'manual' => false,
        'reason' => 'Sample reason (sample email only)',
        'refund' => 119.18,
        'card' => true,
        'fully_paid' => false,
        'balance' => 357.52,
        'paid_so_far' => 119.18,
        'reviewUrl' => $base . 'index.html',
        'googleUrl' => '',
    ];
    $g = ['id' => 0, 'name' => 'Test Guest', 'email' => $owner];
    $payUrl = $base . 'index.html?pay=SAMPLE&b=0';
    $magicUrl = $base . 'index.html?magic=SAMPLE';

    // THE MONEY EMAILS TAKE A DERIVED PAYLOAD, NOT A BOOKING ROW — and this file
    // was handing them the booking above, whose keys mean different things.
    // request_booking_payment() derives what it passes to send_payment_request():
    // 'total' is the RENTAL total, the refundable deposit rides as 'damages', and
    // 'amount' is the stage's own figure. The booking fixture's 'total' is the
    // GRAND total (rental + deposit) and it carries no 'damages' at all, so the
    // owner's preview showed the card taking £119.18 where the live path would
    // take £175.43, and a remainder computed against the grand total — i.e. the
    // one screen whose whole job is showing the owner what the guest will get was
    // the screen quoting figures no guest would ever see. (The live path was and
    // is correct; only the preview was wrong.) Rental here is 390.00 + 11.70 fee.
    $rentalTotal = 401.70;
    $depositAsk = 100.43; // 25% of the rental, the site standard
    $askPayload = [
        'name' => $b['name'],
        'email' => $b['email'],
        'prop_key' => $propKey,
        'prop_name' => $propName,
        'check_in' => $ci,
        'check_out' => $co,
        'kind' => 'deposit',
        'amount' => $depositAsk,
        'total' => $rentalTotal,
        'damages' => 75.0,
        'deposit_charged' => 0,
        'paid' => 0,
        'payment_method' => 'Square card',
        // So the preview shows the deadline the real ask states.
        'balance_due_date' => date('Y-m-d', strtotime($ci . ' -30 days')),
        'instalment_offer' => null,
    ];
    // The BALANCE stage of the same booking, for the reminder — a reminder chases
    // what is left, so previewing it against a deposit-stage payload showed the
    // deposit figure under a "balance due" heading.
    $remindPayload = ['kind' => 'balance', 'amount' => round($rentalTotal - $depositAsk, 2), 'damages' => 0.0, 'paid' => $depositAsk, 'deposit_charged' => 75.0] + $askPayload;
    // The receipt reads the RENTAL rail too ("Rental paid so far £X of £Y"), plus
    // the links and the date its new next-step line needs.
    $receiptPayload = [
        'kind' => 'deposit',
        'amount' => $depositAsk,
        'total' => $rentalTotal,
        'paid_so_far' => $depositAsk,
        'balance' => round($rentalTotal - $depositAsk, 2),
        'deposit_charged' => 75.0,
        'fully_paid' => false,
        'balance_due_date' => $askPayload['balance_due_date'],
        'pay_url' => $payUrl,
        'invoice_url' => $base . 'invoice.php?b=0&token=SAMPLE',
    ] + $b;

    // The enquiry the two enquiry-shaped emails need. Its approve/decline links are
    // deliberately inert sample URLs — a sample must never carry a live token.
    $enqSample = [
        'id' => 0,
        'name' => 'Test Guest',
        'email' => $owner,
        'phone' => '01234 567890',
        'prop_key' => $propKey,
        'prop_name' => $propName,
        'check_in' => $ci,
        'check_out' => $co,
        'check_in_time' => '15:00',
        'check_out_time' => '10:00',
        'adults' => 2,
        'children' => 0,
        'message' => 'Is there parking, and can we arrive a little late?',
        'address' => '123 Test Street, Blakeney',
        'postcode' => 'NR25 7XX',
        'prior_stays' => 0,
        'price' => [
            'total' => $rentalTotal,
            'nights' => 3,
            'perNight' => 130.0,
            'nightly' => 390.0,
            'damagesDeposit' => 75.0,
        ],
        'approve_url' => $base . 'enquiry-action.php?a=approve&id=0&t=SAMPLE',
        'decline_url' => $base . 'enquiry-action.php?a=decline&id=0&t=SAMPLE',
    ];
    // A three-instalment plan, so the notice and the failure both show a SCHEDULE
    // rather than their single-collection wording — the schedule is the half an
    // owner most wants to check before it goes out.
    $autopaySample = $b + [
        'autopay_amount' => 100.43,
        'autopay_instalments' => 3,
        'autopay_due' => date('Y-m-d', strtotime($ci . ' -3 days')),
        'autopay_next_at' => date('Y-m-d', strtotime($ci . ' -33 days')),
    ];

    // which => [human label, sender closure]
    $senders = [
        'confirmation' => ['Booking confirmation', fn() => send_booking_emails($b)],
        'arrival' => ['Arrival information', fn() => send_arrival_email($b)],
        'payment_request' => ['Payment request', fn() => send_payment_request($askPayload, $payUrl)],
        'payment_reminder' => ['Balance reminder', fn() => send_payment_reminder($remindPayload, $payUrl)],
        'payment_receipt' => ['Payment receipt', fn() => send_payment_receipt($receiptPayload)],
        'review_request' => ['Review request', fn() => send_review_request_email($b)],
        'magic_link' => ['Sign-in (magic) link', fn() => send_magic_link_email($g, $magicUrl)],
        'refund' => ['Refund notice', fn() => send_refund_email($b)],
        'deposit_return' => ['Damage deposit return', fn() => send_deposit_return_email($b)],
        'cancellation' => ['Booking cancelled', fn() => send_cancellation_email($b)],
        'anniversary' => ['Anniversary re-invite', fn() => send_anniversary_email($b)],
        'direct_followup' => ['Book-direct re-invite (external reviewer)', fn() => send_direct_followup_email($b)],
        // THE SIX THAT HAD NO PREVIEW. The selection above looked decided and was
        // accidental: it omitted both AUTOMATIC-PAYMENT emails — the newest and most
        // complex money emails in the app, and the two where a wrong figure would be
        // least recoverable — plus the enquiry acknowledgement (the first email most
        // guests ever get) and the owner's own new-enquiry notification (the one they
        // read most). #1027 found the preview screen quoting three wrong figures
        // while the live path was correct, which is exactly why every money email
        // needs to be lookable-at.
        'enquiry_ack' => ['Enquiry acknowledgement', fn() => send_enquiry_ack($enqSample, false)],
        'autopay_notice' => [
            'Automatic payment — advance notice',
            fn() => send_autopay_notice($autopaySample, $payUrl),
        ],
        'autopay_failure' => [
            'Automatic payment — it did not go through',
            // Not stopped, so the sample shows the retry wording rather than the
            // give-up wording; both halves of that branch are gated in test-payrail.
            fn() => send_autopay_failure($autopaySample, 'The card was declined.', false),
        ],
        'owner_enquiry' => ['Owner: new enquiry', fn() => send_owner_enquiry_email($enqSample)],
        // Legacy card-HOLD era. Only reachable for old bookings, so genuinely lower
        // value than the four above — but an owner looking at an old booking can now
        // see what its emails said.
        'hold_request' => ['Card hold request (legacy)', fn() => send_hold_request($b, $payUrl)],
        'hold_released' => ['Card hold released (legacy)', fn() => send_hold_released($b)],
        'owner_notice' => [
            'Owner: payment received',
            fn() => send_owner_payment_notice(array_merge($b, [
                'status' => 'deposit',
                'amount' => $depositAsk,
                // So the preview shows the still-to-collect line the live notice
                // now carries (pay.php passes this).
                'balance' => round($rentalTotal - $depositAsk, 2),
            ])),
        ],
    ];

    $GLOBALS['__chb_test_prefix'] = $prefix;
    $results = [];
    $todo = $which === 'all' ? array_keys($senders) : (isset($senders[$which]) ? [$which] : []);
    if (!$todo) {
        unset($GLOBALS['__chb_test_prefix']);
        return ['ok' => false, 'error' => 'Unknown email type'];
    }
    foreach ($todo as $key) {
        [$label, $fn] = $senders[$key];
        try {
            $r = $fn();
            // send_booking_emails returns a guest/owner pair; flatten to one ok flag.
            $ok = isset($r['guest']) ? !empty($r['guest']['ok']) || !empty($r['owner']['ok']) : !empty($r['ok']);
            $err = isset($r['guest']) ? $r['guest']['error'] ?? ($r['owner']['error'] ?? null) : $r['error'] ?? null;
            $results[] = ['which' => $key, 'label' => $label, 'ok' => $ok, 'error' => $ok ? null : $err];
        } catch (\Throwable $e) {
            $results[] = ['which' => $key, 'label' => $label, 'ok' => false, 'error' => $e->getMessage()];
        }
    }
    unset($GLOBALS['__chb_test_prefix']);
    $sent = count(array_filter($results, fn($r) => $r['ok']));
    return ['ok' => true, 'to' => $owner, 'sent' => $sent, 'results' => $results];
}

// ---- Endpoint (only when this file is hit directly, not when included) ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') === 'email-samples.php') {
    require_admin();
    $in = body();
    if (($in['action'] ?? '') === 'send') {
        json_out(chb_send_sample_emails(clean($in['which'] ?? 'all')));
    }
    json_out(['error' => 'Unknown action'], 400);
}
