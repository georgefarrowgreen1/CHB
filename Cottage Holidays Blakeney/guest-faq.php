<?php
// ============================================================
//  guest-faq.php — capture guest questions the on-device FAQ assistant
//  couldn't answer, so the owner can turn the recurring ones into instant
//  answers (Manage → Search learning → "Guests asked these").
//
//  POST {action:'record', q, prop}  -> public: log an unanswered guest question.
//
//  The guest chat (app.js guestFaqAnswer) answers a typed question on-device
//  from the cottage's own FAQ content. When it CAN'T, the message reaches a
//  person as before — and, additionally, the question is recorded here
//  (deduped + counted) so the owner can see what keeps coming up. Stored in the
//  content table under the internal key 'guest-faq-misses' (admin-only in the
//  content GET — never exposed to public visitors), mirroring the owner-side
//  teach-loop stores (nlu-learned / search-misses).
// ============================================================

// PURE aggregation — no DB, so it's unit-testable (test-guestfaq.php). Takes the
// current store, a raw guest question and cottage key, and returns the updated
// store — or null when the question isn't a teachable FAQ (too short / no
// letters), in which case the caller silently ignores it. Dedupes by the
// lower-cased question (bumping count + recency), caps to the 40 most-recent.
function guest_faq_merge($list, $q, $prop, $today)
{
    if (!is_array($list)) {
        $list = [];
    }
    $q = trim(preg_replace('/\s+/u', ' ', (string) $q));
    $q = mb_substr($q, 0, 200);
    if (mb_strlen($q) < 6 || !preg_match('/[a-z]/i', $q)) {
        return null; // not a question worth remembering
    }
    $prop = (string) $prop;
    if (strlen($prop) > 40) {
        $prop = substr($prop, 0, 40);
    }
    $norm = mb_strtolower($q);
    $found = false;
    foreach ($list as &$row) {
        if (is_array($row) && mb_strtolower((string) ($row['q'] ?? '')) === $norm) {
            $row['n'] = (int) ($row['n'] ?? 0) + 1;
            $row['at'] = $today;
            if ($prop !== '') {
                $row['prop'] = $prop;
            }
            $found = true;
            break;
        }
    }
    unset($row);
    if (!$found) {
        $list[] = ['q' => $q, 'n' => 1, 'at' => $today, 'prop' => $prop];
    }
    while (count($list) > 40) {
        array_shift($list); // drop the oldest at the front
    }
    return $list;
}

// When a test includes this file for the pure helper above, stop before the DB
// require + HTTP routing (mirrors content.php's guard).
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'guest-faq.php') {
    return;
}

require_once __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_out(['error' => 'POST only'], 405);
}

$in = body();
$action = $in['action'] ?? '';

if ($action === 'record') {
    // Public write → rate-limit per IP so it can't be flooded (the chat send it
    // rides alongside is rate-limited too, but this endpoint stands alone).
    rate_limit('guestfaq', 30, 10);
    try {
        $merged = guest_faq_merge(content_json('guest-faq-misses', []), $in['q'] ?? '', clean($in['prop'] ?? ''), date('Y-m-d'));
        if ($merged !== null) {
            content_set_scalar('guest-faq-misses', $merged);
        }
    } catch (\Throwable $e) {
        // Best-effort — a capture failure must never surface to the guest.
    }
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
