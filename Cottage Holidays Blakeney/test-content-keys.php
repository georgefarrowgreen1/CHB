<?php
// ============================================================
//  test-content-keys.php — content-key CLASSIFICATION gate (dev/CI only).
//
//      php test-content-keys.php
//
//  The content table serves double duty: owner-editable SITE content (public
//  by design — the public GET in content.php returns the whole map) and
//  OPERATIONAL state written by server code. The public GET protects the
//  latter only through the classifiers in db.php — is_internal_content_key()
//  (owner-only rows, skipped for guests) and is_private_content_key()
//  (encrypted at rest). A new operational key someone forgets to classify is
//  therefore served, silently, to every anonymous visitor. That has happened:
//  'owner-ping' (the owner's latest push notification — guest names and
//  amounts), 'mailbox-seen' and 'testcentre-seeded' all leaked this way until
//  this gate found them.
//
//  The gate scans every non-test PHP file for content writes with LITERAL
//  keys — INSERT INTO content …, content_set_scalar(), content_set_secret()
//  — and fails unless each key is classified internal, private, or is on the
//  short PUBLIC_OK list below (keys that are MEANT to be world-readable).
//  Writes with dynamic keys (the content editor's save path) are the owner's
//  own public content and out of scope by design.
//
//  Adding a new operational key? Add it to is_internal_content_key() (or give
//  it an is_private_content_key() prefix if it must be encrypted). Adding a
//  new PUBLIC content key written by PHP? Add it to PUBLIC_OK here with a
//  comment saying why it's safe for anonymous visitors.
// ============================================================
error_reporting(E_ALL);
require_once __DIR__ . '/db.php'; // the classifiers (CLI include: no request runs)

// Keys written by server code that are DELIBERATELY public.
$PUBLIC_OK = [
    'hero-bg' => 'the homepage hero image path (optimize-hero.php) — rendered to every visitor anyway',
    'reviews' => 'the public review list (testcentre.php demo seed writes the same key the site serves)',
];

$fail = 0;
$pass = 0;
function ck_check($name, $cond)
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name\n";
    }
}

echo "\n== Content-key classification (every server-written key must be classified) ==\n";

$found = []; // key => [files]
foreach (glob(__DIR__ . '/*.php') as $f) {
    $base = basename($f);
    if (strpos($base, 'test-') === 0) {
        continue;
    }
    $src = (string) file_get_contents($f);
    $keys = [];
    // INSERT INTO content (…) VALUES ('literal-key', …  — multiline SQL string.
    if (preg_match_all("/INSERT INTO content\s*\([^)]*\)\s*VALUES\s*\('([a-z0-9-]+)'/is", $src, $m)) {
        $keys = array_merge($keys, $m[1]);
    }
    // content_set_scalar('key' … / content_set_secret('key' …
    if (preg_match_all("/content_set_(?:scalar|secret)\(\s*'([a-z0-9-]+)'/", $src, $m)) {
        $keys = array_merge($keys, $m[1]);
    }
    foreach (array_unique($keys) as $k) {
        $found[$k][] = $base;
    }
}

ck_check('the scan finds server-written keys (sanity: ≥ 15 literals)', count($found) >= 15);

ksort($found);
foreach ($found as $key => $files) {
    $where = implode(', ', array_unique($files));
    if (is_private_content_key($key)) {
        ck_check("'$key' ($where) — private (encrypted at rest)", true);
    } elseif (is_internal_content_key($key)) {
        ck_check("'$key' ($where) — internal (owner-only in the public GET)", true);
    } elseif (isset($PUBLIC_OK[$key])) {
        ck_check("'$key' ($where) — deliberately public: {$PUBLIC_OK[$key]}", true);
    } else {
        ck_check("'$key' ($where) — UNCLASSIFIED: the public content GET serves it to anonymous visitors. Add it to is_internal_content_key() in db.php (or PUBLIC_OK here, with a reason).", false);
    }
}

// The three keys this gate was built around must stay classified — a regression
// here re-opens a real leak (owner-ping held the owner's latest push text).
foreach (['owner-ping', 'mailbox-seen', 'testcentre-seeded'] as $k) {
    ck_check("regression pin: '$k' stays internal", is_internal_content_key($k));
}

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
