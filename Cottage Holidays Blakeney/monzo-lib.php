<?php
// ============================================================
//  monzo-lib.php — the live link to the Monzo Business account, PURE.
//
//  The owner creates a CONFIDENTIAL client at developers.monzo.com (a refresh
//  token is only ever issued to one), connects once, and approves access in the
//  Monzo app. From then on the business account's payments arrive by themselves
//  into the same store the statements use (bank_lines), keyed on Monzo's own
//  transaction id, so a payment that arrives both ways is still one payment.
//
//  Monzo documents its developer API for personal and joint accounts. Whether it
//  shares a BUSINESS account is Monzo's decision, so the link takes only an
//  account Monzo describes as business, and says so plainly when there is none:
//  a personal account's payments must never land in the business books.
//
//  No database, no network, no clock: test-monzo.php drives every function here.
//  monzo-sync.php does the talking and the storing.
// ============================================================

const MONZO_FULL_WINDOW = 300;          // seconds after connecting when Monzo shares the whole history
const MONZO_RECENT_DAYS = 89;           // after that, only the last 90 days
const MONZO_OVERLAP_DAYS = 10;          // re-read this far back, so a card payment that settled late arrives
const MONZO_STALE_HOURS = 36;           // a link that has not synced for this long is not "live"

function monzo_api_base(): string
{
    return defined('MONZO_API_BASE') ? rtrim((string) constant('MONZO_API_BASE'), '/') : 'https://api.monzo.com';
}
function monzo_auth_base(): string
{
    return defined('MONZO_AUTH_BASE') ? (string) constant('MONZO_AUTH_BASE') : 'https://auth.monzo.com/';
}

// Where the owner is sent to connect. state is the unguessable value the return
// is checked against.
function monzo_auth_url(string $clientId, string $redirect, string $state): string
{
    return monzo_auth_base() . '?' . http_build_query([
        'client_id' => $clientId,
        'redirect_uri' => $redirect,
        'response_type' => 'code',
        'state' => $state,
    ]);
}

// A client id and secret as pasted, or the sentence saying what is wrong with them.
function monzo_client_problem(string $id, string $secret): string
{
    if ($id === '' || $secret === '') {
        return 'Paste both the client ID and the client secret.';
    }
    if (!preg_match('/^[A-Za-z0-9_.\-]{8,200}$/', $id) || !preg_match('/^[A-Za-z0-9_.\-+\/=]{8,400}$/', $secret)) {
        return 'That doesn’t look like a Monzo client ID and secret. Copy them again from developers.monzo.com.';
    }
    // Monzo's non-confidential secrets say so. Such a client is never given a
    // refresh token, so the link would stop every six hours.
    if (stripos($secret, 'mnzpub') === 0) {
        return 'That client isn’t confidential, so Monzo won’t keep it connected. Make it again as Confidential.';
    }
    return '';
}

// Monzo's token reply as what is kept: null when it carries no access token.
function monzo_token_read(array $body, int $now): ?array
{
    $access = (string) ($body['access_token'] ?? '');
    if ($access === '') {
        return null;
    }
    $life = (int) ($body['expires_in'] ?? 0);
    return [
        'access' => $access,
        'refresh' => (string) ($body['refresh_token'] ?? ''),
        'expires_at' => $now + ($life > 0 ? $life : 21600),
        'user_id' => (string) ($body['user_id'] ?? ''),
    ];
}

// Refresh a few minutes early, so a sync never starts on a token about to lapse.
function monzo_refresh_due(array $auth, int $now): bool
{
    return (int) ($auth['expires_at'] ?? 0) - 300 <= $now;
}

// The business account among those Monzo shared, or null. A closed account is
// never chosen, and neither is a personal or joint one, whatever else is there.
function monzo_pick_account(array $accounts): ?array
{
    foreach ($accounts as $a) {
        if (!is_array($a) || !empty($a['closed'])) {
            continue;
        }
        if (stripos((string) ($a['type'] ?? ''), 'business') !== false) {
            return $a;
        }
    }
    return null;
}

// How an account is named on screen: "Business account ending 4471".
function monzo_account_label(array $a): string
{
    $num = preg_replace('/\D/', '', (string) ($a['account_number'] ?? ''));
    return 'Business account' . ($num !== '' ? ' ending ' . substr($num, -4) : '');
}

// What kinds of account Monzo shared, in words, for when none is business.
function monzo_shared_words(array $accounts): string
{
    $kinds = [];
    foreach ($accounts as $a) {
        if (!is_array($a) || !empty($a['closed'])) {
            continue;
        }
        $t = strtolower((string) ($a['type'] ?? ''));
        $kinds[] = strpos($t, 'joint') !== false ? 'a joint account' : (strpos($t, 'retail') !== false ? 'a personal account' : 'another kind of account');
    }
    $kinds = array_values(array_unique($kinds));
    if (!$kinds) {
        return 'no accounts';
    }
    return count($kinds) === 1 ? $kinds[0] : implode(', ', array_slice($kinds, 0, -1)) . ' and ' . end($kinds);
}

// From when to ask Monzo for payments. Within the first five minutes it shares
// everything, so the whole floor (the start of the tax year) is asked for; after
// that only the last 90 days, re-reading a little behind the newest payment
// already here so one that settled late still arrives.
function monzo_since(?string $newest, int $connectedAt, int $now, string $floor): string
{
    $full = $connectedAt > 0 && $now - $connectedAt < MONZO_FULL_WINDOW;
    $from = strtotime($floor . ' 00:00:00 UTC') ?: 0;
    if (!$full) {
        $from = max($from, $now - MONZO_RECENT_DAYS * 86400);
        if ($newest) {
            $from = max($from, (strtotime($newest . ' UTC') ?: 0) - MONZO_OVERLAP_DAYS * 86400);
        }
    }
    return gmdate('Y-m-d\TH:i:s\Z', $from);
}

// One Monzo transaction as a bank line (statement-lib's shape), or null when it
// is not money that moved: declined, still pending, nothing, or another currency.
function monzo_line(array $tx, array $potNames = [], string $tz = 'Europe/London'): ?array
{
    $id = (string) ($tx['id'] ?? '');
    $created = (string) ($tx['created'] ?? '');
    if ($id === '' || $created === '' || !isset($tx['amount'])) {
        return null;
    }
    if (!empty($tx['decline_reason'])) {
        return null;
    }
    // A card payment waiting to settle can still change; it arrives once settled.
    if (array_key_exists('settled', $tx) && (string) $tx['settled'] === '') {
        return null;
    }
    $cur = strtoupper((string) ($tx['currency'] ?? 'GBP'));
    if ($cur !== 'GBP') {
        return null;
    }
    $pence = (int) $tx['amount'];
    if ($pence === 0) {
        return null;
    }
    try {
        $when = (new DateTimeImmutable($created))->setTimezone(new DateTimeZone($tz));
    } catch (\Throwable $e) {
        return null;
    }
    $amount = round($pence / 100, 2);
    $desc = (string) ($tx['description'] ?? '');
    $notes = (string) ($tx['notes'] ?? '');
    $meta = is_array($tx['metadata'] ?? null) ? $tx['metadata'] : [];
    $cp = is_array($tx['counterparty'] ?? null) ? $tx['counterparty'] : [];
    $merchant = is_array($tx['merchant'] ?? null) ? $tx['merchant'] : [];
    $scheme = (string) ($tx['scheme'] ?? '');
    $potId = (string) ($meta['pot_id'] ?? (preg_match('/^pot_\w+$/', $desc) ? $desc : ''));
    if ($scheme === 'uk_retail_pot' || $potId !== '') {
        $type = 'Pot transfer';
        $pot = $potNames[$potId] ?? '';
        $name = ($amount < 0 ? 'To ' : 'From ') . ($pot !== '' ? $pot . ' pot' : 'a pot');
        $desc = '';
    } else {
        $type = ['payport_faster_payments' => 'Faster payment', 'mastercard' => 'Card payment', 'bacs' => 'Direct debit'][$scheme]
            ?? ($scheme !== '' ? ucfirst(str_replace('_', ' ', $scheme)) : 'Payment');
        $name = (string) ($cp['name'] ?? '') ?: (string) ($merchant['name'] ?? '') ?: $desc;
    }
    $bal = isset($tx['account_balance']) && is_numeric($tx['account_balance']) ? round(((int) $tx['account_balance']) / 100, 2) : null;
    return [
        'ext_key' => 'm:' . substr((string) preg_replace('/[^A-Za-z0-9_-]/', '', $id), 0, 76),
        'date' => $when->format('Y-m-d'),
        'time' => $when->format('H:i:s'),
        'type' => mb_substr($type, 0, 40),
        'name' => mb_substr($name, 0, 160),
        'category' => mb_substr((string) ($tx['category'] ?? ''), 0, 60),
        'description' => mb_substr($desc === $name ? '' : $desc, 0, 255),
        'notes' => mb_substr($notes, 0, 255),
        'amount' => $amount,
        'balance' => $bal,
    ];
}

// How the link stands, for the page: one state and one sentence. $link is the
// stored record (monzo-link), $hasClient whether a client is saved, $hasToken
// whether a token is held.
function monzo_health(array $link, bool $hasClient, bool $hasToken, int $now): array
{
    if (!$hasClient) {
        return ['state' => 'off', 'say' => ''];
    }
    if (!empty($link['reconnect'])) {
        return ['state' => 'reconnect', 'say' => 'Monzo stopped accepting the link. Connect again to carry on.'];
    }
    if (!$hasToken) {
        return ['state' => 'ready', 'say' => 'Not connected yet.'];
    }
    $acc = (string) ($link['account_id'] ?? '');
    if ($acc === '') {
        if (!empty($link['no_business'])) {
            return ['state' => 'no_business', 'say' => 'Monzo shared ' . ((string) ($link['shared'] ?? '') ?: 'no accounts') . ', not the business account. Statements stay the way in.'];
        }
        return ['state' => 'approve', 'say' => 'Approve access in the Monzo app.'];
    }
    $ok = (int) ($link['last_ok'] ?? 0);
    $err = (string) ($link['last_error'] ?? '');
    if ($ok === 0) {
        return ['state' => $err !== '' ? 'error' : 'syncing', 'say' => $err !== '' ? $err : 'Fetching your payments.'];
    }
    if ($now - $ok > MONZO_STALE_HOURS * 3600) {
        return ['state' => 'stale', 'say' => $err !== '' ? $err : 'Hasn’t synced for a while.'];
    }
    return ['state' => 'live', 'say' => ''];
}

// Is the link doing the statements' job? While it is, no statement is asked for.
function monzo_is_live(array $health): bool
{
    return ($health['state'] ?? '') === 'live';
}
