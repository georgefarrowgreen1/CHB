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

// $preload — does THIS route actually paint the hero? Only the homepage does:
// #hero lives inside <main id="view-main">, which the cottage and experiences
// routes leave display:none, and a display:none background-image is never
// fetched. The preload defeats exactly that, pulling the largest asset on the
// site at fetchpriority=high for an element those two routes never show.
function inject_live_hero($out, $hero, $origin, $preload = true)
{
    $hero = trim((string) $hero);
    // Defence in depth: only ever inject a safe site-relative image path
    // (these are server-generated upload names).
    if ($hero === '' || !preg_match('#^[a-z0-9/_.\-]+\.(jpe?g|png|webp)$#i', $hero)) {
        return $out;
    }
    $heroAbs = $origin . '/' . ltrim($hero, '/');
    // Both injection points now go through img.php with a rawurlencode'd src, so
    // the plain-path escape this used to need is gone.
    // Absolute references: og:image, twitter:image and the JSON-LD images.
    $out = str_replace($origin . '/hero.jpg', $heroAbs, $out);
    // THE LCP PRELOAD, AT A SIZE THE PHONE CAN USE. The upload is 1920×1440 and
    // htaccess negotiates a .webp companion, so a real guest downloads ~726KB for
    // a box that is 1170 device px wide on a phone. img.php (already used for
    // every other image, already immutable-cached, already routed into the service
    // worker's image bucket) returns w=1200 at ~349KB — measured ~377KB and ~3.3s
    // of LCP saved on slow 4G, on the largest asset every anonymous visitor pays
    // for. 1200 not 900: the hero box is 390×517 CSS px at DPR3, so 900 would
    // upscale a full-bleed photo. The og:image/JSON-LD replacement above keeps the
    // 1920px ORIGINAL — social platforms want that one.
    // NB img.php's own fallback (no GD, or an unwritable cache dir) streams the
    // ORIGINAL, which does NOT go through the .htaccess WebP rewrite — so a broken
    // cache degrades to the 909KB JPEG, worse than today. Worth knowing before
    // assuming the degrade is free.
    $preloadTag = '<link rel="preload" as="image" href="hero.jpg" fetchpriority="high">';
    if ($preload) {
        $sized = 'img.php?src=' . rawurlencode($hero) . '&amp;w=1200';
        $out = str_replace(
            $preloadTag,
            '<link rel="preload" as="image" href="' . $sized . '" fetchpriority="high">',
            $out,
        );
    } else {
        // This route never paints the hero — drop the tag entirely rather than
        // rewrite it. (Leaving it pointed at hero.jpg would be worse still: that
        // file does not exist on the live host and 404s.)
        $out = str_replace($preloadTag, '', $out);
    }
    // The hero element itself (no flash of a missing image before JS runs). Same
    // sized source as the preload, so the warmed entry is the one CSS asks for —
    // pointing them at different URLs would download the photo twice.
    $out = str_replace(
        'data-edit-img="hero-bg" style="background-image: url(\'hero.jpg\');"',
        'data-edit-img="hero-bg" style="background-image: url(\'img.php?src=' . rawurlencode($hero) . '&amp;w=1200\');"',
        $out,
    );
    // The static og:image:width/height (1200×630) no longer match: the live hero is
    // resized to 1920px wide at its ORIGINAL aspect ratio, so declared dims would
    // make social platforms crop the preview wrong. Drop them (mirrors cottage.php).
    $out = preg_replace('#\s*<meta property="og:image:(width|height)" content="[^"]*">#', '', $out);

    return $out;
}
