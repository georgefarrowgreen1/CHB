<?php
// ============================================================
//  test-csp-report.php — guards the CSP-report severity decision (csp-lib.php).
//  Dev/CI only, deploy-excluded. No DB, no HTTP, no clock: the whole point of the
//  lib is that the decision is a pure function of (directive, blocked-uri, policy),
//  and this drives it against the REAL live policy string and the EXACT reports
//  that prompted the work, plus a genuine attack that must stay 'warn'.
// ============================================================

require_once __DIR__ . '/csp-lib.php';

$fails = 0;
function ok($cond, $msg)
{
    global $fails;
    echo ($cond ? "  \xE2\x9C\x93 " : "  \xE2\x9C\x97 ") . $msg . "\n";
    if (!$cond) {
        $fails++;
    }
}

// The policy under test is the one actually shipped — read from htaccess.txt, the
// same source Apache serves — so this test cannot pass against a policy the site
// does not enforce. (csp-report.php reads .htaccess live; the string is identical.)
$ht = file_get_contents(__DIR__ . '/htaccess.txt');
$polStr = $ht === false ? null : csp_extract_policy($ht);
ok(is_string($polStr) && $polStr !== '', 'the live CSP is extracted from htaccess.txt');
$P = $polStr ? csp_parse_policy($polStr) : [];
ok(isset($P['form-action']) && isset($P['connect-src']), 'policy parses into directives (form-action, connect-src present)');

// ---- The two reports from the screenshot: both are things the CURRENT policy
// permits, so both can only be stale-client artifacts → 'info', not 'warn'. If
// either came back 'warn' the owner would keep being nagged by an old shell.
ok(csp_report_severity('form-action', 'https://methodurl.vcas.visa.com/DeviceFingerprint?id=688a69e24', $P) === 'info',
    "3-D Secure form-action to an https ACS is permitted now → info (was the nagging report)");
ok(csp_report_severity('connect-src', 'https://spay.samsung.com/', $P) === 'info',
    "the Samsung Pay probe host is allow-listed now → info");
ok(csp_report_severity('connect-src', 'https://google.com/pay', $P) === 'info',
    "Google Pay apex is allow-listed now → info");

// ---- A GENUINE block must still reach the owner. A host the live policy forbids
// is a real signal (a rogue resource, a CSP-stopped exfiltration) and stays 'warn'.
ok(csp_report_severity('connect-src', 'https://evil.example.com/steal', $P) === 'warn',
    "an un-allow-listed connect-src host stays warn (a real signal is never hidden)");
ok(csp_report_severity('script-src', 'https://evil.example.com/x.js', $P) === 'warn',
    'an un-allow-listed script-src host stays warn');

// ---- Scheme-sources are scheme-SPECIFIC. form-action is 'self' https:, so an
// http:// (insecure) form target is NOT permitted and stays warn — proving the
// downgrade is not a blanket "form-action is always fine".
ok(csp_report_severity('form-action', 'http://methodurl.vcas.visa.com/x', $P) === 'warn',
    'an http (insecure) form-action target is NOT permitted → warn');

// ---- Inline / eval / data are their own class regardless of policy.
ok(csp_report_severity('script-src-elem', 'inline', $P) === 'info', 'blocked inline → info');
ok(csp_report_severity('script-src', 'eval', $P) === 'info', 'blocked eval → info');
ok(csp_report_severity('img-src', '', $P) === 'info', 'empty blocked-uri → info');

// ---- Telemetry stays info even though we deliberately do NOT allow-list it (so a
// stale client that lacks it would report it, and an up-to-date one blocks+reports
// it too — either way it is noise, matched on host so a path lookalike can't sneak).
ok(csp_report_severity('connect-src', 'https://o160250.ingest.sentry.io/api/1/envelope', $P) === 'info',
    "Square's Sentry telemetry → info (matched on host)");
ok(csp_report_severity('connect-src', 'https://ingest.sentry.io.evil.com/x', $P) === 'warn',
    'a sentry.io lookalike in a different host stays warn (suffix match, not substring)');

// ---- form-action has NO default-src fallback: if the policy omitted it entirely,
// an https target must NOT be silently permitted by default-src 'self'.
$noFA = csp_parse_policy("default-src 'self'; connect-src https://ok.example.com");
ok(csp_policy_permits($noFA, 'connect-src', 'https://ok.example.com/x') === true,
    'connect-src source matches (host-source)');
ok(csp_policy_permits($noFA, 'connect-src', 'https://other.example.com/x') === false,
    'connect-src falls back to default-src (self) → external host not permitted');
ok(csp_policy_permits($noFA, 'form-action', 'https://anywhere.example.com/x') === false,
    'form-action does NOT fall back to default-src — absent directive never auto-permits');

// ---- Wildcard host matching: '*.google.com' matches a subdomain, not the apex.
$wild = csp_parse_policy('connect-src https://*.google.com');
ok(csp_policy_permits($wild, 'connect-src', 'https://pay.google.com/x') === true, "'*.google.com' matches a subdomain");
ok(csp_policy_permits($wild, 'connect-src', 'https://google.com/x') === false, "'*.google.com' does NOT match the bare apex");
ok(csp_policy_permits($wild, 'connect-src', 'https://evilgoogle.com/x') === false, "'*.google.com' does NOT match a suffix-spoof host");

echo $fails ? "\n  $fails CSP-REPORT CHECK(S) FAILED \xE2\x9D\x8C\n" : "\n  CSP-REPORT SUITE PASSED \xE2\x9C\x85\n";
exit($fails ? 1 : 0);
