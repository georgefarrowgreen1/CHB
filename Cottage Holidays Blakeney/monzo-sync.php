<?php
// ============================================================
//  monzo-sync.php — the live link's talking and storing (the decisions are
//  monzo-lib.php). Required by monzo.php, monzo-callback.php and self-repair.
//
//  Three stores, each said once:
//    monzo-client  PRIVATE  {id, secret}: the owner's developer client (a config
//                           const MONZO_CLIENT_ID / MONZO_CLIENT_SECRET wins)
//    monzo-auth    PRIVATE  {access, refresh, expires_at, user_id}
//    monzo-link    internal {account_id, account, connected_at, last_ok, last_sync,
//                           last_error, reconnect, no_business, shared, balance,
//                           balance_at, total, added, pending (connect state hash)}
//  Payments land in bank_lines (statement payments' table) with import_id 0.
// ============================================================
require_once __DIR__ . '/monzo-lib.php';
require_once __DIR__ . '/statement-lib.php';
require_once __DIR__ . '/split-store.php';

function monzo_client(): array
{
    if (defined('MONZO_CLIENT_ID') && defined('MONZO_CLIENT_SECRET') && (string) constant('MONZO_CLIENT_ID') !== '') {
        return ['id' => (string) constant('MONZO_CLIENT_ID'), 'secret' => (string) constant('MONZO_CLIENT_SECRET'), 'const' => true];
    }
    $c = content_secret_json('monzo-client', []);
    return ['id' => (string) ($c['id'] ?? ''), 'secret' => (string) ($c['secret'] ?? ''), 'const' => false];
}
function monzo_link(): array
{
    return content_json('monzo-link', []);
}
function monzo_link_save(array $l): void
{
    content_set_scalar('monzo-link', $l);
}
function monzo_auth(): array
{
    return content_secret_json('monzo-auth', []);
}
function monzo_auth_save(array $a): void
{
    content_set_secret('monzo-auth', $a);
}
// Every change to the link and its tokens happens under ONE lock, the sync's. A
// sync, an approval check, a connection and a disconnect can meet: a disconnect
// made while a refresh was in flight was undone by the refresh's save (the link
// came back and went on importing payments), and two refreshes at once spent one
// refresh token twice, so the loser told the owner to connect again over the
// winner's good token. [true, result], or [false, null] when another holder kept
// it past $wait seconds. Re-entrant: a check inside a sync is one holder.
function monzo_locked(callable $fn, int $wait): array
{
    $s = db()->prepare("SELECT GET_LOCK('chb_monzo_sync', ?)");
    $s->execute([$wait]);
    if ((int) $s->fetchColumn() !== 1) {
        return [false, null];
    }
    try {
        return [true, $fn()];
    } finally {
        db()->query("SELECT RELEASE_LOCK('chb_monzo_sync')");
    }
}
function monzo_lock_wait(): int
{
    return defined('CHB_MONZO_LOCK_WAIT') ? (int) constant('CHB_MONZO_LOCK_WAIT') : 20;
}
// The address Monzo sends the owner back to. It is pasted into the client at
// developers.monzo.com, so it must be exactly this.
function monzo_redirect_url(): string
{
    return site_base_url() . 'monzo-callback.php';
}

// One call to Monzo: ['status' => int, 'body' => array]. status 0 = unreachable.
function monzo_http(string $method, string $path, string $token = '', ?array $form = null, array $query = []): array
{
    $url = monzo_api_base() . $path . ($query ? '?' . http_build_query($query) : '');
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    if ($token !== '') {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    if ($form !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($form));
    }
    $raw = curl_exec($ch);
    if ($raw === false) {
        curl_close($ch);
        return ['status' => 0, 'body' => []];
    }
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $body = json_decode((string) $raw, true);
    return ['status' => $status, 'body' => is_array($body) ? $body : []];
}

// The access token to use now, refreshed first when it is about to lapse. '' when
// there is none, or when Monzo refused the refresh (the link then needs the owner).
function monzo_token(): string
{
    $a = monzo_auth();
    if (empty($a['access'])) {
        return '';
    }
    if (!monzo_refresh_due($a, time())) {
        return (string) $a['access'];
    }
    $c = monzo_client();
    if ($c['id'] === '' || empty($a['refresh'])) {
        monzo_needs_reconnect('The link expired. Connect again to carry on.');
        return '';
    }
    $r = monzo_http('POST', '/oauth2/token', '', [
        'grant_type' => 'refresh_token', 'client_id' => $c['id'], 'client_secret' => $c['secret'], 'refresh_token' => $a['refresh'],
    ]);
    $t = $r['status'] === 200 ? monzo_token_read($r['body'], time()) : null;
    if ($t === null) {
        // Unreachable is not refused: keep the token and try again next time.
        if ($r['status'] === 0) {
            return '';
        }
        monzo_needs_reconnect('Monzo stopped accepting the link. Connect again to carry on.');
        return '';
    }
    // Refreshing is one-time: the new refresh token replaces the old.
    if ($t['refresh'] === '') {
        $t['refresh'] = (string) $a['refresh'];
    }
    monzo_auth_save($t);
    return $t['access'];
}
function monzo_needs_reconnect(string $why): void
{
    $l = monzo_link();
    $l['reconnect'] = true;
    $l['last_error'] = $why;
    monzo_link_save($l);
    monzo_auth_save([]);
}

// The page's view of the link, never a token or secret.
function monzo_status(): array
{
    $c = monzo_client();
    $a = monzo_auth();
    $l = monzo_link();
    $h = monzo_health($l, $c['id'] !== '', !empty($a['access']), time());
    return [
        'state' => $h['state'],
        'say' => $h['say'],
        'client' => $c['id'] !== '',
        'client_fixed' => $c['const'],
        'redirect' => monzo_redirect_url(),
        'account' => (string) ($l['account'] ?? ''),
        'connected_at' => (int) ($l['connected_at'] ?? 0),
        'full_until' => (int) ($l['connected_at'] ?? 0) > 0 ? (int) $l['connected_at'] + MONZO_FULL_WINDOW : 0,
        'last_ok' => (int) ($l['last_ok'] ?? 0),
        'last_error' => (string) ($l['last_error'] ?? ''),
        'added' => (int) ($l['added'] ?? 0),
        'balance' => isset($l['balance']) && is_numeric($l['balance']) ? round((float) $l['balance'], 2) : null,
        'total' => isset($l['total']) && is_numeric($l['total']) ? round((float) $l['total'], 2) : null,
        'balance_at' => (int) ($l['balance_at'] ?? 0),
    ];
}

// Has the owner approved access yet, and is there a business account? Settles the
// link's account. Returns the state monzo_health would now report. While a sync
// holds the link it reports the link as it stands rather than calling Monzo.
function monzo_check(): string
{
    [$got, $state] = monzo_locked('monzo_check_now', min(3, monzo_lock_wait()));
    return $got ? (string) $state : monzo_status()['state'];
}
function monzo_check_now(): string
{
    $token = monzo_token();
    if ($token === '') {
        return monzo_status()['state'];
    }
    $r = monzo_http('GET', '/accounts', $token);
    $l = monzo_link();
    if ($r['status'] === 401) {
        monzo_needs_reconnect('Monzo stopped accepting the link. Connect again to carry on.');
        return 'reconnect';
    }
    if ($r['status'] !== 200) {
        // 403: not approved in the app yet. Anything else: try again shortly.
        if ($r['status'] !== 403) {
            $l['last_error'] = $r['status'] === 0 ? 'Couldn’t reach Monzo.' : 'Monzo answered ' . $r['status'] . '.';
            monzo_link_save($l);
        }
        return monzo_status()['state'];
    }
    $accounts = is_array($r['body']['accounts'] ?? null) ? $r['body']['accounts'] : [];
    $acc = monzo_pick_account($accounts);
    if ($acc === null) {
        // Before approval Monzo can answer with no accounts at all: that is still
        // waiting, not "no business account".
        if (!$accounts) {
            return monzo_status()['state'];
        }
        $l['no_business'] = true;
        $l['shared'] = monzo_shared_words($accounts);
        $l['last_error'] = '';
        monzo_link_save($l);
        return 'no_business';
    }
    $l['account_id'] = (string) $acc['id'];
    $l['account'] = monzo_account_label($acc);
    $l['no_business'] = false;
    $l['last_error'] = '';
    monzo_link_save($l);
    return monzo_status()['state'];
}

// Fetch payments since the right moment into bank_lines, and the balance.
// One sync at a time (the cron and a tap can meet; a refresh is one-time).
// Returns ['ok', 'added', 'auto', 'fetched', 'error'].
function monzo_sync(): array
{
    $out = ['ok' => false, 'added' => 0, 'auto' => 0, 'fetched' => 0, 'error' => ''];
    $lock = db()->prepare("SELECT GET_LOCK('chb_monzo_sync', ?)");
    $lock->execute([monzo_lock_wait()]);
    if ((int) $lock->fetchColumn() !== 1) {
        $out['error'] = 'A sync is already running.';
        return $out;
    }
    try {
        $l = monzo_link();
        if (empty($l['account_id'])) {
            monzo_check_now();
            $l = monzo_link();
            if (empty($l['account_id'])) {
                $out['error'] = monzo_status()['say'];
                return $out;
            }
        }
        $token = monzo_token();
        if ($token === '') {
            $out['error'] = monzo_status()['say'] ?: 'Couldn’t reach Monzo.';
            return $out;
        }
        $acc = (string) $l['account_id'];
        $newest = db()->query("SELECT CONCAT(MAX(txn_date), ' 23:59:59') FROM bank_lines WHERE import_id = 0")->fetchColumn() ?: null;
        $today = date('Y-m-d');
        $ty = (int) substr($today, 0, 4) - ((substr($today, 5) < '04-06') ? 1 : 0);
        $since = monzo_since($newest, (int) ($l['connected_at'] ?? 0), time(), $ty . '-04-06');
        // Pot names, so a move reads "To Tax pot" rather than an id.
        $pots = [];
        $p = monzo_http('GET', '/pots', $token, null, ['current_account_id' => $acc]);
        foreach ((array) ($p['body']['pots'] ?? []) as $pot) {
            if (is_array($pot) && !empty($pot['id'])) {
                $pots[(string) $pot['id']] = (string) ($pot['name'] ?? '');
            }
        }
        $payees = split_payees_now();
        $cursor = $since;
        for ($page = 0; $page < 60; $page++) {
            $r = monzo_http('GET', '/transactions', $token, null, ['account_id' => $acc, 'since' => $cursor, 'limit' => 100]);
            if ($r['status'] === 401) {
                monzo_needs_reconnect('Monzo stopped accepting the link. Connect again to carry on.');
                $out['error'] = 'Monzo stopped accepting the link.';
                return $out;
            }
            if ($r['status'] !== 200) {
                $out['error'] = $r['status'] === 0 ? 'Couldn’t reach Monzo.' : ($r['status'] === 403 ? 'Monzo didn’t allow it. Approve access in the Monzo app.' : 'Monzo answered ' . $r['status'] . '.');
                break;
            }
            $txs = is_array($r['body']['transactions'] ?? null) ? $r['body']['transactions'] : [];
            foreach ($txs as $tx) {
                if (!is_array($tx)) {
                    continue;
                }
                $out['fetched']++;
                $line = monzo_line($tx, $pots);
                if ($line === null) {
                    continue;
                }
                [$in1, $a1] = split_bank_insert($line, 0, $payees);
                $out['added'] += $in1 ? 1 : 0;
                $out['auto'] += $a1 ? 1 : 0;
            }
            if (count($txs) < 100) {
                break;
            }
            $last = end($txs);
            $cursor = is_array($last) ? (string) ($last['id'] ?? '') : '';
            if ($cursor === '') {
                break;
            }
        }
        $b = monzo_http('GET', '/balance', $token, null, ['account_id' => $acc]);
        $l = monzo_link();
        if ($b['status'] === 200 && isset($b['body']['balance'])) {
            $l['balance'] = round(((int) $b['body']['balance']) / 100, 2);
            $l['total'] = isset($b['body']['total_balance']) ? round(((int) $b['body']['total_balance']) / 100, 2) : null;
            $l['balance_at'] = time();
        }
        $l['last_sync'] = time();
        if ($out['error'] === '') {
            $l['last_ok'] = time();
            $l['last_error'] = '';
            $l['added'] = (int) ($l['added'] ?? 0) + $out['added'];
            $out['ok'] = true;
        } else {
            $l['last_error'] = $out['error'];
        }
        monzo_link_save($l);
        return $out;
    } finally {
        db()->query("SELECT RELEASE_LOCK('chb_monzo_sync')");
    }
}
