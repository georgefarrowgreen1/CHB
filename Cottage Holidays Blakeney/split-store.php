<?php
// ============================================================
//  split-store.php — the split's settings and the bank columns it needs (IO).
//  The decisions are split-lib.php; this reads and writes what they work on, for
//  split.php, statements.php and the Monzo sync alike.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/split-lib.php';

function split_cfg(): array
{
    return split_config(content_json(SPLIT_KEY, []));
}
function split_cfg_save(array $cfg): void
{
    content_set_scalar(SPLIT_KEY, split_config($cfg));
}
// migration-136 adds who a payment was paid to and which cottage a platform payout
// was for. Until it has run the split stays off, so nothing writes a column that
// isn't there and an import never fails over it.
function split_cols_ready(): bool
{
    static $ok = null;
    if ($ok === null) {
        try {
            db()->query('SELECT admin_id, prop_key FROM bank_lines LIMIT 0');
            $ok = true;
        } catch (\Throwable $e) {
            $ok = false;
        }
    }
    return $ok;
}
// The names payments are sorted to a person by, as new bank lines arrive.
function split_payees_now(): array
{
    return split_cols_ready() ? split_payee_map(split_cfg()) : [];
}
// One bank line in, sorted by itself where nothing needs asking (statement_auto).
// $importId is 0 for the live Monzo link. Returns [added, auto].
function split_bank_insert(array $l, int $importId, array $payees): array
{
    static $ins = [];
    $cols = split_cols_ready();
    $k = $cols ? 'c' : 'p';
    if (!isset($ins[$k])) {
        $ins[$k] = db()->prepare($cols
            ? 'INSERT IGNORE INTO bank_lines (ext_key, import_id, txn_date, txn_time, kind, name, category, description, notes, amount, balance, sorted_as, sorted_label, sorted_at, admin_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
            : 'INSERT IGNORE INTO bank_lines (ext_key, import_id, txn_date, txn_time, kind, name, category, description, notes, amount, balance, sorted_as, sorted_label, sorted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    }
    $a = statement_auto($l, $cols ? $payees : []);
    $args = [
        $l['ext_key'], $importId, $l['date'], $l['time'], $l['type'], $l['name'], $l['category'], $l['description'], $l['notes'],
        $l['amount'], $l['balance'], $a ? $a[0] : null, $a ? $a[1] : null, $a ? date('Y-m-d H:i:s') : null,
    ];
    if ($cols) {
        $args[] = $a && isset($a[2]) ? (int) $a[2] : null;
    }
    $ins[$k]->execute($args);
    $added = $ins[$k]->rowCount() > 0;
    return [$added, $added && $a];
}
