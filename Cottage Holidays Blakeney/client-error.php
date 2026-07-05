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

log_activity('system', 'client.error', 'Front-end error: ' . mb_substr($msg, 0, 160), [
    'severity' => 'warn',
    'meta' => [
        'detail' => $where !== '' ? mb_substr($where, 0, 200) : '',
        'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
    ],
]);
json_out(['ok' => true]);
