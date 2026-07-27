<?php
// ============================================================
//  watchers.php — the owner's standing queries.
//
//    POST { action: 'list' }                      -> { watchers: [...] }
//    POST { action: 'set', watcher: {...} }       -> { ok, watchers: [...] }
//    POST { action: 'stop', id: '…' }             -> { ok, watchers: [...] }
//
//  ADMIN ONLY (require_admin) — a watcher is the owner's own reminder and its
//  payload names cottages and dates. Guests can never reach it.
//
//  The rules live in watchers-lib.php (pure, unit-tested); this file is transport
//  and validation only. Declarative routing via route_actions (db.php), so an
//  unknown action can never fall through to something unintended.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/watchers-lib.php';
require_admin();

route_actions([
    'list' => function () {
        json_out(['watchers' => watchers_all()]);
    },

    'set' => function ($in) {
        $w = is_array($in['watcher'] ?? null) ? $in['watcher'] : [];
        // Whitelist the shape. Anything the client sends beyond these keys is
        // dropped rather than persisted — this row is written straight back out to
        // the owner's own UI, so it may only ever contain fields we understand.
        $iso = function ($v) {
            $v = is_string($v) ? trim($v) : '';
            return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : '';
        };
        $clean = [
            // Time-based, not random: a watcher's id has to be stable enough to
            // stop by, and unique enough not to collide with the next one.
            'id' => 'w' . substr(bin2hex(random_bytes(5)), 0, 10),
            'kind' => preg_match('/^[a-z-]{3,24}$/', (string) ($w['kind'] ?? '')) ? $w['kind'] : '',
            'pk' => preg_match('/^[a-z0-9_-]{1,40}$/i', (string) ($w['pk'] ?? '')) ? $w['pk'] : '',
            'from' => $iso($w['from'] ?? ''),
            'to' => $iso($w['to'] ?? ''),
            // What a non-date watcher is ABOUT (a booking id, a month key). Part of
            // its identity, so two balance watchers can't collide — see watchers_key.
            'ref' => preg_match('/^[a-z0-9_-]{1,40}$/i', (string) ($w['ref'] ?? '')) ? $w['ref'] : '',
            'tell' => $iso($w['tell'] ?? ''),
            'say' => mb_substr(clean((string) ($w['say'] ?? '')), 0, 140),
            'at' => date('Y-m-d'),
        ];
        if ($clean['kind'] === '' || $clean['tell'] === '') {
            json_out(['error' => 'A watcher needs something to watch and a day to tell you.'], 400);
        }
        // Never let one be set for a day that has already gone — it would fire on
        // the very next cron run, which is not what "tell me on Friday" means.
        if ($clean['tell'] < date('Y-m-d')) {
            json_out(['error' => 'That day has already passed.'], 400);
        }
        $list = watchers_merge(watchers_all(), $clean);
        watchers_save($list);
        json_out(['ok' => true, 'watchers' => $list]);
    },

    'stop' => function ($in) {
        $list = watchers_remove(watchers_all(), (string) ($in['id'] ?? ''));
        watchers_save($list);
        json_out(['ok' => true, 'watchers' => $list]);
    },
]);
