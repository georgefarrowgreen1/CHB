<?php
// ============================================================
//  keysafe-lib.php — the key safe keeper's PURE judgements, with no DB and
//  no session so test-keysafe.php can drive every one of them in CI.
//
//  The model (owner-approved): each cottage's record says what the safe is
//  PHYSICALLY set to and which booking it was set FOR. Only the owner's
//  explicit "I've set the safe to X" writes it — the app cannot turn a dial,
//  so a recorded code the safe doesn't carry is the worst state available.
//  The guest is never emailed a code (the standing policy in mailer.php);
//  it appears on their My Stays page only once the safe is confirmed set
//  for THEIR booking and their arrival is near (keysafe_reveal_window).
// ============================================================

// How many days before check-in the guest's door code appears on My Stays.
// Tight on purpose: long enough to cover the travel day and an offline cache
// of their booking page, short enough that a code isn't circulating for weeks.
const KEYSAFE_REVEAL_DAYS = 2;

// History cap — the dispute record keeps the last N rotations per cottage.
const KEYSAFE_HISTORY_MAX = 20;

// A code a past guest would try first. Beyond the literal list, any
// all-same-digit code and any straight ascending/descending run is refused.
function keysafe_bad($code)
{
    if (!is_string($code) || !preg_match('/^\d{4}$/', $code)) {
        return true;
    }
    if (preg_match('/^(\d)\1{3}$/', $code)) {
        return true; // 0000, 1111 …
    }
    $asc = true;
    $desc = true;
    for ($i = 1; $i < 4; $i++) {
        $d = (int) $code[$i] - (int) $code[$i - 1];
        if ($d !== 1) {
            $asc = false;
        }
        if ($d !== -1) {
            $desc = false;
        }
    }
    return $asc || $desc; // 1234, 0123, 4321, 9876 …
}

// A fresh 4-digit code: never a bad one, never one in $exclude (this
// cottage's recent codes plus the other cottages' current ones). Random
// first; if the exclusions are somehow exhaustive, a deterministic scan
// still returns SOMETHING valid rather than looping forever.
function keysafe_generate(array $exclude = [])
{
    $ex = [];
    foreach ($exclude as $c) {
        $ex[(string) $c] = true;
    }
    for ($i = 0; $i < 200; $i++) {
        $c = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
        if (!keysafe_bad($c) && !isset($ex[$c])) {
            return $c;
        }
    }
    for ($n = 0; $n <= 9999; $n++) {
        $c = str_pad((string) $n, 4, '0', STR_PAD_LEFT);
        if (!keysafe_bad($c) && !isset($ex[$c])) {
            return $c;
        }
    }
    return '4821'; // unreachable: fewer than 10,000 exclusions exist
}

// Sanitise a stored record. Owner-written JSON reaching a guest surface, so
// anything malformed degrades to "no record" — a failed decrypt or a garbage
// value must never put line noise on a guest's booking page.
//   { code, setAt (ISO datetime), forBooking (int), history: [{code, setAt,
//     forBooking, guest}] }
function keysafe_read($raw)
{
    $empty = ['code' => '', 'setAt' => '', 'forBooking' => 0, 'forStay' => '', 'enabled' => true, 'history' => []];
    $d = is_array($raw) ? $raw : (is_string($raw) && $raw !== '' ? json_decode($raw, true) : null);
    if (!is_array($d)) {
        return $empty;
    }
    $code = isset($d['code']) && is_string($d['code']) && preg_match('/^\d{4}$/', $d['code']) ? $d['code'] : '';
    // The STAY REF identifies who the safe was set for when there is no
    // bookings row — a platform (Airbnb/Vrbo) stay, keyed 'o:<check-in>'
    // (block ids are re-minted on every sync and cannot anchor a record).
    // Direct stays keep matching on forBooking; the ref rides beside it.
    $ref = fn($v) => is_string($v) && preg_match('/^[bo]:[\w:-]{1,40}$/', $v) ? $v : '';
    $hist = [];
    foreach (is_array($d['history'] ?? null) ? $d['history'] : [] as $h) {
        if (!is_array($h) || !isset($h['code']) || !preg_match('/^\d{4}$/', (string) $h['code'])) {
            continue;
        }
        $hist[] = [
            'code' => (string) $h['code'],
            'setAt' => is_string($h['setAt'] ?? null) ? $h['setAt'] : '',
            'forBooking' => (int) ($h['forBooking'] ?? 0),
            'forStay' => $ref($h['forStay'] ?? ''),
            'guest' => is_string($h['guest'] ?? null) ? $h['guest'] : '',
        ];
        if (count($hist) >= KEYSAFE_HISTORY_MAX) {
            break;
        }
    }
    return [
        'code' => $code,
        'setAt' => is_string($d['setAt'] ?? null) ? $d['setAt'] : '',
        'forBooking' => (int) ($d['forBooking'] ?? 0),
        'forStay' => $ref($d['forStay'] ?? ''),
        // The per-cottage on/off switch (Settings → cottage → Private notes).
        // Default ON: only an explicit false disables, so every record from
        // before the toggle existed keeps working and garbage reads as on.
        'enabled' => !(isset($d['enabled']) && $d['enabled'] === false),
        'history' => $hist,
    ];
}

// May this booking's guest be shown the door code today? Both ends matter:
// from KEYSAFE_REVEAL_DAYS before check-in (covers the travel day and an
// offline cache of My Stays) through check-out day inclusive (they are in
// the cottage until the check-out time). Dates are ISO Y-m-d strings, so
// string comparison is date comparison and no timezone can move the day.
function keysafe_reveal_window($checkIn, $checkOut, $today)
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $checkIn) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $today)) {
        return false;
    }
    $from = date('Y-m-d', strtotime($checkIn . ' 12:00:00 UTC') - KEYSAFE_REVEAL_DAYS * 86400);
    if ($today < $from) {
        return false;
    }
    $out = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $checkOut) ? $checkOut : $checkIn;
    return $today <= $out;
}
