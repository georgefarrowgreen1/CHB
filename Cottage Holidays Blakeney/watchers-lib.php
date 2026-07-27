<?php
// ============================================================
//  watchers-lib.php — standing queries the owner sets on a thing they care about.
//
//  "Tell me if the 3-night Jollyboat gap hasn't sold by Friday." Everything up to
//  now is REACTIVE: search answers when asked, the brief summarises when opened.
//  A watcher is the owner telling the app what to keep an eye on, which is the
//  difference between a search box and a control centre.
//
//  Assembly, not invention: chbGapScan/chbAnomalies already find the gaps,
//  cron.php already runs daily, and alert_owner()/the digest already deliver. The
//  new part is the record and the decision of when it fires.
//
//  Stored as JSON in the content table under `search-watchers` — an INTERNAL key
//  (classified in db.php), so it is owner-only by construction and
//  test-content-keys.php enforces that rather than trusting this comment.
//
//  Everything here is PURE except the two store functions, so the rules that
//  matter — when a watcher is due, when it has expired, how many may exist — are
//  testable without a database or a clock.
// ============================================================
require_once __DIR__ . '/db.php';

if (!function_exists('watchers_key')) {
    defined('WATCHERS_KEY') || define('WATCHERS_KEY', 'search-watchers');
    // A hard cap. A watcher the owner forgot they set is a notification they did
    // not ask for, and twelve of those is worse than none at all.
    defined('WATCHERS_MAX') || define('WATCHERS_MAX', 12);

    // Identity: one watcher per THING watched, not per time it was set. Asking
    // twice about the same gap must update the existing watcher rather than
    // produce two alerts on the same morning.
    function watchers_key($w)
    {
        if (!is_array($w) || empty($w['kind'])) {
            // No kind means no thing being watched. Returning the joined-empties
            // string ('|||') instead made a contentless watcher look like a valid
            // identity, so merge() happily stored it.
            return '';
        }
        // `ref` is what a non-date watcher is ABOUT — a booking id, a month key.
        // Without it every 'balance-unpaid' watcher keyed to the same empty
        // 'balance-unpaid|||' string, so asking about a second guest's balance
        // would silently REPLACE the first one's watcher.
        return implode('|', [
            (string) ($w['kind'] ?? ''),
            (string) ($w['pk'] ?? ''),
            (string) ($w['from'] ?? ''),
            (string) ($w['to'] ?? ''),
            (string) ($w['ref'] ?? ''),
        ]);
    }

    // Merge one watcher into the list: replace by identity, cap, newest last.
    function watchers_merge($list, $w)
    {
        $list = is_array($list) ? array_values(array_filter($list, 'is_array')) : [];
        $k = watchers_key($w);
        if ($k === '' || empty($w['tell'])) {
            return $list; // a watcher with nothing to watch, or no day to speak
        }
        $out = [];
        foreach ($list as $x) {
            if (watchers_key($x) !== $k) {
                $out[] = $x;
            }
        }
        $out[] = $w;
        // Oldest go first when over the cap — the newest intent is the live one.
        return count($out) > WATCHERS_MAX ? array_slice($out, -WATCHERS_MAX) : $out;
    }

    function watchers_remove($list, $id)
    {
        $list = is_array($list) ? $list : [];
        return array_values(array_filter($list, function ($x) use ($id) {
            return is_array($x) && (string) ($x['id'] ?? '') !== (string) $id;
        }));
    }

    // DUE = the day has come (or passed, if the cron missed a day) and it has not
    // already spoken. `>=` not `===` on purpose: a cron that fails on Friday must
    // still tell you on Saturday rather than silently swallowing the one alert the
    // owner actually asked for.
    function watchers_due($list, $today)
    {
        $due = [];
        foreach (is_array($list) ? $list : [] as $w) {
            if (!is_array($w) || empty($w['tell'])) {
                continue;
            }
            if (!empty($w['done'])) {
                continue;
            }
            if ((string) $w['tell'] <= (string) $today) {
                $due[] = $w;
            }
        }
        return $due;
    }

    // EXPIRED = the window it was about has passed, so it can never be useful
    // again. Cleared without speaking: "that gap you asked about is now in the
    // past" is not news, it is noise.
    function watchers_expired($list, $today)
    {
        $gone = [];
        foreach (is_array($list) ? $list : [] as $w) {
            if (!is_array($w)) {
                continue;
            }
            $end = (string) ($w['to'] ?? $w['tell'] ?? '');
            if ($end !== '' && $end < (string) $today) {
                $gone[] = $w;
            }
        }
        return $gone;
    }

    // ---- store (the only impure part) ----
    function watchers_all()
    {
        try {
            $v = content_json(WATCHERS_KEY, []);
            return is_array($v) ? array_values(array_filter($v, 'is_array')) : [];
        } catch (Throwable $e) {
            return [];
        }
    }

    function watchers_save($list)
    {
        try {
            content_set_scalar(WATCHERS_KEY, json_encode(array_values(is_array($list) ? $list : [])));
            return true;
        } catch (Throwable $e) {
            return false;
        }
    }
}
