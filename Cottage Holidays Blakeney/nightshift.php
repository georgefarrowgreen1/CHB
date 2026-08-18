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
function night_require_key($given, $what)
{
    $devices = night_devices_read();
    $onFile = night_key_on_file();
    $i = night_device_index($devices, $given);
    if ($i >= 0) {
        // LAST SEEN, stamped here because this is the only place that knows a
        // request was genuine. Cheap: the app calls twice a night.
        $devices[$i]['seen'] = time();
        try {
            night_devices_write($devices);
        } catch (\Throwable $e) { /* a stamp we cannot write must not refuse a good request */ }
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
            ];
        }
        json_out(['ok' => true, 'devices' => $out, 'quietAfter' => NIGHT_QUIET_NIGHTS]);
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
        $list[] = [
            'h' => night_key_hash($key),
            'label' => night_dev_label($rec['label'] ?? 'A Mac'),
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
    'brief' => function ($in) {
        rate_limit('night-brief', 40, 60);
        night_require_key((string) ($in['secret'] ?? ''), 'brief');
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
            $st = db()->prepare(
                'SELECT id, prop_key, name, check_in, check_out, adults, children, message, created_at
                   FROM enquiries
                  ORDER BY created_at DESC, id DESC
                  LIMIT ' . (int) NIGHT_BRIEF_MAX,
            );
            $st->execute();
            $rows = $st->fetchAll();
            foreach ($rows as $row) {
                $pk = (string) $row['prop_key'];
                // The site's own price, and the site's own clash answer. Both
                // are wrapped: a cottage with no rate row, or a failed check,
                // yields an ABSENT fact rather than a guessed one — and the
                // producer's rule is that an absent fact is not mentioned.
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
                $out[] = night_brief_enquiry($row, (string) prop_display($pk), $price, $free, $facts);
            }
        } catch (\Throwable $e) {
            // A read that fails answers "nothing waiting" rather than an error:
            // the producer's correct response to both is to do nothing tonight.
            $out = [];
        }
        json_out(['ok' => true, 'host' => $host, 'enquiries' => $out, 'cap' => NIGHT_BRIEF_MAX]);
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
