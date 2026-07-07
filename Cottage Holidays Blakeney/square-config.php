<?php
// ============================================================
//  square-config.php — public, read-only Square front-end config.
//  GET -> { enabled, environment, applicationId, locationId }
//  Only PUBLIC values are exposed (the Web Payments SDK needs the application
//  + location IDs). The access token and webhook key never leave the server.
//  Mirrors push.php?action=key handing the client the VAPID public key.
// ============================================================
require_once __DIR__ . '/db.php';

// The payload, as a function so bootstrap.php can serve the SAME data in its
// combined first-paint response without duplicating this logic.
function square_config_payload()
{
    return [
        'enabled' => square_enabled(),
        'environment' => defined('SQUARE_ENVIRONMENT') ? SQUARE_ENVIRONMENT : 'sandbox',
        'applicationId' => square_enabled() && defined('SQUARE_APPLICATION_ID') ? SQUARE_APPLICATION_ID : '',
        'locationId' => square_enabled() && defined('SQUARE_LOCATION_ID') ? SQUARE_LOCATION_ID : '',
    ];
}

// Serve only when this file is the request (bootstrap.php includes it as a lib).
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'square-config.php') {
    return;
}

json_out(square_config_payload());
