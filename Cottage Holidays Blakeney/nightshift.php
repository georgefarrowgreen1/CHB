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

// The key the app should be using. PRIVATE (apikey- prefix), so it is
// encrypted at rest like every other credential the site stores.
function night_scoped_key()
{
    return trim((string) content_value('apikey-nightshift'));
}

// THE ONE DOOR CHECK for both machine routes. Answers 401 and logs, or
// returns the kind of key that opened it.
// Is a key ON FILE? Asked of the ROW, not of the value — a value that will not
// decrypt still means a key was configured. See night_key_kind().
function night_key_on_file()
{
    try {
        $st = db()->prepare('SELECT 1 FROM content WHERE item_key = ? LIMIT 1');
        $st->execute(['apikey-nightshift']);
        return (bool) $st->fetchColumn();
    } catch (\Throwable $e) {
        // Cannot tell. Say NO, so a database hiccup does not lock the app out
        // of a site that was working — the master fallback is the safe answer
        // to "I do not know", where it is the unsafe answer to "it is broken".
        return false;
    }
}

function night_require_key($given, $what)
{
    $kind = night_key_kind(
        $given,
        night_scoped_key(),
        defined('APP_SECRET') ? APP_SECRET : '',
        night_key_on_file(),
    );
    if ($kind === '') {
        log_activity('system', 'night.reject', 'Overnight queue: a ' . $what . ' arrived with the wrong key', [
            'actor' => 'system',
            'severity' => 'warn',
        ]);
        json_out(['error' => 'Not authorised.'], 401);
    }
    return $kind;
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
        content_set_secret('apikey-nightshift', $key);
        log_activity('system', 'night.key', 'Overnight queue: a new app key was generated', [
            'actor' => 'owner',
            'severity' => 'info',
        ]);
        json_out(['ok' => true, 'key' => $key]);
    },

    // Is one set? Never what it is.
    'key_state' => function ($in) {
        require_admin();
        json_out(['ok' => true, 'set' => strlen(night_scoped_key()) >= NIGHT_KEY_MIN]);
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
