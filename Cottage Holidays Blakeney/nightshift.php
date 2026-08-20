<?php
// ============================================================
//  nightshift.php — the overnight queue's server side.
//
//  POST {action:'list'}                (owner) -> the open, unexpired items
//  POST {action:'act', id, do}         (owner) -> use / dismiss / restore
//  POST {action:'ingest', secret, items} (a machine) -> store a night's work
//
//  THE POSTURES ARE DIFFERENT ON PURPOSE and that is why require_admin() is
//  not at the top of this file. `list` and `act` are the owner in a browser.
//  `ingest` is a MACHINE with no session and no cookie — the same shape as
//  the cron URLs, authenticated by APP_SECRET with hash_equals — so a single
//  file-level guard would either lock the producer out or open the queue up.
//  Each handler states its own, first line, so the posture is readable at
//  the point it is enforced. (test-auth-posture registers this file as
//  'admin' with the APP_SECRET marker required as well, so stripping either
//  guard fails the gate.)
//
//  WHAT INGEST CANNOT DO, restated here because this is the door: it cannot
//  send anything, charge anything, change a price, touch a booking, or write
//  any content key. It can put words and a destination on one screen the
//  owner already had. Everything else about a night item is decided by
//  nightshift-lib.php's pure rules, which the gate drives with no database.
//
//  AND IT IS REFUSED WHILE THE SETTING IS OFF. Not silently dropped and not
//  quietly stored for later: a producer posting into a switched-off queue is
//  told so in a sentence, because the alternative is a machine working every
//  night into a table nobody will ever look at.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/nightshift-lib.php';

// The one definition of whether the feature is on. Internal content key,
// default OFF — off is byte-for-byte today's back office.
function night_enabled()
{
    return content_value('night-shift') === '1';
}

// ── THE CONVERSATION AS ROWS (migration-118) ────────────────────────────
// The web chat's thread lives in ownerchat_msgs now: every message has an
// ID, so an action card is addressed exactly (never by position), two
// devices appending cannot overwrite each other, and the old 40-message cap
// becomes a display window over a retained history. The `mac-chat` content
// key survives carrying the standing instruction; its old msgs are ADOPTED
// into rows on the first read after the migration, so nothing already said
// is lost. Every row still passes through night_ownerchat_thread's
// sanitiser on the way out — the table changes WHERE messages live, never
// what may live in one.
function ownerchat_row_to_msg(array $r)
{
    $m = ['who' => (string) $r['who'], 'text' => (string) $r['text'], 'at' => (string) $r['at']];
    foreach (['think' => 'think', 'model' => 'model', 'img' => 'img', 'file' => 'file'] as $col => $k) {
        if (night_str($r[$col] ?? '') !== '') {
            $m[$k] = $r[$col];
        }
    }
    if (!empty($r['stopped'])) {
        $m['stopped'] = true;
    }
    $used = json_decode((string) ($r['used'] ?? ''), true);
    if (is_array($used) && $used) {
        $m['used'] = $used;
    }
    $act = json_decode((string) ($r['act'] ?? ''), true);
    if (is_array($act)) {
        if (night_str($r['act_done'] ?? '') !== '') {
            $act['done'] = $r['act_done'];
            $act['doneAt'] = night_str($r['act_done_at'] ?? '');
        }
        $m['act'] = $act;
    }
    $t = night_ownerchat_thread(['msgs' => [$m]]);
    if (!$t['msgs']) {
        return null; // a row the sanitiser refuses whole renders as nothing
    }
    $clean = $t['msgs'][0];
    $clean['id'] = (int) $r['id'];
    return $clean;
}
// The newest $limit messages, oldest-first for the screen.
function ownerchat_rows($limit = 40)
{
    $st = db()->prepare('SELECT * FROM ownerchat_msgs ORDER BY id DESC LIMIT ' . (int) $limit);
    $st->execute();
    $out = [];
    foreach (array_reverse($st->fetchAll()) as $r) {
        $m = ownerchat_row_to_msg($r);
        if ($m !== null) {
            $out[] = $m;
        }
    }
    return $out;
}
// Validate through the ONE sanitiser, then append. Returns the clean msg
// with its new id, or null when the sanitiser refused it whole.
function ownerchat_append(array $msg)
{
    $t = night_ownerchat_thread(['msgs' => [$msg]]);
    if (!$t['msgs']) {
        return null;
    }
    $m = $t['msgs'][0];
    $st = db()->prepare('INSERT INTO ownerchat_msgs (who, text, think, used, model, stopped, act, img, file, at)
                         VALUES (?,?,?,?,?,?,?,?,?,?)');
    $st->execute([
        $m['who'], $m['text'],
        $m['think'] ?? null,
        isset($m['used']) ? json_encode($m['used']) : null,
        $m['model'] ?? null,
        !empty($m['stopped']) ? 1 : 0,
        isset($m['act']) ? json_encode($m['act']) : null,
        $m['img'] ?? null,
        $m['file'] ?? null,
        $m['at'] ?? date('H:i'),
    ]);
    $m['id'] = (int) db()->lastInsertId();
    return $m;
}
// One-time adoption: the blob's messages become rows, the blob keeps only
// the instruction. Best-effort — a failed adoption leaves the blob intact
// for the next read to try again.
function ownerchat_adopt()
{
    try {
        if ((int) db()->query('SELECT COUNT(*) FROM ownerchat_msgs')->fetchColumn() > 0) {
            return;
        }
        $t = night_ownerchat_thread(content_json('mac-chat', []));
        if (!$t['msgs']) {
            return;
        }
        foreach ($t['msgs'] as $m) {
            ownerchat_append($m);
        }
        content_set_scalar('mac-chat', json_encode(['instr' => $t['instr'], 'msgs' => []]));
    } catch (\Throwable $e) {
    }
}

// ── ONE GATHER, TWO READERS ─────────────────────────────────────────────
// The 'today' and 'money' chat tools AND the world sheet chat_send attaches
// read these — one derivation, so the grounding pack and a lookup can never
// disagree about the same day. Each returns the ROWS the pure composers in
// nightshift-lib.php shape.
function night_gather_today($today)
{
    require_once __DIR__ . '/pricing.php';
    $st = db()->prepare('SELECT * FROM bookings WHERE check_in <= ? AND check_out >= ? ORDER BY check_in');
    $st->execute([$today, $today]);
    $rows = [];
    foreach ($st->fetchAll() as $b) {
        try {
            $b['due'] = (float) booking_amount_due($b, 'balance')['due'];
        } catch (\Throwable $e) {
            $b['due'] = 0.0; // an unpriceable row states no figure at all
        }
        $rows[] = $b;
    }
    $waiting = 0;
    try {
        $waiting = (int) db()->query('SELECT COUNT(*) FROM enquiries WHERE declined_at IS NULL')->fetchColumn();
    } catch (\Throwable $e) {
        $waiting = 0;
    }
    return ['rows' => $rows, 'waiting' => $waiting];
}
function night_gather_money($today)
{
    require_once __DIR__ . '/pricing.php';
    $st = db()->prepare('SELECT * FROM bookings WHERE check_out >= ? ORDER BY check_in LIMIT 80');
    $st->execute([$today]);
    $owed = [];
    foreach ($st->fetchAll() as $b) {
        try {
            $due = (float) booking_amount_due($b, 'balance')['due'];
        } catch (\Throwable $e) {
            $due = 0.0;
        }
        if ($due <= 0.5) {
            continue;
        }
        $b['due'] = $due;
        $b['due_now'] = ((string) $b['check_out'] <= $today) || booking_within_balance_window($b);
        $owed[] = $b;
    }
    $st = db()->prepare("SELECT id, name, prop_key, check_out, hold_amount, agreed_booking_fee
                           FROM bookings WHERE hold_status = 'charged' AND check_out <= ? ORDER BY check_out DESC LIMIT 30");
    $st->execute([$today]);
    $deps = [];
    foreach ($st->fetchAll() as $b) {
        $held = damages_collected($b) - damages_returned((int) $b['id']);
        if ($held <= 0.5) {
            continue;
        }
        $b['dep'] = $held;
        $deps[] = $b;
    }
    return ['owed' => $owed, 'deps' => $deps];
}

// One enquiry row → the producer's view of it: the site's own price, its own
// clash answer, that cottage's published Q&A, the display name. ONE
// derivation, read by the nightly brief AND the ask channel, so the two can
// never hand over different facts about the same enquiry. Callers must have
// required pricing.php first (get_rate / price_breakdown live there).
function night_enquiry_view(array $row)
{
    $pk = (string) $row['prop_key'];
    // The site's own price, and the site's own clash answer. Both are
    // wrapped: a cottage with no rate row, or a failed check, yields an
    // ABSENT fact rather than a guessed one — and the producer's rule is
    // that an absent fact is not mentioned.
    $price = null;
    try {
        $rate = get_rate($pk);
        if ($rate) {
            $price = price_breakdown($rate, (int) $row['adults'], (int) $row['children'], $row['check_in'], $row['check_out']);
        }
    } catch (\Throwable $e) {
        $price = null;
    }
    $free = null;
    try {
        $free = !dates_clash($pk, $row['check_in'], $row['check_out']);
    } catch (\Throwable $e) {
        $free = null;
    }
    $facts = [];
    try {
        $faqs = content_json('faqs-' . $pk, []);
        if (is_array($faqs)) {
            $facts = $faqs;
        }
    } catch (\Throwable $e) {
        $facts = [];
    }
    // ['name'], NOT the row. prop_display() returns an ARRAY — name, accent,
    // slug — and `(string)` on an array is the literal word "Array" in PHP.
    // So every draft ever written opened "Array is a lovely cottage", and the
    // cast is what hid it: it silenced the conversion into a plausible-looking
    // string instead of letting it be a type error. Reported from a phone, on
    // the first night this ever ran.
    $name = prop_display($pk);
    return night_brief_enquiry(
        $row,
        is_array($name) ? (string) ($name['name'] ?? $pk) : (string) $name,
        $price,
        $free,
        $facts,
    );
}

// The ask channel's housekeeping, run on every touch of the table: an open
// ask past its ten minutes flips to expired (the owner stopped waiting), and
// anything a day old is deleted — these rows only matter while somebody is
// looking. Never throws: an un-migrated table is each action's own 503.
function night_asks_sweep()
{
    try {
        db()->exec("UPDATE night_asks SET status = 'expired'
                     WHERE status = 'open' AND created_at < DATE_SUB(NOW(), INTERVAL " . NIGHT_ASK_TTL_MIN . ' MINUTE)');
        db()->exec("DELETE FROM night_asks WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)");
    } catch (\Throwable $e) {
        // the caller's own table check answers
    }
}

// THE PAIRED MACS. Stored under the same private key as before, which now
// holds a LIST of hashes rather than one key — night_devices() reads the old
// single-string shape as a one-entry list, so an existing Mac keeps working
// and converts on the next write.
const NIGHT_DEV_KEY = 'apikey-nightshift';
const NIGHT_CODE_KEY = 'apikey-nightshift-code';

function night_devices_read()
{
    // A private key round-trips through json, so a list comes back as an array
    // and a legacy single key as a string. Both are handed to the same reader.
    $raw = content_secret_json(NIGHT_DEV_KEY, null);
    if ($raw === null) {
        $raw = trim((string) content_value(NIGHT_DEV_KEY));
    }
    return night_devices($raw);
}

function night_devices_write($list)
{
    content_set_secret(NIGHT_DEV_KEY, array_values((array) $list));
}

// Is a key ON FILE? Asked of the ROW, not of the value — see night_key_kind().
function night_key_on_file()
{
    try {
        $st = db()->prepare('SELECT 1 FROM content WHERE item_key = ? LIMIT 1');
        $st->execute([NIGHT_DEV_KEY]);
        return (bool) $st->fetchColumn();
    } catch (\Throwable $e) {
        return false;
    }
}

// THE ONE DOOR CHECK for both machine routes. Answers 401 and logs, or
// returns the kind of key that opened it.
function night_require_key($given, $what, $build = '')
{
    $devices = night_devices_read();
    $onFile = night_key_on_file();
    $i = night_device_index($devices, $given);
    if ($i >= 0) {
        // LAST SEEN, stamped here because this is the only place that knows a
        // request was genuine — at FIVE-MINUTE granularity, not per call.
        // "Cheap: the app calls twice a night" was true until the ask channel
        // gave the Mac a 20-second poll; stamping every poll would write the
        // devices row (encrypted content) four thousand times a day to keep a
        // fact the quiet-Mac duty reads in NIGHTS. The BUILD rides the same
        // write (integration step 4) — and a CHANGED build writes through the
        // throttle, so a just-updated Mac says its new name promptly.
        $b = night_str($build);
        $buildChanged = $b !== '' && $b !== (string) ($devices[$i]['build'] ?? '');
        if ($buildChanged || time() - (int) ($devices[$i]['seen'] ?? 0) > 300) {
            $devices[$i]['seen'] = time();
            if ($b !== '') {
                $devices[$i]['build'] = mb_substr($b, 0, 60);
            }
            try {
                night_devices_write($devices);
            } catch (\Throwable $e) { /* a stamp we cannot write must not refuse a good request */ }
        }
        return 'scoped';
    }
    // Nothing on file → the master secret still works, so an install that has
    // not been paired yet keeps running. Something on file → only these keys do.
    if (!$onFile && !count($devices)) {
        $m = defined('APP_SECRET') ? APP_SECRET : '';
        if ($m !== '' && (string) $given !== '' && hash_equals($m, (string) $given)) {
            return 'master';
        }
    }
    log_activity('system', 'night.reject', 'Overnight queue: a ' . $what . ' arrived with the wrong key', [
        'actor' => 'system',
        'severity' => 'warn',
    ]);
    json_out(['error' => 'Not authorised.'], 401);
}

route_actions([
    // ---- the owner mints the app's own key -------------------------
    //
    // SHOWN ONCE, on the way out of this call, and never again: the stored
    // copy is encrypted at rest and the screen only ever reports WHETHER one
    // is set. A key a page will redisplay is a key in every screenshot and
    // every shoulder-surf, which is the rule the backup passphrase already
    // follows.
    //
    // Generating a second one REVOKES the first, because the check compares
    // against exactly one value. That is the whole revocation story and it is
    // enough for one machine.
    'new_key' => function ($in) {
        require_admin();
        $key = night_key_make();
        $list = night_devices_read();
        $list[] = [
            'h' => night_key_hash($key),
            'label' => night_dev_label($in['label'] ?? 'A Mac'),
            'added' => time(),
            'seen' => 0,
        ];
        // OLDEST OUT, not newest refused: someone adding a ninth Mac means to
        // use it, and refusing at the door leaves them stuck.
        while (count($list) > NIGHT_DEV_MAX) {
            array_shift($list);
        }
        night_devices_write($list);
        log_activity('system', 'night.key', 'Overnight queue: a key was generated for a Mac', [
            'actor' => 'owner',
            'severity' => 'info',
        ]);
        json_out(['ok' => true, 'key' => $key]);
    },

    // THE CONNECT CODE. Minted by the SITE and read off this screen, so the
    // owner types eight characters into the Mac instead of pasting sixty-four.
    // One code at a time — a second replaces the first, because two live codes
    // is two chances for the wrong one to be typed.
    'connect_code' => function ($in) {
        require_admin();
        $code = night_code_make();
        content_set_secret(NIGHT_CODE_KEY, [
            'h' => night_key_hash($code),
            'exp' => time() + NIGHT_CODE_TTL,
            'used' => 0,
            'label' => night_dev_label($in['label'] ?? 'A Mac'),
        ]);
        json_out([
            'ok' => true,
            'code' => night_code_pretty($code),
            'seconds' => NIGHT_CODE_TTL,
        ]);
    },

    // What is paired, and when each was last heard from. Never a key or a hash:
    // a hash is not a credential, but it is also not the owner's business and
    // putting it on a screen invites someone to think it is one.
    'devices' => function ($in) {
        require_admin();
        $out = [];
        foreach (night_devices_read() as $i => $d) {
            $out[] = [
                'i' => $i,
                'label' => $d['label'],
                'added' => $d['added'] ? (int) $d['added'] : 0,
                'seen' => $d['seen'] ? (int) $d['seen'] : 0,
                'quiet' => night_quiet_days($d, time()),
                'legacy' => !empty($d['legacy']),
                'build' => night_str($d['build'] ?? ''),
            ];
        }
        // The newest published build, refreshed daily by self-repair from the
        // releases feed — '' when never fetched, and the card then claims
        // nothing about being up to date.
        json_out(['ok' => true, 'devices' => $out, 'quietAfter' => NIGHT_QUIET_NIGHTS,
            'latest' => night_str(content_value('nightshift-latest-build'))]);
    },

    // Stop one Mac. By INDEX from the list just read, and the label must match
    // what the owner was looking at — the list can move under a stale screen,
    // and stopping the wrong Mac is a silent failure the owner finds at 2am.
    'stop_device' => function ($in) {
        require_admin();
        $i = (int) ($in['i'] ?? -1);
        $label = (string) ($in['label'] ?? '');
        $list = night_devices_read();
        if ($i < 0 || !isset($list[$i])) {
            json_out(['error' => 'That Mac is not on the list any more. Reload and try again.'], 409);
        }
        if ($label !== '' && $list[$i]['label'] !== $label) {
            json_out(['error' => 'The list has changed since you looked. Reload and try again.'], 409);
        }
        $gone = $list[$i]['label'];
        array_splice($list, $i, 1);
        night_devices_write($list);
        log_activity('system', 'night.key', 'Overnight queue: a Mac was stopped (' . $gone . ')', [
            'actor' => 'owner',
            'severity' => 'info',
        ]);
        json_out(['ok' => true, 'stopped' => $gone, 'left' => count($list)]);
    },

    // Is one set? Never what it is.
    'key_state' => function ($in) {
        require_admin();
        json_out(['ok' => true, 'set' => count(night_devices_read()) > 0]);
    },

    // ---- a Mac connects itself with a code ------------------------
    //
    // THE ONLY UNAUTHENTICATED ACTION HERE, and the only one there will be.
    // It stores nothing a stranger wrote, shows nothing back, and grants
    // nothing without a live code — the whole point of the site minting the
    // code rather than the app. Throttled on the same table as sign-in, so it
    // cannot become a quiet way to guess eight characters.
    'connect' => function ($in) {
        rate_limit('night-connect', 10, 300);
        $rec = content_secret_json(NIGHT_CODE_KEY, []);
        $bad = night_code_problem($rec, $in['code'] ?? '', time());
        if ($bad !== '') {
            log_activity('system', 'night.reject', 'Overnight queue: a connect code was refused', [
                'actor' => 'system',
                'severity' => 'info',
            ]);
            json_out(['error' => $bad, 'code' => 'connect_refused'], 401);
        }
        // BURNED BEFORE THE KEY IS MADE. If anything below fails the code is
        // still spent — which is the safe direction: the owner taps Connect a
        // Mac again, where the alternative is a live code after a half-done
        // pairing.
        $rec['used'] = 1;
        content_set_secret(NIGHT_CODE_KEY, $rec);

        $key = night_key_make();
        $list = night_devices_read();
        // WHICH MAC THIS IS — the app's own name for itself, because the code
        // record was minted before any machine had used it and could only ever
        // supply a default. Reported live: two paired Macs both read "A Mac",
        // so the list could not tell the owner which one to stop.
        //
        // It is text a holder of a valid code wrote, so night_dev_label()
        // sanitises and caps it (and the client escapes it again on render) —
        // the same posture every owner-written label here already has.
        $label = trim((string) ($in['label'] ?? ''));
        if ($label === '') {
            $label = (string) ($rec['label'] ?? 'A Mac');
        }
        $list[] = [
            'h' => night_key_hash($key),
            'label' => night_dev_label($label),
            'added' => time(),
            'seen' => 0,
        ];
        while (count($list) > NIGHT_DEV_MAX) {
            array_shift($list);
        }
        night_devices_write($list);
        log_activity('system', 'night.key', 'Overnight queue: a Mac connected with a code', [
            'actor' => 'system',
            'severity' => 'info',
        ]);
        // The setting is NOT checked here. Connecting a Mac while the feature
        // is off is a reasonable order to do things in, and the queue refuses
        // it with its own sentence the moment it tries to work.
        json_out(['ok' => true, 'key' => $key, 'host' => (string) content_value('host-name')]);
    },

    // ---- the owner reads the queue ---------------------------------
    'list' => function ($in) {
        require_admin();
        if (!night_enabled()) {
            json_out(['ok' => true, 'on' => false, 'items' => []]);
        }
        $items = [];
        try {
            $st = db()->prepare(
                "SELECT id, ref, kind, title, sub, body, source, target, created_at, expires_at
                   FROM night_items
                  WHERE status = 'open' AND expires_at > NOW()
                  ORDER BY created_at DESC, id DESC
                  LIMIT " . (int) NIGHT_OPEN_MAX,
            );
            $st->execute();
            foreach ($st->fetchAll() as $row) {
                $items[] = night_item_public($row);
            }
        } catch (\Throwable $e) {
            // No table yet (un-migrated), or the read failed. Additive by
            // construction: an empty queue is the honest answer and Today is
            // untouched. The owner is not told a machine is broken when what
            // has actually happened is that a migration has not run.
            $items = [];
        }
        json_out(['ok' => true, 'on' => true, 'items' => $items]);
    },

    // ---- the owner acts on one row ---------------------------------
    'act' => function ($in) {
        require_admin();
        $id = (int) ($in['id'] ?? 0);
        $status = night_act_status((string) ($in['do'] ?? ''));
        if (!$id || $status === '') {
            json_out(['error' => 'Which item, and what would you like done with it?'], 400);
        }
        $row = null;
        try {
            $st = db()->prepare('SELECT id, status, target FROM night_items WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
        } catch (\Throwable $e) {
            json_out(['error' => 'Could not read that item just now.'], 500);
        }
        if (!$row) {
            json_out(['error' => 'That item is no longer there.'], 404);
        }
        // Restoring is only ever a way BACK from a bin — never a way to
        // resurrect something the sweep expired, because the deadline was
        // the point and an expired draft is the one this feature exists to
        // stop the owner acting on.
        if ($status === 'open' && (string) $row['status'] !== 'dismissed') {
            json_out(['error' => 'Only something you binned can be put back.'], 409);
        }
        try {
            db()
                ->prepare('UPDATE night_items SET status = ?, acted_at = NOW() WHERE id = ?')
                ->execute([$status, $id]);
        } catch (\Throwable $e) {
            json_out(['error' => 'Could not save that just now.'], 500);
        }
        json_out(['ok' => true, 'id' => $id, 'status' => $status, 'target' => (string) $row['target']]);
    },

    // ---- a machine reads what is waiting ---------------------------
    // The mirror of ingest, and deliberately the SMALLEST read that lets a
    // producer draft a reply without inventing anything: the waiting
    // enquiries, each with the site's OWN quote and the site's OWN
    // availability answer already worked out, plus that cottage's published
    // questions and answers. See nightshift-lib.php's header for why the
    // figures travel with the brief rather than being left to the far end.
    //
    // There is no verb in this handler. It reads, it caps, it answers.
    // ══ THE ASK CHANNEL — the daytime half. The owner files an ask from a
    // screen; the Mac (polling `asks` while it runs) answers with its local
    // model and posts it back; the screen collects it from `ask_status`.
    // Same key, same switch, same withholding as the nightly brief.

    // ---- the owner files an ask ------------------------------------
    'ask' => function ($in) {
        require_admin();
        if (!night_enabled()) {
            json_out(['error' => 'Overnight work is switched off in Manage → System check.', 'code' => 'night_off'], 409);
        }
        $kind = (string) ($in['kind'] ?? '');
        $entityId = (int) ($in['id'] ?? 0);
        $question = $in['question'] ?? '';
        $bad = night_ask_problem($kind, $entityId, $question);
        if ($bad !== '') {
            json_out(['error' => $bad], 400);
        }
        if ($kind === 'reply') {
            // LIVE ENQUIRIES ONLY — the declined lesson, held at the door as
            // well as at the machine's read: an ask about a declined enquiry
            // must not exist at all.
            $st = db()->prepare('SELECT id FROM enquiries WHERE id = ? AND declined_at IS NULL');
            $st->execute([$entityId]);
            if (!$st->fetch()) {
                json_out(['error' => 'That enquiry is no longer waiting.'], 404);
            }
        }
        if ($kind === 'chat') {
            $st = db()->prepare('SELECT id FROM chat_threads WHERE id = ?');
            $st->execute([$entityId]);
            if (!$st->fetch()) {
                json_out(['error' => 'That conversation is no longer there.'], 404);
            }
        }
        night_asks_sweep();
        $open = 0; // before the try — json_out()'s exit is invisible to PHPStan
        try {
            $open = (int) db()->query("SELECT COUNT(*) FROM night_asks WHERE status = 'open'")->fetchColumn();
        } catch (\Throwable $e) {
            json_out(['error' => 'The ask channel is not set up on this install yet (run the migrations).', 'code' => 'night_no_table'], 503);
        }
        if ($open >= NIGHT_ASK_OPEN_MAX) {
            json_out(['error' => 'Your Mac already has ' . NIGHT_ASK_OPEN_MAX . ' asks waiting — give it a moment.'], 429);
        }
        // The INTENT ask's menu — the canonical questions the client's own
        // answer engine can compute. Cleaned at the boundary; an intent ask
        // with no usable options is refused, because a model with nothing to
        // choose from can only invent.
        $opts = $kind === 'intent' ? night_ask_options($in['options'] ?? null) : [];
        if ($kind === 'intent' && !$opts) {
            json_out(['error' => 'An intent ask needs the list of questions the site can answer.'], 400);
        }
        // A DIGEST ask carries the history rows the summary must be built
        // from — the same column, its own caps (a record is a paragraph).
        if ($kind === 'digest') {
            $opts = night_ask_rows($in['rows'] ?? null);
            if (!$opts) {
                json_out(['error' => 'A digest ask needs the records the summary is built from.'], 400);
            }
        }
        $st = db()->prepare('INSERT INTO night_asks (kind, entity_id, prop_key, question, options, created_at) VALUES (?,?,?,?,?, NOW())');
        $st->execute([$kind, $entityId, night_str($in['prop'] ?? ''), night_str($question),
            $opts ? json_encode($opts) : null]);
        json_out(['ok' => true, 'id' => (int) db()->lastInsertId()]);
    },

    // ---- the owner collects the answer ------------------------------
    'ask_status' => function ($in) {
        require_admin();
        // `wait` holds this open up to 10 seconds and answers the moment the
        // row settles — one request instead of a 2.5-second poll ladder. The
        // SESSION WRITE LOCK IS RELEASED FIRST: PHP serialises requests that
        // share a session, so a held lock here would freeze every other admin
        // tab for the whole wait.
        $wait = min(10, max(0, (int) ($in['wait'] ?? 0)));
        if ($wait > 0) {
            @session_write_close();
        }
        $until = time() + $wait;
        $row = null;
        do {
            night_asks_sweep();
            $st = db()->prepare('SELECT status, answer, model FROM night_asks WHERE id = ?');
            $st->execute([(int) ($in['id'] ?? 0)]);
            $row = $st->fetch();
            if (!$row) {
                json_out(['error' => 'No such ask.'], 404);
            }
            if ($row['status'] !== 'open' || time() >= $until) {
                break;
            }
            // CONNECTIVITY: a quarter-second grain, not a whole second — an
            // answer landing mid-hold reaches the owner up to 750ms sooner,
            // on every hop of every ask. The sweep stays at ~1s (the loop's
            // own do-first call covers it), because two UPDATEs every 250ms
            // is a price for nothing.
            usleep(250000);
        } while (true);
        json_out([
            'ok' => true,
            'status' => (string) $row['status'],
            'answer' => (string) ($row['answer'] ?? ''),
            'model' => (string) ($row['model'] ?? ''),
        ]);
    },

    // ---- THE WEB CHAT: the owner talks to their Mac from anywhere ---
    //
    // The phone posts a turn; the Mac's existing poll picks it up and answers
    // with the SAME chat it runs locally. The site is only the meeting point —
    // it stores the one thread (every device reads the same conversation),
    // carries the turns out and the answer back, and composes nothing itself.
    'chat_thread' => function ($in) {
        require_admin();
        ownerchat_adopt();
        $t = night_ownerchat_thread(content_json('mac-chat', []));
        try {
            $t['msgs'] = ownerchat_rows(NIGHT_OWNERCHAT_THREAD_MAX);
        } catch (\Throwable $e) {
            // Un-migrated: the blob still serves the read; writes say so.
        }
        // Opening the screen IS the warm hint — the model preloads while the
        // owner types their first message.
        if (night_enabled()) {
            try {
                content_set_scalar('night-warm-until', time() + 900);
            } catch (\Throwable $e) {
            }
        }
        $mem = [];
        try {
            $mem = night_ownerchat_memories(content_json('mac-chat-memory', []));
        } catch (\Throwable $e) {
        }
        json_out([
            'ok' => true,
            'msgs' => $t['msgs'],
            'instr' => $t['instr'],
            'memory' => $mem,
            'on' => night_enabled(),
            'presence' => night_mac_presence(night_devices_read(), time()),
        ]);
    },
    // ---- the owner edits the chat's memories ------------------------
    // A visible list the OWNER writes ("never dogs"), riding every ask
    // beside the standing instruction. The app never adds a line of its
    // own — memory the model invented is the failure this shape prevents.
    'chat_memory_save' => function ($in) {
        require_admin();
        $items = night_ownerchat_memories(is_array($in['items'] ?? null) ? $in['items'] : []);
        content_set_scalar('mac-chat-memory', json_encode($items));
        json_out(['ok' => true, 'memory' => $items]);
    },
    'chat_send' => function ($in) {
        require_admin();
        if (!night_enabled()) {
            json_out(['error' => 'Overnight work is switched off in Manage → System check — the switch that connects your Mac.', 'code' => 'night_off'], 409);
        }
        $text = mb_substr(trim((string) ($in['text'] ?? '')), 0, NIGHT_OWNERCHAT_TEXT_MAX);
        if ($text === '') {
            json_out(['error' => 'Type a message first.'], 400);
        }
        night_asks_sweep();
        // ONE CONVERSATION, ONE ASK IN FLIGHT: a second send supersedes the
        // first — the Mac must never answer a question the owner has already
        // moved past (the search supersede rule, applied to chat).
        try {
            db()->exec("UPDATE night_asks SET status = 'expired' WHERE status = 'open' AND kind = 'ownerchat'");
        } catch (\Throwable $e) {
            json_out(['error' => 'The ask channel is not set up on this install yet (run the migrations).', 'code' => 'night_no_table'], 503);
        }
        $msg = ['who' => 'you', 'text' => $text, 'at' => date('H:i')];
        // A PHOTO rides the send itself (a ~1MB data URI in one POST beats a
        // second endpoint and a ref handshake). Stored as a FILE, never in
        // the thread — the thread carries the ref, chat_file serves the bytes
        // to the paired Mac, self-repair prunes after 7 days. A photo that
        // will not store REFUSES the whole send: quietly dropping it would
        // let the Mac answer a question about a picture it never saw.
        $photo = (string) ($in['photo'] ?? '');
        if ($photo !== '') {
            $ref = chat_photo_store($photo);
            if ($ref === '') {
                json_out(['error' => 'That photo could not be read — it needs to be a JPEG under 2MB. Try attaching it again.'], 400);
            }
            $msg['img'] = $ref;
        }
        // An attached DOCUMENT already travelled fenced inside $text; `file`
        // is only its shown name, so the phone can collapse the fence to a chip.
        $fname = trim((string) ($in['file'] ?? ''));
        if ($fname !== '') {
            $msg['file'] = mb_substr($fname, 0, NIGHT_OWNERCHAT_FILE_MAX);
        }
        $stored = null; // before the try — PHPStan cannot infer never from json_out
        try {
            ownerchat_adopt();
            $stored = ownerchat_append($msg); // one sanitiser owns the shape, img/file included
        } catch (\Throwable $e) {
            json_out(['error' => 'The chat needs its migration — run the migrations (Manage → System check → Run migrations).', 'code' => 'night_no_table'], 503);
        }
        if ($stored === null) {
            json_out(['error' => 'Type a message first.'], 400);
        }
        $t = night_ownerchat_thread(content_json('mac-chat', []));
        $t['msgs'] = ownerchat_rows(NIGHT_OWNERCHAT_TURNS_MAX);
        $payload = night_ownerchat_payload($t);
        // THE GROUNDING PACK: the fleet, today, and the money picture ride
        // every ask, composed fresh from the SAME gatherers the tools read —
        // the model's first generation starts grounded instead of spending a
        // round deciding whether to look. BEST-EFFORT: a failed gather must
        // never block the send — the model then simply looks things up, which
        // is exactly yesterday's behaviour.
        try {
            $nameOfW = [];
            foreach (db()->query('SELECT prop_key, name, couple_rate, max_adults, max_children, max_total
                                    FROM properties WHERE archived_at IS NULL')->fetchAll() as $pr) {
                $nameOfW[$pr['prop_key']] = (string) ($pr['name'] ?: $pr['prop_key']);
            }
            $fleetRows = [];
            foreach (db()->query('SELECT prop_key, name, couple_rate, max_adults, max_children, max_total
                                    FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name')->fetchAll() as $pr) {
                $pr['facts'] = [];
                $fleetRows[] = $pr;
            }
            $todayIsoW = date('Y-m-d');
            $gT = night_gather_today($todayIsoW);
            $gM = night_gather_money($todayIsoW);
            $payload['world'] = night_world(
                night_tool_cottages($fleetRows)['cottages'],
                night_tool_today($gT['rows'], $nameOfW, $todayIsoW, $gT['waiting']),
                night_tool_money($gM['owed'], $gM['deps'], $nameOfW),
            );
        } catch (\Throwable $e) {
        }
        try {
            $mems = night_ownerchat_memories(content_json('mac-chat-memory', []));
            if ($mems) {
                $payload['memories'] = $mems;
            }
        } catch (\Throwable $e) {
        }
        $st = db()->prepare('INSERT INTO night_asks (kind, entity_id, prop_key, question, options, created_at) VALUES (?,?,?,?,?, NOW())');
        $st->execute(['ownerchat', 0, '', mb_substr($text, 0, 500), json_encode($payload)]);
        // CAPTURED BEFORE THE WARM HINT: content_set_scalar is its own INSERT
        // on the same connection, so a lastInsertId read after it answers for
        // the CONTENT row (0, under ON DUPLICATE) — measured in CI as every
        // send returning id 0 and every poll finding "No such ask".
        $askId = (int) db()->lastInsertId();
        try {
            content_set_scalar('night-warm-until', time() + 900);
        } catch (\Throwable $e) {
        }
        json_out([
            'ok' => true,
            'id' => $askId,
            'presence' => night_mac_presence(night_devices_read(), time()),
        ]);
    },
    // The phone collects: long-poll that returns the MOMENT anything moves —
    // a partial (the Mac streams chunks onto the open row), the answer, or
    // the honest expiry. THE APPEND IS CLAIMED, not assumed: the first poller
    // to see 'answered' flips it to 'collected' and writes the thread; a
    // second device polling the same ask reads the thread the winner wrote,
    // so one answer can never land twice.
    'chat_poll' => function ($in) {
        require_admin();
        $wait = min(20, max(0, (int) ($in['wait'] ?? 0)));
        if ($wait > 0) {
            @session_write_close();
        }
        $id = (int) ($in['id'] ?? 0);
        $seen = (int) ($in['seen'] ?? 0); // partial chars the phone already painted
        $until = time() + $wait;
        $tick = 0;
        do {
            if ($tick % 4 === 0) {
                night_asks_sweep();
            }
            $tick++;
            $st = db()->prepare('SELECT status, answer, model FROM night_asks WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_out(['error' => 'No such ask.'], 404);
            }
            if ($row['status'] === 'answered') {
                $up = db()->prepare("UPDATE night_asks SET status = 'collected' WHERE id = ? AND status = 'answered'");
                $up->execute([$id]);
                if ($up->rowCount() === 1) {
                    $j = json_decode((string) ($row['answer'] ?? ''), true);
                    $msg = ['who' => 'mac', 'text' => is_array($j) && is_string($j['text'] ?? null)
                        ? $j['text'] : (string) ($row['answer'] ?? ''), 'at' => date('H:i')];
                    if (is_array($j)) {
                        if (is_string($j['think'] ?? null) && $j['think'] !== '') {
                            $msg['think'] = $j['think'];
                        }
                        if (is_array($j['used'] ?? null) && $j['used']) {
                            $msg['used'] = $j['used'];
                        }
                        // The proposal rides into the thread; the sanitiser
                        // is the second guard and drops anything invalid.
                        if (isset($j['act'])) {
                            $msg['act'] = $j['act'];
                        }
                    }
                    if (night_str($row['model'] ?? '') !== '') {
                        $msg['model'] = night_str($row['model']);
                    }
                    $stored = null;
                    try {
                        $stored = ownerchat_append($msg);
                    } catch (\Throwable $e) {
                    }
                    json_out(['ok' => true, 'status' => 'answered', 'msg' => $stored]);
                }
                // The claim was lost to another device — fall through to the
                // collected read below, which serves what the winner stored.
            }
            if ($row['status'] === 'answered' || $row['status'] === 'collected') {
                $lastM = null;
                try {
                    $stq = db()->query("SELECT * FROM ownerchat_msgs WHERE who = 'mac' ORDER BY id DESC LIMIT 1");
                    $lr = $stq->fetch();
                    if ($lr) {
                        $lastM = ownerchat_row_to_msg($lr);
                    }
                } catch (\Throwable $e) {
                }
                json_out(['ok' => true, 'status' => 'answered', 'msg' => $lastM]);
            }
            if ($row['status'] !== 'open') {
                json_out(['ok' => true, 'status' => 'expired',
                    'say' => 'Your Mac didn’t answer in time — it may be asleep or mid-job. The question is still in the thread; send it again when the Mac shows as listening.']);
            }
            // A PARTIAL: the Mac streams chunks onto the open row. Returned
            // the moment there is more than the phone has already painted.
            $pj = json_decode((string) ($row['answer'] ?? ''), true);
            $ptxt = is_array($pj) && is_string($pj['text'] ?? null) ? $pj['text'] : '';
            $pthink = is_array($pj) && is_string($pj['think'] ?? null) ? $pj['think'] : '';
            if (mb_strlen($ptxt) + mb_strlen($pthink) > $seen) {
                json_out(['ok' => true, 'status' => 'open', 'partial' => ['text' => $ptxt, 'think' => $pthink]]);
            }
            if (time() >= $until) {
                break;
            }
            usleep(250000);
        } while (true);
        json_out(['ok' => true, 'status' => 'open']);
    },
    // ---- the owner taps ■ — the round trip ends on their terms ------
    // Three layers, one decision: the phone's poll dies on its stamp, THIS
    // settles whatever the Mac had already streamed into the thread (words
    // said are kept — a stop is a decision, not a failure) and expires the
    // row, and the Mac stands down within a beat with NO new channel: its
    // next ask_partial finds the row no longer open (`held: false`) and
    // aborts the generation. The claim is guarded exactly like chat_poll's:
    // if the ANSWER beat the stop, this says so and the phone collects it
    // honestly rather than hiding words that were already finished.
    'chat_stop' => function ($in) {
        require_admin();
        $id = (int) ($in['id'] ?? 0);
        $up = db()->prepare("UPDATE night_asks SET status = 'expired' WHERE id = ? AND status = 'open' AND kind = 'ownerchat'");
        $up->execute([$id]);
        if ($up->rowCount() !== 1) {
            // Not ours to stop any more — answered, already expired, or junk.
            $st = db()->prepare("SELECT status FROM night_asks WHERE id = ? AND kind = 'ownerchat'");
            $st->execute([$id]);
            $stt = $st->fetchColumn();
            if ($stt === false) {
                json_out(['error' => 'No such ask.'], 404);
            }
            json_out(['ok' => true, 'kept' => false, 'raced' => (string) $stt]);
        }
        // Claimed. The partial is read AFTER the claim, so nothing can grow
        // it underneath us (ask_partial only writes to an OPEN row).
        $st = db()->prepare('SELECT answer FROM night_asks WHERE id = ?');
        $st->execute([$id]);
        $pj = json_decode((string) ($st->fetchColumn() ?: ''), true);
        $ptxt = is_array($pj) && is_string($pj['text'] ?? null) ? trim($pj['text']) : '';
        if ($ptxt === '') {
            // Nothing had come back yet — nothing is stored, so the question
            // stays askable (the Mac chat's own stop-before-words rule).
            json_out(['ok' => true, 'kept' => false]);
        }
        $msg = ['who' => 'mac', 'text' => $ptxt, 'at' => date('H:i'), 'stopped' => true];
        if (is_array($pj) && is_string($pj['think'] ?? null) && trim($pj['think']) !== '') {
            $msg['think'] = $pj['think'];
        }
        $stored = null;
        try {
            $stored = ownerchat_append($msg);
        } catch (\Throwable $e) {
        }
        json_out(['ok' => true, 'kept' => $stored !== null, 'msg' => $stored]);
    },
    // ---- the owner decides a proposed action ------------------------
    // The VERDICT is thread state: a card confirmed on one phone must render
    // inert on every device and every reload, or the same email is one tap
    // from going twice. Deliberately does NOT execute anything — execution
    // happened on the phone through the ordinary admin endpoints before this
    // is called (done), or never (dismissed). ADDRESSED BY ID now (the row
    // era): the message's id is the card, so nothing can rotate underneath
    // it — the kind is still verified, and the decide is a GUARDED update so
    // two devices deciding at once store exactly one verdict.
    'chat_act_done' => function ($in) {
        require_admin();
        $id = (int) ($in['id'] ?? 0);
        $kind = night_str($in['kind'] ?? '');
        $verdict = $in['verdict'] ?? '';
        if ($verdict !== 'done' && $verdict !== 'dismissed') {
            json_out(['error' => 'The verdict is done or dismissed.'], 400);
        }
        $st = db()->prepare("SELECT * FROM ownerchat_msgs WHERE id = ? AND who = 'mac'");
        $st->execute([$id]);
        $row = $st->fetch();
        $act = $row ? json_decode((string) ($row['act'] ?? ''), true) : null;
        if (!is_array($act) || ($act['kind'] ?? '') !== $kind) {
            json_out(['error' => 'The conversation has moved on — refresh and look again.'], 409);
        }
        if (night_str($row['act_done'] ?? '') !== '') {
            // Already decided (another device, or a double tap) — the stored
            // verdict stands; saying so beats silently re-deciding.
            json_out(['ok' => true, 'already' => true, 'verdict' => $row['act_done']]);
        }
        $up = db()->prepare('UPDATE ownerchat_msgs SET act_done = ?, act_done_at = ? WHERE id = ? AND act_done IS NULL');
        $up->execute([$verdict, date('H:i'), $id]);
        if ($up->rowCount() !== 1) {
            $st->execute([$id]);
            $row2 = $st->fetch();
            json_out(['ok' => true, 'already' => true, 'verdict' => night_str($row2['act_done'] ?? '')]);
        }
        json_out(['ok' => true, 'verdict' => $verdict]);
    },
    // ---- the owner opens a guest thread: is a live draft waiting? ---
    // messages.php files a 'chat' ask the moment a guest speaks; the Mac's
    // sweep answers it within seconds. This hands the freshest answer over —
    // an idempotent READ, deliberately unclaimed, so closing the thread and
    // reopening it does not lose the draft. Two honesty guards: a draft older
    // than two hours is not offered (the conversation has moved on), and a
    // thread whose NEWEST message is the owner's gets nothing — a draft
    // written before their own reply would answer a question already handled.
    'chat_draft' => function ($in) {
        require_admin();
        $tid = (int) ($in['thread'] ?? 0);
        if ($tid <= 0) {
            json_out(['ok' => true, 'draft' => '']);
        }
        try {
            $lm = db()->prepare('SELECT sender_role FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1');
            $lm->execute([$tid]);
            if ((string) $lm->fetchColumn() !== 'guest') {
                json_out(['ok' => true, 'draft' => '']);
            }
            $st = db()->prepare("SELECT answer FROM night_asks WHERE kind = 'chat' AND entity_id = ?
                                    AND status IN ('answered', 'collected')
                                    AND answered_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)
                                  ORDER BY id DESC LIMIT 1");
            $st->execute([$tid]);
            json_out(['ok' => true, 'draft' => night_str($st->fetchColumn() ?: '')]);
        } catch (\Throwable $e) {
            json_out(['ok' => true, 'draft' => '']); // no table, no draft — never an error
        }
    },
    'chat_instr' => function ($in) {
        require_admin();
        $t = night_ownerchat_thread(content_json('mac-chat', []));
        $t['instr'] = mb_substr(trim((string) ($in['text'] ?? '')), 0, NIGHT_OWNERCHAT_INSTR_MAX);
        content_set_scalar('mac-chat', json_encode($t));
        json_out(['ok' => true, 'instr' => $t['instr']]);
    },
    'chat_clear' => function ($in) {
        require_admin();
        try {
            db()->exec('DELETE FROM ownerchat_msgs');
        } catch (\Throwable $e) {
        }
        $t = night_ownerchat_thread(content_json('mac-chat', []));
        content_set_scalar('mac-chat', json_encode(['instr' => $t['instr'], 'msgs' => []]));
        json_out(['ok' => true]);
    },

    // ---- the machine streams a partial answer onto an open ask ------
    // Pseudo-streaming: the Mac posts the answer-so-far every couple of
    // seconds; chat_poll hands the phone whatever is new. The row stays
    // OPEN — only 'answer' settles it — and only a web-chat ask takes
    // partials, because nothing else has a screen watching mid-generation.
    'ask_partial' => function ($in) {
        rate_limit('night-partial', 120, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'ask_partial');
        if (!night_enabled()) {
            json_out(['error' => 'Overnight work is switched off in Manage → System check.', 'code' => 'night_off'], 409);
        }
        $id = (int) ($in['id'] ?? 0);
        $text = mb_substr((string) ($in['text'] ?? ''), 0, NIGHT_OWNERCHAT_TEXT_MAX + NIGHT_OWNERCHAT_THINK_MAX);
        $up = db()->prepare("UPDATE night_asks SET answer = ? WHERE id = ? AND status = 'open' AND kind = 'ownerchat'");
        $up->execute([$text, $id]);
        json_out(['ok' => true, 'held' => $up->rowCount() === 1]);
    },

    // ---- the machine fetches an attached chat photo ----------------
    // The ask payload carries a REF (uploads/chat-photo-…jpg); the bytes come
    // through this door — device key, the one night-shift switch, and the ref
    // must be EXACTLY the shape chat_photo_store mints. Serving by pattern
    // rather than by path is the whole point: a device key must never become
    // a way to read arbitrary files out of uploads/.
    'chat_file' => function ($in) {
        rate_limit('night-file', 60, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'chat_file', $in['build'] ?? '');
        if (!night_enabled()) {
            json_out(['error' => 'Overnight work is switched off in Manage → System check.', 'code' => 'night_off'], 409);
        }
        $ref = $in['ref'] ?? '';
        if (!night_chat_ref_ok($ref)) {
            json_out(['error' => 'That is not a chat photo reference.'], 400);
        }
        $path = __DIR__ . '/' . $ref;
        $raw = @file_get_contents($path, false, null, 0, 2 * 1024 * 1024 + 1);
        if ($raw === false || $raw === '' || strlen($raw) > 2 * 1024 * 1024) {
            json_out(['error' => 'No such photo — it may have been pruned (chat photos are kept a week).'], 404);
        }
        json_out(['ok' => true, 'data' => base64_encode($raw), 'mime' => 'image/jpeg']);
    },

    // ---- the owner opened search: warm the Mac's engine ------------
    'warm' => function ($in) {
        require_admin();
        if (night_enabled()) {
            try {
                content_set_scalar('night-warm-until', time() + 900);
            } catch (\Throwable $e) {
            }
        }
        json_out(['ok' => true]);
    },

    // ---- the machine reads the open asks ----------------------------
    'asks' => function ($in) {
        // Throttled well above a real Mac's 20-second poll, and BEFORE the
        // key is looked at — the sign-in rule, same as ingest.
        rate_limit('night-asks', 30, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'asks', $in['build'] ?? '');
        if (!night_enabled()) {
            json_out(['error' => 'Overnight work is switched off in Manage → System check.', 'code' => 'night_off'], 409);
        }
        require_once __DIR__ . '/pricing.php';
        night_asks_sweep();
        $host = '';
        try {
            require_once __DIR__ . '/mailer.php';
            $host = (string) email_host_name();
        } catch (\Throwable $e) {
            $host = '';
        }
        // LONG-POLL (the seamlessness plumbing): `wait` holds this request
        // open up to 25 seconds and returns the MOMENT an ask appears, so the
        // Mac starts working within a second of the owner's tap instead of a
        // 20-second poll later. No session is held (machine routes have
        // none), and the loop re-sweeps so an expiry mid-wait is honoured.
        $wait = min(25, max(0, (int) ($in['wait'] ?? 0)));
        $until = time() + $wait;
        $out = [];
        $rows = []; // before the try — the json_out-in-catch rule again
        do {
            try {
                $rows = db()->query("SELECT * FROM night_asks WHERE status = 'open' ORDER BY created_at, id")->fetchAll();
            } catch (\Throwable $e) {
                json_out(['error' => 'The ask channel is not set up on this install yet (run the migrations).', 'code' => 'night_no_table'], 503);
            }
            if ($rows || time() >= $until) {
                break;
            }
            // The same quarter-second grain as ask_status: a filed ask meets
            // the Mac's held poll within ~250ms instead of up to a second.
            // The sweep runs every fourth tick — its old once-a-second rate.
            usleep(250000);
            $tick = (isset($tick) ? $tick : 0) + 1;
            if ($tick % 4 === 0) {
                night_asks_sweep();
            }
        } while (true);
        foreach ($rows as $a) {
            $one = ['id' => (int) $a['id'], 'kind' => (string) $a['kind']];
            if ($a['kind'] === 'reply') {
                // Re-checked at the READ too: declined since the ask was filed
                // means the ask dies here, unanswered — the same rule as the
                // brief, so the machine never sees a declined guest's words.
                $st = db()->prepare('SELECT id, prop_key, name, check_in, check_out, adults, children, message, created_at
                                       FROM enquiries WHERE id = ? AND declined_at IS NULL');
                $st->execute([(int) $a['entity_id']]);
                $e = $st->fetch();
                if (!$e) {
                    try {
                        db()->prepare("UPDATE night_asks SET status = 'expired' WHERE id = ?")->execute([(int) $a['id']]);
                    } catch (\Throwable $x) {
                    }
                    continue;
                }
                $one['enquiry'] = night_enquiry_view($e);
            } elseif ($a['kind'] === 'intent') {
                // The query and the MENU — the model may only choose from it
                // (or say none), and the answer route re-checks that.
                $opts = night_ask_options(json_decode((string) ($a['options'] ?? ''), true));
                if (!$opts) {
                    continue; // a menu that decodes to nothing offers nothing
                }
                $one['intent'] = ['q' => night_str($a['question']), 'options' => $opts];
            } elseif ($a['kind'] === 'digest') {
                // The question and the ROWS the summary must be built from —
                // the grounding travels with the ask, and the answer route
                // re-checks the money against these same stored rows.
                $rows = night_ask_rows(json_decode((string) ($a['options'] ?? ''), true));
                if (!$rows) {
                    continue; // nothing to summarise offers nothing
                }
                $one['digest'] = ['q' => night_str($a['question']), 'rows' => $rows];
            } elseif ($a['kind'] === 'ownerchat') {
                // THE WEB CHAT: the turns and the standing instruction,
                // exactly as chat_send stored them. Junk decodes to nothing
                // and the ask dies unanswered at its TTL — the phone's poll
                // says so honestly.
                $pl = json_decode((string) ($a['options'] ?? ''), true);
                $turns = is_array($pl) && is_array($pl['turns'] ?? null) ? $pl['turns'] : [];
                if (!$turns) {
                    continue;
                }
                $one['ownerchat'] = [
                    'turns' => $turns,
                    'instr' => night_str(is_array($pl) ? ($pl['instr'] ?? '') : ''),
                ];
                if (is_array($pl['world'] ?? null)) {
                    $one['ownerchat']['world'] = $pl['world'];
                }
                if (is_array($pl['memories'] ?? null) && $pl['memories']) {
                    $one['ownerchat']['memories'] = night_ownerchat_memories($pl['memories']);
                }
            } elseif ($a['kind'] === 'chat') {
                // The conversation, composed by the same withholding rules as
                // the enquiry brief: words and a first name, never contact
                // details. A vanished thread expires the ask, unanswered.
                $st = db()->prepare('SELECT id, name FROM chat_threads WHERE id = ?');
                $st->execute([(int) $a['entity_id']]);
                $th = $st->fetch();
                if (!$th) {
                    try {
                        db()->prepare("UPDATE night_asks SET status = 'expired' WHERE id = ?")->execute([(int) $a['id']]);
                    } catch (\Throwable $x) {
                    }
                    continue;
                }
                $st = db()->prepare('SELECT sender_role, body FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ' . (int) NIGHT_CHAT_MSGS_MAX);
                $st->execute([(int) $a['entity_id']]);
                $one['chat'] = night_chat_view($th, array_reverse($st->fetchAll()));
            } else {
                // An FAQ answer: the question, that cottage's own published
                // answers to ground it, nothing else.
                $pk = night_str($a['prop_key']);
                $names = [];
                try {
                    foreach (db()->query('SELECT prop_key, name FROM properties')->fetchAll() as $pr) {
                        $names[$pr['prop_key']] = (string) ($pr['name'] ?: $pr['prop_key']);
                    }
                } catch (\Throwable $x) {
                    $names = [];
                }
                $qs = night_questions_brief(
                    [['q' => night_str($a['question']), 'n' => 1, 'prop' => $pk]],
                    $names,
                    function ($k) { return $k !== '' ? content_json('faqs-' . $k, []) : []; },
                    1,
                );
                if (!$qs) {
                    continue;
                }
                $one['question'] = $qs[0];
            }
            $out[] = $one;
        }
        // The voice examples ride the asks too — a reply drafted while the
        // owner waits should sound like them just as much as a nightly one.
        // Composed only when a reply ask exists: the ordinary poll answers
        // an empty list and must stay a cheap read.
        $vp = [];
        foreach ($out as $o) {
            if (($o['kind'] ?? '') === 'reply') {
                try {
                    $vp = night_voice_examples(content_json('email-templates', []));
                } catch (\Throwable $e) {
                    $vp = [];
                }
                break;
            }
        }
        $ap = ['ok' => true, 'host' => $host, 'asks' => $out];
        // The warm hint (seamlessness rung 2): the owner opened search in the
        // last few minutes, so bringing the model up NOW means a dead end
        // meets a warm engine. A hint, never an instruction — the Mac ignores
        // it unless auto-start is on.
        try {
            if ((int) content_value('night-warm-until') > time()) {
                $ap['warm'] = true;
            }
        } catch (\Throwable $e) {
        }
        if ($vp) {
            $ap['voice'] = $vp;
        }
        json_out($ap);
    },

    // ---- the machine posts an answer --------------------------------
    'answer' => function ($in) {
        rate_limit('night-answer', 20, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'answer');
        if (!night_enabled()) {
            json_out(['error' => 'Overnight work is switched off in Manage → System check.', 'code' => 'night_off'], 409);
        }
        night_asks_sweep();
        $id = (int) ($in['id'] ?? 0);
        $st = db()->prepare('SELECT status, kind, options FROM night_asks WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) {
            json_out(['error' => 'No such ask.'], 404);
        }
        // THE ANSWER RULE FOLLOWS THE KIND: a web-chat answer is a JSON
        // envelope with its own caps (the thinking rides inside, so the
        // generic 8000-character rule would refuse honest answers); every
        // other kind keeps the generic rule it always had.
        $bad = $row['kind'] === 'ownerchat'
            ? night_ownerchat_answer_problem($in['text'] ?? '')
            : night_ask_answer_problem($in['text'] ?? '');
        if ($bad !== '') {
            json_out(['error' => $bad], 400);
        }
        if ($row['status'] === 'answered') {
            // A retried POST whose reply was lost — the answer is already
            // there, which is what the machine wanted.
            json_out(['ok' => true, 'replayed' => true]);
        }
        if ($row['status'] !== 'open') {
            // Ten minutes have passed and the owner moved on. Refused, so a
            // late model run never lands words nobody is waiting for.
            json_out(['error' => 'Too late — the owner stopped waiting for this one.', 'code' => 'ask_expired'], 410);
        }
        // AN INTENT ANSWER IS CHECKED AGAINST ITS OWN MENU — byte-exact
        // member or the literal 'none'. The Mac's guard enforces this too;
        // the door re-checks because the door must never rely on the caller.
        try {
            $meta = $row;
            if ($meta && $meta['kind'] === 'intent') {
                $opts = night_ask_options(json_decode((string) ($meta['options'] ?? ''), true));
                $t = trim((string) $in['text']);
                if ($t !== 'none' && !in_array($t, $opts, true)) {
                    json_out(['error' => 'An intent answer must be one of the offered questions, or the word none.'], 400);
                }
            }
            // A DIGEST ANSWER'S MONEY IS GROUNDED IN ITS OWN ROWS — the Mac's
            // guard enforces this too; the door re-checks against what was
            // actually STORED, so a figure the rows never stated cannot land.
            if ($meta && $meta['kind'] === 'digest') {
                $rows = night_ask_rows(json_decode((string) ($meta['options'] ?? ''), true));
                $bad = night_digest_answer_problem((string) $in['text'], $rows);
                if ($bad !== '') {
                    json_out(['error' => $bad], 400);
                }
            }
        } catch (\Throwable $e) {
        }
        // A PROPOSED ACTION IS VALIDATED AT THIS DOOR, the first of the two
        // guards: the whitelist is closed, the cottage resolves against the
        // live list (ambiguity refused naming the choices), the past is not
        // proposable, and a request_payment ref must be a booking that
        // EXISTS. The act is stored NORMALISED (prop key + display name), so
        // everything downstream renders one shape. A bad act refuses the
        // whole answer in a sentence — the Mac validated first, so meeting
        // this is a buggy or hostile device, not a model having a bad day.
        $storeText = trim((string) $in['text']);
        if ($row['kind'] === 'ownerchat') {
            $env = json_decode($storeText, true);
            if (is_array($env) && isset($env['act'])) {
                $nameOfA = [];
                try {
                    foreach (db()->query('SELECT prop_key, name FROM properties WHERE archived_at IS NULL')->fetchAll() as $pr) {
                        $nameOfA[$pr['prop_key']] = (string) ($pr['name'] ?: $pr['prop_key']);
                    }
                } catch (\Throwable $e) {
                }
                $res = night_act_resolve($env['act'], $nameOfA, date('Y-m-d'));
                if ($res['act'] === null) {
                    json_out(['error' => 'The proposed action was refused: ' . $res['problem']], 400);
                }
                if ($res['act']['kind'] === 'request_payment') {
                    $st = db()->prepare('SELECT id FROM bookings WHERE id = ?');
                    $st->execute([(int) $res['act']['booking']]);
                    if (!$st->fetchColumn()) {
                        json_out(['error' => 'The proposed action was refused: no booking has that ref.'], 400);
                    }
                }
                if ($res['act']['kind'] === 'send_enquiry_reply') {
                    $st = db()->prepare('SELECT id FROM enquiries WHERE id = ? AND declined_at IS NULL');
                    $st->execute([(int) $res['act']['enquiry']]);
                    if (!$st->fetchColumn()) {
                        json_out(['error' => 'The proposed action was refused: no waiting enquiry has that id.'], 400);
                    }
                }
                $env['act'] = $res['act'];
                $storeText = json_encode($env);
            }
        }
        // Guarded write: the WHERE re-checks open, so two racing answers
        // cannot both land (the first wins, the second reads back as replayed).
        $up = db()->prepare("UPDATE night_asks SET status = 'answered', answer = ?, model = ?, answered_at = NOW()
                              WHERE id = ? AND status = 'open'");
        $up->execute([$storeText, night_str($in['model'] ?? ''), $id]);
        json_out(['ok' => true, 'replayed' => $up->rowCount() === 0]);
    },

    'brief' => function ($in) {
        rate_limit('night-brief', 40, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'brief', $in['build'] ?? '');
        // ONE SWITCH CLOSES BOTH DIRECTIONS. Off must not leave a readable
        // door open behind a queue nothing can be posted to.
        if (!night_enabled()) {
            json_out([
                'error' => 'Overnight work is switched off in Manage → System check.',
                'code' => 'night_off',
            ], 409);
        }
        require_once __DIR__ . '/pricing.php';
        $host = '';
        try {
            require_once __DIR__ . '/mailer.php';
            $host = (string) email_host_name();
        } catch (\Throwable $e) {
            $host = '';
        }
        $out = [];
        try {
            // LIVE ENQUIRIES ONLY — declining is a soft delete (declined_at
            // set; enquiries.php's own list filters exactly this way) and an
            // APPROVED enquiry's row is deleted outright. Without the filter
            // the producer drafted replies to enquiries the owner had already
            // DECLINED: decline someone in the afternoon, and a reply to them
            // sat in Ready-for-you the next morning — plus their name and
            // message had left the site for a machine that had no business
            // reading them any more.
            // A BINNED DRAFT STAYS BINNED. Refs are per-night, so an enquiry
            // whose draft the owner dismissed was re-drafted the next night
            // under a fresh ref — the machine redoing work the owner rejected.
            // USED is withheld for the same reason: the reply happened. The
            // queue's own target ('enquiry-<id>') is the join, and the window
            // is days because a still-waiting enquiry past it is fair to
            // offer again — the guest is still waiting too.
            $st = db()->prepare(
                "SELECT id, prop_key, name, check_in, check_out, adults, children, message, created_at
                   FROM enquiries e
                  WHERE declined_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM night_items ni
                                     WHERE ni.kind = 'reply'
                                       AND ni.target = CONCAT('enquiry-', e.id)
                                       AND ni.status IN ('used', 'dismissed')
                                       AND ni.acted_at > DATE_SUB(NOW(), INTERVAL 4 DAY))
                  ORDER BY created_at DESC, id DESC
                  LIMIT " . (int) NIGHT_BRIEF_MAX,
            );
            $st->execute();
            $rows = $st->fetchAll();
            foreach ($rows as $row) {
                // The shared view — see night_enquiry_view above, which also
                // carries the "Array is not a cottage name" history.
                $out[] = night_enquiry_view($row);
            }
        } catch (\Throwable $e) {
            // A read that fails answers "nothing waiting" rather than an error:
            // the producer's correct response to both is to do nothing tonight.
            $out = [];
        }

        // ── THE OTHER JOBS' FACTS. Same posture as the enquiries: every ──
        // figure formatted HERE, contact details withheld, and a read that
        // fails yields an ABSENT section — a producer treats absent as
        // "this site does not hand that over", never as an empty week.
        require_once __DIR__ . '/pricing.php';
        $nameOf = [];
        try {
            foreach (db()->query('SELECT prop_key, name FROM properties')->fetchAll() as $pr) {
                $nameOf[$pr['prop_key']] = (string) ($pr['name'] ?: $pr['prop_key']);
            }
        } catch (\Throwable $e) {
            $nameOf = [];
        }
        $week = null;
        try {
            $today = date('Y-m-d');
            $limit = date('Y-m-d', strtotime('+' . NIGHT_WEEK_DAYS . ' days'));
            $st = db()->prepare(
                'SELECT * FROM bookings
                  WHERE check_out > ? AND check_in < ?
                  ORDER BY check_in',
            );
            $st->execute([$today, $limit]);
            $wrows = [];
            foreach ($st->fetchAll() as $b) {
                $due = 0.0;
                try {
                    $due = (float) booking_amount_due($b, 'balance')['due'];
                } catch (\Throwable $e) {
                    $due = 0.0; // an unpriceable row states no figure at all
                }
                $wrows[] = [
                    'prop_key' => $b['prop_key'], 'name' => $b['name'],
                    'check_in' => $b['check_in'], 'check_out' => $b['check_out'],
                    'adults' => $b['adults'], 'children' => $b['children'],
                    'due' => $due,
                ];
            }
            $week = night_week_brief($wrows, $nameOf, $today);
        } catch (\Throwable $e) {
            $week = null;
        }
        $gaps = null;
        try {
            $today = date('Y-m-d');
            $occ = [];
            $st = db()->prepare('SELECT prop_key, check_in, check_out FROM bookings WHERE check_out > ?');
            $st->execute([$today]);
            foreach ($st->fetchAll() as $b) {
                $occ[] = $b;
            }
            // Blocks OCCUPY too: an owner-held hole must never read as a gap
            // to sell, and an OTA stay is as booked as one of ours.
            $st = db()->prepare('SELECT prop_key, check_in, check_out FROM ical_blocks WHERE check_out > ?');
            $st->execute([$today]);
            foreach ($st->fetchAll() as $b) {
                $occ[] = $b;
            }
            $gaps = night_gap_brief(
                $occ,
                $nameOf,
                function ($pk) { return get_rate($pk); },
                function ($rate, $in, $out) { return price_breakdown($rate, 2, 0, $in, $out); },
                $today,
            );
        } catch (\Throwable $e) {
            $gaps = null;
        }
        $questions = null;
        try {
            $questions = night_questions_brief(
                content_json('guest-faq-misses', []),
                $nameOf,
                function ($pk) { return $pk !== '' ? content_json('faqs-' . $pk, []) : []; },
            );
        } catch (\Throwable $e) {
            $questions = null;
        }

        $stood = 0;
        try {
            $stood = (int) db()->query(
                "SELECT COUNT(*) FROM enquiries e
                  WHERE e.declined_at IS NULL
                    AND EXISTS (SELECT 1 FROM night_items ni
                                 WHERE ni.kind = 'reply'
                                   AND ni.target = CONCAT('enquiry-', e.id)
                                   AND ni.status IN ('used', 'dismissed')
                                   AND ni.acted_at > DATE_SUB(NOW(), INTERVAL 4 DAY))",
            )->fetchColumn();
        } catch (\Throwable $e) {
            $stood = 0;
        }
        // The owner's register, for the reply drafts (integration step 3).
        $voice = [];
        try {
            $voice = night_voice_examples(content_json('email-templates', []));
        } catch (\Throwable $e) {
            $voice = [];
        }
        // THE TEACH BRIEF (search × Mac, rung 4): the week's dead-end
        // searches beside the canonical menu the owner's own client synced
        // (search-canon rides chbAssistSyncPush like the learned/suppressed
        // lists). Absent when either side is empty — a producer treats
        // absent as "nothing to map", never as an error.
        $teach = null;
        try {
            $teach = night_teach_brief(
                content_json('search-misses', []),
                content_json('search-canon', []),
                content_json('nlu-learned', []),
                content_json('nlu-suppressed', []),
                date('Y-m-d'),
            );
        } catch (\Throwable $e) {
            $teach = null;
        }
        $payload = ['ok' => true, 'host' => $host, 'enquiries' => $out, 'cap' => NIGHT_BRIEF_MAX];
        if ($voice) {
            $payload['voice'] = $voice;
        }
        if ($stood > 0) {
            $payload['stood_down'] = $stood;
        }
        if ($week !== null) {
            $payload['week'] = $week;
        }
        if ($gaps !== null) {
            $payload['gaps'] = $gaps;
        }
        if ($questions !== null) {
            $payload['questions'] = $questions;
        }
        if ($teach !== null) {
            $payload['teach'] = $teach;
        }
        json_out($payload);
    },

    // ---- the chat's read-only tools --------------------------------
    //
    // The Mac's Chat screen looking things up mid-conversation. Same door as
    // the brief (device key + the night-shift switch — one switch closes both
    // directions), and the same grounding rule: every figure leaves here
    // formatted by the site's own derivations, so the model quotes money and
    // never calculates it. READ-ONLY by construction — nothing in this action
    // writes a row, sends an email or touches a content key. Unlike the
    // brief's answer-nothing-on-error posture, a failed read here REFUSES
    // with a sentence: the brief's producer treats silence as "do nothing
    // tonight", but a chat that answers "no bookings" off a failed read has
    // told the owner a lie about their own week.
    'chat_tool' => function ($in) {
        rate_limit('night-chat-tool', 30, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'chat_tool', $in['build'] ?? '');
        if (!night_enabled()) {
            json_out([
                'error' => 'Overnight work is switched off in Manage → System check.',
                'code' => 'night_off',
            ], 409);
        }
        $tool = night_str($in['tool'] ?? '');
        $args = (isset($in['args']) && is_array($in['args'])) ? $in['args'] : [];
        $today = date('Y-m-d');
        $bad = night_tool_problem($tool, $args, $today);
        if ($bad !== '') {
            json_out(['error' => $bad], 400);
        }
        require_once __DIR__ . '/pricing.php';
        $nameOf = [];
        try {
            foreach (db()->query('SELECT prop_key, name FROM properties')->fetchAll() as $pr) {
                $nameOf[$pr['prop_key']] = (string) ($pr['name'] ?: $pr['prop_key']);
            }
        } catch (\Throwable $e) {
            $nameOf = [];
        }
        try {
            if ($tool === 'today') {
                $g = night_gather_today($today);
                json_out(['ok' => true, 'tool' => $tool, 'data' => night_tool_today($g['rows'], $nameOf, $today, $g['waiting'])]);
            }
            if ($tool === 'bookings') {
                $from = night_tool_iso($args['from'] ?? '') ?: $today;
                $to = night_tool_iso($args['to'] ?? '') ?: date('Y-m-d', strtotime($from . ' +14 days'));
                $name = mb_substr(trim((string) ($args['name'] ?? '')), 0, NIGHT_TOOL_ARG_MAX);
                $sql = 'SELECT * FROM bookings WHERE check_out > ? AND check_in < ?';
                $params = [$from, $to];
                if ($name !== '') {
                    $sql .= ' AND name LIKE ?';
                    $params[] = '%' . $name . '%';
                }
                $st = db()->prepare($sql . ' ORDER BY check_in LIMIT ' . (int) (NIGHT_TOOL_ROWS_MAX + 20));
                $st->execute($params);
                $rows = [];
                foreach ($st->fetchAll() as $b) {
                    try {
                        $b['due'] = (float) booking_amount_due($b, 'balance')['due'];
                    } catch (\Throwable $e) {
                        $b['due'] = 0.0;
                    }
                    $rows[] = $b;
                }
                json_out(['ok' => true, 'tool' => $tool, 'data' => night_tool_bookings($rows, $nameOf, $from, $to)]);
            }
            if ($tool === 'availability') {
                // WHICH COTTAGE — matched against the live list, never guessed.
                // Ambiguous or unknown names are refused NAMING the choices, so
                // the model's next try can be right.
                $want = mb_strtolower(trim((string) $args['cottage']));
                $hits = [];
                foreach ($nameOf as $pk => $nm) {
                    if (mb_strtolower($nm) === $want || mb_strtolower((string) $pk) === $want
                        || mb_stripos($nm, $want) !== false) {
                        $hits[$pk] = $nm;
                    }
                }
                if (count($hits) !== 1) {
                    json_out(['error' => (count($hits) === 0 ? 'No cottage called that. ' : 'More than one cottage matches. ')
                        . 'The cottages are: ' . implode(', ', array_values($nameOf)) . '.'], 400);
                }
                $pk = (string) array_key_first($hits);
                $from = night_tool_iso($args['from'] ?? '');
                $to = night_tool_iso($args['to'] ?? '');
                $takenBy = [];
                $st = db()->prepare('SELECT name FROM bookings WHERE prop_key = ? AND check_in < ? AND check_out > ?');
                $st->execute([$pk, $to, $from]);
                foreach ($st->fetchAll() as $b) {
                    $takenBy[] = (string) $b['name'];
                }
                $st = db()->prepare('SELECT COUNT(*) FROM ical_blocks WHERE prop_key = ? AND check_in < ? AND check_out > ?');
                $st->execute([$pk, $to, $from]);
                if ((int) $st->fetchColumn() > 0) {
                    $takenBy[] = 'an external or blocked booking';
                }
                $price = null;
                if (count($takenBy) === 0) {
                    try {
                        $rate = get_rate($pk);
                        $price = $rate ? price_breakdown($rate, 2, 0, $from, $to) : null;
                    } catch (\Throwable $e) {
                        $price = null; // free with no figure — never a guessed quote
                    }
                }
                json_out(['ok' => true, 'tool' => $tool,
                    'data' => night_tool_availability($hits[$pk], $from, $to, $takenBy, $price)]);
            }
            if ($tool === 'cottages') {
                // The fleet itself — names, occupancy, base rate, published
                // Q&A. Found live: the first four tools all assumed the model
                // already knew what the cottages WERE, and it did not.
                $rows = [];
                $st = db()->query('SELECT prop_key, name, couple_rate, max_adults, max_children, max_total
                                     FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name');
                foreach ($st->fetchAll() as $pr) {
                    $facts = [];
                    try {
                        $f = content_json('faqs-' . $pr['prop_key'], []);
                        if (is_array($f)) {
                            $facts = $f;
                        }
                    } catch (\Throwable $e) {
                        $facts = [];
                    }
                    $pr['facts'] = $facts;
                    $rows[] = $pr;
                }
                json_out(['ok' => true, 'tool' => $tool, 'data' => night_tool_cottages($rows)]);
            }
            if ($tool === 'money') {
                // Who still owes, judged by the SAME window rule the payask
                // uses — one gather shared with the world sheet, so a lookup
                // and the grounding pack can never disagree.
                $g = night_gather_money($today);
                json_out(['ok' => true, 'tool' => $tool, 'data' => night_tool_money($g['owed'], $g['deps'], $nameOf)]);
            }
            if ($tool === 'performance') {
                $mStart = date('Y-m-01');
                $mEnd = date('Y-m-t');
                $lStart = date('Y-m-01', strtotime($mStart . ' -1 month'));
                $lEnd = date('Y-m-t', strtotime($lStart));
                $pull = function ($a, $b2) {
                    $st = db()->prepare('SELECT * FROM bookings WHERE check_in >= ? AND check_in <= ?');
                    $st->execute([$a, $b2]);
                    $rows = [];
                    foreach ($st->fetchAll() as $bk) {
                        try {
                            $bk['revenue'] = (float) booking_rental_price($bk);
                        } catch (\Throwable $e) {
                            $bk['revenue'] = 0.0;
                        }
                        $rows[] = $bk;
                    }
                    return $rows;
                };
                json_out(['ok' => true, 'tool' => $tool, 'data' => night_tool_performance(
                    $pull($mStart, $mEnd),
                    $pull($lStart, $lEnd),
                    date('F Y'),
                    date('F Y', strtotime($lStart)),
                )]);
            }
            if ($tool === 'expenses') {
                // The tax year the books use: from 6 April.
                $y = (int) date('Y');
                $taxStart = (date('md') >= '0406' ? $y : $y - 1) . '-04-06';
                $st = db()->prepare('SELECT amount, category FROM expenses WHERE expense_date >= ? LIMIT 500');
                $st->execute([$taxStart]);
                json_out(['ok' => true, 'tool' => $tool, 'data' => night_tool_expenses(
                    $st->fetchAll(),
                    substr($taxStart, 0, 4) . '/' . substr((string) ((int) substr($taxStart, 0, 4) + 1), 2),
                )]);
            }
            // enquiries — the brief's own view, WITHOUT its draft stand-down
            // filter: that filter is about not re-drafting, and the chat is
            // asking what is waiting, which includes an enquiry whose draft
            // was already made.
            $st = db()->prepare('SELECT id, prop_key, name, check_in, check_out, adults, children, message, created_at
                                   FROM enquiries WHERE declined_at IS NULL
                                  ORDER BY created_at DESC, id DESC LIMIT 6');
            $st->execute();
            $list = [];
            foreach ($st->fetchAll() as $row) {
                $list[] = night_enquiry_view($row);
            }
            json_out(['ok' => true, 'tool' => $tool, 'data' => ['enquiries' => $list]]);
        } catch (\Throwable $e) {
            json_out(['error' => 'The website could not read that just now — try again in a moment.'], 500);
        }
    },

    // ---- a machine reports a night's work --------------------------
    'ingest' => function ($in) {
        // Throttled BEFORE the secret is looked at, on the same table sign-in
        // uses, so this cannot become a quieter way to guess APP_SECRET. A real
        // producer posts once or twice a night and never meets it.
        rate_limit('night-ingest', 20, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'POST');
        if (!night_enabled()) {
            json_out([
                'error' => 'Overnight work is switched off in Manage → System check. Nothing was stored.',
                'code' => 'night_off',
            ], 409);
        }
        $items = $in['items'] ?? null;
        $bad = night_batch_problem($items);
        if ($bad !== '') {
            json_out(['error' => $bad], 400);
        }

        // How much room is left decides how many of a valid batch land. The
        // cap is on OPEN rows, so a queue the owner has worked through takes
        // the next night's work normally.
        $openNow = 0;
        try {
            $openNow = (int) db()
                ->query("SELECT COUNT(*) FROM night_items WHERE status = 'open' AND expires_at > NOW()")
                ->fetchColumn();
        } catch (\Throwable $e) {
            json_out([
                'error' => 'The overnight queue is not set up on this install yet (run the migrations).',
                'code' => 'night_no_table',
            ], 503);
        }
        $room = night_room_left($openNow);

        $stored = 0;
        $skipped = [];
        $ins = null;
        try {
            $ins = db()->prepare(
                'INSERT INTO night_items (ref, kind, title, sub, body, source, target, status, created_at, expires_at)
                 VALUES (?,?,?,?,?,?,?, \'open\', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))
                 ON DUPLICATE KEY UPDATE id = id',
            );
        } catch (\Throwable $e) {
            $ins = null;
        }
        if (!$ins) {
            json_out(['error' => 'Could not store anything just now.'], 500);
        }
        foreach ($items as $it) {
            $why = night_item_problem($it);
            if ($why !== '') {
                $skipped[] = ['ref' => is_array($it) ? (string) ($it['ref'] ?? '') : '', 'why' => $why];
                continue;
            }
            if ($room <= 0) {
                $skipped[] = [
                    'ref' => (string) $it['ref'],
                    'why' => 'the queue already holds ' . NIGHT_OPEN_MAX . ' items waiting to be read',
                ];
                continue;
            }
            try {
                $ins->execute([
                    (string) $it['ref'],
                    (string) $it['kind'],
                    trim((string) $it['title']),
                    isset($it['sub']) ? (string) $it['sub'] : '',
                    (string) $it['body'],
                    isset($it['source']) ? (string) $it['source'] : '',
                    isset($it['target']) ? (string) $it['target'] : '',
                    night_ttl_days((string) $it['kind']),
                ]);
                // ON DUPLICATE KEY UPDATE id = id changes nothing, so rowCount
                // is 0 for a ref already stored — which is exactly the answer a
                // retried POST should get. It is not an error and not a skip
                // worth naming: the item IS in the queue, which is what the
                // producer asked for.
                if ($ins->rowCount() > 0) {
                    $stored++;
                    $room--;
                }
            } catch (\Throwable $e) {
                $skipped[] = ['ref' => (string) $it['ref'], 'why' => 'could not be stored'];
            }
        }
        if ($stored > 0) {
            log_activity('system', 'night.ingest', 'Overnight work arrived — ' . $stored . ' item' . ($stored === 1 ? '' : 's'), [
                'actor' => 'system',
            ]);
        }
        json_out(['ok' => true, 'stored' => $stored, 'skipped' => $skipped, 'room' => $room]);
    },
]);
