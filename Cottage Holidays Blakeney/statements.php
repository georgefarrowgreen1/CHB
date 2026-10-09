<?php
// ============================================================
//  statements.php — the business bank account, read from the statements the
//  owner exports (Monzo Business: ⋯ on the business card → Bank statements → CSV).
//
//  POST {action:'status'}                    -> settings, the latest statement, whether
//                                               one is due, and the payments to show
//  POST {action:'preview', csv, filename, since} -> what adding this file would do;
//                                               writes nothing
//  POST {action:'import', csv, filename, since, op_id} -> add it (exactly once)
//  POST {action:'mark', id, as, booking_id, expense_id, label} -> the owner sorted one
//  POST {action:'unmark', id}                -> put it back to sort
//  POST {action:'settings', remind}          -> the reminder on the 1st
//  POST {action:'remove'}                    -> stop asking for statements (keeps
//                                               the payments already added)
//
//  The statement is READ ONCE and kept as payments: the app never signs in to the
//  bank. A payment already added is never added again (Monzo's transaction id, or
//  a fingerprint when a file has none), so statements may overlap freely.
//  What a payment IS (a guest's transfer, an expense) is decided by the owner on
//  the Payments page; recording it goes through the existing endpoints
//  (bookings.php set_payment, expenses.php add) and only the link lands here.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/statement-lib.php';
require_admin();

const STMT_MAX_BYTES = 4000000;
const STMT_SORTS = ['payment', 'expense', 'platform', 'ignore', 'tax', 'income'];

function stmt_settings(): array
{
    $s = content_json('bank-statements', []);
    return [
        'on' => !empty($s['on']),
        'remind' => !array_key_exists('remind', $s) || !empty($s['remind']),
        'reminded' => (string) ($s['reminded'] ?? ''),
    ];
}
function stmt_save(array $s): void
{
    content_set_scalar('bank-statements', $s);
}
function stmt_ready(): bool
{
    try {
        db()->query('SELECT 1 FROM bank_lines LIMIT 1');
        db()->query('SELECT 1 FROM bank_imports LIMIT 1');
        return true;
    } catch (\Throwable $e) {
        return false;
    }
}
function stmt_need_ready(): void
{
    if (!stmt_ready()) {
        json_out(['error' => 'Bank statements need a database update first. Open Manage → Status and run the updates.'], 409);
    }
}
function stmt_row(array $r): array
{
    return [
        'id' => (int) $r['id'],
        'date' => (string) $r['txn_date'],
        'time' => (string) $r['txn_time'],
        'type' => (string) $r['kind'],
        'name' => (string) $r['name'],
        'category' => (string) $r['category'],
        'description' => (string) $r['description'],
        'notes' => (string) $r['notes'],
        'amount' => round((float) $r['amount'], 2),
        'as' => $r['sorted_as'] !== null ? (string) $r['sorted_as'] : null,
        'booking_id' => $r['booking_id'] !== null ? (int) $r['booking_id'] : null,
        'expense_id' => $r['expense_id'] !== null ? (int) $r['expense_id'] : null,
        'label' => (string) ($r['sorted_label'] ?? ''),
    ];
}
// The text of the uploaded file, refused in words when it is not one.
function stmt_csv(array $in): string
{
    $csv = $in['csv'] ?? '';
    if (!is_string($csv) || $csv === '') {
        json_out(['error' => 'Choose the statement file first.'], 400);
    }
    if (strlen($csv) > STMT_MAX_BYTES) {
        json_out(['error' => 'That file is too big. Export a shorter stretch of dates.'], 400);
    }
    return $csv;
}
function stmt_since(array $in): string
{
    $s = (string) ($in['since'] ?? '');
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) ? $s : '';
}
// Which of these keys are already stored. Chunked so a year's statement is a
// handful of queries, not hundreds.
function stmt_known(array $keys): array
{
    $known = [];
    foreach (array_chunk(array_values(array_unique($keys)), 400) as $chunk) {
        $q = db()->prepare('SELECT ext_key FROM bank_lines WHERE ext_key IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')');
        $q->execute($chunk);
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $k) {
            $known[(string) $k] = true;
        }
    }
    return $known;
}
// Parse, split into new / already here / before the start date, and total up.
function stmt_plan(array $in): array
{
    $p = statement_parse(stmt_csv($in), (string) ($in['filename'] ?? ''));
    if (!$p['ok']) {
        json_out(['error' => $p['error']], 400);
    }
    $since = stmt_since($in);
    $known = stmt_known(array_column($p['lines'], 'ext_key'));
    $new = [];
    $already = 0;
    $older = 0;
    foreach ($p['lines'] as $l) {
        if (isset($known[$l['ext_key']])) {
            $already++;
        } elseif ($since !== '' && $l['date'] < $since) {
            $older++;
        } else {
            $new[] = $l;
        }
    }
    return [$p, $new, $already, $older, $since];
}
function stmt_summary(array $p, array $new, int $already, int $older): array
{
    return [
        'from' => $p['from'],
        'to' => $p['to'],
        'rows' => count($p['lines']),
        'adding' => count($new),
        'already' => $already,
        'older' => $older,
        'money_in' => $p['money_in'],
        'money_out' => $p['money_out'],
        'balance' => $p['balance'],
        'balance_at' => $p['balance_at'],
        'unreadable' => $p['unreadable'],
        'other_currency' => $p['other_currency'],
    ];
}

route_actions([
    'status' => function ($in) {
        $set = stmt_settings();
        if (!stmt_ready()) {
            json_out(['ok' => true, 'ready' => false, 'on' => false]);
        }
        $last = db()->query('SELECT * FROM bank_imports ORDER BY to_date DESC, id DESC LIMIT 1')->fetch() ?: null;
        $bal = db()->query('SELECT closing_balance, closing_at FROM bank_imports WHERE closing_balance IS NOT NULL ORDER BY closing_at DESC, id DESC LIMIT 1')->fetch() ?: null;
        $first = db()->query('SELECT MIN(txn_date) FROM bank_lines')->fetchColumn();
        $uploads = (int) db()->query('SELECT COUNT(*) FROM bank_imports')->fetchColumn();
        $toSort = db()->query('SELECT * FROM bank_lines WHERE sorted_as IS NULL ORDER BY txn_date DESC, id DESC LIMIT 400')->fetchAll();
        $sorted = db()->query('SELECT * FROM bank_lines WHERE sorted_as IS NOT NULL ORDER BY txn_date DESC, id DESC LIMIT 160')->fetchAll();
        $unsorted = (int) db()->query('SELECT COUNT(*) FROM bank_lines WHERE sorted_as IS NULL')->fetchColumn();
        // The payees the owner has sorted before, and how: what makes the next
        // suggestion one tap.
        $learn = db()->query("SELECT name, sorted_as, sorted_label, COUNT(*) c FROM bank_lines
            WHERE sorted_as IN ('expense','platform','ignore','tax','income') AND name <> ''
            GROUP BY name, sorted_as, sorted_label ORDER BY c DESC LIMIT 300")->fetchAll();
        $lastTo = $last ? (string) $last['to_date'] : null;
        json_out([
            'ok' => true,
            'ready' => true,
            'on' => $set['on'],
            'remind' => $set['remind'],
            'last' => $last ? [
                'from' => (string) $last['from_date'], 'to' => (string) $last['to_date'],
                'rows' => (int) $last['rows_in_file'], 'added' => (int) $last['added'], 'skipped' => (int) $last['skipped'],
                'at' => (string) $last['created_at'],
            ] : null,
            'balance' => $bal ? round((float) $bal['closing_balance'], 2) : null,
            'balance_at' => $bal ? (string) $bal['closing_at'] : '',
            'first' => $first ? (string) $first : '',
            'uploads' => $uploads,
            'unsorted' => $unsorted,
            'due' => statement_due($lastTo, date('Y-m-d')),
            'lines' => array_map('stmt_row', array_merge($toSort, $sorted)),
            'learned' => array_map(fn($r) => ['name' => (string) $r['name'], 'as' => (string) $r['sorted_as'], 'label' => (string) $r['sorted_label']], $learn),
        ]);
    },

    'preview' => function ($in) {
        stmt_need_ready();
        [$p, $new, $already, $older] = stmt_plan($in);
        json_out(['ok' => true, 'summary' => stmt_summary($p, $new, $already, $older)]);
    },

    'import' => function ($in) {
        stmt_need_ready();
        // An import replayed after a dropped reply is answered from the ledger; and a
        // payment already here is never added twice whatever happens (ext_key is unique).
        $opTok = op_claim($in);
        [$p, $new, $already, $older] = stmt_plan($in);
        $pdo = db();
        $importId = 0;
        $added = 0;
        $auto = 0;
        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO bank_imports (filename, from_date, to_date, rows_in_file, added, skipped, money_in, money_out, closing_balance, closing_at, admin_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([
                    mb_substr(clean((string) ($in['filename'] ?? '')), 0, 160), $p['from'], $p['to'], count($p['lines']), 0, $already + $older,
                    $p['money_in'], $p['money_out'], $p['balance'], $p['balance_at'] ?: null, (int) ($_SESSION['admin_id'] ?? 0) ?: null,
                ]);
            $importId = (int) $pdo->lastInsertId();
            $ins = $pdo->prepare('INSERT IGNORE INTO bank_lines (ext_key, import_id, txn_date, txn_time, kind, name, category, description, notes, amount, balance, sorted_as, sorted_label, sorted_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            foreach ($new as $l) {
                $a = statement_auto($l);
                $ins->execute([
                    $l['ext_key'], $importId, $l['date'], $l['time'], $l['type'], $l['name'], $l['category'], $l['description'], $l['notes'],
                    $l['amount'], $l['balance'], $a ? $a[0] : null, $a ? $a[1] : null, $a ? date('Y-m-d H:i:s') : null,
                ]);
                if ($ins->rowCount() > 0) {
                    $added++;
                    if ($a) {
                        $auto++;
                    }
                }
            }
            $pdo->prepare('UPDATE bank_imports SET added = ?, skipped = ? WHERE id = ?')->execute([$added, count($p['lines']) - $added, $importId]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            json_out(['error' => 'Couldn’t add the statement. Nothing was saved.'], 500);
        }
        $set = stmt_settings();
        $set['on'] = true;
        stmt_save($set);
        log_activity('payment', 'statement.import', 'Bank statement added — ' . $added . ' payment' . ($added === 1 ? '' : 's') . ' (' . uk_date($p['from']) . ' to ' . uk_date($p['to']) . ')', ['entity' => 'statement', 'entity_id' => (string) $importId]);
        $sum = stmt_summary($p, $new, $already, $older);
        $sum['added'] = $added;
        $sum['auto'] = $auto;
        json_out(op_finish($opTok, ['ok' => true, 'summary' => $sum]));
    },

    'mark' => function ($in) {
        stmt_need_ready();
        $id = (int) ($in['id'] ?? 0);
        $as = (string) ($in['as'] ?? '');
        if ($id <= 0 || !in_array($as, STMT_SORTS, true)) {
            json_out(['error' => 'That isn’t a way to sort a payment.'], 400);
        }
        $bid = (int) ($in['booking_id'] ?? 0);
        $eid = (int) ($in['expense_id'] ?? 0);
        if ($as === 'payment' && $bid <= 0) {
            json_out(['error' => 'Say which booking the payment was for.'], 400);
        }
        $label = mb_substr(clean((string) ($in['label'] ?? '')), 0, 160);
        $q = db()->prepare('UPDATE bank_lines SET sorted_as = ?, booking_id = ?, expense_id = ?, sorted_label = ?, sorted_at = NOW() WHERE id = ?');
        $q->execute([$as, $bid ?: null, $eid ?: null, $label, $id]);
        $has = db()->prepare('SELECT 1 FROM bank_lines WHERE id = ?');
        $has->execute([$id]);
        if ($q->rowCount() === 0 && !$has->fetchColumn()) {
            json_out(['error' => 'That payment isn’t in the app any more.'], 404);
        }
        json_out(['ok' => true]);
    },

    'unmark' => function ($in) {
        stmt_need_ready();
        $id = (int) ($in['id'] ?? 0);
        if ($id <= 0) {
            json_out(['error' => 'Which payment?'], 400);
        }
        db()->prepare('UPDATE bank_lines SET sorted_as = NULL, booking_id = NULL, expense_id = NULL, sorted_label = NULL, sorted_at = NULL WHERE id = ?')->execute([$id]);
        json_out(['ok' => true]);
    },

    'settings' => function ($in) {
        $set = stmt_settings();
        $set['remind'] = !empty($in['remind']);
        stmt_save($set);
        json_out(['ok' => true, 'remind' => $set['remind']]);
    },

    'remove' => function ($in) {
        $set = stmt_settings();
        $set['on'] = false;
        stmt_save($set);
        log_activity('payment', 'statement.remove', 'Bank statements turned off — the payments already added are kept', ['entity' => 'statement']);
        json_out(['ok' => true]);
    },
]);
