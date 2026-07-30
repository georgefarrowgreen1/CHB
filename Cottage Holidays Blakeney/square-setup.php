<?php
// ============================================================
//  square-setup.php — admin: wire the Square webhook up automatically.
//
//  POST {action:'status'}  -> is the webhook connected? (enabled + key + events)
//  POST {action:'setup'}   -> create/enable the subscription via the Square API,
//                             capture its signing key, store it encrypted. Idempotent.
//
//  This removes the manual "register the URL + paste the signing key into
//  config.php" step: the app provisions its own webhook subscription (POST
//  /v2/webhooks/subscriptions) and reads the signature_key straight out of the
//  response, storing it as the private 'apikey-square-webhook' content key.
//  square-webhook.php then verifies against that (square_webhook_signing_key()).
//  If anything fails, the on-view Square reconcile (bookings.php) is still the
//  safety net — this just makes fees/refund statuses update INSTANTLY.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

// The events square-webhook.php acts on: payment status + processing fee, refund
// status, and disputes/chargebacks (logged for the owner).
// NB adding an event makes sq_subscription_ok() report an EXISTING install as not
// connected until "Connect automatic payment updates" is run again — which is the
// intended prompt, not a fault: the subscription genuinely lacks the new events.
// setup is idempotent, so re-running only adds them.
const SQ_WEBHOOK_EVENTS = [
    'payment.created',
    'payment.updated',
    'refund.created',
    'refund.updated',
    'dispute.created',
    'dispute.state.changed',
    // Payouts: what has actually reached the bank (payouts-lib.php). Without these
    // the payout cache is only as fresh as the nightly cron, so money that landed
    // this morning reads as still on its way until tomorrow.
    'payout.sent',
    'payout.paid',
    'payout.failed',
    // The bank account itself (bank-lib.php). A newly linked or newly verified
    // account is the difference between "nowhere for the money to go" and "on its
    // way", and the owner does that in Square, not here — so without these the
    // screen keeps saying no bank account until the next nightly cron.
    'bank_account.created',
    'bank_account.verified',
    'bank_account.disabled',
];

// Find OUR subscription (matching notification_url) among the merchant's, paging
// a few times defensively. Returns the subscription array or null.
function sq_find_subscription($url)
{
    $cursor = '';
    for ($i = 0; $i < 5; $i++) {
        $path = '/v2/webhooks/subscriptions' . ($cursor !== '' ? '?cursor=' . rawurlencode($cursor) : '');
        $res = square_api('GET', $path);
        if (($res['status'] ?? 0) !== 200) {
            return ['__error' => $res['body']['errors'][0]['detail'] ?? 'Could not read Square webhooks.'];
        }
        foreach ($res['body']['subscriptions'] ?? [] as $s) {
            if (($s['notification_url'] ?? '') === $url) {
                return $s;
            }
        }
        $cursor = $res['body']['cursor'] ?? '';
        if ($cursor === '') {
            break;
        }
    }
    return null;
}

// Does this subscription cover every event we need, and is it enabled?
function sq_subscription_ok($sub)
{
    if (!is_array($sub) || empty($sub['enabled'])) {
        return false;
    }
    $have = $sub['event_types'] ?? [];
    foreach (SQ_WEBHOOK_EVENTS as $e) {
        if (!in_array($e, $have, true)) {
            return false;
        }
    }
    return true;
}

$in = body();
$action = $in['action'] ?? 'status';
$url = square_webhook_url();
$apiV = defined('SQUARE_API_VERSION') ? SQUARE_API_VERSION : '2024-01-18';

// ---- Read-only status ----
if ($action === 'status') {
    // The Square LOCATIONS ride this response, because the Payments settings screen
    // already makes this one call — the picker had been reading a variable that only
    // the Move-money-out screen fills (__sweepLiab), so opening Settings directly left
    // it empty and the card hid itself every time. A control that cannot appear is
    // worse than no control.
    require_once __DIR__ . '/bank-lib.php';
    $bc = bank_cached();
    $locs = is_array($bc) ? ($bc['locations'] ?? []) : [];
    if (!$locs && square_enabled()) {
        // Nothing cached yet (a fresh install, or before the first refresh since this
        // shipped). Ask directly rather than making the owner wait for a cron: this is
        // an explicit settings screen and the endpoint is already talking to Square.
        try {
            $lr = square_api('GET', '/v2/locations');
            if ((int) $lr['status'] >= 200 && (int) $lr['status'] < 300) {
                $locs = locations_slim($lr['body']['locations'] ?? []);
            }
        } catch (\Throwable $e) {
        }
    }
    $out = [
        'square' => square_enabled(),
        'url' => $url,
        'hasKey' => square_webhook_signing_key() !== '',
        'connected' => false,
        'enabled' => false,
        'events' => [],
        'locations' => $locs,
        'location' => square_location_id(),
    ];
    if (!$out['square']) {
        json_out($out); // Square off → nothing to report
    }
    $sub = sq_find_subscription($url);
    if (is_array($sub) && isset($sub['__error'])) {
        $out['error'] = $sub['__error'];
        json_out($out);
    }
    if (is_array($sub)) {
        $out['enabled'] = !empty($sub['enabled']);
        $out['events'] = $sub['event_types'] ?? [];
        $out['connected'] = sq_subscription_ok($sub) && $out['hasKey'];
    }
    json_out($out);
}

// ---- Provision / repair the subscription ----
if ($action === 'setup') {
    if (!square_enabled()) {
        json_out(['error' => 'Turn Square card payments on first, then connect automatic updates.'], 400);
    }

    $sub = sq_find_subscription($url);
    if (is_array($sub) && isset($sub['__error'])) {
        json_out(['error' => $sub['__error']], 502);
    }

    $signingKey = '';
    if (!is_array($sub)) {
        // None yet → create it. The create response is the ONLY place Square hands
        // back the signature_key, so we capture it here.
        $res = square_api('POST', '/v2/webhooks/subscriptions', [
            'idempotency_key' => bin2hex(random_bytes(16)),
            'subscription' => [
                'name' => 'Cottage Holidays Blakeney',
                'event_types' => SQ_WEBHOOK_EVENTS,
                'notification_url' => $url,
                'api_version' => $apiV,
                'enabled' => true,
            ],
        ]);
        if (!in_array($res['status'] ?? 0, [200, 201], true) || empty($res['body']['subscription']['id'])) {
            json_out(['error' => $res['body']['errors'][0]['detail'] ?? 'Square could not create the webhook.'], 502);
        }
        $sub = $res['body']['subscription'];
        $signingKey = (string) ($sub['signature_key'] ?? '');
    } else {
        // Exists → make sure it's enabled and covers every event we need.
        if (!sq_subscription_ok($sub)) {
            $res = square_api('PUT', '/v2/webhooks/subscriptions/' . rawurlencode((string) $sub['id']), [
                'subscription' => ['enabled' => true, 'event_types' => SQ_WEBHOOK_EVENTS],
            ]);
            if (($res['status'] ?? 0) !== 200) {
                json_out(['error' => $res['body']['errors'][0]['detail'] ?? 'Square could not update the webhook.'], 502);
            }
        }
        // An update never returns the signing key. If we don't already have one
        // (fresh install, or key lost), rotate it so verification can succeed.
        if (square_webhook_signing_key() === '') {
            $res = square_api('POST', '/v2/webhooks/subscriptions/' . rawurlencode((string) $sub['id']) . '/signature-key', []);
            $signingKey = (string) ($res['body']['signature_key'] ?? '');
            if ($signingKey === '') {
                json_out(['error' => $res['body']['errors'][0]['detail'] ?? 'Square could not issue a signing key.'], 502);
            }
        }
    }

    // Persist: signing key ENCRYPTED (private apikey- key), subscription id plain.
    try {
        if ($signingKey !== '') {
            content_set_secret('apikey-square-webhook', $signingKey);
        }
        if (!empty($sub['id'])) {
            content_set_scalar('square-webhook-sub-id', (string) $sub['id']);
        }
    } catch (\Throwable $e) {
        json_out(['error' => 'Connected at Square, but could not save the key locally.'], 500);
    }

    if (function_exists('log_activity')) {
        log_activity('payment', 'square.webhook_connected', 'Automatic payment updates connected (Square webhook).', ['entity' => 'square', 'entity_id' => (string) ($sub['id'] ?? '')]);
    }

    json_out([
        'ok' => true,
        'connected' => square_webhook_signing_key() !== '',
        'events' => SQ_WEBHOOK_EVENTS,
        'url' => $url,
    ]);
}

// ---- Refresh the payout cache on demand ----
// Payouts are pulled by the daily cron (self-repair.php) so no page ever waits on
// Square. This is the owner asking explicitly — the one place a wait is fair,
// because they chose it and the button says what it is doing.
if ($action === 'payouts_refresh') {
    require_once __DIR__ . '/payouts-lib.php';
    require_once __DIR__ . '/bank-lib.php';
    // Both halves of the same question. A payout feed that reports nothing and a
    // missing bank account look identical on screen until you ask this too, so the
    // owner's one tap asks both rather than answering half of it.
    $bank = bank_refresh();
    $r = payouts_refresh();
    if (empty($r['ok'])) {
        // A plain sentence, not a status code: this reaches the owner's screen.
        json_out(['error' => $r['reason'] ?: 'Couldn\'t reach Square just now.'], 200);
    }
    json_out(['ok' => true, 'payouts' => $r['payouts'], 'charges' => $r['charges'], 'bank' => (int) ($bank['accounts'] ?? 0), 'checked' => time()]);
}

json_out(['error' => 'Unknown action'], 400);
