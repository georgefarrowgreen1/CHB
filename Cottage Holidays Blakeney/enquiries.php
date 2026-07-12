<?php
// ============================================================
//  api/enquiries.php
//  POST {action:'submit', ...}   -> public: create an enquiry
//  GET                           -> admin: list pending enquiries
//  POST {action:'approve', id}   -> admin: convert to booking (snapshots price)
//  POST {action:'decline', id}   -> admin: delete enquiry
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';
require_once __DIR__ . '/enquiry-actions.php'; // shared approve/decline logic + email-action tokens

// The admin GET payload, as a function so admin-bootstrap.php can serve the
// SAME data in its combined back-office boot response. Caller must require_admin.
function enquiries_admin_payload()
{
    // Live enquiries only — declined ones are soft-deleted (declined_at set).
    // Fall back to the unfiltered query if the column doesn't exist yet (the
    // brief window after a deploy but before migrate.php adds it).
    try {
        $rows = db()->query('SELECT * FROM enquiries WHERE declined_at IS NULL ORDER BY created_at ASC')->fetchAll();
    } catch (\Throwable $e) {
        $rows = db()->query('SELECT * FROM enquiries ORDER BY created_at ASC')->fetchAll();
    }
    // Repeat-guest recognition: tag each enquiry with how many COMPLETED stays the
    // same email has already had (matched case-insensitively), plus when/where the
    // most recent one ended. Lets the inbox badge returning guests. Cached per email
    // so duplicate emails across enquiries don't re-query.
    try {
        // Plain equality is already case-insensitive under the table's *_ci collation,
        // and (unlike LOWER(email)=...) it can use idx_email.
        $histStmt = db()->prepare(
            'SELECT check_out, prop_key FROM bookings
             WHERE email = ? AND email <> \'\' AND check_out < CURDATE()
             ORDER BY check_out DESC',
        );
        $cache = [];
        foreach ($rows as &$r) {
            $email = trim((string) ($r['email'] ?? ''));
            if ($email === '') {
                $r['prior_stays'] = 0;
                continue;
            }
            $key = strtolower($email);
            if (!array_key_exists($key, $cache)) {
                $histStmt->execute([$email]);
                $past = $histStmt->fetchAll();
                $cache[$key] = [
                    'prior_stays' => count($past),
                    'last_stay_end' => $past ? $past[0]['check_out'] : null,
                    'last_stay_prop' => $past ? $past[0]['prop_key'] : null,
                ];
            }
            $r['prior_stays'] = $cache[$key]['prior_stays'];
            $r['last_stay_end'] = $cache[$key]['last_stay_end'];
            $r['last_stay_prop'] = $cache[$key]['last_stay_prop'];
        }
        unset($r);
    } catch (\Throwable $e) {
        /* history is a nicety; never block the enquiry list over it */
    }
    return ['enquiries' => $rows];
}

// When admin-bootstrap.php includes this file for the payload helper, stop
// before the HTTP routing — routes below run only when this file IS the request.
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'enquiries.php') {
    return;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_admin();
    json_out(enquiries_admin_payload());
}

$in = body();
$action = $in['action'] ?? '';

if ($action === 'draft') {
    // Public — the enquiry form quietly saves a server-side draft once the
    // visitor has typed a valid email, so an abandoned enquiry can get ONE
    // "pick up where you left off" email (enquiry-nudge.php). Deliberately
    // minimal: only what that email needs — no address/postcode/message.
    // One row per email (upsert); a real submission below deletes it.
    rate_limit('enqdraft', 30, 15);
    $email = strtolower(clean($in['email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
        json_out(['ok' => true]); // silently ignore — never surface errors in the form
    }
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate($propKey)) {
        json_out(['ok' => true]);
    }
    $checkIn = clean($in['check_in'] ?? '');
    $checkOut = clean($in['check_out'] ?? '');
    $dateOk = fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
    if (!$dateOk($checkIn) || !$dateOk($checkOut) || $checkOut <= $checkIn) {
        $checkIn = null;
        $checkOut = null;
    }
    try {
        db()
            ->prepare(
                'INSERT INTO enquiry_drafts (email, prop_key, name, check_in, check_out, adults, children)
                 VALUES (?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE prop_key = VALUES(prop_key), name = VALUES(name),
                   check_in = VALUES(check_in), check_out = VALUES(check_out),
                   adults = VALUES(adults), children = VALUES(children)',
            )
            ->execute([
                $email,
                $propKey,
                mb_substr(clean($in['name'] ?? ''), 0, 120),
                $checkIn,
                $checkOut,
                max(1, min(99, (int) ($in['adults'] ?? 2))),
                max(0, min(99, (int) ($in['children'] ?? 0))),
            ]);
    } catch (\Throwable $e) {
        /* pre-migration or DB hiccup — the draft is a nicety, never an error */
    }
    json_out(['ok' => true]);
}

if ($action === 'submit') {
    // Public — anyone can submit an enquiry. Rate-limit per IP to stop floods.
    // The admin "Edit / Move Enquiry" screen also lands here (decline + resubmit):
    // for that, skip the rate limit and — below — the guest acknowledgement and
    // owner alert, so editing an enquiry never re-sends "we received your
    // enquiry" to the guest or re-pings the owner about their own edit.
    $isAdminEdit = !empty($_SESSION['admin_id']);
    if (!$isAdminEdit) {
        rate_limit('enquiry', 6, 15);
    }
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate($propKey)) {
        json_out(['error' => 'Unknown property'], 400);
    }
    $name = clean($in['name'] ?? '');
    $checkIn = clean($in['check_in'] ?? '');
    $checkOut = clean($in['check_out'] ?? '');
    if ($name === '' || !$checkIn || !$checkOut) {
        json_out(['error' => 'Name and both dates are required'], 400);
    }
    // Reject malformed dates up front — otherwise a non-ISO value slips past the
    // string comparison below and reaches strtotime(), yielding a nonsense night
    // count. A clean 400 is clearer than odd downstream behaviour.
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkIn) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkOut)) {
        json_out(['error' => 'Please provide valid dates (YYYY-MM-DD).'], 400);
    }
    if ($checkOut <= $checkIn) {
        json_out(['error' => 'Check-out must be after check-in'], 400);
    }
    // The picker blocks past dates client-side; enforce it here so a direct
    // POST can't create a stay that has already started. (Admin edits are
    // exempt — the owner may legitimately amend a historic enquiry.)
    if (!$isAdminEdit && $checkIn < date('Y-m-d')) {
        json_out(['error' => 'Check-in can’t be in the past.'], 400);
    }
    // The email was previously stored with NO validation at all — a typo'd
    // address sailed through submit, approval and the confirmation send before
    // anyone noticed (see the ntl-world.com incident). Validate the format and
    // run the smart deliverability check; a dead domain with an obvious fix gets
    // a "did you mean" message the form shows inline. Deliverability fails OPEN
    // (DNS trouble never blocks a real guest); disposable addresses are allowed
    // here — an enquiry is transactional, not marketing.
    $enqEmail = clean($in['email'] ?? '');
    if ($enqEmail !== '') {
        $chk = email_deliverability($enqEmail);
        if (empty($chk['ok']) && ($chk['reason'] ?? '') === 'format') {
            json_out(['error' => 'That email address doesn’t look right — please check it.'], 400);
        }
        if (empty($chk['ok']) && in_array($chk['reason'] ?? '', ['no_mail', 'typo'], true) && !empty($chk['suggest'])) {
            json_out(['error' => 'That email looks mistyped — did you mean ' . $chk['suggest'] . '?'], 400);
        }
        if (empty($chk['ok']) && ($chk['reason'] ?? '') === 'no_mail') {
            json_out(['error' => 'That email domain can’t receive mail — please check the part after the @.'], 400);
        }
    }

    // We must be able to REPLY: require an email or a phone number. Without
    // either, the ack email is skipped and the owner has no way to answer —
    // the guest waits for a response that can never come.
    $enqPhone = clean($in['phone'] ?? '');
    if (!$isAdminEdit && $enqEmail === '' && $enqPhone === '') {
        json_out(['error' => 'Please give an email address or phone number so we can reply.'], 400);
    }
    // The form requires a message client-side; mirror it here (admin edits may
    // carry an empty notes field, so they're exempt).
    if (!$isAdminEdit && trim((string) ($in['message'] ?? '')) === '') {
        json_out(['error' => 'Please tell us a little about your party.'], 400);
    }

    $address = clean($in['address'] ?? '');
    $postcode = clean($in['postcode'] ?? '');
    if ($address === '') {
        json_out(['error' => 'Please enter your UK address'], 400);
    }
    if (!uk_postcode_valid($postcode)) {
        json_out(['error' => 'Please enter a valid UK postcode'], 400);
    }

    // Occupancy limits per property (mirror of the front end; enforced here so
    // the public enquiry form can't be bypassed).
    $adultsN = max(1, (int) ($in['adults'] ?? 2));
    $childrenN = max(0, (int) ($in['children'] ?? 0));
    $limits = occupancy_limits(); // single source of truth (db.php) — active cottages only
    // Reject archived/inactive cottages: get_rate() still returns a rate for an
    // archived prop, but occupancy_limits only lists live ones — so an archived
    // prop_key would otherwise skip the occupancy check entirely.
    if (!isset($limits[$propKey])) {
        json_out(['error' => 'That cottage is not currently taking bookings.'], 400);
    }
    $L = $limits[$propKey];
    if ($adultsN > $L['maxAdults'] || $childrenN > $L['maxChildren'] || $adultsN + $childrenN > $L['maxTotal']) {
        json_out(['error' => 'That party size is over the limit for this property.'], 400);
    }

    // Booking rules (min/max nights, arrival days) — mirror of the front end,
    // enforced here so the public form can't be bypassed. Rules are stored in the
    // content table under 'rules-<propKey>' as JSON; fall back to defaults.
    $nights = (int) round((strtotime($checkOut) - strtotime($checkIn)) / 86400);
    $defaultRules = ['minNights' => 2, 'maxNights' => 0, 'arrivalDays' => []];
    $rules = $defaultRules;
    $rs = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
    $rs->execute(['rules-' . $propKey]);
    $rrow = $rs->fetch();
    if ($rrow) {
        $decoded = json_decode($rrow['item_value'], true);
        if (is_array($decoded)) {
            $rules = array_merge($defaultRules, $decoded);
        }
    }
    $minN = max(1, (int) $rules['minNights']);
    if ($nights < $minN) {
        json_out(
            ['error' => 'This property has a minimum stay of ' . $minN . ' night' . ($minN === 1 ? '' : 's') . '.'],
            400,
        );
    }
    $maxN = max(0, (int) $rules['maxNights']);
    if ($maxN > 0 && $nights > $maxN) {
        json_out(
            ['error' => 'This property has a maximum stay of ' . $maxN . ' night' . ($maxN === 1 ? '' : 's') . '.'],
            400,
        );
    }
    $arrivalDays = is_array($rules['arrivalDays'] ?? null) ? $rules['arrivalDays'] : [];
    if (count($arrivalDays) > 0) {
        $arrivalDow = (int) date('w', strtotime($checkIn)); // 0=Sun .. 6=Sat
        if (!in_array($arrivalDow, array_map('intval', $arrivalDays), true)) {
            $dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            sort($arrivalDays);
            $names = implode(', ', array_map(fn($i) => $dayNames[(int) $i] ?? '', $arrivalDays));
            json_out(['error' => 'Arrivals at this property are only on: ' . $names . '.'], 400);
        }
    }

    // Availability: reject if these dates clash with a confirmed booking or an
    // imported iCal block (Airbnb/Vrbo). Shared helper in db.php.
    if (dates_clash($propKey, $checkIn, $checkOut)) {
        json_out(['error' => 'Sorry, those dates are no longer available. Please choose different dates.'], 409);
    }

    // Record terms acceptance (server timestamp is authoritative). The client
    // blocks submit without the tick; enforce it here so a direct PUBLIC POST
    // can't create a booking-to-be with NULL terms acceptance. Admin edits are
    // exempt (the owner amending an enquiry mustn't wipe or fake acceptance —
    // the original values are preserved by the edit path).
    if (!$isAdminEdit && empty($in['terms_accepted'])) {
        json_out(['error' => 'Please accept the booking terms to send your enquiry.'], 400);
    }
    $termsAt = !empty($in['terms_accepted']) ? date('Y-m-d H:i:s') : null;
    $termsVer = $termsAt ? clean($in['terms_version'] ?? '') : null;
    // Admin Edit/Move works as decline + resubmit — carry the guest's ORIGINAL
    // acceptance across so an edit never silently wipes (or re-dates) it.
    if ($isAdminEdit && $termsAt === null && !empty($in['terms_accepted_at_passthrough'])) {
        $orig = clean($in['terms_accepted_at_passthrough']);
        if (preg_match('/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/', $orig)) {
            $termsAt = $orig;
            $termsVer = clean($in['terms_version'] ?? '') ?: null;
        }
    }

    db()
        ->prepare(
            'INSERT INTO enquiries
        (prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,message,terms_accepted_at,terms_version,sms_opt_in)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        ->execute([
            $propKey,
            $name,
            clean($in['email'] ?? ''),
            clean($in['phone'] ?? ''),
            $address,
            $postcode,
            $checkIn,
            $checkOut,
            clean($in['check_in_time'] ?? '15:00'),
            clean($in['check_out_time'] ?? '10:00'),
            $adultsN,
            $childrenN,
            clean($in['message'] ?? ''),
            $termsAt,
            $termsVer,
            // SMS consent only counts if they actually left a number to text.
            !empty($in['sms_opt_in']) && clean($in['phone'] ?? '') !== '' ? 1 : 0,
        ]);
    $enqId = (int) db()->lastInsertId();
    // A real enquiry supersedes any abandoned-draft rescue for this email.
    try {
        $draftEmail = strtolower(clean($in['email'] ?? ''));
        if ($draftEmail !== '') {
            db()->prepare('DELETE FROM enquiry_drafts WHERE email = ?')->execute([$draftEmail]);
        }
    } catch (\Throwable $e) {
    }
    // Wake the owner's devices (best-effort) — not for the owner's own edit.
    if (!$isAdminEdit) {
        try {
            require_once __DIR__ . '/webpush.php';
            alert_owner('New enquiry', trim(($name ?: 'Someone') . ' · ' . $checkIn . '–' . $checkOut));
        } catch (\Throwable $e) {
        }
    }

    // Does this email already have a guest account? Used to tailor the follow-up so a
    // returning guest is nudged to sign in rather than create another account.
    $email = clean($in['email'] ?? '');
    $accountExists = false;
    if ($email !== '') {
        try {
            $st = db()->prepare('SELECT 1 FROM guests WHERE email = ? LIMIT 1');
            $st->execute([$email]);
            $accountExists = (bool) $st->fetchColumn();
        } catch (\Throwable $e) {
        }
    }
    // Emails go out AFTER the response is flushed (mail_after_response): the
    // enquiry is already saved, so the guest shouldn't wait on two SMTP
    // handshakes — on a slow mail day that blocked the public form long enough
    // to risk a host gateway timeout. Both sends stay best-effort.
    // Skipped entirely for an admin edit — the guest already got their
    // acknowledgement when they originally enquired, and the owner doesn't
    // need an email about an enquiry they just edited themselves.
    if ($isAdminEdit) {
        json_out(['ok' => true, 'account_exists' => $accountExists]);
    }
    require_once __DIR__ . '/mailer.php';
    $ackName = $name;
    $ackEmail = $email;
    $ackAccountExists = $accountExists;
    $ownerCtx = [
        'id' => $enqId,
        'name' => $name,
        'email' => $email,
        'phone' => clean($in['phone'] ?? ''),
        'address' => $address,
        'postcode' => $postcode,
        'prop_key' => $propKey,
        'check_in' => $checkIn,
        'check_out' => $checkOut,
        'check_in_time' => clean($in['check_in_time'] ?? '15:00'),
        'check_out_time' => clean($in['check_out_time'] ?? '10:00'),
        'adults' => $adultsN,
        'children' => $childrenN,
        'message' => clean($in['message'] ?? ''),
    ];
    $base = site_base_url(); // built from $_SERVER now, used after flush
    mail_after_response(function () use ($ackName, $ackEmail, $ackAccountExists, $ownerCtx, $base) {
        // Acknowledge the enquiry to the guest (best-effort).
        try {
            if ($ackEmail !== '' && function_exists('send_enquiry_ack')) {
                send_enquiry_ack(
                    [
                        'name' => $ackName,
                        'email' => $ackEmail,
                        'prop_key' => $ownerCtx['prop_key'],
                        'check_in' => $ownerCtx['check_in'],
                        'check_out' => $ownerCtx['check_out'],
                    ],
                    $ackAccountExists,
                );
            }
        } catch (\Throwable $e) {
        }

        // Let the owner act straight from their inbox: a notification email with
        // signed one-tap Review/Approve/Decline links (enquiry-action.php shows a
        // confirmation page first, so mail scanners that prefetch links can't act).
        try {
            if (function_exists('send_owner_enquiry_email')) {
                $newId = $ownerCtx['id'];
                // Full context for the owner's inbox: the price the site quoted
                // (estimate — approval snapshots the real figures) and whether this
                // email has completed stays before (returning guest).
                $priceEst = null;
                try {
                    $rate = get_rate($ownerCtx['prop_key']);
                    if ($rate) {
                        $priceEst = price_breakdown($rate, $ownerCtx['adults'], $ownerCtx['children'], $ownerCtx['check_in'], $ownerCtx['check_out']);
                    }
                } catch (\Throwable $e) {
                }
                $priorStays = 0;
                try {
                    if ($ownerCtx['email'] !== '') {
                        $ps = db()->prepare(
                            "SELECT COUNT(*) FROM bookings WHERE email = ? AND email <> '' AND check_out < CURDATE()",
                        );
                        $ps->execute([$ownerCtx['email']]);
                        $priorStays = (int) $ps->fetchColumn();
                    }
                } catch (\Throwable $e) {
                }
                send_owner_enquiry_email(
                    $ownerCtx + [
                        'price' => $priceEst,
                        'prior_stays' => $priorStays,
                        'approve_url' =>
                            $base .
                            'enquiry-action.php?id=' .
                            $newId .
                            '&a=approve&t=' .
                            enquiry_action_token($newId, 'approve'),
                        'decline_url' =>
                            $base .
                            'enquiry-action.php?id=' .
                            $newId .
                            '&a=decline&t=' .
                            enquiry_action_token($newId, 'decline'),
                    ],
                );
            }
        } catch (\Throwable $e) {
        }
    });

    json_out(['ok' => true, 'account_exists' => $accountExists]);
}

// All remaining actions are admin-only
require_admin();

if ($action === 'decline') {
    $r = enquiry_decline((int) ($in['id'] ?? 0));
    log_activity('enquiry', 'enquiry.decline', 'Enquiry declined', ['entity' => 'enquiry', 'entity_id' => (string) (int) ($in['id'] ?? 0)]);
    json_out($r);
}

// Undo a decline (soft delete) — return the enquiry to the inbox.
if ($action === 'restore' || $action === 'undecline') {
    require_admin();
    $r = enquiry_undecline((int) ($in['id'] ?? 0));
    if (!empty($r['ok'])) {
        log_activity('enquiry', 'enquiry.restore', 'Declined enquiry restored', ['entity' => 'enquiry', 'entity_id' => (string) (int) ($in['id'] ?? 0)]);
    }
    json_out($r);
}

// Render the confirmation email an approval would send, so the owner can review
// it before approving. No booking is created and nothing is sent.
if ($action === 'approve_preview') {
    require_admin();
    $r = enquiry_confirmation_preview((int) ($in['id'] ?? 0), $in['price_override'] ?? null);
    json_out($r);
}

if ($action === 'approve') {
    // Optional agreed price (parity with the manual add's price override).
    $r = enquiry_approve((int) ($in['id'] ?? 0), $in['price_override'] ?? null);
    if (!empty($r['error'])) {
        json_out(['error' => $r['error']], (int) ($r['code'] ?? 400));
    }
    log_activity('enquiry', 'enquiry.approve', 'Enquiry approved → booking', ['entity' => 'enquiry', 'entity_id' => (string) (int) ($in['id'] ?? 0)]);
    json_out([
        'ok' => true,
        // The new booking's id — the inbox jumps straight to its hub.
        'booking_id' => $r['booking_id'] ?? null,
        'email' => $r['email'] ?? null,
        'payment_request' => $r['payment_request'] ?? null,
        // Deliverability heads-up (enquiry_approve already computes it; it was
        // previously dropped here so only the one-tap email route showed it).
        'email_check' => $r['email_check'] ?? null,
    ]);
}

// Email the enquirer directly from the Inbox: the owner's message, sent in the
// house email style with the enquiry's details (cottage/dates/times/party/
// estimated price) attached underneath. Replies come back to the site inbox.
// Build the branded email HTML for the composer's live preview (no send).
if ($action === 'email_preview') {
    require_admin();
    $id = (int) ($in['id'] ?? 0);
    $s = db()->prepare('SELECT * FROM enquiries WHERE id = ?');
    $s->execute([$id]);
    $row = $s->fetch();
    if (!$row) {
        json_out(['error' => 'Enquiry not found'], 404);
    }
    $message = mb_substr(trim((string) ($in['message'] ?? '')), 0, 5000);
    $subject = mb_substr(clean($in['subject'] ?? ''), 0, 150);
    $priceEst = null;
    try {
        $rate = get_rate($row['prop_key']);
        if ($rate) {
            $priceEst = price_breakdown($rate, (int) $row['adults'], (int) $row['children'], $row['check_in'], $row['check_out']);
        }
    } catch (\Throwable $e) {
    }
    require_once __DIR__ . '/mailer.php';
    $m = build_enquiry_reply_email(array_merge($row, ['price' => $priceEst]), $subject, $message, 'enquiry');
    json_out(['ok' => true, 'html' => $m['html'], 'subject' => $m['subject']]);
}

if ($action === 'email_guest') {
    $id = (int) ($in['id'] ?? 0);
    $s = db()->prepare('SELECT * FROM enquiries WHERE id = ?');
    $s->execute([$id]);
    $row = $s->fetch();
    if (!$row) {
        json_out(['error' => 'Enquiry not found'], 404);
    }
    if (empty($row['email'])) {
        json_out(['error' => 'This enquiry has no email address.'], 400);
    }
    $message = trim((string) ($in['message'] ?? ''));
    if ($message === '') {
        json_out(['error' => 'Please write a message first.'], 400);
    }
    $message = mb_substr($message, 0, 5000);
    $subject = mb_substr(clean($in['subject'] ?? ''), 0, 150);
    // Same estimate the site quoted (approval still snapshots the real figures).
    $priceEst = null;
    try {
        $rate = get_rate($row['prop_key']);
        if ($rate) {
            $priceEst = price_breakdown($rate, (int) $row['adults'], (int) $row['children'], $row['check_in'], $row['check_out']);
        }
    } catch (\Throwable $e) {
    }
    require_once __DIR__ . '/mailer.php';
    $atts = sanitize_email_attachments($in['attachments'] ?? []);
    $r = ['ok' => false, 'error' => 'send failed'];
    try {
        $r = send_enquiry_reply_email(array_merge($row, ['price' => $priceEst]), $subject, $message, 'enquiry', $atts);
    } catch (\Throwable $e) {
        $r = ['ok' => false, 'error' => $e->getMessage()];
    }
    if (empty($r['ok'])) {
        json_out(['error' => $r['error'] ?? 'Could not send the email'], 400);
    }
    log_activity('comms', 'enquiry.email', 'Emailed enquirer — ' . ($row['name'] ?: $row['email']), [
        'entity' => 'enquiry',
        'entity_id' => (string) $id,
        'prop_key' => $row['prop_key'] ?? '',
    ]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
