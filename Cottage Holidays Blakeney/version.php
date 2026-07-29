<?php
// ============================================================
//  version.php — reports the currently-deployed BUILD id (read from app.js, where
//  `const BUILD` now lives — it used to be inline in index.html). The app polls
//  this so a signed-in admin's open page can auto-refresh to a new release without
//  clicking anything. No auth (a build id isn't sensitive).
// ============================================================
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$build = '';
// BUILD lives in app.js; fall back to index.html for older deploys.
foreach (['/app.js', '/index.html'] as $f) {
    $src = @file_get_contents(__DIR__ . $f);
    if ($src !== false && preg_match("/const BUILD = '([^']+)'/", $src, $m)) {
        $build = $m[1];
        break;
    }
}
// ?csp=1 — DEPLOYMENT OBSERVABILITY for the CSP report pipeline. Twice a CSP fix
// was believed live and was inert, and there was no way to tell from outside
// except to infer from symptoms — which was wrong both times. This reports what
// the DEPLOYED code actually resolves and decides, so one curl answers it.
// Discloses nothing new: the policy it summarises is already a response header on
// every page, and the two probes are fixed literals, not request input.
if (isset($_GET['csp'])) {
    $csp = ['lib' => false, 'source' => 'none', 'formAction' => null, 'probe' => null, 'sig' => null];
    if (is_file(__DIR__ . '/csp-lib.php')) {
        require_once __DIR__ . '/csp-lib.php';
        $csp['lib'] = true;
        $csp['source'] = csp_policy_source(__DIR__);
        $parsed = csp_live_policy(__DIR__);
        $csp['formAction'] = $parsed['form-action'] ?? null;
        // The two reports that have been nagging: what would this deploy log them as?
        $csp['probe'] = [
            '3ds' => csp_report_severity('form-action', 'https://methodurl.vcas.visa.com/DeviceFingerprint?id=x', $parsed),
            'samsung' => csp_report_severity('connect-src', 'https://spay.samsung.com/', $parsed),
            'evil' => csp_report_severity('connect-src', 'https://evil.example.com/x', $parsed),
        ];
        // Which de-dupe signature shape this deploy writes: host (current) or the
        // reporter's IP (pre-#861). The activity log shows the sig, so this pins
        // down which csp-report.php is actually running.
        $csp['sig'] = 'directive|host';
    }
    echo json_encode(['build' => $build, 'csp' => $csp]);
    exit;
}
echo json_encode(['build' => $build]);
