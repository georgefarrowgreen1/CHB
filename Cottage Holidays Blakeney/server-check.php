<?php
// What the weekly server file check found (.github/scripts/server-check.sh, run by
// .github/workflows/server-check.yml), told to the site so Manage → Status and Needs
// attention say it as well as GitHub. The job key only: nothing here is for a browser.
require_once __DIR__ . '/db.php';

if (!cron_request_ok()) {
    json_out(['error' => 'Not authorised'], 401);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_out(['error' => 'POST only'], 405);
}
$in = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($in)) {
    json_out(['error' => 'Expected the check\'s JSON'], 400);
}

// Each list as plain one-line text, kept short: the row's meta has room for 4,000
// characters, and a cut JSON string would not read back at all.
$lines = function ($v): array {
    $out = [];
    foreach (is_array($v) ? $v : [] as $s) {
        if (is_string($s) && trim($s) !== '') {
            $out[] = mb_substr((string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', trim($s)), 0, 150);
        }
    }
    return $out;
};
$found = array_merge($lines($in['needs'] ?? []), $lines($in['changed'] ?? []), $lines($in['missing'] ?? []));
$leftovers = $lines($in['leftovers'] ?? []);
$n = count($found);
$summary = $n === 0
    ? 'Server file check: nothing unexpected' . ($leftovers ? ' (' . count($leftovers) . ' leftover' . (count($leftovers) === 1 ? '' : 's') . ' to tidy)' : '')
    : 'Server file check: ' . $n . ' thing' . ($n === 1 ? '' : 's') . ' on the server need' . ($n === 1 ? 's' : '') . ' a look';
log_activity('system', 'server.check', $summary, [
    'severity' => $n ? 'warn' : 'info',
    'meta' => [
        'commit' => preg_match('/^[0-9a-f]{40}$/', (string) ($in['commit'] ?? '')) ? (string) $in['commit'] : '',
        'found' => $n,
        'items' => array_slice($found, 0, 20),
        'leftovers' => count($leftovers),
    ],
]);
json_out(['ok' => true, 'found' => $n]);
