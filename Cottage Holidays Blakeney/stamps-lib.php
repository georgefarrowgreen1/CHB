<?php
// ============================================================
//  stamps-lib.php — a number per table that moves whenever a row in it changes.
//  (CLAUDE.md, '"Nothing new" costs almost nothing'.)
//
//  The owner's email log, chat list and a visitor's review figures are built from tables
//  that grow with the years, and a page that already holds the answer used to have it
//  rebuilt in full only to hear "same". A read whose tables' stamps (and the deployed
//  code, and the hour) are the ones that produced the answer the page holds can say
//  "same" without building it (db.php held_fp / json_out_held_fp).
//
//  THE STAMPS ARE MOVED AT THE ONE PLACE EVERY WRITE PASSES THROUGH: db() hands out a
//  ChbPDO, whose statements report each write they make. A stamp you have to remember to
//  move is one the next writer forgets; here a writer cannot leave one behind. Rules:
//   - a statement that names a stamped table and is not a read moves its stamp, unless it
//     is an INSERT/UPDATE/DELETE/REPLACE that changed no row;
//   - inside a transaction the stamps move when it ends, however it ends (a stamp moved
//     for nothing costs a rebuild; one moved too early could be read before the write);
//   - a statement whose effect cannot be read from its text (EXECUTE, CALL, LOAD…) moves
//     every stamp;
//   - log_activity's own insert carries CHB_STAMP_SELF and moves 'activity_log.<entity>'
//     itself: every action is logged, and moving 'activity_log' for each would mean the
//     email log never heard "same".
//  A write the app does not make (phpMyAdmin) moves nothing; the hour in every
//  fingerprint bounds it. No db.php: the integration harness writes through a ChbPDO of
//  its own, so a change it makes by hand is seen exactly as the app's would be.
//
//  A STAMP IS A ROW OF THE content TABLE ('stamp-<name>', internal and server-only), so a
//  visitor's one content read already holds the ones the review figures need, and an
//  owner's read asks for its stamps and its remembered answer in one query. No table of
//  its own, so nothing waits on a migration.
// ============================================================

// The tables a reader may ask the stamp of. A write to any other table moves nothing.
const CHB_STAMPED = ['activity_log', 'chat_threads', 'direct_leads', 'guest_reviews', 'guests', 'messages'];
// The activity rows log_activity stamps under 'activity_log.<entity>'.
const CHB_STAMPED_ENTITIES = ['booking'];
// log_activity's insert says it stamps itself.
const CHB_STAMP_SELF = '/*chb:stamped*/';
// The content key a stamp is kept under.
const CHB_STAMP_KEY = 'stamp-';

// What a statement may change: [stamp names, whether a count of no rows means nothing
// changed]. [] for a read or a statement naming no stamped table.
function chb_stamp_targets(string $sql): array
{
    $s = ltrim($sql);
    if (strncmp($s, CHB_STAMP_SELF, strlen(CHB_STAMP_SELF)) === 0) {
        return [[], false];
    }
    // Leading comments are not the statement.
    while (true) {
        if (strncmp($s, '/*', 2) === 0) {
            $e = strpos($s, '*/');
            if ($e === false) {
                break;
            }
            $s = ltrim(substr($s, $e + 2));
            continue;
        }
        if (strncmp($s, '--', 2) === 0 || strncmp($s, '#', 1) === 0) {
            $e = strpos($s, "\n");
            $s = $e === false ? '' : ltrim(substr($s, $e + 1));
            continue;
        }
        break;
    }
    $verb = preg_match('/^\(*\s*([a-z]+)/i', $s, $m) ? strtoupper($m[1]) : '';
    // One statement, or several (a literal ';' reads as several: a stamp moved for nothing).
    $several = strpos(rtrim($s, "; \t\n\r"), ';') !== false;
    if (!$several && in_array($verb, ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'SET', 'DO', 'USE', 'CHECKSUM', 'HELP', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'LOCK', 'UNLOCK', 'PREPARE', 'DEALLOCATE'], true)) {
        return [[], false];
    }
    if (in_array($verb, ['EXECUTE', 'CALL', 'HANDLER', 'LOAD', ''], true)) {
        return [CHB_STAMPED, false];
    }
    // A table name is a word no hyphen touches: 'stamp-messages' is a content key, not the
    // messages table.
    $names = [];
    foreach (CHB_STAMPED as $t) {
        if (preg_match('/(?<![\w-])' . $t . '(?![\w-])/i', $s)) {
            $names[] = $t;
        }
    }
    return [$names, !$several && in_array($verb, ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'], true)];
}

// Moves the named stamps by one, and says so for the rest of the request (a memo read
// before the write would answer with the old number). Never throws: a write must never
// fail because of its stamp.
function chb_stamp_bump(PDO $pdo, array $names): void
{
    $names = array_values(array_unique(array_map('strval', $names)));
    if (!$names) {
        return;
    }
    foreach ($names as $n) {
        $GLOBALS['__chb_stamp_moved'][$n] = true;
    }
    try {
        $pdo->prepare('INSERT INTO content (item_key, item_value) VALUES ' . implode(',', array_fill(0, count($names), "(?, '1')"))
            . ' ON DUPLICATE KEY UPDATE item_value = CAST(item_value AS UNSIGNED) + 1, updated_at = CURRENT_TIMESTAMP')
            ->execute(array_map(fn($n) => CHB_STAMP_KEY . $n, $names));
    } catch (\Throwable $e) {
    }
}

// Whether a stamp has moved in this request (its memo, if any, is then out of date).
function chb_stamp_moved(string $name): bool
{
    return !empty($GLOBALS['__chb_stamp_moved'][$name]);
}

final class ChbPDO extends PDO
{
    /** @var array<string, bool> stamps a transaction's writes moved, waiting for its end */
    private array $chbHeld = [];
    // THE WRITE'S OWN ID OUTLIVES ITS STAMP. A stamp is an INSERT into content, which has no
    // AUTO_INCREMENT, so the connection's insert id reads 0 after it: every
    // `INSERT … ; lastInsertId()` would have got 0 (a guest's session minted for guest 0).
    // The id is kept as it stood before the first stamp and answered until the next real
    // statement, so lastInsertId() reads exactly as it would with no stamp at all.
    private ?string $chbLastId = null;
    private bool $chbBumping = false;

    public function __construct(string $dsn, ?string $username = null, ?string $password = null, ?array $options = null)
    {
        parent::__construct($dsn, $username, $password, $options);
        $this->setAttribute(PDO::ATTR_STATEMENT_CLASS, [ChbStmt::class, [$this]]);
    }

    public function lastInsertId(?string $name = null): string|false
    {
        return $this->chbLastId ?? parent::lastInsertId($name);
    }

    // A real statement is about to run: from here the connection's own id is the truth.
    public function chbBefore(): void
    {
        if (!$this->chbBumping) {
            $this->chbLastId = null;
        }
    }

    public function exec(string $statement): int|false
    {
        $this->chbBefore();
        $n = parent::exec($statement);
        if ($n !== false) {
            $this->chbSeen($statement, (int) $n);
        }
        return $n;
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        $this->chbBefore();
        $st = $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
        if ($st !== false) {
            $this->chbSeen($query, $st->rowCount());
        }
        return $st;
    }

    public function beginTransaction(): bool
    {
        $this->chbBefore();
        return parent::beginTransaction();
    }

    public function commit(): bool
    {
        $this->chbBefore();
        try {
            return parent::commit();
        } finally {
            $this->chbFlush();
        }
    }

    public function rollBack(): bool
    {
        $this->chbBefore();
        try {
            return parent::rollBack();
        } finally {
            $this->chbFlush();
        }
    }

    // A statement ran and changed $rows rows.
    public function chbSeen(string $sql, int $rows): void
    {
        [$names, $dml] = chb_stamp_targets($sql);
        if ($names && !($dml && $rows === 0)) {
            $this->chbTouch($names);
        }
    }

    // Moves the named stamps now, or when the transaction a write belongs to ends.
    public function chbTouch(array $names): void
    {
        if ($this->inTransaction()) {
            foreach ($names as $n) {
                $this->chbHeld[(string) $n] = true;
            }
            return;
        }
        $this->chbBump($names);
    }

    private function chbFlush(): void
    {
        if ($this->chbHeld && !$this->inTransaction()) {
            $names = array_keys($this->chbHeld);
            $this->chbHeld = [];
            $this->chbBump($names);
        }
    }

    // The bump, keeping the id the write before it left (the first bump since a real
    // statement reads it; a second reads the first bump's 0, so it keeps what it has).
    private function chbBump(array $names): void
    {
        if ($this->chbLastId === null) {
            $id = parent::lastInsertId();
            $this->chbLastId = $id === false ? null : $id;
        }
        $this->chbBumping = true;
        try {
            chb_stamp_bump($this, $names);
        } finally {
            $this->chbBumping = false;
        }
    }
}

final class ChbStmt extends PDOStatement
{
    private ChbPDO $chbPdo;

    protected function __construct(ChbPDO $pdo)
    {
        $this->chbPdo = $pdo;
    }

    public function execute(?array $params = null): bool
    {
        $this->chbPdo->chbBefore();
        $ok = parent::execute($params);
        if ($ok) {
            $this->chbPdo->chbSeen($this->queryString, $this->rowCount());
        }
        return $ok;
    }
}
