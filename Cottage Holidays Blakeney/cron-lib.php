<?php
// ============================================================
//  cron-lib.php — the scheduled jobs' own key. Pure: no database and no request
//  globals (callers pass $_SERVER and $_GET), so test-cron-key.php drives it.
//
//  A job starts when its web address is asked for, and the web server writes every
//  address it is asked for into its access log. Those addresses used to carry
//  APP_SECRET, the key that encrypts the door codes and private photos and signs every
//  link the app sends, so the server's log held the master key many times a day. The
//  jobs now have their own key, which can do nothing but start them.
// ============================================================

// The job key: CRON_SECRET from config.php when one is set (20+ characters, not the
// master key), else derived from APP_SECRET, so nothing needs setting up. deploy.yml
// derives the same value with openssl; test-cron-key.php holds the two equal.
function cron_key(): string
{
    $master = defined('APP_SECRET') ? (string) APP_SECRET : '';
    if (defined('CRON_SECRET') && is_string(CRON_SECRET) && strlen(CRON_SECRET) >= 20 && CRON_SECRET !== $master) {
        return CRON_SECRET;
    }
    return $master === '' ? '' : substr(hash_hmac('sha256', 'cron|v1', $master), 0, 40);
}

// What a request presents, where the senders put it: the X-CHB-Cron header (the job
// runner and the deploy, kept out of the logged address), ?cron= (a scheduler's
// address), and the path after the script name (cron.php/<key>, for scheduler panels
// that refuse a "?").
function cron_presented(array $server, array $get, bool $allowPath): array
{
    $out = [];
    $path = $allowPath ? ltrim((string) ($server['PATH_INFO'] ?? ''), '/') : '';
    foreach ([$server['HTTP_X_CHB_CRON'] ?? '', $get['cron'] ?? '', $path] as $c) {
        if (is_string($c) && $c !== '') {
            $out[] = $c;
        }
    }
    return $out;
}

// 'key' for the job key; 'master' for APP_SECRET, which the old addresses carry and which
// still works so a scheduler nobody has changed keeps running (the caller notes it, and
// Status asks for the address to change); '' for anything else.
function cron_auth(array $server, array $get, bool $allowPath = false): string
{
    $key = cron_key();
    $master = defined('APP_SECRET') ? (string) APP_SECRET : '';
    $via = '';
    foreach (cron_presented($server, $get, $allowPath) as $c) {
        if ($key !== '' && hash_equals($key, $c)) {
            return 'key';
        }
        if ($master !== '' && hash_equals($master, $c)) {
            $via = 'master';
        }
    }
    return $via;
}

// The address for the daily scheduler (IONOS): the job key as a path segment, which
// panels that refuse a "?" still accept.
function cron_address(string $base): string
{
    return rtrim($base, '/') . '/cron.php/' . rawurlencode(cron_key());
}

// Whether the scheduler still sends the master key, from the times cron.php noted: it has
// moved once a run arrived with the job key at least as recently as one with the master
// key. Nothing noted yet reads as not moved, because the old addresses are the only ones
// that existed before the job key.
function cron_master_in_use(array $seen): bool
{
    $master = (int) ($seen['master_at'] ?? 0);
    $key = (int) ($seen['key_at'] ?? 0);
    return !($key > 0 && $key >= $master);
}

// How the job runner asks for one job: the key in the X-CHB-Cron header, and a
// placeholder in ?cron= (ical-import.php routes on it). $inUrl puts the key in the address
// instead, for a host that does not pass the header on.
function cron_job_request(string $base, string $path, string $key, bool $inUrl): array
{
    return [
        'url' => $base . $path . ($inUrl ? rawurlencode($key) : 'header'),
        'headers' => $inUrl ? [] : ['X-CHB-Cron: ' . $key],
    ];
}

// A job that answers 401 or 403 did not accept the key; any other answer did.
function cron_job_refused(int $status): bool
{
    return $status === 401 || $status === 403;
}
