<?php
// ============================================================
//  monzo.php — the live link to the Monzo Business account (Payments → Monzo
//  Business). The decisions are monzo-lib.php; the talking is monzo-sync.php.
//
//  POST {action:'status'}                     -> how the link stands (no secrets)
//  POST {action:'save_client', client_id, client_secret} -> the owner's developer
//                                                client from developers.monzo.com
//  POST {action:'connect'}                    -> the Monzo address to send them to
//  POST {action:'check'}                      -> approved in the app yet? (polled
//                                                while waiting; syncs at once when it is)
//  POST {action:'sync'}                       -> fetch new payments now
//  POST {action:'disconnect'}                 -> drop the link (payments stay)
//
//  Connecting and disconnecting are full access only; checking and syncing are
//  the money area's (people-lib).
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/monzo-sync.php';
require_admin();

function monzo_out(array $extra = []): void
{
    json_out(array_merge(['ok' => true], $extra, ['live' => monzo_status()]));
}
// A sync kept the link past the wait: say so, and change nothing.
function monzo_busy(): void
{
    json_out(['error' => 'Monzo Business is syncing right now. Try again in a minute.', 'code' => 'busy'], 409);
}
function monzo_need_tables(): void
{
    try {
        db()->query('SELECT 1 FROM bank_lines LIMIT 1');
    } catch (\Throwable $e) {
        json_out(['error' => 'The live link needs a database update first. Open Manage → Status and run the updates.'], 409);
    }
}

route_actions([
    'status' => function ($in) {
        monzo_out();
    },

    'save_client' => function ($in) {
        if (monzo_client()['const']) {
            json_out(['error' => 'The client is set in the server’s configuration, so it is changed there.'], 409);
        }
        $id = trim((string) ($in['client_id'] ?? ''));
        $secret = trim((string) ($in['client_secret'] ?? ''));
        $why = monzo_client_problem($id, $secret);
        if ($why !== '') {
            json_out(['error' => $why], 400);
        }
        content_set_secret('monzo-client', ['id' => $id, 'secret' => $secret]);
        log_activity('payment', 'monzo.client', 'Monzo developer client saved', ['entity' => 'monzo']);
        monzo_out();
    },

    'connect' => function ($in) {
        monzo_need_tables();
        $c = monzo_client();
        if ($c['id'] === '') {
            json_out(['error' => 'Add the client from developers.monzo.com first.'], 409);
        }
        // The return is matched against this, and it is single-use. Kept on the
        // server rather than in the session: Monzo's email link often opens in a
        // different browser from the one that asked (an installed app on a phone).
        $state = bin2hex(random_bytes(16));
        [$got] = monzo_locked(function () use ($state) {
            $l = monzo_link();
            $l['pending'] = hash('sha256', $state);
            $l['pending_at'] = time();
            monzo_link_save($l);
            return true;
        }, monzo_lock_wait());
        if (!$got) {
            monzo_busy();
        }
        monzo_out(['url' => monzo_auth_url($c['id'], monzo_redirect_url(), $state)]);
    },

    'check' => function ($in) {
        monzo_need_tables();
        $state = monzo_check();
        $sum = null;
        // Approved inside the first five minutes: Monzo shares the whole history
        // only now, so it is fetched at once.
        if ($state === 'syncing') {
            $sum = monzo_sync();
        }
        monzo_out(['sync' => $sum]);
    },

    'sync' => function ($in) {
        monzo_need_tables();
        $sum = monzo_sync();
        if ($sum['ok'] && $sum['added'] > 0) {
            log_activity('payment', 'monzo.sync', 'Monzo Business — ' . $sum['added'] . ' new payment' . ($sum['added'] === 1 ? '' : 's'), ['entity' => 'monzo']);
        }
        monzo_out(['sync' => $sum]);
    },

    'disconnect' => function ($in) {
        // Under the sync's lock: a sync or a refresh in flight finishes first, so
        // nothing it saves afterwards can bring the link back.
        [$got] = monzo_locked(function () {
            $a = monzo_auth();
            if (!empty($a['access'])) {
                // Best effort: tell Monzo the token is finished with.
                monzo_http('POST', '/oauth2/logout', (string) $a['access'], []);
            }
            monzo_auth_save([]);
            monzo_link_save([]);
            return true;
        }, monzo_lock_wait());
        if (!$got) {
            monzo_busy();
        }
        log_activity('payment', 'monzo.disconnect', 'Monzo Business link disconnected — the payments already added are kept', ['entity' => 'monzo']);
        monzo_out();
    },
]);
