<?php
// ============================================================
//  home.php — serves the homepage with the LIVE hero image injected.
//
//  The owner's real hero is an uploaded photo stored in the content table
//  (key 'hero-bg'); the static index.html still references 'hero.jpg', which
//  doesn't exist on the live host. That broke three things this fixes:
//    1. the LCP preload pointed at a 404 (and the real hero couldn't start
//       downloading until CSS + JS + the content API round-trip finished),
//    2. og:image / twitter:image / JSON-LD images 404'd — shared links had
//       no preview photo,
//    3. the hero showed a flash of nothing before JS swapped it in.
//  The .htaccess rewrite routes '/' and '/index.html' here; we replace every
//  'hero.jpg' reference (preload, absolute og/JSON-LD URLs, the hero div)
//  with the live upload. app.js still re-applies content overrides on boot.
//
//  Mirrors cottage.php: deliberately standalone (own PDO — db.php's db()
//  EXITS with a JSON error when the database is down, which would corrupt
//  this HTML route). On ANY problem it serves index.html untouched.
// ============================================================

$html = @file_get_contents(__DIR__ . '/index.html');
if ($html === false) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found');
}

$out = $html;
try {
    if (is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';
        $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 3,
        ]);
        $s = $pdo->prepare("SELECT item_value FROM content WHERE item_key = 'hero-bg'");
        $s->execute();
        $v = $s->fetchColumn();
        $hero = '';
        if ($v !== false) {
            $d = json_decode((string) $v, true);
            if (is_string($d)) {
                $hero = trim($d);
            }
        }

        // Swap the static hero.jpg (which 404s on the live host) for the owner's
        // uploaded hero — the LCP preload, the hero element, and the absolute
        // og/twitter/JSON-LD image URLs. Shared with cottage.php / experiences.
        require_once __DIR__ . '/hero-shell.php';
        $out = inject_live_hero($out, $hero, 'https://cottageholidaysblakeney.co.uk');

        // THE PAGE BEFORE THE SCRIPT (ssr-lib.php; see CLAUDE.md): the first screen written
        // with the owner's own words, prices and reviews, so a first visit can be shown before
        // the script arrives. Its own catch: a failure leaves the page as the hero step made
        // it, without the mark the head script reads, and the cover hides it as it always did.
        try {
            require_once __DIR__ . '/ssr-lib.php';
            require_once __DIR__ . '/reviews-lib.php';
            $out = ssr_home($out, home_ssr_data($pdo, $html));
        } catch (\Throwable $e) {
        }
    }
} catch (\Throwable $e) {
    $out = $html; // any hiccup → the untouched shell, exactly as before this file existed
}

// What the first screen needs, in four reads: the cottages (in the rates' order), the
// content the page names (its own [data-edit-*] keys, each cottage's card keys and saved
// limits, the owner's reviews) and the guests' reviews. Only keys the page itself names are
// read, so nothing private or internal can reach this HTML (test-ssr checks the page's keys).
function home_ssr_data(PDO $pdo, string $shell): array
{
    $props = $pdo->query('SELECT * FROM properties ORDER BY sort_order, name')->fetchAll();
    preg_match_all('#data-edit-(?:text|img)="([a-z0-9_-]+)"#', $shell, $m);
    $keys = array_fill_keys($m[1], true);
    foreach ($props as $p) {
        $k = (string) ($p['prop_key'] ?? '');
        foreach (ssr_card_keys($k) as $ck) {
            $keys[$ck] = true;
        }
        $keys['occupancy-' . $k] = true;
    }
    $keys['reviews'] = true;
    $names = array_keys($keys);
    $q = $pdo->prepare('SELECT item_key, item_value FROM content WHERE item_key IN (' . implode(',', array_fill(0, count($names), '?')) . ')');
    $q->execute($names);
    $content = [];
    foreach ($q->fetchAll() as $r) {
        // As content.php decodes a value: JSON, or the stored text when it is not JSON.
        $d = json_decode((string) $r['item_value'], true);
        $content[$r['item_key']] = $d === null && $r['item_value'] !== 'null' ? $r['item_value'] : $d;
    }
    $reviews = reviews_summary(reviews_merge(reviews_guest_rows($pdo), reviews_curated_from($content['reviews'] ?? [])));
    return ['content' => $content, 'props' => $props, 'reviews' => $reviews, 'base' => '/'];
}

// Conditional GET, so an installed PWA's launch costs a ~0-byte 304 instead of
// re-downloading a byte-identical 34.5KB shell. See shell-etag.php for why the
// comparison has to tolerate mod_deflate's "-gzip" suffix.
require_once __DIR__ . '/shell-etag.php';
shell_send_html($out);
