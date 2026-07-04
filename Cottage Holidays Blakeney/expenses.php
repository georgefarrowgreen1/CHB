<?php
// ============================================================
//  expenses.php — owner-logged running costs (admin only), so the Money page
//  can show NET income per UK tax year.
//
//  GET                         -> { ok, expenses:[{id,category,description,amount,prop_key,recurring,receipt_data,date}] }
//  POST {action:'add', category, description, amount, prop, date, recurring, receipt_data}
//  POST {action:'delete', id}
//
//  receipt_data is JSON read on-device from a receipt photo (supplier, date,
//  items, amount) — the photo itself is never uploaded or stored.
//  Table created by migration-expenses*.sql (via migrate.php).
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

$in = body();
$action = $in['action'] ?? '';

if ($action === 'add') {
    $category = substr(clean($in['category'] ?? 'General') ?: 'General', 0, 64);
    $description = substr(clean($in['description'] ?? ''), 0, 255);
    $amount = round((float) ($in['amount'] ?? 0), 2);
    $prop = preg_replace('/[^a-z0-9_]/i', '', (string) ($in['prop'] ?? ''));
    $prop = $prop === '' ? null : substr($prop, 0, 32);
    $date = clean($in['date'] ?? '');
    $recurring = !empty($in['recurring']) ? 1 : 0;
    // Structured data read from a receipt photo (JSON). We store only valid JSON,
    // capped in size; the receipt image is never uploaded.
    $receiptData = isset($in['receipt_data']) ? (string) $in['receipt_data'] : '';
    if ($receiptData !== '') {
        if (strlen($receiptData) > 6000) {
            $receiptData = substr($receiptData, 0, 6000);
        }
        $decoded = json_decode($receiptData, true);
        $receiptData = is_array($decoded) ? json_encode($decoded, JSON_UNESCAPED_UNICODE) : null;
    } else {
        $receiptData = null;
    }
    if ($amount <= 0) {
        json_out(['error' => 'Enter an amount greater than zero.'], 400);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        json_out(['error' => 'Enter a valid date (YYYY-MM-DD).'], 400);
    }
    try {
        db()
            ->prepare(
                'INSERT INTO expenses (category, description, amount, prop_key, recurring, receipt_data, expense_date) VALUES (?,?,?,?,?,?,?)',
            )
            ->execute([$category, $description, $amount, $prop, $recurring, $receiptData, $date]);
        json_out(['ok' => true, 'id' => (int) db()->lastInsertId()]);
    } catch (\Throwable $e) {
        // Older DB without the recurring/receipt_data columns — save the core fields.
        try {
            db()
                ->prepare(
                    'INSERT INTO expenses (category, description, amount, prop_key, expense_date) VALUES (?,?,?,?,?)',
                )
                ->execute([$category, $description, $amount, $prop, $date]);
            json_out(['ok' => true, 'id' => (int) db()->lastInsertId()]);
        } catch (\Throwable $e2) {
            json_out(['error' => 'Could not save — has migrate.php been run?'], 500);
        }
    }
}

if ($action === 'update') {
    $id = (int) ($in['id'] ?? 0);
    if ($id <= 0) {
        json_out(['error' => 'An expense id is required'], 400);
    }
    $category = substr(clean($in['category'] ?? 'General') ?: 'General', 0, 64);
    $description = substr(clean($in['description'] ?? ''), 0, 255);
    $amount = round((float) ($in['amount'] ?? 0), 2);
    $prop = preg_replace('/[^a-z0-9_]/i', '', (string) ($in['prop'] ?? ''));
    $prop = $prop === '' ? null : substr($prop, 0, 32);
    $date = clean($in['date'] ?? '');
    $recurring = !empty($in['recurring']) ? 1 : 0;
    if ($amount <= 0) {
        json_out(['error' => 'Enter an amount greater than zero.'], 400);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        json_out(['error' => 'Enter a valid date (YYYY-MM-DD).'], 400);
    }
    // receipt_data is only changed if the key is present (e.g. re-scanned); otherwise kept.
    $touchReceipt = array_key_exists('receipt_data', $in);
    $receiptData = null;
    if ($touchReceipt) {
        $rd = (string) ($in['receipt_data'] ?? '');
        if ($rd !== '') {
            if (strlen($rd) > 6000) {
                $rd = substr($rd, 0, 6000);
            }
            $dec = json_decode($rd, true);
            $receiptData = is_array($dec) ? json_encode($dec, JSON_UNESCAPED_UNICODE) : null;
        }
    }
    try {
        if ($touchReceipt) {
            db()
                ->prepare(
                    'UPDATE expenses SET category=?, description=?, amount=?, prop_key=?, recurring=?, receipt_data=?, expense_date=? WHERE id=?',
                )
                ->execute([$category, $description, $amount, $prop, $recurring, $receiptData, $date, $id]);
        } else {
            db()
                ->prepare(
                    'UPDATE expenses SET category=?, description=?, amount=?, prop_key=?, recurring=?, expense_date=? WHERE id=?',
                )
                ->execute([$category, $description, $amount, $prop, $recurring, $date, $id]);
        }
        json_out(['ok' => true]);
    } catch (\Throwable $e) {
        // Older DB without recurring/receipt_data — update the core fields only.
        try {
            db()
                ->prepare(
                    'UPDATE expenses SET category=?, description=?, amount=?, prop_key=?, expense_date=? WHERE id=?',
                )
                ->execute([$category, $description, $amount, $prop, $date, $id]);
            json_out(['ok' => true]);
        } catch (\Throwable $e2) {
            json_out(['error' => 'Could not update — has migrate.php been run?'], 500);
        }
    }
}

if ($action === 'delete') {
    $id = (int) ($in['id'] ?? 0);
    if ($id <= 0) {
        json_out(['error' => 'An expense id is required'], 400);
    }
    db()
        ->prepare('DELETE FROM expenses WHERE id = ?')
        ->execute([$id]);
    json_out(['ok' => true]);
}

// Default: list all expenses (newest first). The client buckets them by UK tax year.
// SELECT * so this tolerates whatever columns the DB has been migrated to.
try {
    $rows = db()->query('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC')->fetchAll();
    json_out([
        'ok' => true,
        'expenses' => array_map(
            fn($r) => [
                'id' => (int) $r['id'],
                'category' => $r['category'] ?? '',
                'description' => $r['description'] ?? '',
                'amount' => (float) ($r['amount'] ?? 0),
                'prop_key' => $r['prop_key'] ?? null,
                'recurring' => (int) ($r['recurring'] ?? 0),
                'receipt_data' => $r['receipt_data'] ?? null,
                'date' => $r['expense_date'] ?? null,
            ],
            $rows,
        ),
    ]);
} catch (\Throwable $e) {
    json_out(['ok' => true, 'expenses' => []]); // table not migrated yet — treat as none
}
