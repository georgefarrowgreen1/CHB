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

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    require_admin();
    $rows = db()->query('SELECT * FROM enquiries ORDER BY created_at ASC')->fetchAll();
    json_out(['enquiries' => $rows]);
}

$in = body();
$action = $in['action'] ?? '';

if ($action === 'submit') {
    // Public — anyone can submit an enquiry
    $propKey = clean($in['prop_key'] ?? '');
    if (!get_rate($propKey)) json_out(['error' => 'Unknown property'], 400);
    $name = clean($in['name'] ?? '');
    $checkIn = clean($in['check_in'] ?? '');
    $checkOut = clean($in['check_out'] ?? '');
    if ($name === '' || !$checkIn || !$checkOut) json_out(['error' => 'Name and both dates are required'], 400);
    if ($checkOut <= $checkIn) json_out(['error' => 'Check-out must be after check-in'], 400);
    $address = clean($in['address'] ?? '');
    $postcode = clean($in['postcode'] ?? '');
    if ($address === '') json_out(['error' => 'Please enter your UK address'], 400);
    if (!uk_postcode_valid($postcode)) json_out(['error' => 'Please enter a valid UK postcode'], 400);

    // Occupancy limits per property (mirror of the front end; enforced here so
    // the public enquiry form can't be bypassed).
    $adultsN = max(1, (int)($in['adults'] ?? 2));
    $childrenN = max(0, (int)($in['children'] ?? 0));
    $limits = occupancy_limits();   // single source of truth (db.php)
    if (isset($limits[$propKey])) {
        $L = $limits[$propKey];
        if ($adultsN > $L['maxAdults'] || $childrenN > $L['maxChildren'] || ($adultsN + $childrenN) > $L['maxTotal']) {
            json_out(['error' => 'That party size is over the limit for this property.'], 400);
        }
    }

    // Booking rules (min/max nights, arrival days) — mirror of the front end,
    // enforced here so the public form can't be bypassed. Rules are stored in the
    // content table under 'rules-<propKey>' as JSON; fall back to defaults.
    $nights = (int)round((strtotime($checkOut) - strtotime($checkIn)) / 86400);
    $defaultRules = ['minNights' => 2, 'maxNights' => 0, 'arrivalDays' => []];
    $rules = $defaultRules;
    $rs = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
    $rs->execute(['rules-' . $propKey]);
    $rrow = $rs->fetch();
    if ($rrow) {
        $decoded = json_decode($rrow['item_value'], true);
        if (is_array($decoded)) $rules = array_merge($defaultRules, $decoded);
    }
    $minN = max(1, (int)$rules['minNights']);
    if ($nights < $minN) {
        json_out(['error' => 'This property has a minimum stay of ' . $minN . ' night' . ($minN === 1 ? '' : 's') . '.'], 400);
    }
    $maxN = max(0, (int)$rules['maxNights']);
    if ($maxN > 0 && $nights > $maxN) {
        json_out(['error' => 'This property has a maximum stay of ' . $maxN . ' night' . ($maxN === 1 ? '' : 's') . '.'], 400);
    }
    $arrivalDays = is_array($rules['arrivalDays'] ?? null) ? $rules['arrivalDays'] : [];
    if (count($arrivalDays) > 0) {
        $arrivalDow = (int)date('w', strtotime($checkIn));  // 0=Sun .. 6=Sat
        if (!in_array($arrivalDow, array_map('intval', $arrivalDays), true)) {
            $dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            sort($arrivalDays);
            $names = implode(', ', array_map(fn($i) => $dayNames[(int)$i] ?? '', $arrivalDays));
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

    db()->prepare('INSERT INTO enquiries
        (prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,message,terms_accepted_at,terms_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $propKey, $name, clean($in['email'] ?? ''), clean($in['phone'] ?? ''), $address, $postcode,
            $checkIn, $checkOut,
            clean($in['check_in_time'] ?? '15:00'), clean($in['check_out_time'] ?? '10:00'),
            $adultsN, $childrenN,
            clean($in['message'] ?? ''), $termsAt, $termsVer
        ]);
    // Wake the owner's devices (best-effort).
    try { require_once __DIR__ . '/webpush.php'; alert_owner('New enquiry', trim(($name ?: 'Someone') . ' · ' . $checkIn . '–' . $checkOut)); } catch (\Throwable $e) {}
    json_out(['ok' => true]);
}

// All remaining actions are admin-only
require_admin();

if ($action === 'decline') {
    db()->prepare('DELETE FROM enquiries WHERE id = ?')->execute([(int)($in['id'] ?? 0)]);
    json_out(['ok' => true]);
}

if ($action === 'approve') {
    $id = (int)($in['id'] ?? 0);
    $stmt = db()->prepare('SELECT * FROM enquiries WHERE id = ?');
    $stmt->execute([$id]);
    $e = $stmt->fetch();
    if (!$e) json_out(['error' => 'Enquiry not found'], 404);

    $rate = get_rate($e['prop_key']);
    if (!$rate) json_out(['error' => 'Property not found'], 404);
    book_lock($e['prop_key']);   // serialise so concurrent approvals can't both win
    // Don't approve onto dates that have since been taken (a confirmed booking or an
    // imported Airbnb/Vrbo block). This path previously skipped the clash check.
    if (dates_clash($e['prop_key'], $e['check_in'], $e['check_out'])) {
        book_unlock($e['prop_key']);
        json_out(['error' => 'Those dates are no longer available — another booking now overlaps them. Please decline or adjust this enquiry.'], 409);
    }
    $p = price_breakdown($rate, $e['adults'], $e['children'], $e['check_in'], $e['check_out']);
    $today = date('Y-m-d');

    db()->prepare('INSERT INTO bookings
        (prop_key,name,email,phone,address,postcode,check_in,check_out,check_in_time,check_out_time,adults,children,notes,payment,
         agreed_total,agreed_per_night,agreed_nights,agreed_nightly,agreed_booking_fee,agreed_txn_pct,agreed_txn_fee,agreed_on,
         terms_accepted_at,terms_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $e['prop_key'], $e['name'], $e['email'], $e['phone'], ($e['address'] ?? ''), ($e['postcode'] ?? ''), $e['check_in'], $e['check_out'],
            $e['check_in_time'], $e['check_out_time'], $e['adults'], $e['children'],
            ($e['message'] ?: 'Approved from enquiry inbox.'), 'unpaid',
            $p['total'], $p['perNight'], $p['nights'], $p['nightly'], $p['damagesDeposit'], $p['transactionPct'], $p['txFee'], $today,
            $e['terms_accepted_at'] ?? null, $e['terms_version'] ?? null
        ]);
    $bookingId = db()->lastInsertId();
    db()->prepare('DELETE FROM enquiries WHERE id = ?')->execute([$id]);
    book_unlock($e['prop_key']);   // free before the (slower) email send

    // Send confirmation emails (guest + owner). Wrapped so an email problem
    // never breaks the approval — the booking is already saved above.
    $emailResult = null;
    try {
        require_once __DIR__ . '/mailer.php';
        $newId = (int)$bookingId;
        $ref = 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string)$newId), -6), 6, '0', STR_PAD_LEFT);
        $emailResult = send_booking_emails([
            'name'           => $e['name'],
            'email'          => $e['email'],
            'phone'          => $e['phone'] ?? '',
            'prop_key'       => $e['prop_key'],
            'prop_name'      => $rate['name'] ?? $e['prop_key'],
            'address'        => $rate['address'] ?? '',
            'check_in'       => $e['check_in'],
            'check_out'      => $e['check_out'],
            'check_in_time'  => $e['check_in_time'] ?? '15:00',
            'check_out_time' => $e['check_out_time'] ?? '10:00',
            'nights'         => $p['nights'],
            'per_night'      => $p['perNight'],
            'nightly'        => $p['nightly'],
            'tx_pct'         => $p['transactionPct'],
            'tx_fee'         => $p['txFee'],
            'adults'         => $e['adults'],
            'children'       => $e['children'],
            'total'          => $p['total'],
            'damages_deposit'=> $p['damagesDeposit'] ?? 0,
            'payment'        => 'unpaid',
            'ref'            => $ref,
        ]);
    } catch (\Throwable $ex) {
        $emailResult = ['error' => 'Mail step skipped: ' . $ex->getMessage()];
    }

    // Best-effort: push the guest "booking confirmed" if they have an account +
    // a subscribed device. Never blocks the approval (no-op without either).
    try {
        require_once __DIR__ . '/webpush.php';
        notify_guest_email($e['email'], 'Booking confirmed 🎉',
            ($rate['name'] ?? 'Your cottage') . ' · ' . $e['check_in'] . ' to ' . $e['check_out'], './');
    } catch (\Throwable $ex) {}

    // Auto payment request (Square): on approval ask the guest for the 25% deposit —
    // or, if check-in is already inside the balance window (default 30 days), ask for
    // the full amount upfront. The scheduled job (payments-due.php) chases the balance
    // ~a month before check-in for the staged bookings. Never blocks the approval.
    $paymentRequest = null;
    if (square_enabled() && !empty($e['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            $nb = db()->prepare('SELECT * FROM bookings WHERE id = ?');
            $nb->execute([(int)$bookingId]);
            $bk = $nb->fetch();
            if ($bk) {
                $daysToCheckIn = (int)floor((strtotime($bk['check_in']) - strtotime(date('Y-m-d'))) / 86400);
                $withinWindow = $daysToCheckIn < payment_balance_days();
                $kind = $withinWindow ? 'balance' : 'deposit';
                $paymentRequest = request_booking_payment($bk, $kind);
                // If we asked for everything now, mark the balance as already requested
                // so the scheduled job never double-asks.
                if (!empty($paymentRequest['ok']) && $withinWindow) {
                    try { db()->prepare('UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')->execute([(int)$bookingId]); }
                    catch (\Throwable $e2) {}
                }
                // Deposit asked for now (check-in still far off): record when, so the
                // abandoned-payment recovery in payments-due.php can chase it once if it
                // goes unpaid. Harmless if the column isn't migrated yet.
                if (!empty($paymentRequest['ok']) && !$withinWindow) {
                    try { db()->prepare('UPDATE bookings SET deposit_requested_at = NOW() WHERE id = ?')->execute([(int)$bookingId]); }
                    catch (\Throwable $e2) {}
                }
            }
        } catch (\Throwable $ex) { $paymentRequest = ['ok' => false, 'error' => $ex->getMessage()]; }
    }

    json_out(['ok' => true, 'email' => $emailResult, 'payment_request' => $paymentRequest]);
}

json_out(['error' => 'Unknown action'], 400);
