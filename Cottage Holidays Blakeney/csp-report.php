<?php
// ============================================================
//  csp-report.php — collects Content-Security-Policy violation reports (the
//  browser POSTs here via the `report-uri` in the CSP header, see htaccess.txt).
//  A violation means something tried to run/load outside the policy — e.g. an
//  injected inline <script> or a rogue external resource — so it's an early signal
//  of an XSS/injection attempt (or a misconfigured legit resource). We best-effort
//  log it to the owner's activity log, deduped, and always return 204.
//
//  DELIBERATELY STANDALONE (own short-timeout PDO, never db.php — db()'s exit path
//  would matter here). Reports are attacker-influenced + unauthenticated, so
//  everything is size-capped, sanitised, deduped and wrapped so it can neither
//  error nor flood the log.
// ============================================================

http_response_code(204); // No Content — nothing to send back to the browser
header('Content-Type: text/plain; charset=utf-8');

// Pure severity/matcher helpers (no I/O), extracted so they can be unit-tested by
// test-csp-report.php. Guarded: a missing lib must never fatal the report sink.
if (is_file(__DIR__ . '/csp-lib.php')) {
    require_once __DIR__ . '/csp-lib.php';
}

// Only POST carries a report; ignore anything else quietly.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    exit;
}

try {
    $raw = file_get_contents('php://input', false, null, 0, 8192); // cap the body
    if ($raw === false || $raw === '') {
        exit;
    }
    $j = json_decode($raw, true);
    // Both the legacy `{"csp-report":{...}}` and the Reporting-API array shapes.
    $r = null;
    if (is_array($j)) {
        if (isset($j['csp-report'])) {
            $r = $j['csp-report'];
        } elseif (isset($j[0]['body'])) {
            $r = $j[0]['body'];
        } elseif (isset($j['body'])) {
            $r = $j['body'];
        }
    }
    if (!is_array($r)) {
        exit;
    }
    $clip = fn($k, $n = 200) => mb_substr((string) ($r[$k] ?? $r[str_replace('_', '-', $k)] ?? ''), 0, $n);
    $directive = $clip('violated-directive') ?: $clip('effective-directive') ?: $clip('effectiveDirective');
    $blocked = $clip('blocked-uri') ?: $clip('blockedURL');
    // Ignore the well-known noise: browser-extension injections and about:/inline
    // reports that aren't ours to fix.
    $low = strtolower($blocked);
    foreach (['chrome-extension', 'moz-extension', 'safari-extension', 'safari-web-extension'] as $ext) {
        if (strpos($low, $ext) !== false) {
            exit;
        }
    }
    if (!defined('DB_HOST') && is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';
    }
    if (!defined('DB_HOST')) {
        exit;
    }
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . (defined('DB_CHARSET') ? DB_CHARSET : 'utf8mb4'),
        DB_USER,
        DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3],
    );
    $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    $ip = mb_substr($fwd !== '' ? trim(explode(',', $fwd)[0]) : ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 60);
    // De-dupe on (directive, blocked HOST) — NOT on the IP, which was the bug.
    // A phone on mobile data rotates its IPv6 address every few minutes (RFC 4941
    // privacy extensions), so an IP-keyed signature never matched and the hourly
    // limit never fired: observed live, the same "connect-src -> spay.samsung.com"
    // block logged twice within three minutes from 2a00:…:c2f8:a5cc:379:f1e6 and
    // 2a00:…:5606:6d48:ddfd:e89…, on one device, on one page. What the owner needs
    // to know is WHAT is being blocked; who tripped it is forensics, and the row
    // still carries the IP for that. Host, not full URL, because 3-D Secure and
    // payment SDKs put per-transaction ids in the path.
    $host = '';
    if ($blocked !== '') {
        $h = parse_url($blocked, PHP_URL_HOST);
        $host = is_string($h) && $h !== '' ? $h : mb_substr($blocked, 0, 60);
    }
    $sig = mb_substr($directive . '|' . $host, 0, 180);
    $recent = $pdo->prepare(
        "SELECT 1 FROM activity_log WHERE action = 'csp.violation' AND summary LIKE ? AND created_at > (NOW() - INTERVAL 1 HOUR) LIMIT 1",
    );
    $recent->execute(['%' . $sig . '%']);
    if ($recent->fetchColumn()) {
        exit;
    }
    $meta = json_encode([
        'directive' => $directive,
        'blocked' => $blocked,
        'documentUri' => $clip('document-uri', 200) ?: $clip('documentURL', 200),
        'sourceFile' => $clip('source-file', 200) ?: $clip('sourceFile', 200),
        'line' => (int) ($r['line-number'] ?? $r['lineNumber'] ?? 0),
        'sig' => $sig,
    ]);
    // Severity. A blocked INLINE / EVAL script is auto-handled and NOT an owner
    // to-do: our own inline boot script is hash-allowed in the CSP, so a blocked
    // inline is almost always a browser EXTENSION or a carrier/proxy injecting a
    // script into the page (or, less often, a CSP-stopped XSS — still auto-handled).
    // Log those as INFO so they stay in the log for forensics but never nag "Needs
    // attention" / the weekly digest. A block pointing at an external HOST is rarer
    // and more worth the owner's awareness, so keep it a low 'warn'.
    // Severity — the whole decision lives in csp_report_severity() (csp-lib.php,
    // unit-tested). It drops to 'info' (forensics, no "Needs attention") three
    // classes: a blocked inline/eval (our boot script is hash-allowed, so it's an
    // extension or a CSP-stopped XSS — auto-handled), Square's Sentry telemetry
    // (expected noise), and — the load-bearing one — any (directive, uri) the
    // CURRENT policy would PERMIT. A report the live policy allows can only come
    // from a client still enforcing an OLD policy (an up-to-date browser wouldn't
    // have blocked it), so it's a stale-client artifact from a shell that hasn't
    // refetched yet, not a threat. The live policy is read from the same file
    // Apache serves, so this cannot drift out of step with what is enforced. A
    // genuine block — a host the policy still forbids — stays 'warn'.
    // Chrome has historically sent the FULL directive ("form-action 'self'") in
    // violated-directive, so take the name only.
    $effDir = strtolower(trim(explode(' ', (string) $directive)[0]));
    $parsed = function_exists('csp_live_policy') ? csp_live_policy(__DIR__) : null;
    if (function_exists('csp_report_severity')) {
        $sev = csp_report_severity($effDir, $blocked, $parsed);
    } else {
        // Fallback if the lib is somehow absent: the pre-lib behaviour.
        $lb = strtolower($blocked);
        $sev = ($lb === '' || strpos($lb, 'inline') !== false || strpos($lb, 'eval') !== false || strpos($lb, 'data') === 0) ? 'info' : 'warn';
    }
    $pdo->prepare(
        "INSERT INTO activity_log (actor, category, action, summary, ip, meta, severity)
         VALUES ('system', 'security', 'csp.violation', ?, ?, ?, ?)",
    )->execute([mb_substr('CSP blocked ' . ($directive ?: '?') . ' → ' . ($blocked ?: '?') . ' [' . $sig . ']', 0, 240), $ip, $meta, $sev]);
} catch (\Throwable $e) {
    // never let reporting affect the response
}
exit;
