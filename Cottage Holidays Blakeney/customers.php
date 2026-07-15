<?php
// ============================================================
//  customers.php — the unified customer directory's server side.
//
//  The directory itself is built CLIENT-side (admin.js chbCustomers) over the
//  in-memory booking store; this endpoint is the SAFEGUARD layer:
//
//  POST {action:'directory', q}      -> group the WHOLE bookings history into
//        UNIFIED customers matching q (name/email/phone/postcode), by STRONG
//        identity only (exact email, else phone digits, NEVER name — false-merge
//        protection, same rule as the client). Returns repeat customers (>=2
//        stays) with lifetime nights + revenue, so a PAST guest not held in the
//        browser still surfaces as one person.
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
require_once __DIR__ . '/customers-lib.php';
require_admin();

$in = body();
$action = $in['action'] ?? '';

if ($action === 'directory') {
    $q = is_string($in['q'] ?? '') ? trim($in['q']) : '';
    if (mb_strlen($q) < 2) {
        json_out(['customers' => []]);
    }
    // Bounded LIKE across the identifying columns, wildcards escaped so a stray
    // % / _ is literal. Fully parameterised — no interpolation of user input.
    $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($q)) . '%';
    $rows = [];
    try {
        $st = db()->prepare(
            "SELECT id, prop_key, name, email, phone, check_in, check_out,
                    COALESCE(price_override, agreed_total, 0) AS total
               FROM bookings
              WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ?
                 OR LOWER(phone) LIKE ? OR LOWER(postcode) LIKE ?
              ORDER BY check_in DESC
              LIMIT 400"
        );
        $st->execute([$like, $like, $like, $like]);
        $rows = $st->fetchAll();
    } catch (\Throwable $e) {
        json_out(['customers' => []]);
    }
    // Group by STRONG identity (email/phone, never name) — the shared library, so
    // the server directory and the client's chbCustomers agree by construction.
    $cust = customers_group($rows);
    // Only REPEAT customers (>=2 stays) earn a unified row here — a single stay is
    // already shown as its booking. Most recent first, capped.
    $out = array_values(array_filter($cust, fn($c) => $c['stays'] >= 2));
    usort($out, fn($a, $z) => strcmp((string) $z['last'], (string) $a['last']));
    $out = array_slice($out, 0, 20);
    $customers = array_map(fn($c) => [
        'key' => $c['key'],
        'name' => $c['name'] !== '' ? $c['name'] : '(no name)',
        'stays' => $c['stays'],
        'nights' => $c['nights'],
        'revenue' => round($c['revenue'], 2),
        'last' => $c['last'],
        'first' => $c['first'],
        'latest_id' => $c['latest_id'],
        'props' => $c['props'],
    ], $out);
    json_out(['customers' => $customers]);
}

if ($action === 'audit') {
    $rawName = $in['name'] ?? '';
    $rawRef = $in['ref'] ?? '';
    $name = is_string($rawName) ? mb_substr(trim($rawName), 0, 120) : '';
    $ref = is_string($rawRef) ? mb_substr(trim($rawRef), 0, 40) : ''; // opaque client hash — not PII
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
