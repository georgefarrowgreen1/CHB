<?php
// ============================================================
//  test-ssr.php — the home page written by the server (ssr-lib.php), checked with no
//  database: the real index.html and a fixture business in, the page out. Dev/CI only
//  (deploy-excluded with every test-*.php).
//
//  What it holds: every piece is what app.js would write (the text, the photos, the
//  headline's word spans, both grids and the footer from the live list, each price,
//  rating and Guest favourite, the cottage count and guest rating); a stored value is
//  text, never markup; a cottage the public cannot see is never written; the page is
//  marked for the head script only when its first screen is complete; the hero photo is
//  one size rule; only public words are read; and the numbers round as the script rounds
//  them. The browser half (the head script, the hand-over, the script's own cards agreeing)
//  is ui-test-earlypaint.js; home.php's reads against a real database are integration §102.
// ============================================================
require_once __DIR__ . '/ssr-lib.php';
require_once __DIR__ . '/reviews-lib.php';
require_once __DIR__ . '/hero-shell.php';
require_once __DIR__ . '/db.php'; // the content-key classifiers (§5), before any output: it sets headers

$pass = 0;
$fail = 0;
function ssc(string $label, bool $ok, string $detail = ''): void
{
    global $pass, $fail;
    if ($ok) {
        $pass++;
        echo "  \u{2713} $label\n";
    } else {
        $fail++;
        echo "  \u{2717} $label" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}
// Is the page marked for the head script? (The attribute on the root element, not a mention.)
function ssr_marked(string $html): bool
{
    return (bool) preg_match('#<html\b[^>]*\bdata-ssr="home"#', $html);
}

$shell = (string) file_get_contents(__DIR__ . '/index.html');
ssc('(vacuity) index.html read', strlen($shell) > 50000);
ssc('(vacuity) the shell itself is not marked', !ssr_marked($shell));

echo "\n== 1. the numbers round as the script rounds them ==\n";
// Each expected string is what node prints for the same double (toFixed / gbp).
$fixed = [[4.35, 1, '4.3'], [87 / 20, 1, '4.3'], [4.25, 1, '4.3'], [4.75, 1, '4.8'], [0.15, 1, '0.1'], [4.95, 1, '5.0'], [2.675, 2, '2.67'], [0.005, 2, '0.01'], [5.0, 1, '5.0'], [4.8, 1, '4.8']];
$bad = [];
foreach ($fixed as [$x, $d, $want]) {
    $got = ssr_to_fixed((float) $x, $d);
    if ($got !== $want) {
        $bad[] = "{$x}→{$got} (want {$want})";
    }
}
ssc('toFixed: the nearest to the exact double, a tie going up (' . count($fixed) . ' cases)', !$bad, implode(', ', $bad));
ssc('gbp: £, grouping, two decimals', ssr_gbp(130) === '£130.00' && ssr_gbp(1234.5) === '£1,234.50' && ssr_gbp(0.005) === '£0.01');
ssc('Math.round: a tie goes up', ssr_js_round(43.5) === 44.0 && ssr_js_round(43.4999) === 43.0);

echo "\n== 2. a fixture business through the whole page ==\n";
$props = [
    ['prop_key' => '21a', 'name' => '21A Westgate', 'slug' => '21a-westgate', 'couple_rate' => 165, 'max_total' => 6, 'max_adults' => 6, 'archived_at' => null, 'unlisted' => 0],
    ['prop_key' => 'jollyboat', 'name' => 'Jollyboat', 'slug' => 'jollyboat', 'couple_rate' => 1234.5, 'max_total' => 2, 'max_adults' => 2, 'archived_at' => null, 'unlisted' => 0],
    ['prop_key' => 'secret', 'name' => 'Secret Hideaway', 'slug' => 'secret', 'couple_rate' => 999, 'max_total' => 2, 'archived_at' => null, 'unlisted' => 1],
    ['prop_key' => 'oldone', 'name' => 'Old One', 'slug' => 'oldone', 'couple_rate' => 50, 'max_total' => 2, 'archived_at' => '2025-01-01 00:00:00', 'unlisted' => 0],
    ['prop_key' => 'boathouse', 'name' => 'The Boathouse', 'slug' => 'The-Boathouse', 'couple_rate' => 140, 'max_total' => 4, 'max_adults' => 3, 'archived_at' => null, 'unlisted' => 0],
];
$content = [
    'hero-title' => 'Three cottages &amp; a <script>alert(1)</script> quay',
    'hero-kicker' => 'Est. 1983 · Book direct',
    'nav-home' => 'Start',
    'card1-title' => 'Westgate House',
    'card1-meta' => 'Sleeps 6 • Townhouse',
    'card1-img' => 'uploads/card-21a.jpg',
    'card2-img' => "https://example.com/a'b(c).jpg",
    'occupancy-boathouse' => ['maxAdults' => 4, 'maxChildren' => 1, 'maxTotal' => 5],
];
// 87/20 and 17/4: the script prints 4.3 for both (one is a binary under-shoot, the other a tie).
$reviews = ['v' => 2, 'list' => [], 'n' => 24, 'sum' => 104, 'props' => ['21a' => [20, 87], 'jollyboat' => [4, 17]], 'ld' => [10, 44]];
$out = ssr_home($shell, ['content' => $content, 'props' => $props, 'reviews' => $reviews, 'base' => '/']);

ssc('the page is marked for the head script', strpos($out, '<html lang="en-GB" data-ssr="home">') !== false);
ssc('a stored value is text: the headline cannot carry markup', strpos($out, '<script>alert(1)') === false && strpos($out, '&lt;script&gt;alert(1)&lt;/script&gt;') !== false);
ssc('…and an entity in it reads as the character (decoded, then escaped once)', strpos($out, '<i>&amp;</i>') !== false && strpos($out, '&amp;amp;') === false);
preg_match('#<h1[^>]*data-edit-text="hero-title"[^>]*>.*?</h1>#s', $out, $h1);
$h1 = $h1[0] ?? '';
ssc('the headline is in its word spans, numbered, the whole of it its name', substr_count($h1, '<span class="w" aria-hidden="true" style="--i: ') === 6 && strpos($h1, 'style="--i: 5;"><i>quay</i>') !== false && strpos($h1, 'aria-label="Three cottages &amp; a &lt;script&gt;alert(1)&lt;/script&gt; quay"') !== false, $h1);
ssc('the kicker and the nav say what the owner wrote', strpos($out, 'data-edit-text="hero-kicker">Est. 1983 · Book direct</p>') !== false && strpos($out, 'data-edit-text="nav-home">Start</a>') !== false);
ssc('…and a key the owner never set keeps the page\'s own words', strpos($out, 'data-edit-text="hero-sub">Family-run holiday cottages') !== false);

// The grids, read back from between their markers.
$between = function (string $html, string $name): string {
    $a = strpos($html, '<!--ssr:' . $name . '-->');
    $b = $a === false ? false : strpos($html, '<!--/ssr:' . $name . '-->', $a);
    return ($a !== false && $b !== false) ? substr($html, $a, $b - $a) : '';
};
$home = $between($out, 'home-cards');
$all = $between($out, 'cards');
$foot = $between($out, 'footer-cottages');
preg_match_all('#data-prop="([^"]+)" href="/cottages/([^"]+)"#', $home, $hm);
ssc('the home grid has the live cottages in the rates\' order, none the public cannot see', $hm[1] === ['21a', 'jollyboat', 'boathouse'], implode(',', $hm[1]));
ssc('…and the slug as the client lowers it', $hm[2] === ['21a-westgate', 'jollyboat', 'the-boathouse'], implode(',', $hm[2]));
ssc('the cottages grid holds the same three', substr_count($all, 'class="card glass-panel"') === 3 && strpos($all, 'secret') === false && strpos($all, 'oldone') === false);
ssc('the grids say which cottages the server wrote', strpos($out, 'id="home-cottages-grid" data-ssr-keys="21a,jollyboat,boathouse"') !== false && strpos($out, 'id="cottages" data-ssr-keys="21a,jollyboat,boathouse"') !== false);
ssc('each price, as renderCardPrices writes it', strpos($home, 'id="home-card-price-21a">from £165.00 <span>/ night (couple)</span></div>') !== false && strpos($all, 'id="card-price-jollyboat">from £1,234.50 <span>/ night (couple)</span></div>') !== false);
ssc('each rating: 87/20 and 17/4 both print 4.3, as the script prints them', strpos($home, 'id="home-card-rating-21a"><span class="cr-star">★</span> 4.3 <span class="cr-count">· 20 reviews</span>') !== false && strpos($home, 'id="home-card-rating-jollyboat"><span class="cr-star">★</span> 4.3 <span class="cr-count">· 4 reviews</span>') !== false);
ssc('…and a cottage with none says so', strpos($home, 'id="home-card-rating-boathouse"><span class="cr-new">New · no reviews yet</span>') !== false);
ssc('the Guest favourite only on the cottages grid, hidden below 4.8', strpos($home, 'cott-fav') === false && strpos($all, 'id="cott-fav-21a" hidden>') !== false);
$fav = ssr_home($shell, ['content' => [], 'props' => $props, 'reviews' => ['n' => 3, 'sum' => 15, 'props' => ['21a' => [3, 15]]], 'base' => '/']);
ssc('…and shown from three reviews at 4.8 or more, as renderCardRatings shows it', strpos($between($fav, 'cards'), 'id="cott-fav-21a"><svg') !== false);
ssc('the owner\'s title and meta win; the name and the limits fill in (a saved limit winning)', strpos($home, 'data-edit-text="card1-title">Westgate House</div>') !== false && strpos($home, 'data-edit-text="card-title-boathouse">The Boathouse</div>') !== false && strpos($home, 'data-edit-text="card-meta-boathouse">Sleeps 5</div>') !== false);
ssc('an upload goes through img.php at the card\'s size, marked as already shown', strpos($home, 'class="card-img img-fade img-in" data-edit-img="card1-img" role="img" aria-label="Photo of Westgate House" style="background-image: url(\'/img.php?src=uploads%2Fcard-21a.jpg&amp;w=900\');"') !== false);
ssc('a link\'s quote and brackets cannot end its url()', strpos($home, "url('https://example.com/a%27b%28c%29.jpg')") !== false);
ssc('a cottage with no photo set keeps the page\'s own name for one', strpos($home, "url('card-boathouse.jpg')") !== false);
ssc('the footer lists the live cottages', strpos($foot, '<a href="/cottages/the-boathouse" data-act="cottageLink" data-prop="boathouse">The Boathouse</a>') !== false && strpos($foot, 'secret') === false && strpos($foot, 'oldone') === false);
ssc('the cottage count is the live list', strpos($out, '<span class="heritage-num" id="heritage-count">3</span>') !== false);
ssc('the guest rating, from three reviews up, rounded as updateHeritageStats rounds it', strpos($out, '<div class="heritage-item" id="heritage-rating-item">') !== false && strpos($out, '<span class="heritage-num" id="heritage-rating">★ 4.3</span>') !== false);

echo "\n== 3. what the server must not do ==\n";
$few = ssr_home($shell, ['content' => [], 'props' => $props, 'reviews' => ['n' => 2, 'sum' => 10, 'props' => []], 'base' => '/']);
ssc('two reviews: no guest rating (the script waits for three)', strpos($few, 'id="heritage-rating-item" style="display:none;"') !== false && ssr_marked($few));
$none = ssr_home($shell, ['content' => [], 'props' => [], 'reviews' => [], 'base' => '/']);
ssc('no live list: the static cards stay and the page is not marked (the cover hides them)', strpos($none, 'data-ssr-keys') === false && strpos($none, 'id="home-cottages-grid"') !== false && !ssr_marked($none));
$cutOut = ssr_home(str_replace('<!--/ssr:home-cards-->', '', $shell), ['content' => $content, 'props' => $props, 'reviews' => $reviews, 'base' => '/']);
ssc('an anchor gone: that piece is skipped and the page is whole', substr_count($cutOut, '</main>') === substr_count($shell, '</main>') && strpos($cutOut, '<!--ssr:home-cards-->') !== false);
ssc('…and not marked: a static card is a placeholder, so the cover stays', !ssr_marked($cutOut));
$noWords = ssr_home(str_replace('<h1 data-edit-text="hero-title">Three cottages', '<h1 data-edit-text="hero-title"><b>x</b>Three cottages', $shell), ['content' => [], 'props' => $props, 'reviews' => $reviews, 'base' => '/']);
ssc('a headline the renderer cannot put in its spans: not marked (the script would wrap it and it would rise again)', !ssr_marked($noWords));
ssc('every marker the renderer writes between is in index.html, once each', substr_count($shell, '<!--ssr:home-cards-->') === 1 && substr_count($shell, '<!--/ssr:home-cards-->') === 1 && substr_count($shell, '<!--ssr:cards-->') === 1 && substr_count($shell, '<!--/ssr:cards-->') === 1 && substr_count($shell, '<!--ssr:footer-cottages-->') === 1 && substr_count($shell, '<!--/ssr:footer-cottages-->') === 1);

echo "\n== 4. the hero photo: one size rule, read by the browser ==\n";
$sh = ssr_home(inject_live_hero($shell, 'uploads/hero-abc.jpg', 'https://x.test'), ['content' => $content, 'props' => $props, 'reviews' => $reviews, 'base' => '/']);
preg_match('#<style id="hero-photo">(.*?)</style>#s', $sh, $rule);
$rule = $rule[1] ?? '';
ssc('the rule asks for 1200 below 900px and 1600 from there (heroPhotoUrl\'s sizes)', strpos($rule, "#hero .hero-bg{background-image:url('img.php?src=uploads%2Fhero-abc.jpg&w=1200')}") !== false && strpos($rule, "@media (min-width:900px){#hero .hero-bg{background-image:url('img.php?src=uploads%2Fhero-abc.jpg&w=1600')}}") !== false, $rule);
ssc('a style element is not decoded: a bare &, never &amp;, inside it', $rule !== '' && strpos($rule, '&amp;') === false);
ssc('each size is preloaded for its own screen, and the placeholder never is', strpos($sh, 'href="img.php?src=uploads%2Fhero-abc.jpg&amp;w=1200" fetchpriority="high" media="(max-width: 899px)"') !== false && strpos($sh, 'href="img.php?src=uploads%2Fhero-abc.jpg&amp;w=1600" fetchpriority="high" media="(min-width: 900px)"') !== false && strpos($sh, 'href="hero.jpg"') === false);
ssc('the element carries no photo of its own (the rule places it; the scene stays off)', strpos($sh, 'data-edit-img="hero-bg" style=') === false && strpos($sh, 'data-edit-img="hero-bg"') !== false);
$plain = inject_live_hero($shell, 'images/hero.jpg', 'https://x.test');
ssc('a photo that is not an upload is used as it is, as resizedUrl leaves it', strpos($plain, "#hero .hero-bg{background-image:url('images/hero.jpg')}") !== false && strpos($plain, 'img.php?src=images') === false);
$route = inject_live_hero($shell, 'uploads/hero-abc.jpg', 'https://x.test', false);
ssc('a route that does not paint the hero first gets the rule and no preload', strpos($route, '<style id="hero-photo">') !== false && strpos($route, 'rel="preload" as="image" href="img.php') === false);

echo "\n== 5. only public words reach the page ==\n";
preg_match_all('#data-edit-(?:text|img)="([a-z0-9_-]+)"#', $shell, $km);
$named = array_values(array_unique($km[1]));
$hidden = array_values(array_filter($named, fn($k) => is_internal_content_key($k) || is_private_content_key($k)));
ssc('(vacuity) the page names its content keys', count($named) >= 15, (string) count($named));
ssc('every key the page names is public (home.php reads only those)', !$hidden, implode(', ', $hidden));
$card = [];
foreach (['21a', 'jollyboat', 'boathouse'] as $k) {
    foreach (array_merge(array_values(ssr_card_keys($k)), ['occupancy-' . $k]) as $ck) {
        if (is_internal_content_key($ck) || is_private_content_key($ck)) {
            $card[] = $ck;
        }
    }
}
ssc('…and so are the card, limit and review keys it adds', !$card && !is_internal_content_key('reviews') && !is_private_content_key('reviews'), implode(', ', $card));

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \u{274C}\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \u{2705}\n\n";
exit(0);
