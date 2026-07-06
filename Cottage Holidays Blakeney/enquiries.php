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

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_admin();
    $rows = db()->query('SELECT * FROM enquiries ORDER BY created_at ASC')->fetchAll();
    json_out(['enquiries' => $rows]);
}

$in = body();
$action = $in['action'] ?? '';

if ($action === 'submit') {
    // Public — anyone can submit an enquiry. Rate-limit per IP to stop floods.
    rate_limit('enquiry', 6, 15);
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

    // Record terms acceptance (server timestamp is authoritative)
    $termsAt = !empty($in['terms_accepted']) ? date('Y-m-d H:i:s') : null;
    $termsVer = $termsAt ? clean($in['terms_version'] ?? '') : null;

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
    // Wake the owner's devices (best-effort).
    try {
        require_once __DIR__ . '/webpush.php';
        alert_owner('New enquiry', trim(($name ?: 'Someone') . ' · ' . $checkIn . '–' . $checkOut));
    } catch (\Throwable $e) {
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
    // Acknowledge the enquiry by email (best-effort — never block the enquiry on mail).
    try {
        require_once __DIR__ . '/mailer.php';
        if ($email !== '' && function_exists('send_enquiry_ack')) {
            send_enquiry_ack(
                [
                    'name' => $name,
                    'email' => $email,
                    'prop_key' => $propKey,
                    'check_in' => $checkIn,
                    'check_out' => $checkOut,
                ],
                $accountExists,
            );
        }
    } catch (\Throwable $e) {
    }

    // Let the owner act straight from their inbox: a notification email with
    // signed one-tap Review/Approve/Decline links (enquiry-action.php shows a
    // confirmation page first, so mail scanners that prefetch links can't act).
    try {
        require_once __DIR__ . '/mailer.php';
        if (function_exists('send_owner_enquiry_email')) {
            $newId = $enqId;
            $base = site_base_url();
            send_owner_enquiry_email([
                'id' => $newId,
                'name' => $name,
                'email' => $email,
                'prop_key' => $propKey,
                'check_in' => $checkIn,
                'check_out' => $checkOut,
                'adults' => $adultsN,
                'children' => $childrenN,
                'message' => clean($in['message'] ?? ''),
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
            ]);
        }
    } catch (\Throwable $e) {
    }

    json_out(['ok' => true, 'account_exists' => $accountExists]);
}

// All remaining actions are admin-only
require_admin();

if ($action === 'decline') {
    $r = enquiry_decline((int) ($in['id'] ?? 0));
    log_activity('enquiry', 'enquiry.decline', 'Enquiry declined', ['entity' => 'enquiry', 'entity_id' => (string) (int) ($in['id'] ?? 0)]);
    json_out($r);
}

if ($action === 'approve') {
    $r = enquiry_approve((int) ($in['id'] ?? 0));
    if (!empty($r['error'])) {
        json_out(['error' => $r['error']], (int) ($r['code'] ?? 400));
    }
    log_activity('enquiry', 'enquiry.approve', 'Enquiry approved → booking', ['entity' => 'enquiry', 'entity_id' => (string) (int) ($in['id'] ?? 0)]);
    json_out(['ok' => true, 'email' => $r['email'] ?? null, 'payment_request' => $r['payment_request'] ?? null]);
}

json_out(['error' => 'Unknown action'], 400);
