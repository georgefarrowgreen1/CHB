<?php
// ============================================================
//  client-error.php — record an uncaught front-end JS error in the activity log,
//  so the owner learns about breakage before a guest emails about it.
//  Public (errors happen before login too) but rate-limited and size-capped;
//  nothing here trusts or executes the payload — it's only stored as text.
// ============================================================
require_once __DIR__ . '/db.php';

// A broken page can fire a burst of errors — cap per IP so the log can't be flooded.
rate_limit('clienterr', 12, 10);

$in = body();
$msg = trim((string) ($in['message'] ?? ''));
if ($msg === '') {
    json_out(['ok' => true]); // nothing to record
}
$where = trim((string) ($in['where'] ?? ''));

// Third-party noise (mirrors the client-side filter, for visitors still running
// a cached older app.js): errors from scripts INJECTED by in-app browsers
// (iabjs:// — Instagram/Facebook Android webviews), browser extensions and
// native bridges aren't site breakage — keep them out of "Needs attention".
$noise =
    preg_match('~^(?!https?://)[a-z][a-z0-9.+-]*://~i', $where) === 1 || // iabjs://, gap://, chrome-extension://…
    stripos($where, 'webkit-masked-url') !== false ||
    preg_match('/Java (object|bridge|exception)/i', $msg) === 1 ||
    // iOS in-app browsers (Facebook/Instagram WKWebView) inject scripts that poke
    // window.webkit.messageHandlers — our code never touches that API, and iOS
    // injections report the PAGE url as the source, so the scheme check misses them.
    stripos($msg, 'webkit.messageHandlers') !== false;
if ($noise) {
    json_out(['ok' => true, 'ignored' => true]);
}

$summary = 'Front-end error: ' . mb_substr($msg, 0, 160);

// Cross-visitor dedup: the same error within the last hour is logged once,
// however many visitors hit the broken page (each page load already self-caps,
// but a popular broken page would still stack identical rows without this).
try {
    $s = db()->prepare(
        "SELECT 1 FROM activity_log WHERE action = 'client.error' AND summary = ?
           AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 1",
    );
    $s->execute([mb_substr($summary, 0, 255)]);
    if ($s->fetchColumn()) {
        json_out(['ok' => true, 'deduped' => true]);
    }
} catch (\Throwable $e) {
}

log_activity('system', 'client.error', $summary, [
    'severity' => 'warn',
    'meta' => [
        'detail' => $where !== '' ? mb_substr($where, 0, 200) : '',
        'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
        // Triage context from the reporter (all optional, size-capped).
        'stack' => mb_substr(trim((string) ($in['stack'] ?? '')), 0, 500),
        'build' => mb_substr(trim((string) ($in['build'] ?? '')), 0, 20),
        'view' => mb_substr(trim((string) ($in['view'] ?? '')), 0, 40),
    ],
]);
// Nudge the owner's devices about site breakage (throttled to one push per 6h
// in chb_maybe_alert_owner_error — a reporting aid, not a pager).
chb_maybe_alert_owner_error($summary);
json_out(['ok' => true]);
