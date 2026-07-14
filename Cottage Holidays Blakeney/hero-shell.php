<?php
// ============================================================
//  hero-shell.php — shared hero-image rewrite for the standalone SSR shells
//  (home.php, cottage.php, experiences-page.php).
//
//  index.html ships static 'hero.jpg' references, but that file does NOT exist
//  on the live host (the real hero is an uploaded photo in content 'hero-bg').
//  home.php already swapped it for '/'; cottage.php and /experiences did not, so
//  those pages fired a fetchpriority="high" preload for a 404 and carried
//  hero.jpg in their JSON-LD / social images. This helper does the swap for all
//  three routes: the LCP preload, the hero element, and the absolute
//  og/twitter/JSON-LD image URLs.
//
//  Pure string ops — NO database, NO session (these routes must never touch
//  db.php, whose db() EXITS with JSON on failure and would corrupt the HTML).
//  Returns $out unchanged when $hero isn't a safe site-relative image path.
// ============================================================

function inject_live_hero($out, $hero, $origin)
{
    $hero = trim((string) $hero);
    // Defence in depth: only ever inject a safe site-relative image path
    // (these are server-generated upload names).
    if ($hero === '' || !preg_match('#^[a-z0-9/_.\-]+\.(jpe?g|png|webp)$#i', $hero)) {
        return $out;
    }
    $heroAbs = $origin . '/' . ltrim($hero, '/');
    $safe = htmlspecialchars($hero, ENT_QUOTES);
    // Absolute references: og:image, twitter:image and the JSON-LD images.
    $out = str_replace($origin . '/hero.jpg', $heroAbs, $out);
    // The LCP preload — the single biggest first-paint win on the page.
    $out = str_replace(
        '<link rel="preload" as="image" href="hero.jpg" fetchpriority="high">',
        '<link rel="preload" as="image" href="' . $safe . '" fetchpriority="high">',
        $out,
    );
    // The hero element itself (no flash of a missing image before JS runs).
    $out = str_replace(
        'data-edit-img="hero-bg" style="background-image: url(\'hero.jpg\');"',
        'data-edit-img="hero-bg" style="background-image: url(\'' . $safe . '\');"',
        $out,
    );
    // The static og:image:width/height (1200×630) no longer match: the live hero is
    // resized to 1920px wide at its ORIGINAL aspect ratio, so declared dims would
    // make social platforms crop the preview wrong. Drop them (mirrors cottage.php).
    $out = preg_replace('#\s*<meta property="og:image:(width|height)" content="[^"]*">#', '', $out);

    return $out;
}
