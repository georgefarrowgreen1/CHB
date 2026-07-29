<?php
// ============================================================
//  csp-lib.php — pure helpers for csp-report.php (no I/O, no DB, no globals), so
//  the severity decision can be unit-tested (test-csp-report.php).
//
//  THE PROBLEM THIS SOLVES. The CSP is a response HEADER on the cached app shell,
//  so an installed PWA keeps enforcing whatever policy was live when its shell was
//  last cached, until it reloads and refetches. During that window a payment can
//  fire a 3-D Secure form-action / connect-src the OLD policy forbade and the NEW
//  one allows — reported to csp-report.php, logged, and shown to the owner as
//  "Needs attention". But a report the CURRENT policy would PERMIT can only have
//  come from a client running an OLD policy: an up-to-date browser would never have
//  blocked it, so it would never have reported it. Such a report is a stale-client
//  artifact, not a threat and not the owner's to fix. csp_report_severity() reads
//  the live policy and drops those to 'info' (kept for forensics, never nags),
//  while a genuine block — a host the current policy still forbids — stays 'warn'.
//  Self-maintaining: it re-reads the SAME policy Apache serves, so it can never
//  drift out of step with what is actually enforced. Measured against the exact
//  reports that prompted it (form-action → methodurl.vcas.visa.com, connect-src →
//  spay.samsung.com), both of which the post-fix policy permits.
// ============================================================

// Split "https://a.b/c" into ['scheme'=>'https','host'=>'a.b']. Scheme lower-cased;
// host lower-cased and de-ported. Returns '' parts it can't determine.
function csp_uri_parts(string $uri): array
{
    $uri = trim($uri);
    $scheme = '';
    if (preg_match('#^([a-z][a-z0-9+.\-]*):#i', $uri, $m)) {
        $scheme = strtolower($m[1]);
    }
    $host = '';
    $h = parse_url($uri, PHP_URL_HOST);
    if (is_string($h) && $h !== '') {
        $host = strtolower($h);
    }
    return ['scheme' => $scheme, 'host' => $host];
}

// Parse a CSP string into directive => [source, source, …], everything lower-cased.
// e.g. "default-src 'self'; form-action 'self' https:" →
//   ['default-src' => ["'self'"], 'form-action' => ["'self'", 'https:']]
function csp_parse_policy(string $policy): array
{
    $out = [];
    foreach (explode(';', $policy) as $chunk) {
        $parts = preg_split('/\s+/', trim($chunk), -1, PREG_SPLIT_NO_EMPTY);
        if (!$parts) {
            continue;
        }
        $dir = strtolower(array_shift($parts));
        if ($dir === '') {
            continue;
        }
        $out[$dir] = array_map('strtolower', $parts);
    }
    return $out;
}

// Pull the enforced CSP string out of an .htaccess body. Ignores a commented
// example (Content-Security-Policy-Report-Only appears in a comment) by keying on
// the `Header … set Content-Security-Policy "…"` shape and taking the last match.
function csp_extract_policy(string $htaccess): ?string
{
    if (preg_match_all('/Header\s+(?:always\s+)?set\s+Content-Security-Policy\s+"([^"]*)"/i', $htaccess, $m) && $m[1]) {
        return end($m[1]);
    }
    return null;
}

// The live policy, for csp-report.php. Order matters and is the point:
//
//   1. csp-policy.php — a GENERATED php file that simply `return`s the string.
//      This is the reliable source in production and the reason this helper
//      exists. The first version of the stale-client downgrade read the policy
//      from the filesystem at request time — '.htaccess' with 'htaccess.txt' as a
//      fallback — and it silently never worked live: deploy.yml RENAMES
//      htaccess.txt to .htaccess, so the fallback is a 404 on the host (verified),
//      leaving one source, a dotfile PHP may not be permitted to read. When the
//      read failed the parsed policy was null, the downgrade was skipped, and
//      every report kept logging at 'warn' — the fix looked deployed and did
//      nothing. An `include` is executed rather than read, and csp-lib.php itself
//      proves includes work, so this cannot fail the same way.
//   2. '.htaccess' — kept only as a belt-and-braces fallback for a host where the
//      generated file is somehow missing.
//   3. 'htaccess.txt' — dev/CI only, where the un-renamed file is what exists.
//
// Returns the parsed directive map, or null if no policy could be resolved (in
// which case csp_report_severity leaves everything at 'warn' — failing SAFE, since
// over-reporting is recoverable and under-reporting hides a real block).
function csp_live_policy(string $dir): ?array
{
    $gen = $dir . '/csp-policy.php';
    if (is_file($gen)) {
        $pol = @include $gen;
        if (is_string($pol) && $pol !== '') {
            return csp_parse_policy($pol);
        }
    }
    foreach (['/.htaccess', '/htaccess.txt'] as $f) {
        $raw = @file_get_contents($dir . $f);
        if ($raw !== false && $raw !== '') {
            $pol = csp_extract_policy($raw);
            if ($pol) {
                return csp_parse_policy($pol);
            }
        }
    }
    return null;
}

// Does ONE source token permit a URI with this (scheme, host)?
//  - scheme-source ('https:', 'blob:', 'data:') → scheme must equal it
//  - host-source ('https://spay.samsung.com', 'https://*.google.com') → scheme
//    must match (or be absent = any) AND host must match exactly, or match the
//    '*.suffix' wildcard (subdomains only, per CSP — the apex needs its own source)
//  - keyword-sources ('self', 'unsafe-inline', 'none', …) → NOT used to permit an
//    external host: 'self' is same-origin (which a stale-client downgrade must not
//    over-claim without knowing our origin), and the inline/eval keywords are
//    handled separately as their own 'info' class.
function csp_source_permits(string $source, string $scheme, string $host): bool
{
    $source = strtolower(trim($source));
    if ($source === '' || $source === "'self'" || $source[0] === "'") {
        return false; // keyword-source — never used to clear an external host here
    }
    // Bare scheme, e.g. "https:" (has a trailing colon, no host).
    if (preg_match('/^([a-z][a-z0-9+.\-]*):$/', $source, $m)) {
        return $scheme !== '' && $scheme === $m[1];
    }
    // Host-source, optionally scheme-qualified.
    $srcScheme = '';
    $rest = $source;
    if (preg_match('#^([a-z][a-z0-9+.\-]*)://(.*)$#', $source, $m)) {
        $srcScheme = $m[1];
        $rest = $m[2];
    }
    if ($srcScheme !== '' && $scheme !== '' && $srcScheme !== $scheme) {
        return false;
    }
    // Strip any path/port from the source host part.
    $srcHost = preg_replace('#[/:].*$#', '', $rest);
    if ($srcHost === '' || $host === '') {
        return false;
    }
    if (strpos($srcHost, '*.') === 0) {
        $suffix = substr($srcHost, 1); // "*.google.com" → ".google.com" (subdomains only)
        return $host !== '' && substr($host, -strlen($suffix)) === $suffix;
    }
    return $host === $srcHost;
}

// Does the whole policy permit this (directive, blocked-uri)? Fetch directives fall
// back to default-src when absent (per CSP); the navigation directives form-action
// and frame-src do NOT — which is correct, and is why an absent one keeps 'warn'.
function csp_policy_permits(array $parsed, string $directive, string $blockedUri): bool
{
    $directive = strtolower(trim($directive));
    $parts = csp_uri_parts($blockedUri);
    if ($parts['scheme'] === '') {
        return false; // "inline" / "eval" / "" are not URIs — handled elsewhere
    }
    $noFallback = ['form-action', 'frame-src', 'frame-ancestors', 'base-uri', 'navigate-to'];
    $sources = $parsed[$directive] ?? null;
    if ($sources === null && !in_array($directive, $noFallback, true)) {
        $sources = $parsed['default-src'] ?? null; // fetch-directive fallback
    }
    if (!$sources) {
        return false;
    }
    foreach ($sources as $s) {
        if (csp_source_permits($s, $parts['scheme'], $parts['host'])) {
            return true;
        }
    }
    return false;
}

// The whole severity decision, in one testable place. 'info' = keep for forensics,
// never "Needs attention"; 'warn' = a genuine block worth the owner's awareness.
//   1. inline / eval / data — our own boot script is hash-allowed, so a blocked
//      inline is almost always an extension or a CSP-stopped XSS: auto-handled, info.
//   2. known third-party SDK telemetry (Square's Sentry): expected noise, info.
//   3. a directive+uri the CURRENT policy PERMITS: a stale-client artifact, info.
//   4. everything else — a host the live policy still forbids: warn.
function csp_report_severity(string $directive, string $blockedUri, ?array $parsed): string
{
    $lb = strtolower(trim($blockedUri));
    if ($lb === '' || strpos($lb, 'inline') !== false || strpos($lb, 'eval') !== false || strpos($lb, 'data') === 0) {
        return 'info';
    }
    $host = csp_uri_parts($blockedUri)['host'];
    foreach (['ingest.sentry.io', 'sentry.io'] as $q) {
        if ($host !== '' && ($host === $q || substr($host, -(strlen($q) + 1)) === '.' . $q)) {
            return 'info';
        }
    }
    if ($parsed !== null && csp_policy_permits($parsed, $directive, $blockedUri)) {
        return 'info';
    }
    return 'warn';
}
