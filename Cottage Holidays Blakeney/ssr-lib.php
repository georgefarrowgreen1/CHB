<?php
// ============================================================
//  ssr-lib.php — the home page's first screen, written by the server.
//
//  A first visit painted a crown on black until app.js (196KB gzipped) had arrived,
//  run, and asked bootstrap.php for the content. home.php now writes the page as the
//  script would leave it, and index.html's head script lifts the cover for a visitor
//  who has never signed in on this device, so the first paint IS the page (CLAUDE.md,
//  "The page before the script").
//
//  PURE: the shell and the data in, the page out. No database, no session, no output.
//  Each piece is what app.js writes at boot, so the script finds the page already as it
//  would make it and changes nothing a visitor can see:
//    - every [data-edit-text] element's text          applyContentOverrides
//    - the card photos                                applyContentOverrides
//    - the hero headline in its word spans            heroWordsRise
//    - both cottage grids from the live list          cottageCardHtml
//      each card's price                              renderCardPrices
//      each card's rating and Guest favourite         renderCardRatings
//    - the footer's cottage links                     renderFooterCottages
//    - the cottage count and the guest rating         updateHeritageStats
//  A missing anchor skips its piece: the page is never broken, at worst less finished.
// ============================================================

function ssr_esc($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// The text a stored value shows as: app.js decodes entities, then sets textContent.
function ssr_text($v): string
{
    return html_entity_decode((string) $v, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

// A stored content value as app.js holds it (content.php's decode), or '' if not a string.
function ssr_str(array $content, string $key): string
{
    $v = $content[$key] ?? null;
    return is_string($v) ? $v : '';
}

// JS's Number.prototype.toFixed: the nearest n / 10^d to the double's EXACT value, a tie
// going up. sprintf rounds a tie to even and number_format pre-rounds, so each would print
// some ratings differently from the script (4.25 and 87/20 respectively).
function ssr_to_fixed(float $x, int $d): string
{
    $neg = $x < 0;
    $s = sprintf('%.' . ($d + 30) . 'f', abs($x));
    $dot = strpos($s, '.');
    $int = substr($s, 0, $dot);
    $frac = substr($s, $dot + 1);
    $n = (int) ($int . substr($frac, 0, $d));
    if (($frac[$d] ?? '0') >= '5') {
        $n++;
    }
    $p = 10 ** $d;
    $out = $d > 0 ? intdiv($n, $p) . '.' . str_pad((string) ($n % $p), $d, '0', STR_PAD_LEFT) : (string) $n;
    return ($neg && $n !== 0 ? '-' : '') . $out;
}

// Math.round for a positive double: the nearest integer, a tie going up.
function ssr_js_round(float $x): float
{
    $f = floor($x);
    return $x - $f >= 0.5 ? $f + 1 : $f;
}

// gbp(): £, en-GB grouping, two decimals.
function ssr_gbp($n): string
{
    $v = (float) $n;
    $s = ssr_to_fixed(abs($v), 2);
    [$i, $f] = explode('.', $s);
    return '£' . ($v < 0 ? '-' : '') . number_format((float) $i, 0, '.', ',') . '.' . $f;
}

// chbCssUrl(): percent-encode whatever CSS could read as the end of url('…').
function ssr_css_url(string $u): string
{
    return (string) preg_replace_callback('/["\'()\\\\\s<>]/', function ($m) {
        $c = $m[0];
        return $c === "'" ? '%27' : ($c === '(' ? '%28' : ($c === ')' ? '%29' : rawurlencode($c)));
    }, $u);
}

// resizedUrl(): an upload through img.php at the next size up; anything else as it is.
function ssr_resized(string $url, int $w, string $base): string
{
    if (!preg_match('/^uploads\/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i', $url)) {
        return $url;
    }
    $target = min(1600, max(320, $w));
    $pick = 1600;
    foreach ([320, 480, 640, 900, 1200, 1600] as $s) {
        if ($s >= $target) {
            $pick = $s;
            break;
        }
    }
    return $base . 'img.php?src=' . rawurlencode($url) . '&w=' . $pick;
}

// cardKeys(): the original three keep their legacy content keys.
const SSR_LEGACY_CARD_N = ['21a' => 1, 'jollyboat' => 2, 'pimpernel' => 3];
function ssr_card_keys(string $k): array
{
    $n = SSR_LEGACY_CARD_N[$k] ?? 0;
    return $n
        ? ['img' => "card{$n}-img", 'title' => "card{$n}-title", 'meta' => "card{$n}-meta"]
        : ['img' => "card-img-$k", 'title' => "card-title-$k", 'meta' => "card-meta-$k"];
}

// liveCottageKeys(): what the public site shows, in the rates' order.
function ssr_live(array $props): array
{
    $out = [];
    foreach ($props as $p) {
        if (!is_array($p) || empty($p['prop_key']) || !empty($p['archived_at']) || !empty($p['unlisted'])) {
            continue;
        }
        $out[] = $p;
    }
    return $out;
}

// cottageSleepsLabel(): from the cottage's limits, a saved override winning (occupancy_limits).
function ssr_sleeps(array $p, array $content): string
{
    $total = max(1, (int) ($p['max_total'] ?? 2));
    $adults = max(1, (int) ($p['max_adults'] ?? 2));
    $o = $content['occupancy-' . $p['prop_key']] ?? null;
    if (is_array($o) && isset($o['maxAdults'], $o['maxChildren'], $o['maxTotal'])) {
        $total = max(1, (int) $o['maxTotal']);
        $adults = max(1, (int) $o['maxAdults']);
    }
    return 'Sleeps ' . ($total ?: ($adults ?: 2));
}

// A cottage's review figures: [count, star sum], from reviews_summary's props.
function ssr_rating_html(array $fig): string
{
    $n = (int) ($fig[0] ?? 0);
    if ($n <= 0) {
        return '<span class="cr-new">New · no reviews yet</span>';
    }
    $avg = ((float) ($fig[1] ?? 0)) / $n;
    return '<span class="cr-star">★</span> ' . ssr_to_fixed($avg, 1) . ' <span class="cr-count">· ' . $n . ' review' . ($n === 1 ? '' : 's') . '</span>';
}

// One card, as cottageCardHtml() builds it, with the price, rating and Guest favourite
// already in. The photo is marked as shown (img-fade img-in), so the script's settle
// never hides a photo the visitor is already looking at.
function ssr_card_html(array $p, string $prefix, bool $withFav, array $content, array $props, string $base): string
{
    $k = (string) $p['prop_key'];
    $ck = ssr_card_keys($k);
    $slug = strtolower((string) (($p['slug'] ?? '') !== '' ? $p['slug'] : $k));
    $name = (string) (($p['name'] ?? '') !== '' ? $p['name'] : $k);
    $img = ssr_str($content, $ck['img']) !== '' ? ssr_str($content, $ck['img']) : "card-$k.jpg";
    $title = ssr_str($content, $ck['title']) !== '' ? ssr_text(ssr_str($content, $ck['title'])) : $name;
    $meta = ssr_str($content, $ck['meta']) !== '' ? ssr_text(ssr_str($content, $ck['meta'])) : ssr_sleeps($p, $content);
    $fig = $props[$k] ?? [0, 0];
    $n = (int) ($fig[0] ?? 0);
    $avg = $n > 0 ? ((float) $fig[1]) / $n : 0.0;
    $fav = '';
    if ($withFav) {
        $show = $n >= 3 && $avg >= 4.8;
        $fav = '<span class="cott-fav" id="cott-fav-' . ssr_esc($k) . '"' . ($show ? '' : ' hidden') . '><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7-4.6-9.3-9C1.4 9 2.7 5.5 6 5.5c2 0 3.2 1.2 4 2.5.8-1.3 2-2.5 4-2.5 3.3 0 4.6 3.5 3.3 6.5C19 16.4 12 21 12 21z"/></svg> Guest favourite</span>';
    }
    $url = ssr_css_url(ssr_resized($img, 800, $base));
    $ek = ssr_esc($k);
    return '<a class="card glass-panel" data-prop="' . $ek . '" href="/cottages/' . ssr_esc($slug) . '" data-act="cottageLink">'
        . '<div class="card-img-wrap">'
        . '<div class="card-img img-fade img-in" data-edit-img="' . ssr_esc($ck['img']) . '" role="img" aria-label="Photo of ' . ssr_esc($title) . '" style="background-image: url(\'' . ssr_esc($url) . '\');"></div>'
        . $fav
        . '</div>'
        . '<div class="card-title" data-edit-text="' . ssr_esc($ck['title']) . '">' . ssr_esc($title) . '</div>'
        . '<div class="cott-facts">'
        . '<div class="card-rating" id="' . ssr_esc($prefix) . 'card-rating-' . $ek . '">' . ssr_rating_html($fig) . '</div>'
        . '<div class="card-meta" data-edit-text="' . ssr_esc($ck['meta']) . '">' . ssr_esc($meta) . '</div>'
        . '</div>'
        . '<div class="card-foot">'
        . '<div class="card-price" id="' . ssr_esc($prefix) . 'card-price-' . $ek . '">from ' . ssr_gbp($p['couple_rate'] ?? 0) . ' <span>/ night (couple)</span></div>'
        . '<div class="card-avail" id="' . ssr_esc($prefix) . 'card-avail-' . $ek . '"></div>'
        . '</div>'
        . '</a>';
}

// Replace what sits between <!--ssr:NAME--> and <!--/ssr:NAME-->; untouched without both,
// and $done says which happened.
function ssr_between(string $html, string $name, string $inner, ?bool &$done = null): string
{
    $a = '<!--ssr:' . $name . '-->';
    $b = '<!--/ssr:' . $name . '-->';
    $i = strpos($html, $a);
    $j = $i === false ? false : strpos($html, $b, $i);
    $done = $i !== false && $j !== false;
    if (!$done) {
        return $html;
    }
    return substr($html, 0, $i + strlen($a)) . $inner . substr($html, $j);
}

// heroWordsRise(): the headline's words in spans, the whole headline as its name.
function ssr_hero_words(string $html, ?bool &$done = null): string
{
    $done = false;
    return (string) preg_replace_callback(
        '#(<h1\b[^>]*\bdata-edit-text="hero-title"[^>]*)>([^<]*)</h1>#',
        function ($m) use (&$done) {
            $words = preg_split('/\s+/u', trim(ssr_text($m[2]))) ?: [];
            $words = array_values(array_filter($words, fn($w) => $w !== ''));
            if (!$words) {
                return $m[0];
            }
            $spans = [];
            foreach ($words as $i => $w) {
                $spans[] = '<span class="w" aria-hidden="true" style="--i: ' . $i . ';"><i>' . ssr_esc($w) . '</i></span>';
            }
            $done = true;
            return $m[1] . ' aria-label="' . ssr_esc(implode(' ', $words)) . '">' . implode(' ', $spans) . '</h1>';
        },
        $html,
        1,
    );
}

// The page. $d: content (key => value as content.php decodes it), props (rows in the
// rates' order), reviews (reviews_summary), base (the app's path, for img.php links).
function ssr_home(string $html, array $d): string
{
    $content = is_array($d['content'] ?? null) ? $d['content'] : [];
    $rows = is_array($d['props'] ?? null) ? $d['props'] : [];
    $rv = is_array($d['reviews'] ?? null) ? $d['reviews'] : [];
    $base = (string) ($d['base'] ?? '/');
    $live = ssr_live($rows);

    // Every text-only [data-edit-text] element, as applyContentOverrides leaves it.
    $html = (string) preg_replace_callback(
        '#(<([a-z][a-z0-9]*)\b[^>]*\bdata-edit-text="([a-z0-9_-]+)"[^>]*>)([^<]*)(</\2>)#i',
        function ($m) use ($content) {
            // Only a string replaces the default, as in the script; an empty one empties it.
            $v = $content[$m[3]] ?? null;
            return is_string($v) ? $m[1] . ssr_esc(ssr_text($v)) . $m[5] : $m[0];
        },
        $html,
    );
    $html = ssr_hero_words($html, $words);
    $grids = false;

    if ($live) {
        $props = is_array($rv['props'] ?? null) ? $rv['props'] : [];
        $home = '';
        $all = '';
        $foot = '';
        foreach ($live as $p) {
            $home .= ssr_card_html($p, 'home-', false, $content, $props, $base);
            $all .= ssr_card_html($p, '', true, $content, $props, $base);
            $slug = strtolower((string) (($p['slug'] ?? '') !== '' ? $p['slug'] : $p['prop_key']));
            $name = (string) (($p['name'] ?? '') !== '' ? $p['name'] : $p['prop_key']);
            $foot .= '<a href="/cottages/' . ssr_esc($slug) . '" data-act="cottageLink" data-prop="' . ssr_esc($p['prop_key']) . '">' . ssr_esc($name) . '</a>';
        }
        $keys = implode(',', array_map(fn($p) => (string) $p['prop_key'], $live));
        $html = ssr_between($html, 'home-cards', $home, $one);
        $html = ssr_between($html, 'cards', $all, $two);
        $html = ssr_between($html, 'footer-cottages', $foot);
        $grids = $one && $two;
        // The grids say which cottages the server wrote, so the script can keep them.
        $html = str_replace(['id="home-cottages-grid"', 'id="cottages"'], ['id="home-cottages-grid" data-ssr-keys="' . ssr_esc($keys) . '"', 'id="cottages" data-ssr-keys="' . ssr_esc($keys) . '"'], $html);
        $html = (string) preg_replace('#(<span class="heritage-num" id="heritage-count">)[^<]*(</span>)#', '${1}' . count($live) . '${2}', $html, 1);
    }
    // The guest rating, from three reviews up (updateHeritageStats).
    $n = (int) ($rv['n'] ?? 0);
    if ($n >= 3) {
        $avg = ((float) ($rv['sum'] ?? 0)) / $n;
        $txt = '★ ' . ssr_to_fixed(ssr_js_round($avg * 10) / 10, 1);
        $html = (string) preg_replace('#<div class="heritage-item" id="heritage-rating-item" style="display:none;">#', '<div class="heritage-item" id="heritage-rating-item">', $html, 1);
        $html = (string) preg_replace('#(<span class="heritage-num" id="heritage-rating">)[^<]*(</span>)#', '${1}' . ssr_esc($txt) . '${2}', $html, 1);
    }
    // Last: the mark the head script reads to show this page without its cover. Only when the
    // first screen is the script's own: both grids written (a static card is a placeholder) and
    // the headline in its spans (unwrapped, the script would wrap it and it would rise again).
    if (!$grids || !$words) {
        return $html;
    }
    return (string) preg_replace('#<html\b([^>]*)>#', '<html$1 data-ssr="home">', $html, 1);
}
