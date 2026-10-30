<?php
// ============================================================
//  search.php — federated "deep index" search for the ⌘K palette.
//
//  Admin-only. Searches EVERY content source the owner might look for —
//  bookings (and their invoices), enquiries, guest accounts, chat messages,
//  reviews, sent emails, payments and the activity log — and returns one flat,
//  typed result list. The client maps each type to a destination; we never send
//  code back.
//
//  TWO WAYS TO MATCH (CLAUDE.md "Search stays instant at five years"). The quick
//  path runs on every pause in typing, so it reads full-text indexes
//  (migrations 151 and 152, SEARCH_FT): a word, or the start of one ("pemb" finds
//  Pemberton), an email by its start through its own index, and a figure through
//  its own column (a phone number, a postcode or a reference by LIKE, an amount
//  exactly). It read every row of every source with LIKE '%…%': 33,000 rows for a
//  word nobody wrote, on five years. "Search everything" (?deep) still matches
//  anywhere inside a word, over everything. A database without a word index reads
//  that source the old way (search_rows) rather than finding nothing.
//
//  Every source is wrapped so a missing table/column can never break the whole
//  search (older installs may not have every migration), and a source that fails
//  is logged (search_source_failed). Each source is capped; the whole response is
//  capped again. Read-only.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

// CORPUS mode (?corpus) — a bounded dump of the text-bearing history (chat
// messages, sent emails, reviews, activity log, enquiries) so the client can
// EMBED it with the on-device model and run TRUE semantic recall locally
// (meaning-based, not keyword). Text + a stable per-row handle to open it. No
// query needed; capped per source to bound the payload.
// What a result type needs, for someone with limited access: their search never
// shows an area switched off for them (expenses are the Payments screens; the
// activity log is full access; subscribers and things to do are the website).
const SEARCH_TYPE_CAP = ['expense' => 'mo.view', 'activity' => 'owner', 'subscriber' => 'we.news', 'experience' => 'we.content'];
function search_visible(array $rows)
{
    return array_values(array_filter($rows, fn($r) => !isset(SEARCH_TYPE_CAP[$r['type'] ?? '']) || admin_can(SEARCH_TYPE_CAP[$r['type']])));
}
// The engines' own stopwords of three letters or more: never indexed, so a word that is
// one can only make a required term match nothing.
const SEARCH_FT_STOP = ['about', 'are', 'com', 'for', 'from', 'how', 'that', 'the', 'this', 'was', 'what', 'when', 'where', 'who', 'will', 'with', 'und', 'www'];
/**
 * A query as a full-text index answers it: each word of three letters or digits or more
 * (the shortest an index holds), required, and matched as the start of a word
 * ("+pemb* +sarah*"). Everything but letters and digits splits words, so no character
 * of the query reaches the engine's own syntax. '' when no word is left.
 */
function search_ft_terms(string $q): string
{
    $words = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($q), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $keep = [];
    foreach ($words as $w) {
        if (mb_strlen($w) >= 3 && !in_array($w, SEARCH_FT_STOP, true)) {
            $keep['+' . $w . '*'] = true;
        }
    }
    return implode(' ', array_slice(array_keys($keep), 0, 8));
}
// The word indexes (migrations 151 and 152), by table: the columns each source's words
// are matched against, exactly as each index lists them (test-migrate holds the two
// equal). An index takes only columns that state no collation of their own, so the
// emails of bookings, enquiries and guests are found through their own index instead
// (search_mail_like).
const SEARCH_FT = [
    'bookings' => ['name', 'address', 'notes'],
    'enquiries' => ['name', 'message'],
    'guests' => ['name'],
    'messages' => ['body'],
    'guest_reviews' => ['review_text'],
    'mail_sent' => ['subject', 'to_email', 'body'],
    'activity_log' => ['summary'],
    'expenses' => ['category', 'description'],
    'waitlist' => ['name', 'email', 'note'],
];
/**
 * A source's words as SQL: its full-text index, or (when $indexed is false) the LIKE the
 * index replaced, over the same columns. Returns [condition, parameters].
 * @return array{0: string, 1: list<string>}
 */
function search_words(string $table, string $alias, bool $indexed, string $ft, string $like): array
{
    $cols = array_map(fn($c) => ($alias !== '' ? $alias . '.' : '') . $c, SEARCH_FT[$table]);
    if ($indexed) {
        return ['MATCH(' . implode(', ', $cols) . ') AGAINST(? IN BOOLEAN MODE)', [$ft]];
    }
    return ['(' . implode(' OR ', array_map(fn($c) => "$c LIKE ?", $cols)) . ')', array_fill(0, count($cols), $like)];
}
/**
 * A source's rows, read through its word index, or without it when the database has no
 * such index (error 1191: a migration that has not run, or failed). Finding nothing
 * there would read as "no such guest", which is how a week of search went quiet when
 * migration-151 failed on the live database.
 */
function search_rows(callable $query): array
{
    try {
        return $query(true);
    } catch (\PDOException $e) {
        if ((int) ($e->errorInfo[1] ?? 0) !== 1191) {
            throw $e;
        }
        return $query(false);
    }
}
/**
 * The query as the start of an email address, for a LIKE on an email column's own index
 * ('' when it cannot be one: under three characters, or holding a space).
 */
function search_mail_like(string $q): string
{
    $q = mb_strtolower(trim($q));
    if (mb_strlen($q) < 3 || preg_match('/\s/u', $q)) {
        return '';
    }
    return addcslashes($q, '%_\\') . '%';
}
/**
 * A source that failed is said once an hour (Needs attention), never swallowed in
 * silence: the search goes on with the others, but a source that keeps failing is
 * results the owner never sees.
 */
function search_source_failed(\Throwable $e): void
{
    chb_log_server_error('Search source', $e->getMessage(), $e->getFile(), $e->getLine());
}
if (!empty($_GET['corpus']) || !empty(body()['corpus'] ?? null)) {
    $out = [];
    $cap = 300;
    $add = function ($type, $id, $text, $date, $extra = []) use (&$out) {
        $text = trim(preg_replace('/\s+/', ' ', (string) $text));
        if ($text === '') {
            return;
        }
        $out[] = array_merge(['type' => $type, 'id' => (int) $id, 'text' => mb_substr($text, 0, 600), 'date' => substr((string) $date, 0, 10)], $extra);
    };
    $safe = function (callable $fn) {
        try {
            $fn();
        } catch (\Throwable $e) {
            search_source_failed($e); // one failing source must not sink the whole dump
        }
    };
    $safe(function () use ($add, $cap) {
        foreach (db()->query("SELECT thread_id, body, created_at FROM messages WHERE body <> '' AND thread_id IS NOT NULL ORDER BY id DESC LIMIT $cap") as $m) {
            $add('message', $m['thread_id'], $m['body'], $m['created_at']);
        }
    });
    $safe(function () use ($add, $cap) {
        foreach (db()->query("SELECT id, prop_key, review_text, created_at FROM guest_reviews WHERE review_text <> '' ORDER BY id DESC LIMIT $cap") as $r) {
            $add('review', $r['id'], $r['review_text'], $r['created_at'], ['prop' => $r['prop_key']]);
        }
    });
    $safe(function () use ($add, $cap) {
        foreach (db()->query("SELECT id, to_email, subject, body, sent_at FROM mail_sent ORDER BY id DESC LIMIT $cap") as $e) {
            $add('email', $e['id'], ($e['subject'] ?? '') . ' — ' . strip_tags((string) ($e['body'] ?? '')), $e['sent_at'], ['to' => $e['to_email'], 'subject' => $e['subject']]);
        }
    });
    $safe(function () use ($add, $cap) {
        foreach (db()->query("SELECT id, summary, created_at FROM activity_log WHERE summary <> '' ORDER BY id DESC LIMIT $cap") as $a) {
            $add('activity', $a['id'], $a['summary'], $a['created_at']);
        }
    });
    $safe(function () use ($add, $cap) {
        foreach (db()->query("SELECT id, name, message, created_at FROM enquiries WHERE message IS NOT NULL AND message <> '' ORDER BY id DESC LIMIT $cap") as $q2) {
            $add('enquiry', $q2['id'], ($q2['name'] ?? '') . ': ' . $q2['message'], $q2['created_at'], ['name' => $q2['name']]);
        }
    });
    json_out(['ok' => true, 'corpus' => search_visible($out)]);
}

$q = trim((string) ($_GET['q'] ?? (body()['q'] ?? '')));
if (mb_strlen($q) < 2) {
    json_out(['ok' => true, 'results' => []]);
}
// Escape LIKE wildcards so a stray % / _ in the query is treated literally.
$like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
// DEEP mode (?deep) runs a heavier multi-term engine below; `expand` asks for one
// source only (the "show more" load); the quick top-hits path is used otherwise.
$deep = !empty($_GET['deep']) || !empty(body()['deep'] ?? null);
$expand = preg_replace('/[^a-z]/', '', strtolower((string) ($_GET['expand'] ?? (body()['expand'] ?? ''))));
$PER = 6; // per-source cap (quick mode)
$results = [];
// The quick path's words, as a full-text index answers them (search_ft_terms), and
// whether the query holds a figure (a phone number, a postcode, a reference, an amount).
$ft = search_ft_terms($q);
$digits = (bool) preg_match('/\d/', $q);
$snip = function ($s, $n = 90) {
    $s = trim(preg_replace('/\s+/', ' ', (string) $s));
    return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s;
};
$src = function (callable $fn) {
    try {
        $fn();
    } catch (\Throwable $e) {
        search_source_failed($e); // one failing source must never break the rest of the search
    }
};
// The query as the start of an email address (search_mail_like).
$mail = search_mail_like($q);

// ============================================================
//  DEEP SEARCH (?deep) — the "search everything" mode behind the palette's quick
//  top-hits. Differs from the quick path in four ways:
//   • MULTI-TERM: every whitespace term must match SOME column (AND-of-ORs), so
//     "smith deposit" finds the Smith booking whose note mentions a deposit.
//   • COUNTS: each source reports its TOTAL match count (not just the shown page).
//   • DEEPER: higher per-source cap; `expand=<type>` pages one source further.
//   • SNIPPETS: body sources return a passage centred on the first matched term.
//  Read-only; each source is still wrapped so one bad table can't sink the rest.
// ============================================================
if ($deep) {
    $terms = array_slice(array_values(array_filter(preg_split('/\s+/', $q), fn($t) => $t !== '')), 0, 6);
    if (!$terms) {
        json_out(['ok' => true, 'deep' => true, 'results' => [], 'counts' => (object) []]);
    }
    $mkLike = fn($t) => '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $t) . '%';
    // The client sends its shared query-understanding: a { word: [synonyms] } map,
    // so each term is satisfied by the term OR any of its synonyms ("revenue" also
    // finds "income"/"money"). Same intelligence client + server; capped for safety.
    $syn = body()['syn'] ?? ($_GET['syn'] ?? []);
    if (!is_array($syn)) {
        $syn = [];
    }
    // Optional recency window (the palette's All time / 12 months / 90 days
    // chips): a validated ISO date each source with a date column ANDs in.
    $sinceIn = body()['since'] ?? ($_GET['since'] ?? '');
    $since = is_string($sinceIn) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $sinceIn) ? $sinceIn : '';
    // Per term: a group of LIKE patterns = the term itself + up to 4 synonyms.
    $groups = array_map(function ($t) use ($syn, $mkLike) {
        $pats = [$mkLike($t)];
        $alts = $syn[$t] ?? ($syn[mb_strtolower($t)] ?? []);
        if (is_array($alts)) {
            foreach (array_slice($alts, 0, 4) as $a) {
                if (is_string($a) && $a !== '') {
                    $pats[] = $mkLike($a);
                }
            }
        }
        return $pats;
    }, $terms);
    // Build "(cA LIKE ? OR cB LIKE ? OR …synonyms…) AND (…)" + its bound params.
    // Every term must match SOME column via its OWN pattern OR a synonym pattern.
    $wt = function (array $cols) use ($groups) {
        $clauses = [];
        $params = [];
        foreach ($groups as $pats) {
            $ors = [];
            foreach ($cols as $c) {
                foreach ($pats as $pat) {
                    $ors[] = "$c LIKE ?";
                    $params[] = $pat;
                }
            }
            $clauses[] = '(' . implode(' OR ', $ors) . ')';
        }
        return [implode(' AND ', $clauses), $params];
    };
    // A ~120-char passage centred on the first matched term (so the match is visible).
    $around = function ($s, $n = 120) use ($terms) {
        $s = trim(preg_replace('/\s+/', ' ', (string) $s));
        if ($s === '') {
            return '';
        }
        $pos = false;
        foreach ($terms as $t) {
            $p = mb_stripos($s, $t);
            if ($p !== false && ($pos === false || $p < $pos)) {
                $pos = $p;
            }
        }
        if ($pos === false || $pos <= $n / 3) {
            return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s;
        }
        $start = max(0, (int) ($pos - $n / 3));
        $out = '…' . mb_substr($s, $start, $n);
        return mb_strlen($s) > $start + $n ? $out . '…' : $out;
    };
    // One descriptor per source: how to find it, present it, and (optionally) an
    // `extra` WHERE fragment and a `snip` column for the matched passage.
    $sources = [
        ['type' => 'booking', 'from' => 'bookings', 'dcol' => 'check_in', 'select' => 'id, prop_key, name, email, check_in',
            'cols' => ['name', 'email', 'phone', 'address', 'postcode', 'notes', "CONCAT('chb-', LPAD(id, 6, '0'))"],
            'order' => '(check_in >= CURDATE()) DESC, check_in ASC',
            'map' => fn($b) => ['type' => 'booking', 'id' => (int) $b['id'], 'title' => $b['name'] ?: '(no name)',
                'sub' => 'CHB-' . str_pad((string) $b['id'], 6, '0', STR_PAD_LEFT) . ' · ' . prop_display($b['prop_key'])['name'] . ($b['check_in'] ? ' · ' . uk_date($b['check_in']) : '')]],
        ['type' => 'enquiry', 'from' => 'enquiries', 'dcol' => 'created_at', 'select' => 'id, prop_key, name, email, message', 'cols' => ['name', 'email', 'message'], 'order' => 'id DESC',
            'map' => fn($e) => ['type' => 'enquiry', 'id' => (int) $e['id'], 'title' => $e['name'] ?: '(no name)', 'sub' => 'Enquiry · ' . prop_display($e['prop_key'])['name'], 'snip' => $around($e['message'])]],
        ['type' => 'guest', 'from' => 'guests', 'dcol' => 'created_at', 'select' => 'id, name, email, phone', 'cols' => ['name', 'email', 'phone'], 'order' => 'id DESC',
            'map' => fn($g) => ['type' => 'guest', 'id' => (int) $g['id'], 'email' => $g['email'], 'title' => $g['name'] ?: $g['email'], 'sub' => 'Guest account · ' . $g['email']]],
        ['type' => 'message', 'from' => 'messages m LEFT JOIN chat_threads t ON t.id = m.thread_id LEFT JOIN guests g ON g.id = m.guest_id', 'dcol' => 'm.created_at',
            'select' => 'm.thread_id, m.body, m.sender_role, COALESCE(t.name, g.name) AS who', 'cols' => ['m.body', 'COALESCE(t.name, g.name)'], 'extra' => 'm.thread_id IS NOT NULL', 'order' => 'm.id DESC',
            'map' => fn($m) => ['type' => 'message', 'thread_id' => (int) $m['thread_id'], 'title' => mb_substr(trim(preg_replace('/\s+/', ' ', (string) $m['body'])), 0, 90),
                'sub' => 'Chat · ' . ($m['who'] ?: 'Visitor') . ($m['sender_role'] === 'admin' ? ' (you)' : ''), 'snip' => $around($m['body'])]],
        ['type' => 'review', 'from' => 'guest_reviews', 'dcol' => 'created_at', 'select' => 'id, prop_key, review_text', 'cols' => ['review_text'], 'order' => 'id DESC',
            'map' => fn($r) => ['type' => 'review', 'id' => (int) $r['id'], 'title' => mb_substr(trim(preg_replace('/\s+/', ' ', (string) $r['review_text'])), 0, 90), 'sub' => 'Review · ' . prop_display($r['prop_key'])['name'], 'snip' => $around($r['review_text'])]],
        ['type' => 'email', 'from' => 'mail_sent', 'dcol' => 'sent_at', 'select' => 'id, to_email, subject, body', 'cols' => ['subject', 'to_email', 'body'], 'order' => 'id DESC',
            'map' => fn($m) => ['type' => 'email', 'id' => (int) $m['id'], 'title' => $m['subject'] ?: '(no subject)', 'sub' => 'Email · to ' . $m['to_email'], 'snip' => $around($m['body'])]],
        ['type' => 'payment', 'from' => 'payments p LEFT JOIN bookings b ON b.id = p.booking_id', 'dcol' => 'p.created_at', 'select' => 'p.id, p.booking_id, p.amount, p.kind, b.name',
            'cols' => ['p.square_payment_id', 'CAST(p.amount AS CHAR)', 'b.name'], 'order' => 'p.id DESC',
            'map' => fn($p) => ['type' => 'payment', 'booking_id' => (int) $p['booking_id'], 'title' => '£' . number_format((float) $p['amount'], 2) . ' ' . $p['kind'], 'sub' => 'Payment · ' . ($p['name'] ?: 'booking #' . $p['booking_id'])]],
        ['type' => 'activity', 'from' => 'activity_log', 'dcol' => 'created_at', 'select' => 'id, summary, category, created_at', 'cols' => ['summary'], 'order' => 'id DESC',
            'map' => fn($a) => ['type' => 'activity', 'id' => (int) $a['id'], 'title' => mb_substr(trim(preg_replace('/\s+/', ' ', (string) $a['summary'])), 0, 90), 'sub' => 'Activity · ' . uk_date(substr((string) $a['created_at'], 0, 10)), 'snip' => $around($a['summary'])]],
        ['type' => 'expense', 'from' => 'expenses', 'dcol' => 'expense_date', 'select' => 'id, category, description, amount, expense_date', 'cols' => ['category', 'description', 'CAST(amount AS CHAR)'], 'order' => 'expense_date DESC, id DESC',
            'map' => fn($e) => ['type' => 'expense', 'id' => (int) $e['id'], 'title' => '£' . number_format((float) $e['amount'], 2) . ' · ' . ($e['category'] ?: 'Expense'), 'sub' => 'Expense · ' . ($e['expense_date'] ? uk_date($e['expense_date']) : ''), 'snip' => $around($e['description'])]],
        ['type' => 'waitlist', 'from' => 'waitlist', 'dcol' => 'created_at', 'select' => 'id, prop_key, name, email, check_in', 'cols' => ['name', 'email', 'note'], 'order' => 'id DESC',
            'map' => fn($w) => ['type' => 'waitlist', 'id' => (int) $w['id'], 'title' => ($w['name'] ?: $w['email']) ?: 'Waitlist entry', 'sub' => 'Waitlist · ' . prop_display($w['prop_key'])['name'] . ($w['check_in'] ? ' · ' . uk_date($w['check_in']) : '')]],
        ['type' => 'subscriber', 'from' => 'newsletter_subscribers', 'dcol' => 'created_at', 'select' => 'id, email, name, unsubscribed_at', 'cols' => ['email', 'name'], 'order' => 'id DESC',
            'map' => fn($s) => ['type' => 'subscriber', 'id' => (int) $s['id'], 'title' => $s['name'] ?: $s['email'], 'sub' => 'Subscriber · ' . $s['email'] . ($s['unsubscribed_at'] ? ' · unsubscribed' : '')]],
        ['type' => 'experience', 'from' => 'experiences', 'dcol' => 'created_at', 'select' => 'id, title, category, status, body', 'cols' => ['title', 'body', 'category'], 'order' => "(status = 'pending') DESC, id DESC",
            'map' => fn($x) => ['type' => 'experience', 'id' => (int) $x['id'], 'title' => $x['title'] ?: '(untitled)', 'sub' => 'Experience · ' . ($x['category'] ?: 'Local') . ($x['status'] === 'pending' ? ' · awaiting approval' : ''), 'snip' => $around($x['body'] ?? '')]],
    ];
    $counts = [];
    foreach ($sources as $s) {
        if ($expand && $s['type'] !== $expand) {
            continue;
        }
        $src(function () use (&$results, &$counts, $s, $wt, $expand, $since) {
            [$whereSql, $params] = $wt($s['cols']);
            if (!empty($s['extra'])) {
                $whereSql .= ' AND ' . $s['extra'];
            }
            // Recency window — only where the source HAS a date column ($since is
            // regex-validated ISO, the column name is our own literal).
            if ($since !== '' && !empty($s['dcol'])) {
                $whereSql .= ' AND ' . $s['dcol'] . ' >= ?';
                $params[] = $since;
            }
            $cap = $expand ? 60 : 20;
            try {
                $cst = db()->prepare('SELECT COUNT(*) FROM ' . $s['from'] . ' WHERE ' . $whereSql);
                $cst->execute($params);
                $counts[$s['type']] = (int) $cst->fetchColumn();
            } catch (\Throwable $e) {
            }
            $st = db()->prepare('SELECT ' . $s['select'] . ' FROM ' . $s['from'] . ' WHERE ' . $whereSql . ' ORDER BY ' . $s['order'] . ' LIMIT ' . $cap);
            $st->execute($params);
            foreach ($st->fetchAll() as $row) {
                $results[] = ($s['map'])($row);
            }
        });
    }
    foreach (SEARCH_TYPE_CAP as $t => $c) {
        if (!admin_can($c)) {
            unset($counts[$t]);
        }
    }
    json_out(['ok' => true, 'deep' => true, 'q' => $q, 'results' => search_visible($results), 'counts' => (object) $counts]);
}

// 1) Bookings — each stay is also its invoice. Name, address and notes by their words,
// the email by its start; a phone number, a postcode or a reference (CHB-000123) only
// when the query holds a figure, as each can use its own index or is cheap enough alone.
$src(function () use (&$results, $like, $PER, $q, $ft, $mail, $digits) {
    $rows = search_rows(function (bool $indexed) use ($like, $PER, $q, $ft, $mail, $digits) {
        $parts = [];
        $params = [];
        $cols = 'SELECT id, prop_key, name, email, phone, check_in FROM bookings WHERE ';
        if ($ft !== '') {
            [$w, $wp] = search_words('bookings', '', $indexed, $ft, $like);
            $parts[] = $cols . $w;
            array_push($params, ...$wp);
        }
        if ($mail !== '') {
            $parts[] = $cols . 'email LIKE ?';
            $params[] = $mail;
        }
        if ($digits) {
            // The reference without its hyphen on both sides: "CHB-000123", "chb000123" and
            // "000123" all find it (the hyphen kept on one side only matched nothing).
            $parts[] = $cols . "phone LIKE ? OR postcode LIKE ? OR CONCAT('chb', LPAD(id, 6, '0')) LIKE ?";
            array_push($params, $like, $like, '%' . strtolower(preg_replace('/[^0-9a-z]/i', '', $q)) . '%');
        }
        if (!$parts) {
            return [];
        }
        $st = db()->prepare('SELECT * FROM ((' . implode(') UNION (', $parts) . ")) u ORDER BY (u.check_in >= CURDATE()) DESC, u.check_in ASC LIMIT $PER");
        $st->execute($params);
        return $st->fetchAll();
    });
    foreach ($rows as $b) {
        $results[] = [
            'type' => 'booking',
            'id' => (int) $b['id'],
            'title' => $b['name'] ?: '(no name)',
            'sub' => 'CHB-' . str_pad((string) $b['id'], 6, '0', STR_PAD_LEFT) . ' · ' . prop_display($b['prop_key'])['name'] . ($b['check_in'] ? ' · ' . uk_date($b['check_in']) : ''),
        ];
    }
});

// 2) Enquiries — name and their message by their words, the email by its start.
$src(function () use (&$results, $like, $ft, $mail, $PER) {
    $rows = search_rows(function (bool $indexed) use ($like, $ft, $mail, $PER) {
        $parts = [];
        $params = [];
        $cols = 'SELECT id, prop_key, name, email FROM enquiries WHERE ';
        if ($ft !== '') {
            [$w, $wp] = search_words('enquiries', '', $indexed, $ft, $like);
            $parts[] = $cols . $w;
            array_push($params, ...$wp);
        }
        if ($mail !== '') {
            $parts[] = $cols . 'email LIKE ?';
            $params[] = $mail;
        }
        if (!$parts) {
            return [];
        }
        $st = db()->prepare('SELECT * FROM ((' . implode(') UNION (', $parts) . ')) u ORDER BY u.id DESC LIMIT ' . $PER);
        $st->execute($params);
        return $st->fetchAll();
    });
    foreach ($rows as $e) {
        $results[] = ['type' => 'enquiry', 'id' => (int) $e['id'], 'title' => $e['name'] ?: '(no name)', 'sub' => 'Enquiry · ' . prop_display($e['prop_key'])['name']];
    }
});

// 3) Guest accounts — the name by its words, the email by its start, a phone number when
// the query holds a figure.
$src(function () use (&$results, $like, $PER, $ft, $mail, $digits) {
    $rows = search_rows(function (bool $indexed) use ($like, $PER, $ft, $mail, $digits) {
        $parts = [];
        $params = [];
        $cols = 'SELECT id, name, email, phone FROM guests WHERE ';
        if ($ft !== '') {
            [$w, $wp] = search_words('guests', '', $indexed, $ft, $like);
            $parts[] = $cols . $w;
            array_push($params, ...$wp);
        }
        if ($mail !== '') {
            $parts[] = $cols . 'email LIKE ?';
            $params[] = $mail;
        }
        if ($digits) {
            $parts[] = $cols . 'phone LIKE ?';
            $params[] = $like;
        }
        if (!$parts) {
            return [];
        }
        $st = db()->prepare('SELECT * FROM ((' . implode(') UNION (', $parts) . ')) u ORDER BY u.id DESC LIMIT ' . $PER);
        $st->execute($params);
        return $st->fetchAll();
    });
    foreach ($rows as $g) {
        $results[] = ['type' => 'guest', 'id' => (int) $g['id'], 'email' => $g['email'], 'title' => $g['name'] ?: $g['email'], 'sub' => 'Guest account · ' . $g['email']];
    }
});

// 4) Chat messages — the message text; jump to its thread.
$src(function () use (&$results, $like, $ft, $PER, $snip) {
    if ($ft === '') {
        return;
    }
    $rows = search_rows(function (bool $indexed) use ($like, $ft, $PER) {
        [$w, $wp] = search_words('messages', 'm', $indexed, $ft, $like);
        $st = db()->prepare(
            'SELECT m.thread_id, m.body, m.sender_role, COALESCE(t.name, g.name) AS who
             FROM messages m
             LEFT JOIN chat_threads t ON t.id = m.thread_id
             LEFT JOIN guests g ON g.id = m.guest_id
             WHERE ' . $w . ' AND m.thread_id IS NOT NULL
             ORDER BY m.id DESC LIMIT ' . $PER,
        );
        $st->execute($wp);
        return $st->fetchAll();
    });
    foreach ($rows as $m) {
        $results[] = [
            'type' => 'message',
            'thread_id' => (int) $m['thread_id'],
            'title' => $snip($m['body']),
            'sub' => 'Chat · ' . ($m['who'] ?: 'Visitor') . ($m['sender_role'] === 'admin' ? ' (you)' : ''),
        ];
    }
});

// 5) Reviews — the review text.
$src(function () use (&$results, $like, $ft, $PER, $snip) {
    if ($ft === '') {
        return;
    }
    $rows = search_rows(function (bool $indexed) use ($like, $ft, $PER) {
        [$w, $wp] = search_words('guest_reviews', '', $indexed, $ft, $like);
        $st = db()->prepare('SELECT id, prop_key, review_text FROM guest_reviews WHERE ' . $w . ' ORDER BY id DESC LIMIT ' . $PER);
        $st->execute($wp);
        return $st->fetchAll();
    });
    foreach ($rows as $r) {
        $results[] = ['type' => 'review', 'id' => (int) $r['id'], 'title' => $snip($r['review_text']), 'sub' => 'Review · ' . prop_display($r['prop_key'])['name']];
    }
});

// 6) Sent emails — subject, recipient, body (the mail_sent trail).
$src(function () use (&$results, $like, $ft, $PER) {
    if ($ft === '') {
        return;
    }
    $rows = search_rows(function (bool $indexed) use ($like, $ft, $PER) {
        [$w, $wp] = search_words('mail_sent', '', $indexed, $ft, $like);
        $st = db()->prepare('SELECT id, to_email, subject FROM mail_sent WHERE ' . $w . ' ORDER BY id DESC LIMIT ' . $PER);
        $st->execute($wp);
        return $st->fetchAll();
    });
    foreach ($rows as $m) {
        $results[] = ['type' => 'email', 'id' => (int) $m['id'], 'title' => $m['subject'] ?: '(no subject)', 'sub' => 'Email · to ' . $m['to_email']];
    }
});

// 7) Payments — by the exact amount ("£45", "45.50") or the start of Square's reference;
// jump to the booking. Each reads its own index. (A part of an amount found 145.00 and
// 312.45 for "45", reading every payment there has been.)
$src(function () use (&$results, $PER, $q, $digits) {
    if (!$digits) {
        return;
    }
    $parts = [];
    $params = [];
    $cols = 'SELECT p.id, p.booking_id, p.amount, p.kind, b.name FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE ';
    $fig = str_replace([',', ' '], '', trim($q));
    if (preg_match('/^£?(\d{1,7}(?:\.\d{1,2})?)$/u', $fig, $m)) {
        $parts[] = $cols . 'p.amount = ?';
        $params[] = number_format((float) $m[1], 2, '.', '');
    }
    if (preg_match('/^[A-Za-z0-9_-]{6,}$/', trim($q))) {
        $parts[] = $cols . 'p.square_payment_id LIKE ?';
        $params[] = addcslashes(trim($q), '%_\\') . '%';
    }
    if (!$parts) {
        return;
    }
    $st = db()->prepare('SELECT * FROM ((' . implode(') UNION (', $parts) . ')) u ORDER BY u.id DESC LIMIT ' . $PER);
    $st->execute($params);
    foreach ($st->fetchAll() as $p) {
        $results[] = [
            'type' => 'payment',
            'booking_id' => (int) $p['booking_id'],
            'title' => '£' . number_format((float) $p['amount'], 2) . ' ' . $p['kind'],
            'sub' => 'Payment · ' . ($p['name'] ?: 'booking #' . $p['booking_id']),
        ];
    }
});

// 8) Activity log — anything that happened in the last 13 months. The quick path
// runs on keystrokes, and a rare word walked the whole log (three years, up to
// 200,000 rows); "search everything" (deep) still reads all of it.
$src(function () use (&$results, $like, $ft, $PER, $snip) {
    if ($ft === '') {
        return;
    }
    $rows = search_rows(function (bool $indexed) use ($like, $ft, $PER) {
        [$w, $wp] = search_words('activity_log', '', $indexed, $ft, $like);
        $st = db()->prepare('SELECT id, summary, category, created_at FROM activity_log WHERE ' . $w . ' AND created_at >= (NOW() - INTERVAL 13 MONTH) ORDER BY created_at DESC, id DESC LIMIT ' . $PER);
        $st->execute($wp);
        return $st->fetchAll();
    });
    foreach ($rows as $a) {
        $results[] = ['type' => 'activity', 'id' => (int) $a['id'], 'title' => $snip($a['summary']), 'sub' => 'Activity · ' . uk_date(substr((string) $a['created_at'], 0, 10))];
    }
});

// 9) Expenses — category / description; jump to Payments → Expenses.
$src(function () use (&$results, $like, $ft, $PER, $snip) {
    if ($ft === '') {
        return;
    }
    $rows = search_rows(function (bool $indexed) use ($like, $ft, $PER) {
        [$w, $wp] = search_words('expenses', '', $indexed, $ft, $like);
        $st = db()->prepare('SELECT id, category, description, amount, expense_date FROM expenses WHERE ' . $w . ' ORDER BY expense_date DESC, id DESC LIMIT ' . $PER);
        $st->execute($wp);
        return $st->fetchAll();
    });
    foreach ($rows as $e) {
        $results[] = [
            'type' => 'expense',
            'id' => (int) $e['id'],
            'title' => '£' . number_format((float) $e['amount'], 2) . ' · ' . ($e['category'] ?: 'Expense') . ($e['description'] ? ' — ' . $snip($e['description'], 40) : ''),
            'sub' => 'Expense · ' . ($e['expense_date'] ? uk_date($e['expense_date']) : ''),
        ];
    }
});

// 10) Waitlist — sold-out demand; name, email, note.
$src(function () use (&$results, $like, $ft, $PER) {
    if ($ft === '') {
        return;
    }
    $rows = search_rows(function (bool $indexed) use ($like, $ft, $PER) {
        [$w, $wp] = search_words('waitlist', '', $indexed, $ft, $like);
        $st = db()->prepare('SELECT id, prop_key, name, email, check_in FROM waitlist WHERE ' . $w . ' ORDER BY id DESC LIMIT ' . $PER);
        $st->execute($wp);
        return $st->fetchAll();
    });
    foreach ($rows as $w) {
        $results[] = [
            'type' => 'waitlist',
            'id' => (int) $w['id'],
            'title' => ($w['name'] ?: $w['email']) ?: 'Waitlist entry',
            'sub' => 'Waitlist · ' . prop_display($w['prop_key'])['name'] . ($w['check_in'] ? ' · ' . uk_date($w['check_in']) : ''),
        ];
    }
});

// 11) Newsletter subscribers — email / name.
$src(function () use (&$results, $like, $PER) {
    $st = db()->prepare('SELECT id, email, name, unsubscribed_at FROM newsletter_subscribers WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT ' . $PER);
    $st->execute([$like, $like]);
    foreach ($st->fetchAll() as $s) {
        $results[] = [
            'type' => 'subscriber',
            'id' => (int) $s['id'],
            'title' => $s['name'] ?: $s['email'],
            'sub' => 'Subscriber · ' . $s['email'] . ($s['unsubscribed_at'] ? ' · unsubscribed' : ''),
        ];
    }
});

// 12) Experiences (things to do) — title, body, category; flag pending ones.
$src(function () use (&$results, $like, $PER) {
    $st = db()->prepare('SELECT id, title, category, status FROM experiences WHERE title LIKE ? OR body LIKE ? OR category LIKE ? ORDER BY (status = \'pending\') DESC, id DESC LIMIT ' . $PER);
    $st->execute([$like, $like, $like]);
    foreach ($st->fetchAll() as $x) {
        $results[] = [
            'type' => 'experience',
            'id' => (int) $x['id'],
            'title' => $x['title'] ?: '(untitled)',
            'sub' => 'Experience · ' . ($x['category'] ?: 'Local') . ($x['status'] === 'pending' ? ' · awaiting approval' : ''),
        ];
    }
});

json_out(['ok' => true, 'results' => array_slice(search_visible($results), 0, 40)]);
