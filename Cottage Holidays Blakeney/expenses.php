<?php
// ============================================================
//  expenses.php — owner-logged running costs (admin only), so the Money page
//  can show NET income per UK tax year.
//
//  GET                         -> { ok, expenses:[{id,category,description,amount,prop_key,date}] }
//  POST {action:'add', category, description, amount, prop, date}
//  POST {action:'delete', id}
//
//  Table created by migration-expenses.sql (via migrate.php).
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

$in = body();
$action = $in['action'] ?? '';

if ($action === 'add') {
    $category = substr(clean($in['category'] ?? 'General') ?: 'General', 0, 64);
    $description = substr(clean($in['description'] ?? ''), 0, 255);
    $amount = round((float)($in['amount'] ?? 0), 2);
    $prop = preg_replace('/[^a-z0-9_]/i', '', (string)($in['prop'] ?? ''));
    $prop = $prop === '' ? null : substr($prop, 0, 32);
    $date = clean($in['date'] ?? '');
    if ($amount <= 0) json_out(['error' => 'Enter an amount greater than zero.'], 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_out(['error' => 'Enter a valid date (YYYY-MM-DD).'], 400);
    try {
        db()->prepare('INSERT INTO expenses (category, description, amount, prop_key, expense_date) VALUES (?,?,?,?,?)')
            ->execute([$category, $description, $amount, $prop, $date]);
        json_out(['ok' => true, 'id' => (int)db()->lastInsertId()]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not save — has migration-expenses.sql been run?'], 500);
    }
}

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    if ($id <= 0) json_out(['error' => 'An expense id is required'], 400);
    db()->prepare('DELETE FROM expenses WHERE id = ?')->execute([$id]);
    json_out(['ok' => true]);
}

// Default: list all expenses (newest first). The client buckets them by UK tax year.
try {
    $rows = db()->query('SELECT id, category, description, amount, prop_key, expense_date FROM expenses ORDER BY expense_date DESC, id DESC')->fetchAll();
    json_out(['ok' => true, 'expenses' => array_map(fn($r) => [
        'id' => (int)$r['id'],
        'category' => $r['category'],
        'description' => $r['description'],
        'amount' => (float)$r['amount'],
        'prop_key' => $r['prop_key'],
        'date' => $r['expense_date'],
    ], $rows)]);
} catch (\Throwable $e) {
    json_out(['ok' => true, 'expenses' => []]);   // table not migrated yet — treat as none
}
