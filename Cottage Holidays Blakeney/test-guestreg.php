<?php
// ============================================================
//  test-guestreg.php — guest-registration form logic (dev/CI only).
//
//      php test-guestreg.php
//
//  Exercises the PURE functions in guest-details.php (guest_reg_clean +
//  render_guest_form_html) — no DB, no APP_SECRET needed: including the file
//  defines the functions but its request bootstrap returns early because the
//  running script isn't guest-details.php.
//
//  Guards the legal-data validation (name+nationality always; passport/ID +
//  onward for non-British/Irish) and that the rendered form escapes input.
// ============================================================
error_reporting(E_ALL);
require __DIR__ . '/guest-details.php';

$fail = 0;
$pass = 0;
function check($name, $cond)
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name\n";
    }
}

echo "\n== Guest-registration form ==\n";

// ---- guest_reg_clean: validation ----
$r = guest_reg_clean(['name' => ['Jane Smith'], 'nationality' => ['British']]);
check('British guest: valid with just name + nationality', $r['error'] === '' && count($r['party']) === 1 && $r['party'][0]['british'] === true && !isset($r['party'][0]['doc']));

$r = guest_reg_clean(['name' => ['Hans Müller'], 'nationality' => ['German']]);
check('non-British without passport/onward → error', $r['error'] !== '' && count($r['party']) === 0);

$r = guest_reg_clean(['name' => ['Hans Müller'], 'nationality' => ['German'], 'doc' => ['X1234567'], 'docplace' => ['Germany'], 'onward' => ['12 Berlin Str, Berlin']]);
check('non-British with passport + onward → valid', $r['error'] === '' && count($r['party']) === 1 && $r['party'][0]['british'] === false && $r['party'][0]['doc'] === 'X1234567' && $r['party'][0]['onward'] === '12 Berlin Str, Berlin');

$r = guest_reg_clean(['name' => ['Irish Guy'], 'nationality' => ['Irish']]);
check('Irish counts as home (no extra fields required)', $r['error'] === '' && $r['party'][0]['british'] === true);

$r = guest_reg_clean(['name' => ['Jane', '', 'Bob'], 'nationality' => ['British', '', 'British']]);
check('blank rows are skipped', $r['error'] === '' && count($r['party']) === 2);

$r = guest_reg_clean(['name' => ['Sam'], 'nationality' => ['']]);
check('missing nationality → error', $r['error'] !== '');

$r = guest_reg_clean(['name' => [], 'nationality' => []]);
check('no guests → error', $r['error'] !== '' && count($r['party']) === 0);

// UK/United Kingdom variants also count as home.
$r = guest_reg_clean(['name' => ['Al'], 'nationality' => ['United Kingdom']]);
check('"United Kingdom" treated as home', $r['error'] === '' && $r['party'][0]['british'] === true);

// ---- expected-count enforcement (the booking's adult count) ----
$r = guest_reg_clean(['name' => ['Only One'], 'nationality' => ['British']], 2);
check('2 expected but 1 given → error, names the shortfall', $r['error'] !== '' && strpos($r['error'], '2 guests') !== false);

$r = guest_reg_clean(['name' => ['A', 'B'], 'nationality' => ['British', 'British']], 2);
check('2 expected + 2 given → valid', $r['error'] === '' && count($r['party']) === 2);

$r = guest_reg_clean(['name' => ['A', 'B', 'C'], 'nationality' => ['British', 'British', 'British']], 2);
check('more than expected is allowed (miscount / 16-17yo counted as child)', $r['error'] === '' && count($r['party']) === 3);

$r = guest_reg_clean(['name' => [], 'nationality' => []], 3);
check('none given, 3 expected → error', $r['error'] !== '' && count($r['party']) === 0);

// ---- render_guest_form_html ----
$html = render_guest_form_html([
    'ref' => 'CHB-000042', 'prop_name' => 'Jollyboat', 'lead_name' => 'Jane Smith',
    'check_in' => '01/08/2026', 'check_out' => '05/08/2026', 'accent' => '#8FB3C7',
    'party' => null, 'saved' => false, 'error' => '', 'action_url' => 'guest-details.php?b=42&token=abc',
]);
check('renders a full HTML document', strpos($html, '<!doctype html>') === 0);
check('has the legal 16+ explainer', strpos($html, '16 or over') !== false || strpos($html, '16 or over') !== false);
check('has name + nationality inputs', strpos($html, "name=\"name[]\"") !== false && strpos($html, "name=\"nationality[]\"") !== false);
check('has the non-British doc + onward inputs', strpos($html, "name=\"doc[]\"") !== false && strpos($html, "name=\"onward[]\"") !== false);
check('has a save button and NO add-another-guest control (fixed count)', strpos($html, 'Save guest details') !== false && strpos($html, 'Add another guest') === false && strpos($html, 'id="rowtpl"') === false);
check('posts back to the token action url (& escaped)', strpos($html, 'guest-details.php?b=42&amp;token=abc') !== false);
check('pre-fills the lead guest name', strpos($html, 'Jane Smith') !== false);

// ---- render matches the booking's guest count ----
$html4 = render_guest_form_html([
    'prop_name' => 'X', 'lead_name' => 'Lead', 'accent' => '#8FB3C7', 'action_url' => 'x',
    'party' => null, 'expected' => 3, 'children' => 1,
]);
check('renders exactly `expected` guest rows (3 → 3, no template)', substr_count($html4, 'name="name[]"') === 3);
check('numbers the guests (Guest 1 / Guest 3)', strpos($html4, '>Guest 1<') !== false && strpos($html4, '>Guest 3<') !== false);
check('shows the "3 guests" count hint', strpos($html4, 'This booking is for <strong>3 guests</strong>') !== false);
check('mentions children are excluded when children>0', strpos($html4, 'Children under 16') !== false);

$html5 = render_guest_form_html([
    'prop_name' => 'X', 'lead_name' => 'Lead', 'accent' => '#8FB3C7', 'action_url' => 'x',
    'party' => null, 'expected' => 2, 'children' => 0,
]);
check('no children → no "Children under 16" line', strpos($html5, 'Children under 16') === false && strpos($html5, 'This booking is for <strong>2 guests</strong>') !== false);

// A saved party larger than expected is preserved (not truncated).
$html6 = render_guest_form_html([
    'prop_name' => 'X', 'accent' => '#8FB3C7', 'action_url' => 'x', 'expected' => 1,
    'party' => [['name' => 'A', 'nationality' => 'British', 'british' => true], ['name' => 'B', 'nationality' => 'British', 'british' => true]],
]);
check('party larger than expected is kept (2 rows, no template)', substr_count($html6, 'name="name[]"') === 2);

// XSS: a hostile name/nationality must be escaped in the output.
$html2 = render_guest_form_html([
    'prop_name' => 'X', 'lead_name' => '', 'accent' => '#8FB3C7', 'action_url' => 'x',
    'party' => [['name' => '<script>alert(1)</script>', 'nationality' => 'German', 'british' => false, 'doc' => '"><b>', 'onward' => 'x']],
]);
check('escapes hostile guest input (no raw <script>)', strpos($html2, '<script>alert(1)</script>') === false && strpos($html2, '&lt;script&gt;') !== false);

// Saved state shows the thank-you banner.
$html3 = render_guest_form_html(['prop_name' => 'X', 'action_url' => 'x', 'saved' => true, 'party' => [['name' => 'A', 'nationality' => 'British', 'british' => true]]]);
check('saved state shows a confirmation banner', strpos($html3, 'saved') !== false && strpos($html3, 'note ok') !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
