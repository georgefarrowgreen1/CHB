<?php
// ============================================================
//  guest-details.php — guest-facing "register your party" form.
//
//  URL:  guest-details.php?b=<id>&token=<guest_reg_token>
//  The token is HMAC(APP_SECRET) over the booking id (db.php guest_reg_token),
//  so the page needs no login but isn't guessable. Linked from the booking
//  confirmation email.
//
//  Legal basis: the Immigration (Hotel Records) Order 1972 requires the full
//  name + nationality of every guest 16+, plus passport/ID + next destination
//  for non-British/Irish guests, kept for 12 months. The party is stored
//  ENCRYPTED at rest (db.php encrypt_value) and auto-purged after 12 months
//  (self-repair.php).
//
//  render_guest_form_html() and guest_reg_clean() are PURE (no DB) so they can
//  be unit-tested; the bootstrap at the bottom only runs when this file IS the
//  request.
// ============================================================

// Build a clean party array from posted parallel arrays. Only rows with a name
// are kept; non-British/Irish rows must carry a passport/ID + onward address.
// $expected is the number of guests aged 16+ on the booking (its `adults`
// count — children never need recording), and the party must cover all of them.
// Returns ['party'=>[...], 'error'=>string|''].
function guest_reg_clean($post, $expected = 1)
{
    $names = (array) ($post['name'] ?? []);
    $nats = (array) ($post['nationality'] ?? []);
    $docs = (array) ($post['doc'] ?? []);
    $places = (array) ($post['docplace'] ?? []);
    $onwards = (array) ($post['onward'] ?? []);
    $party = [];
    $error = '';
    $trim = fn($a, $i) => trim((string) ($a[$i] ?? ''));
    $isHome = fn($nat) => in_array(strtolower(trim($nat)), ['british', 'britain', 'uk', 'united kingdom', 'irish', 'ireland'], true);
    for ($i = 0; $i < count($names); $i++) {
        $name = $trim($names, $i);
        if ($name === '') {
            continue; // blank row — skip
        }
        $nat = $trim($nats, $i);
        if ($nat === '') {
            $error = 'Please give a nationality for every guest.';
            break;
        }
        $g = ['name' => mb_substr($name, 0, 120), 'nationality' => mb_substr($nat, 0, 60), 'british' => $isHome($nat)];
        if (!$g['british']) {
            $doc = $trim($docs, $i);
            $onward = $trim($onwards, $i);
            if ($doc === '' || $onward === '') {
                $error = 'For guests who aren’t British or Irish, please add a passport/ID number and their next destination.';
                break;
            }
            $g['doc'] = mb_substr($doc, 0, 60);
            $g['docPlace'] = mb_substr($trim($places, $i), 0, 80);
            $g['onward'] = mb_substr($onward, 0, 200);
        }
        $party[] = $g;
        if (count($party) >= 30) {
            break; // sanity cap
        }
    }
    $need = max(1, (int) $expected);
    if (!$error && count($party) < $need) {
        $error = count($party) === 0
            ? ($need === 1
                ? 'Please add the guest staying (full name + nationality).'
                : 'This booking is for ' . $need . ' guests aged 16 or over — please add details for all ' . $need . '.')
            : 'This booking is for ' . $need . ' guests aged 16 or over — you’ve given ' . count($party) . '. Please add the ' . ($need - count($party)) . ' still missing.';
    }
    return ['party' => $party, 'error' => $error];
}

// Render the full branded page. $d keys: ref, prop_name, lead_name, check_in,
// check_out, accent, party (array), saved (bool), error (string), action_url.
function render_guest_form_html($d)
{
    $e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $accent = preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($d['accent'] ?? '')) ? $d['accent'] : '#8FB3C7';
    // Guests aged 16+ we must record (the booking's adult count). Children are
    // never counted. Show exactly this many rows so the party matches the stay.
    $expected = max(1, (int) ($d['expected'] ?? 1));
    $children = max(0, (int) ($d['children'] ?? 0));
    $party = is_array($d['party'] ?? null) && count($d['party']) ? array_values($d['party']) : [['name' => $d['lead_name'] ?? '', 'nationality' => 'British', 'british' => true]];
    while (count($party) < $expected) {
        $party[] = ['nationality' => 'British', 'british' => true]; // empty rows to fill the party
    }
    $saved = !empty($d['saved']);
    $error = (string) ($d['error'] ?? '');
    $action = $e($d['action_url'] ?? '');

    // A short, flexible nationality suggestion list (free text still allowed).
    $suggest = ['British', 'Irish', 'American', 'Australian', 'Canadian', 'Chinese', 'Danish', 'Dutch', 'French', 'German', 'Indian', 'Italian', 'Japanese', 'New Zealander', 'Norwegian', 'Polish', 'Portuguese', 'South African', 'Spanish', 'Swedish', 'Swiss'];
    $datalist = '<datalist id="nats">' . implode('', array_map(fn($n) => '<option value="' . $e($n) . '">', $suggest)) . '</datalist>';

    // One guest fieldset. $i is the row index; $g the existing values (or empty).
    $rowHtml = function ($g, $i) use ($e) {
        $home = !empty($g['british']);
        $nat = $e($g['nationality'] ?? '');
        $extraStyle = $home ? 'display:none;' : '';
        return '<fieldset class="guest" data-row>' .
            '<div class="grow"><button type="button" class="rm" title="Remove this guest" onclick="rmRow(this)" aria-label="Remove guest">×</button></div>' .
            '<label>Full name<input type="text" name="name[]" value="' . $e($g['name'] ?? '') . '" maxlength="120" autocomplete="off" required></label>' .
            '<label>Nationality<input type="text" name="nationality[]" list="nats" value="' . ($nat === '' ? '' : $nat) . '" maxlength="60" autocomplete="off" oninput="toggleForeign(this)" required></label>' .
            '<div class="foreign" style="' . $extraStyle . '">' .
            '<label>Passport / ID number<input type="text" name="doc[]" value="' . $e($g['doc'] ?? '') . '" maxlength="60" autocomplete="off"></label>' .
            '<label>Place of issue (country)<input type="text" name="docplace[]" value="' . $e($g['docPlace'] ?? '') . '" maxlength="80" autocomplete="off"></label>' .
            '<label>Next destination (where you go after your stay)<input type="text" name="onward[]" value="' . $e($g['onward'] ?? '') . '" maxlength="200" autocomplete="off"></label>' .
            '</div></fieldset>';
    };
    $rows = '';
    foreach ($party as $i => $g) {
        $rows .= $rowHtml($g, $i);
    }
    // A hidden template row cloned by "Add another guest".
    $template = '<template id="rowtpl">' . $rowHtml(['nationality' => 'British', 'british' => true], 0) . '</template>';

    $banner = $saved
        ? '<div class="note ok">Thank you — your guest details are saved. You can come back and update them any time before you arrive.</div>'
        : ($error !== '' ? '<div class="note err">' . $e($error) . '</div>' : '');

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' .
        '<meta name="viewport" content="width=device-width, initial-scale=1">' .
        '<meta name="robots" content="noindex">' .
        '<title>Your guest details — Cottage Holidays Blakeney</title>' .
        '<style>' .
        '*{box-sizing:border-box}' .
        'body{margin:0;background:#f5f1e9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b2a34;padding:24px 16px;}' .
        '.sheet{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.08);}' .
        '.top{padding:26px 32px 6px;border-top:5px solid ' . $accent . ';text-align:center;}' .
        '.crown{display:block;margin:0 auto 10px;width:64px;height:auto;}' .
        '.brand{font-family:Georgia,\'Times New Roman\',serif;font-size:24px;font-weight:700;letter-spacing:-0.01em;color:#1b2a34;}' .
        '.sub{color:#8a8378;font-size:13px;margin-top:2px;}' .
        '.tag{color:' . $accent . ';font-size:11px;letter-spacing:4px;font-weight:700;margin-top:10px;}' .
        '.body{padding:8px 32px 32px;}' .
        '.intro{font-size:14px;color:#57524A;line-height:1.6;margin:14px 0 6px;}' .
        '.count{font-size:13px;color:#1b2a34;background:#faf6ec;border:1px solid #ece4d3;border-radius:12px;padding:10px 14px;line-height:1.5;margin:10px 0 6px;}' .
        '.meta{font-size:13px;color:#8a8378;margin:0 0 12px;}' .
        '.note{border-radius:12px;padding:12px 14px;font-size:14px;margin:12px 0;line-height:1.5;}' .
        '.note.ok{background:#eaf5ec;border:1px solid #bfe0c6;color:#256b39;}' .
        '.note.err{background:#fbeceb;border:1px solid #f0c9c6;color:#a23b30;}' .
        'fieldset.guest{border:1px solid #ece4d3;border-radius:14px;padding:14px 16px 4px;margin:14px 0;position:relative;background:#fdfbf6;}' .
        '.grow{position:absolute;top:8px;right:10px;}' .
        '.rm{border:0;background:transparent;color:#b7ac97;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;}' .
        '.rm:hover{color:#a23b30;}' .
        'label{display:block;font-size:12px;color:#8a8378;font-weight:600;margin:8px 0 12px;}' .
        'input[type=text]{display:block;width:100%;margin-top:5px;padding:11px 12px;border:1px solid #ddd4c2;border-radius:10px;font-size:16px;font-family:inherit;color:#1b2a34;background:#fff;}' .
        'input[type=text]:focus{outline:none;border-color:' . $accent . ';}' .
        '.foreign{border-top:1px dashed #ece4d3;margin-top:4px;padding-top:6px;}' .
        '.add{display:inline-block;margin:4px 0 8px;background:#faf6ec;border:1px solid #ece4d3;color:#57524A;border-radius:999px;padding:10px 18px;font-weight:600;font-size:14px;cursor:pointer;}' .
        '.actions{margin:18px 0 4px;}' .
        '.btn{display:inline-block;width:100%;background:' . $accent . ';color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 26px;border:0;border-radius:999px;cursor:pointer;}' .
        '.foot{text-align:center;color:#8a8378;font-size:12px;padding:22px 32px 30px;line-height:1.6;}' .
        '</style></head><body>' .
        '<div class="sheet">' .
        '<div class="top"><img class="crown" src="logo.svg" alt="" width="64" height="38"><div class="brand">Cottage Holidays Blakeney</div><div class="sub">North Norfolk Coastal Retreats</div><div class="tag">GUEST DETAILS</div></div>' .
        '<div class="body">' .
        '<p class="intro">By law we need the full name and nationality of everyone staying who is <strong>16 or over</strong>. For guests who aren’t British or Irish we also need a passport/ID number and where they’re travelling to next. We keep this for 12 months and share it only if legally required.</p>' .
        '<p class="count">This booking is for <strong>' . $expected . ' guest' . ($expected === 1 ? '' : 's') . '</strong> aged 16 or over — please give details for ' . ($expected === 1 ? 'them' : 'all ' . $expected) . '.' . ($children > 0 ? ' Children under 16 don’t need to be listed.' : '') . '</p>' .
        '<p class="meta">' . $e($d['prop_name'] ?? '') . ($d['check_in'] ?? '' ? ' · ' . $e($d['check_in']) . ' → ' . $e($d['check_out'] ?? '') : '') . ($d['ref'] ?? '' ? ' · ' . $e($d['ref']) : '') . '</p>' .
        $banner .
        '<form method="post" action="' . $action . '">' .
        '<div id="rows">' . $rows . '</div>' .
        $template .
        '<button type="button" class="add" onclick="addRow()">＋ Add another guest</button>' .
        '<div class="actions"><button type="submit" class="btn">Save guest details</button></div>' .
        '</form>' . $datalist .
        '</div>' .
        '<div class="foot">Cottage Holidays Blakeney · Any questions? Just reply to your confirmation email.<br>Held securely and deleted 12 months after your stay.</div>' .
        '</div>' .
        '<script>' .
        'var MIN=' . $expected . ';' .
        'function toggleForeign(inp){var fs=inp.closest("[data-row]");var f=fs.querySelector(".foreign");var v=(inp.value||"").trim().toLowerCase();var home=["british","britain","uk","united kingdom","irish","ireland"].indexOf(v)>-1;f.style.display=(v===""||home)?"none":"block";}' .
        'function addRow(){var t=document.getElementById("rowtpl");var n=t.content.firstElementChild.cloneNode(true);document.getElementById("rows").appendChild(n);var nat=n.querySelector("input[name=\'nationality[]\']");if(nat)toggleForeign(nat);n.querySelector("input").focus();syncRemove();}' .
        'function rmRow(btn){var rows=document.querySelectorAll("#rows [data-row]");if(rows.length<=Math.max(1,MIN))return;btn.closest("[data-row]").remove();syncRemove();}' .
        'function syncRemove(){var rows=document.querySelectorAll("#rows [data-row]");var lock=rows.length<=Math.max(1,MIN);rows.forEach(function(r){var b=r.querySelector(".rm");if(b){b.style.display=lock?"none":"";}});}' .
        'document.querySelectorAll("#rows input[name=\'nationality[]\']").forEach(toggleForeign);' .
        'syncRemove();' .
        '</script>' .
        '</body></html>';
}

// ---- Bootstrap: only when this file IS the request (not when unit-tested) ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'guest-details.php') {
    return;
}

require_once __DIR__ . '/db.php';

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');

$id = (int) ($_GET['b'] ?? $_POST['b'] ?? 0);
$token = (string) ($_GET['token'] ?? $_POST['token'] ?? '');
if ($id <= 0 || !hash_equals(guest_reg_token($id), $token)) {
    http_response_code(403);
    echo '<!doctype html><meta charset="utf-8"><title>Guest details</title><p style="font-family:sans-serif;padding:40px;">Sorry — this guest-details link is invalid.</p>';
    exit();
}

try {
    $s = db()->prepare('SELECT * FROM bookings WHERE id = ?');
    $s->execute([$id]);
    $b = $s->fetch();
} catch (\Throwable $ex) {
    $b = null;
}
if (!$b) {
    http_response_code(404);
    echo '<!doctype html><meta charset="utf-8"><title>Guest details</title><p style="font-family:sans-serif;padding:40px;">Sorry — we couldn’t find that booking.</p>';
    exit();
}

$rate = get_rate($b['prop_key']);
$accent = $rate['accent'] ?? '';
$actionUrl = 'guest-details.php?b=' . $id . '&token=' . $token;
$saved = false;
$error = '';
$party = null;
// Guests aged 16+ we must record = the booking's adult count. Children (under
// 16) are never counted, so a 2-adult + 1-child booking still needs 2 records.
$expected = max(1, (int) ($b['adults'] ?? 1));
$children = max(0, (int) ($b['children'] ?? 0));

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    rate_limit('guestreg', 30, 10); // per-IP: a leaked token can't be spammed
    $clean = guest_reg_clean($_POST, $expected);
    if ($clean['error']) {
        $error = $clean['error'];
        // Rebuild party from POST so nothing they typed is lost on a bounce.
        $names = (array) ($_POST['name'] ?? []);
        $party = [];
        for ($i = 0; $i < count($names); $i++) {
            $nm = trim((string) ($names[$i] ?? ''));
            if ($nm === '') {
                continue;
            }
            $party[] = [
                'name' => $nm,
                'nationality' => trim((string) ($_POST['nationality'][$i] ?? '')),
                'british' => in_array(strtolower(trim((string) ($_POST['nationality'][$i] ?? ''))), ['british', 'britain', 'uk', 'united kingdom', 'irish', 'ireland'], true),
                'doc' => trim((string) ($_POST['doc'][$i] ?? '')),
                'docPlace' => trim((string) ($_POST['docplace'][$i] ?? '')),
                'onward' => trim((string) ($_POST['onward'][$i] ?? '')),
            ];
        }
    } else {
        try {
            $json = json_encode($clean['party'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $enc = encrypt_value($json);
            $now = date('Y-m-d H:i:s');
            $expires = date('Y-m-d', strtotime(($b['check_out'] ?: date('Y-m-d')) . ' +12 months'));
            db()->prepare(
                'INSERT INTO guest_registrations (booking_id, party_enc, guest_count, submitted_at, updated_at, expires_at)
                 VALUES (?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE party_enc = VALUES(party_enc), guest_count = VALUES(guest_count), updated_at = VALUES(updated_at), expires_at = VALUES(expires_at)'
            )->execute([$id, $enc, count($clean['party']), $now, $now, $expires]);
            $saved = true;
            $party = $clean['party'];
        } catch (\Throwable $ex) {
            $error = 'Sorry — we couldn’t save that just now. Please try again.';
            $party = $clean['party'];
        }
    }
} else {
    // GET — prefill from any existing submission, else one row with the lead name.
    try {
        $s = db()->prepare('SELECT party_enc FROM guest_registrations WHERE booking_id = ?');
        $s->execute([$id]);
        $r = $s->fetch();
        if ($r && !empty($r['party_enc'])) {
            $dec = json_decode(decrypt_value($r['party_enc']), true);
            if (is_array($dec)) {
                $party = $dec;
            }
        }
    } catch (\Throwable $ex) {
    }
}

echo render_guest_form_html([
    'ref' => 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string) $id), -6), 6, '0', STR_PAD_LEFT),
    'prop_name' => $rate['name'] ?? $b['prop_key'],
    'lead_name' => $b['name'] ?? '',
    'check_in' => function_exists('uk_date') ? uk_date($b['check_in']) : $b['check_in'],
    'check_out' => function_exists('uk_date') ? uk_date($b['check_out']) : $b['check_out'],
    'accent' => $accent,
    'party' => $party,
    'expected' => $expected,
    'children' => $children,
    'saved' => $saved,
    'error' => $error,
    'action_url' => $actionUrl,
]);
