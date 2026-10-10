<?php
// ============================================================
//  monzo-callback.php — where Monzo sends the owner back after they confirm the
//  link (the redirect URL pasted into their client at developers.monzo.com).
//
//  Authorised by the single-use state monzo.php 'connect' stored (sha256 only, 15
//  minutes), NOT by the admin session: Monzo's sign-in arrives by email, and on a
//  phone that link opens in the browser, not the installed app the owner started
//  from, so the session is often not here. The code is exchanged for a token, and
//  the page says what is left: approve access in the Monzo app, then go back to
//  the Payments page, which takes it from there.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/monzo-sync.php';
rate_limit('monzo-callback', 12, 10);

function monzo_page(string $title, string $say, bool $ok): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    $t = htmlspecialchars($title, ENT_QUOTES);
    $s = htmlspecialchars($say, ENT_QUOTES);
    $mark = $ok ? '&#10003;' : '!';
    echo '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . $t . '</title>'
        . '<style>:root{--bg:#F5F1E9;--card:#FDFCFA;--ink:#1d2328;--muted:#52646E;--edge:#e4ddd0;--mark:' . ($ok ? '#2e7d4f' : '#9C5300') . ';--btn:#C6885E;--btnink:#1B1208}'
        . '@media (prefers-color-scheme: dark){:root{--bg:#121316;--card:#16171A;--ink:#f1efe9;--muted:#a9b1b6;--edge:#242528;--mark:' . ($ok ? '#7ccf9a' : '#ffb74d') . ';--btn:#D6A785}}'
        . 'body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 Montserrat,-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}'
        . 'main{max-width:420px;width:100%;background:var(--card);border:1px solid var(--edge);border-radius:20px;padding:28px 24px;text-align:center}'
        . '.m{width:52px;height:52px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;font-size:26px;color:var(--mark);border:2px solid var(--mark)}'
        . 'h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:var(--muted);margin:0 0 20px}'
        . 'a{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:999px;background:var(--btn);color:var(--btnink);font-weight:600;text-decoration:none}</style></head>'
        . '<body><main><div class="m" aria-hidden="true">' . $mark . '</div><h1>' . $t . '</h1><p>' . $s . '</p><a href="./?open=accounts:bank">Back to Payments</a></main></body></html>';
    exit;
}

$state = (string) ($_GET['state'] ?? '');
$code = (string) ($_GET['code'] ?? '');
// Under the sync's lock (monzo_locked): a sync finishing just after the new tokens
// were saved would otherwise write the old link back over them. Nothing is used up
// before the lock is held, so a busy answer can simply be reloaded.
[$got, $page] = monzo_locked(function () use ($state, $code) {
    $l = monzo_link();
    $pending = (string) ($l['pending'] ?? '');
    $fresh = (int) ($l['pending_at'] ?? 0) > time() - 900;
    if ($state === '' || $pending === '' || !$fresh || !hash_equals($pending, hash('sha256', $state))) {
        return ['That link has expired', 'Start again from Payments → Monzo Business → Connect. Nothing was changed.', false];
    }
    // Single use, whatever happens next.
    unset($l['pending'], $l['pending_at']);
    monzo_link_save($l);
    if (!empty($_GET['error']) || $code === '') {
        return ['Monzo wasn’t connected', 'Monzo didn’t give permission. You can try again from the Payments page.', false];
    }
    $c = monzo_client();
    $r = monzo_http('POST', '/oauth2/token', '', [
        'grant_type' => 'authorization_code', 'client_id' => $c['id'], 'client_secret' => $c['secret'],
        'redirect_uri' => monzo_redirect_url(), 'code' => $code,
    ]);
    $t = $r['status'] === 200 ? monzo_token_read($r['body'], time()) : null;
    if ($t === null) {
        return ['Monzo wasn’t connected', $r['status'] === 0 ? 'Monzo couldn’t be reached. Try again in a minute.' : 'Monzo refused the link. Check the client ID and secret, then try again.', false];
    }
    monzo_auth_save($t);
    $l = monzo_link();
    // A fresh connection: forget how the last one ended.
    $l = array_diff_key($l, array_flip(['reconnect', 'no_business', 'shared', 'last_error', 'account_id', 'account', 'last_ok']));
    $l['connected_at'] = time();
    monzo_link_save($l);
    log_activity('payment', 'monzo.connect', 'Monzo Business link connected — waiting for approval in the Monzo app', ['entity' => 'monzo', 'actor' => 'owner']);
    return ['Now approve it in the Monzo app', 'Monzo has sent a notification asking you to allow access. Approve it, then go back to Payments: your payments arrive by themselves from then on.', true];
}, monzo_lock_wait());
if (!$got) {
    monzo_page('Monzo Business is busy', 'A sync is running. Reload this page in a minute to finish connecting.', false);
}
monzo_page((string) $page[0], (string) $page[1], (bool) $page[2]);
