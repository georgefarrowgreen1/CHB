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
if ($html === false) { http_response_code(404); header('Content-Type: text/plain; charset=utf-8'); exit('Not found'); }

$out = $html;
try {
    if (is_file(__DIR__ . '/config.php')) {
        require_once __DIR__ . '/config.php';
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET,
            DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 3]
        );
        $s = $pdo->prepare("SELECT item_value FROM content WHERE item_key = 'hero-bg'");
        $s->execute();
        $v = $s->fetchColumn();
        $hero = '';
        if ($v !== false) { $d = json_decode((string)$v, true); if (is_string($d)) $hero = trim($d); }

        // Only rewrite when the owner has an uploaded hero and the path is a safe
        // site-relative image (defence in depth — these are server-generated names).
        if ($hero !== '' && preg_match('#^[a-z0-9/_.\-]+\.(jpe?g|png|webp)$#i', $hero)) {
            $origin  = 'https://cottageholidaysblakeney.co.uk';
            $heroAbs = $origin . '/' . ltrim($hero, '/');
            // Absolute references: og:image, twitter:image and the JSON-LD images.
            $out = str_replace($origin . '/hero.jpg', $heroAbs, $out);
            // The LCP preload — the single biggest first-paint win on the page.
            $out = str_replace(
                '<link rel="preload" as="image" href="hero.jpg" fetchpriority="high">',
                '<link rel="preload" as="image" href="' . htmlspecialchars($hero, ENT_QUOTES) . '" fetchpriority="high">',
                $out
            );
            // The hero element itself (no flash of a missing image before JS runs).
            $out = str_replace(
                'data-edit-img="hero-bg" style="background-image: url(\'hero.jpg\');"',
                'data-edit-img="hero-bg" style="background-image: url(\'' . htmlspecialchars($hero, ENT_QUOTES) . '\');"',
                $out
            );
        }
    }
} catch (\Throwable $e) {
    $out = $html;   // any hiccup → the untouched shell, exactly as before this file existed
}

header('Content-Type: text/html; charset=utf-8');
echo $out;
