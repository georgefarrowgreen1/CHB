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
// The lists stop at 40 each; `total` carries the whole count (the 26/10/2026 report
// read as "40 things" when there were 158). Never less than what was listed.
$tot = is_array($in['total'] ?? null) ? $in['total'] : [];
$num = fn($k) => is_int($tot[$k] ?? null) ? max(0, min(100000, $tot[$k])) : 0;
$n = max(count($found), $num('needs') + $num('changed') + $num('missing'));
$nLeft = max(count($leftovers), $num('leftovers'));
// What the site can check for itself until the next run (status-lib.php reads it):
// paths only, each a plain relative path, at most 200 a list.
$op = is_array($in['open'] ?? null) ? $in['open'] : [];
$paths = function ($v): array {
    $out = [];
    foreach (is_array($v) ? $v : [] as $p) {
        if (is_string($p) && strlen($p) <= 200 && preg_match('#^[A-Za-z0-9._@+-]+(/[A-Za-z0-9._@+-]+)*$#', $p) && !preg_match('#(^|/)\.\.?(/|$)#', $p)) {
            $out[] = $p;
        }
        if (count($out) >= 200) {
            break;
        }
    }
    return $out;
};
$open = $op ? [
    'gone' => $paths($op['gone'] ?? []),
    'goneAll' => is_int($op['goneAll'] ?? null) ? max(0, min(100000, $op['goneAll'])) : 0,
    'back' => $paths($op['back'] ?? []),
    'backAll' => $num('missing'),
    'other' => is_int($op['other'] ?? null) ? max(0, min(100000, $op['other'])) : 0,
] : null;
$summary = $n === 0
    ? 'Server file check: nothing unexpected' . ($nLeft ? ' (' . $nLeft . ' leftover' . ($nLeft === 1 ? '' : 's') . ' to tidy)' : '')
    : 'Server file check: ' . $n . ' thing' . ($n === 1 ? '' : 's') . ' on the server need' . ($n === 1 ? 's' : '') . ' a look';
$meta = [
    'commit' => preg_match('/^[0-9a-f]{40}$/', (string) ($in['commit'] ?? '')) ? (string) $in['commit'] : '',
    'found' => $n,
    'items' => array_slice($found, 0, 20),
    'leftovers' => $nLeft,
];
if ($open) {
    $meta['open'] = $open;
}
// The log keeps 4,000 characters of meta and a cut one does not read back. The items
// give way first down to five, then the open lists from their ends (a path that falls
// off still counts as open, through goneAll/backAll), then the last items.
while (strlen((string) json_encode($meta)) > 3900) {
    if (count($meta['items']) > 5) {
        array_pop($meta['items']);
    } elseif (isset($meta['open']) && ($meta['open']['gone'] || $meta['open']['back'])) {
        $k = count($meta['open']['gone']) >= count($meta['open']['back']) ? 'gone' : 'back';
        array_pop($meta['open'][$k]);
    } elseif ($meta['items']) {
        array_pop($meta['items']);
    } else {
        break;
    }
}
log_activity('system', 'server.check', $summary, [
    'severity' => $n ? 'warn' : 'info',
    'meta' => $meta,
]);
json_out(['ok' => true, 'found' => $n]);
