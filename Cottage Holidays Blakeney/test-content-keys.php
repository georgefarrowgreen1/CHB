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

echo "\n== Client-written keys (saveContent in admin.js / app.js) ==\n";
// The scan above only sees SERVER writes — and the class it protects against
// exists client-side too: admin.js stores operational state through content.php
// (search-undo leaked-in-waiting until classified; search-pins is the newest).
// Convention makes this scannable: operational keys are named as consts
// (`const CHB_X_KEY = '…'` used in `saveContent(CHB_X_KEY, …)`), while the
// owner's PUBLIC content is written with literal or dynamic keys. So: every
// const-keyed write must be classified internal/private, and literal-keyed
// writes must be classified OR on the deliberate JS_PUBLIC_OK list. Coverage
// limit, stated: the assist-sync trio (nlu-learned / nlu-suppressed /
// search-misses) posts content.php directly from a pair-array and is out of
// this scanner's reach — all three are classified in db.php's membership list.
$JS_PUBLIC_OK = [
    'contact-phone' => "the owner's public phone number — rendered on the public site anyway",
    'google-review-url' => 'the public Google-reviews link guests are sent to — public by its nature',
    'host-photo' => 'the host card portrait on the public homepage — uploaded to be shown',
    'square-deposit-pct' => 'the deposit split (%% of total) — siteContent boots from the PUBLIC fetch pre-auth, so hiding it silently resets the Settings field; guests derive it from their own payment anyway',
    'reviews' => 'the public review list (moderation writes the same key the site serves)',
];
$jsFound = [];
foreach (['admin.js', 'app.js'] as $jf) {
    $src = (string) file_get_contents(__DIR__ . '/' . $jf);
    // const-keyed writes, resolved through their declaration
    if (preg_match_all('/saveContent\(\s*([A-Z][A-Z0-9_]+)\s*,/', $src, $m)) {
        foreach (array_unique($m[1]) as $const) {
            if (preg_match('/const\s+' . $const . "\s*=\s*'([a-z0-9-]+)'/", $src, $cm)) {
                $jsFound[$cm[1]][] = "$jf ($const)";
            } else {
                ck_check("const $const in $jf resolves to a literal key (scanner must not go blind)", false);
            }
        }
    }
    // literal-keyed writes
    if (preg_match_all("/saveContent\(\s*'([a-z0-9-]+)'\s*,/", $src, $m)) {
        foreach (array_unique($m[1]) as $k) {
            $jsFound[$k][] = $jf;
        }
    }
}
$constKeyed = 0;
foreach ($jsFound as $k => $where) {
    $isConst = (bool) preg_grep('/\(/', $where);
    if ($isConst) {
        $constKeyed++;
        ck_check("client operational key '$k' is classified (" . implode(', ', $where) . ')', is_internal_content_key($k) || is_private_content_key($k));
    } else {
        ck_check("client literal key '$k' is classified or deliberately public", is_internal_content_key($k) || is_private_content_key($k) || isset($JS_PUBLIC_OK[$k]));
    }
}
// The blindness guard: search-undo and search-pins exist today, so a scan that
// finds fewer than two const-keyed writes has stopped seeing them.
ck_check("the client scan still finds const-keyed operational writes ($constKeyed)", $constKeyed >= 2);


echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
