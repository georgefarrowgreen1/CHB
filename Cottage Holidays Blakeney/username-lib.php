<?php
// ============================================================
//  username-lib.php — the one rule for a username, for guests and the back office.
//
//  A username is something typed in place of an email to sign in. One rule for
//  everyone who signs in: 3 to 40 lower-case letters (a to z) or numbers, with dots,
//  dashes and underscores, starting with a letter or a number — and never an @,
//  which is how the sign-in box tells a username from an email. Capitals don't make
//  a different name: everything is stored lower case.
//
//  Pure (no database): the sheet's check, the save, sign-in and the back office's
//  own usernames all read these, and test-people.php drives them with no database.
//  Whether a name is FREE is a database question, answered in db.php
//  (username_verdict, under the one lock both tables share).
// ============================================================

// Kept back from guests (squashed: dots, dashes and underscores ignored, so
// "a.d.m.i.n" is "admin"). The business's own words, and words a guest could use to
// look like the business; the cottages' names are added at runtime (db.php). The
// back office is the business, so these apply to guests only.
const USERNAME_KEPT = [
    'admin', 'administrator', 'owner', 'owners', 'support', 'help', 'helpdesk', 'info', 'hello', 'contact',
    'bookings', 'booking', 'reservations', 'enquiries', 'enquiry', 'office', 'reception', 'staff', 'team',
    'host', 'hosts', 'manager', 'management', 'root', 'system', 'security', 'billing', 'payments', 'accounts',
    'mail', 'email', 'postmaster', 'webmaster', 'noreply', 'guest', 'guests', 'test', 'null',
    'cottageholidaysblakeney', 'cottageholidays', 'cottage', 'cottages', 'holidays', 'blakeney',
];
const USERNAME_MIN = 3;
const USERNAME_MAX = 40;

// What was typed, as it would be stored: trimmed and lower case.
function username_norm($v): string
{
    return strtolower(trim(is_string($v) ? $v : ''));
}

// '' when it follows the rule, else the sentence that says what to change.
// Checked in the order a person fixes things: what is in it, then how long it is.
function username_format_problem($u): string
{
    $u = (string) $u;
    if ($u === '') {
        return 'Type a username.';
    }
    if (preg_match('/\s/', $u)) {
        return 'No spaces. A dot, dash or underscore works instead.';
    }
    if (strpos($u, '@') !== false) {
        return 'A username can’t have an @ in it. That’s how we tell it from an email.';
    }
    if (preg_match('/[^a-z0-9._-]/', $u)) {
        return 'Only letters a to z, numbers, dots, dashes and underscores.';
    }
    if (!preg_match('/^[a-z0-9]/', $u)) {
        return 'Start with a letter or a number.';
    }
    if (strlen($u) < USERNAME_MIN) {
        return 'At least 3 characters.';
    }
    if (strlen($u) > USERNAME_MAX) {
        return 'At most 40 characters.';
    }
    return '';
}

// The letters and digits of a name, the way kept-back names are compared.
function username_squash($u): string
{
    return (string) preg_replace('/[^a-z0-9]+/', '', strtolower((string) $u));
}

// The cottages' names as kept-back words: each cottage's whole name and its key
// ("21A Westgate Street" keeps "21awestgatestreet" and "21a").
function username_kept_words(array $props): array
{
    $out = [];
    foreach ($props as $p) {
        foreach ([$p['name'] ?? '', $p['prop_key'] ?? '', $p['slug'] ?? ''] as $w) {
            $s = username_squash(username_ascii((string) $w));
            if (strlen($s) >= 2) {
                $out[$s] = true;
            }
        }
    }
    return array_keys($out);
}

// Is this name kept back from guests?
function username_kept($u, array $extra = []): bool
{
    $s = username_squash($u);
    if ($s === '') {
        return false;
    }
    return in_array($s, USERNAME_KEPT, true) || in_array($s, array_map('username_squash', $extra), true);
}

// A name in plain letters: "Zoë" is "zoe".
function username_ascii(string $s): string
{
    $t = function_exists('iconv') ? @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) : false;
    return strtolower(is_string($t) ? $t : $s);
}

// Names to offer when the one typed can't be had, most like it first: the typed
// name with a number, then shapes of the guest's own name. Every one follows the
// rule and none is kept back; whether each is FREE is asked of the database, and
// the first three free ones are offered.
function username_candidates($typed, $name, array $keptExtra = []): array
{
    $typed = username_norm($typed);
    $parts = array_values(array_filter(preg_split('/[^a-z0-9]+/', username_ascii((string) $name)) ?: [], fn($p) => $p !== ''));
    $first = $parts[0] ?? '';
    $last = count($parts) > 1 ? $parts[count($parts) - 1] : '';
    $out = [];
    $add = function ($c) use (&$out, $keptExtra) {
        $c = (string) $c;
        if ($c !== '' && !in_array($c, $out, true) && username_format_problem($c) === '' && !username_kept($c, $keptExtra)) {
            $out[] = $c;
        }
    };
    // The typed name with a number first (unless it is kept back: "admin2" is no
    // answer to "admin isn't available"), then shapes of their own name, so the three
    // offered are three different ideas rather than one name counted up.
    $typedOk = $typed !== '' && username_format_problem($typed) === '' && !username_kept($typed, $keptExtra);
    if ($typedOk) {
        $add($typed . '2');
    }
    if ($first !== '' && $last !== '') {
        foreach ([$first . '.' . $last, $first . '_' . $last, $last . '.' . $first, $first . $last, $first . '-' . $last, $first[0] . $last, $first . $last[0]] as $c) {
            $add($c);
        }
    } elseif ($first !== '') {
        $add($first);
    }
    if ($typedOk) {
        for ($i = 3; $i <= 5; $i++) {
            $add($typed . $i);
        }
    }
    if ($first !== '') {
        $stem = $last !== '' ? $first . '.' . $last : $first;
        for ($i = 2; $i <= 6; $i++) {
            $add($stem . $i);
        }
    }
    return array_slice($out, 0, 12);
}
