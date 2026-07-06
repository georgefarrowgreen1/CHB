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
    }
} catch (\Throwable $e) {
    $out = $html; // any hiccup → the untouched shell, exactly as before this file existed
}

header('Content-Type: text/html; charset=utf-8');
echo $out;
