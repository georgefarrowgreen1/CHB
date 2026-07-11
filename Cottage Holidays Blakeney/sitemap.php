<?php
// ============================================================
//  sitemap.php — dynamic XML sitemap.
//  Served at /sitemap.xml via the rewrite in htaccess.txt, so it always lists
//  the cottages that are currently LIVE (owner-added ones included, archived
//  ones dropped) instead of a hardcoded three. robots.txt points here.
// ============================================================
// Deliberately STANDALONE (own PDO, mirrors home.php/cottage.php): db.php's
// db() EXITS with a JSON error when the database is down, which would emit a
// JSON blob under this XML header. A local PDO throws instead, and the catch
// below serves the three-cottage fallback.
header('Content-Type: application/xml; charset=UTF-8');

// Single canonical origin (matches the SITE_ORIGIN used for canonicals/JSON-LD).
$origin = 'https://cottageholidaysblakeney.co.uk';

// Live cottages, in display order.
$cottages = [];
try {
    if (!is_file(__DIR__ . '/config.php')) {
        throw new RuntimeException('no config');
    }
    require_once __DIR__ . '/config.php';
    $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 3,
    ]);
    foreach (
        $pdo
            ->query('SELECT slug, prop_key FROM properties WHERE archived_at IS NULL AND unlisted = 0 ORDER BY sort_order, name')
            ->fetchAll()
        as $r
    ) {
        $slug = $r['slug'] ?: $r['prop_key'];
        if ($slug !== '') {
            $cottages[] = $slug;
        }
    }
} catch (\Throwable $e) {
    // Pre-migration fallback: the original three.
    $cottages = ['21a-westgate', 'jollyboat', 'pimpernel'];
}

$esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' . "\n";
echo '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n";

// The homepage hero. index.html's static hero.jpg 404s on the live host, so use
// the owner's uploaded hero (content 'hero-bg'); omit the image entry entirely if
// none is set rather than list a 404.
$heroImg = '';
$hb = content_value('hero-bg');
if ($hb !== '' && preg_match('#^[a-z0-9/_.\-]+\.(jpe?g|png|webp)$#i', $hb)) {
    $heroImg = $origin . '/' . ltrim($hb, '/');
}

// Home page (with the hero image, when set).
echo "  <url>\n";
echo "    <loc>{$origin}/</loc>\n";
echo "    <changefreq>weekly</changefreq>\n";
echo "    <priority>1.0</priority>\n";
if ($heroImg !== '') {
    echo "    <image:image>\n";
    echo '      <image:loc>' . $esc($heroImg) . "</image:loc>\n";
    echo "      <image:title>Holiday cottages in Blakeney, North Norfolk</image:title>\n";
    echo "      <image:caption>Self-catering holiday cottages in Blakeney on the North Norfolk coast.</image:caption>\n";
    echo "    </image:image>\n";
}
echo "  </url>\n";

// Things to do (server-rendered for crawlers by experiences-page.php).
echo "  <url>\n    <loc>{$origin}/experiences</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n";

// One entry per live cottage.
foreach ($cottages as $slug) {
    $loc = $origin . '/cottages/' . $esc($slug);
    echo "  <url>\n";
    echo "    <loc>{$loc}</loc>\n";
        echo "    <changefreq>weekly</changefreq>\n";
    echo "    <priority>0.9</priority>\n";
    echo "  </url>\n";
}

echo "</urlset>\n";
