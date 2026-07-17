<?php
// Unit test for guest-faq.php's pure aggregation (guest_faq_merge): dedupe by
// question, count + recency bump, per-cottage tag, length/letter validation,
// and the 40-item cap. No DB — the routing is guarded so including the file
// gives us just the pure helper.
$_SERVER['SCRIPT_NAME'] = '/test-guestfaq.php'; // not guest-faq.php → skip DB + routing
require_once __DIR__ . '/guest-faq.php';

$fail = 0;
function chk($name, $cond)
{
    global $fail;
    echo '  ' . ($cond ? "\u{2713}" : "\u{2717}") . " $name\n";
    if (!$cond) {
        $fail++;
    }
}

// 1) A fresh question is added with count 1, date + cottage.
$l = guest_faq_merge([], 'Is there parking at the cottage?', 'jollyboat', '2026-07-17');
chk('a new question is recorded', is_array($l) && count($l) === 1 && $l[0]['n'] === 1);
chk('it carries the cottage + date', $l[0]['prop'] === 'jollyboat' && $l[0]['at'] === '2026-07-17');

// 2) The same question (different case/spacing) dedupes + bumps the count.
$l = guest_faq_merge($l, '  is there  PARKING at the cottage? ', 'jollyboat', '2026-07-18');
chk('same question dedupes (still one row)', count($l) === 1);
chk('count bumps to 2 + date updates', $l[0]['n'] === 2 && $l[0]['at'] === '2026-07-18');

// 3) A different question adds a second row.
$l = guest_faq_merge($l, 'Do you allow dogs?', 'pimpernel', '2026-07-18');
chk('a distinct question adds a row', count($l) === 2 && $l[1]['n'] === 1 && $l[1]['prop'] === 'pimpernel');

// 4) Too-short / letter-less input is ignored (returns null).
chk('a 1-word too-short message is ignored', guest_faq_merge($l, 'hi', '', '2026-07-18') === null);
chk('a numbers-only message is ignored', guest_faq_merge($l, '12345678', '', '2026-07-18') === null);

// 5) The store caps at 40 — oldest dropped, newest kept.
$big = [];
for ($i = 0; $i < 45; $i++) {
    $big = guest_faq_merge($big, 'unique question number ' . $i . '?', '', '2026-07-18');
}
chk('the store caps at 40 rows', count($big) === 40);
chk('the oldest row was dropped', $big[0]['q'] === 'unique question number 5?');
chk('the newest row is kept', $big[39]['q'] === 'unique question number 44?');

echo $fail ? "\n  $fail GUEST-FAQ CHECK(S) FAILED \u{274C}\n" : "\n  GUEST-FAQ SUITE PASSED \u{2705}\n";
exit($fail ? 1 : 0);
