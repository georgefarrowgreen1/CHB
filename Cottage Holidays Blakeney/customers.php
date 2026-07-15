<?php
// ============================================================
//  customers.php — the unified customer directory's server side.
//
//  The directory itself is built CLIENT-side (admin.js chbCustomers) over the
//  in-memory booking store; this endpoint is the SAFEGUARD layer:
//
//  POST {action:'audit', name, ref}  -> record a customer LOOKUP in the activity
//        log (a GDPR-friendly access trail for guest PII — who looked up whom,
//        when). Deduped within the hour so a browse session doesn't spam the log,
//        and it stores the NAME + a NON-PII ref hash only — never the raw email
//        or phone.
//
//  Admin-only (require_admin) — guests can never reach it.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

$in = body();
$action = $in['action'] ?? '';

if ($action === 'audit') {
    $name = clean($in['name'] ?? '', 120);
    $ref = clean($in['ref'] ?? '', 40); // opaque client hash of the identity key — not PII
    if ($name === '' && $ref === '') {
        json_out(['ok' => false]);
    }
    $label = $name !== '' ? $name : $ref;
    $summary = 'Looked up customer — ' . $label;
    // Dedupe: at most one lookup entry per customer per hour.
    try {
        $seen = db()->prepare(
            "SELECT 1 FROM activity_log
              WHERE action = 'customer.lookup' AND summary = ?
                AND created_at > (NOW() - INTERVAL 1 HOUR) LIMIT 1"
        );
        $seen->execute([$summary]);
        if (!$seen->fetch()) {
            log_activity('account', 'customer.lookup', $summary, ['meta' => ['ref' => $ref]]);
        }
    } catch (\Throwable $e) {
        // The audit trail is best-effort — never block a lookup on a log write.
    }
    json_out(['ok' => true]);
}

json_out(['ok' => false, 'error' => 'Unknown action'], 400);
