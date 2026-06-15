<?php
// ============================================================
//  square-config.php — public, read-only Square front-end config.
//  GET -> { enabled, environment, applicationId, locationId }
//  Only PUBLIC values are exposed (the Web Payments SDK needs the application
//  + location IDs). The access token and webhook key never leave the server.
//  Mirrors push.php?action=key handing the client the VAPID public key.
// ============================================================
require_once __DIR__ . '/db.php';

json_out([
    'enabled'       => square_enabled(),
    'environment'   => defined('SQUARE_ENVIRONMENT') ? SQUARE_ENVIRONMENT : 'sandbox',
    'applicationId' => (square_enabled() && defined('SQUARE_APPLICATION_ID')) ? SQUARE_APPLICATION_ID : '',
    'locationId'    => (square_enabled() && defined('SQUARE_LOCATION_ID')) ? SQUARE_LOCATION_ID : '',
]);
