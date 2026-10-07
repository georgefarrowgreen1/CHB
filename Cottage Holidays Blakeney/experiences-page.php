<?php
// ============================================================
//  experiences-page.php — server-rendered shell for /experiences.
//
//  NB: since the owner restricted things to do to guests who have booked,
//  this route renders NO list and is noindex — it only keeps /experiences
//  working as a link (the app then asks experiences.php, which refuses
//  anyone who hasn't booked). The history below is why the route exists.
//
//  The Experiences view (hand-picked local things to do) was rendered
//  entirely by JavaScript with no URL of its own, so the best "things to do
//  in Blakeney" content on the site was invisible to search engines. The
//  .htaccess rewrite gives it a real URL and this route serves the app shell
//  with the published experiences rendered into the (otherwise empty)
//  #exp-grid, plus a page-specific title / description / canonical / og:
//  tags. app.js recognises the /experiences path on boot and opens the view,
//  then re-renders the rich interactive cards over the server markup.
//
//  Same pattern and guarantees as cottage.php / home.php: standalone PDO,
//  and on ANY problem it serves index.html untouched.
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
        // THINGS TO DO ARE FOR GUESTS WHO HAVE BOOKED (owner's ask), so this route
        // no longer renders the list for crawlers: it serves the app shell, which
        // asks experiences.php (booked guests + owner only) like every other door,
        // and tells search engines not to index it.
        $origin = 'https://cottageholidaysblakeney.co.uk';

        // Swap the static hero.jpg (404 on the live host) for the uploaded hero:
        // fixes the fetchpriority="high" preload firing at a 404 AND gives this
        // page a real og:image/twitter:image (it set no image of its own, so it
        // was inheriting the broken static hero.jpg).
        $hs = $pdo->prepare("SELECT item_value FROM content WHERE item_key = 'hero-bg'");
        $hs->execute();
        $hv = $hs->fetchColumn();
        $hero = '';
        if ($hv !== false) {
            $hd = json_decode((string) $hv, true);
            if (is_string($hd)) {
                $hero = trim($hd);
            }
        }
        require_once __DIR__ . '/hero-shell.php';
        $out = inject_live_hero($out, $hero, $origin, false); // experiences route never paints #hero
    }
} catch (\Throwable $e) {
    $out = $html; // any hiccup → the untouched shell
}

// Conditional GET, so an installed PWA's launch costs a ~0-byte 304 instead of
// re-downloading a byte-identical 34.5KB shell. See shell-etag.php for why the
// comparison has to tolerate mod_deflate's "-gzip" suffix.
header('X-Robots-Tag: noindex');
require_once __DIR__ . '/shell-etag.php';
shell_send_html($out);
