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
    // De-dupe: at most one CSP-violation log per (directive, ip) per hour, so a
    // noisy page (or a scanner) can't flood the activity log.
    $sig = mb_substr($directive . '|' . $ip, 0, 180);
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
    $lb = strtolower($blocked);
    $isInlineOrEval = ($lb === '' || strpos($lb, 'inline') !== false || strpos($lb, 'eval') !== false || strpos($lb, 'data') === 0);
    $sev = $isInlineOrEval ? 'info' : 'warn';
    $pdo->prepare(
        "INSERT INTO activity_log (actor, category, action, summary, ip, meta, severity)
         VALUES ('system', 'security', 'csp.violation', ?, ?, ?, ?)",
    )->execute([mb_substr('CSP blocked ' . ($directive ?: '?') . ' → ' . ($blocked ?: '?') . ' [' . $sig . ']', 0, 240), $ip, $meta, $sev]);
} catch (\Throwable $e) {
    // never let reporting affect the response
}
exit;
