<?php
// ============================================================
//  reviews-lib.php — the reviews the site shows, and the figures it states about them.
//  No db.php: the queries take the connection they are given, so home.php (which keeps
//  its own connection and must never meet db()'s JSON exit) writes the same figures into
//  the first screen as reviews.php sends the script. See CLAUDE.md, "A visitor is sent the
//  reviews on screen" and "The page before the script".
// ============================================================

const REVIEWS_PER_COTTAGE = 4;   // the cottage page's cards
const REVIEWS_ROTATION = 12;     // the homepage's rotating quotes
const REVIEWS_LD = 12;           // the search-result markup's reviews

// Approved reviews from guests: on-site submissions, then the ones left through a review
// link, each newest first. A table that is not there yet adds nothing.
function reviews_guest_rows(PDO $pdo): array
{
    $out = [];
    // Registered-guest reviews (guest_reviews, keyed to an account).
    try {
        $rows = $pdo
            ->query(
                "SELECT r.prop_key, r.stars, r.review_text, g.name
             FROM guest_reviews r JOIN guests g ON g.id = r.guest_id
             WHERE r.status = 'approved' ORDER BY r.created_at DESC",
            )
            ->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $r) {
            $out[] = ['name' => $r['name'], 'stars' => (int) $r['stars'], 'text' => $r['review_text'], 'prop' => $r['prop_key']];
        }
    } catch (\Throwable $e) {
    } // table missing — no reviews yet
    // External-guest reviews left via the /review/<slug> links (direct_leads), once the
    // owner has approved them. Same public shape as above.
    try {
        $rows = $pdo
            ->query(
                "SELECT prop_key, stars, review_text, name
             FROM direct_leads WHERE status = 'approved' ORDER BY created_at DESC",
            )
            ->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $r) {
            $out[] = ['name' => $r['name'], 'stars' => (int) $r['stars'], 'text' => $r['review_text'], 'prop' => $r['prop_key']];
        }
    } catch (\Throwable $e) {
    } // table missing (pre-migration) — skip
    return $out;
}

// The owner's own reviews (the `reviews` content key, decoded): those with words, as stored.
function reviews_curated_from($v): array
{
    $out = [];
    foreach (is_array($v) ? $v : [] as $r) {
        if (is_array($r) && trim((string) ($r['text'] ?? '')) !== '') {
            $out[] = $r;
        }
    }
    return $out;
}

// One review's stars as every figure on the site counts them: 1 to 5, a missing one 5.
function review_star(array $r): int
{
    return max(1, min(5, (int) ($r['stars'] ?? 0) ?: 5));
}

// Every review the site shows, in its order, each marked with where it came from.
function reviews_merge(array $guest, array $curated): array
{
    $all = [];
    foreach ($guest as $r) {
        $all[] = $r + ['src' => 'g'];
    }
    foreach ($curated as $r) {
        $all[] = $r + ['src' => 'c'];
    }
    return $all;
}

// The figures and the reviews on screen. A list is [count, star sum].
function reviews_summary(array $all): array
{
    $sum = 0;
    $props = [];
    $ld = [0, 0];
    $pick = [];
    $per = [];
    $rot = 0;
    $ldShown = 0;
    foreach ($all as $i => $r) {
        $star = review_star($r);
        $sum += $star;
        $p = (string) ($r['prop'] ?? '');
        $props[$p] = [($props[$p][0] ?? 0) + 1, ($props[$p][1] ?? 0) + $star];
        if (($per[$p] ?? 0) < REVIEWS_PER_COTTAGE) {
            $pick[$i] = true;
            $per[$p] = ($per[$p] ?? 0) + 1;
        }
        $text = trim((string) ($r['text'] ?? ''));
        // Bytes, so every quote the page's own count (UTF-16) would take is among them.
        if ($rot < REVIEWS_ROTATION && strlen($text) > 20) {
            $pick[$i] = true;
            $rot++;
        }
        if (($r['src'] ?? '') === 'g' && $text !== '') {
            $ld = [$ld[0] + 1, $ld[1] + $star];
            if ($ldShown < REVIEWS_LD) {
                $pick[$i] = true;
                $ldShown++;
            }
        }
    }
    $list = [];
    foreach ($all as $i => $r) {
        if (isset($pick[$i])) {
            $list[] = $r;
        }
    }
    return ['v' => 2, 'list' => $list, 'n' => count($all), 'sum' => $sum, 'props' => (object) $props, 'ld' => $ld];
}
