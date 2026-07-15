<?php
// ============================================================
//  customers-lib.php — the pure customer-grouping logic for the unified directory,
//  split out so it can be unit-tested (test-customers.php) without the endpoint's
//  admin gate / DB. Mirrors the client rule (admin.js chbCustomerKey/chbCustomers)
//  so the two directories agree by construction.
// ============================================================

// STRONG identity for a booking row: exact email, else phone digits (last 10),
// else the booking's own id. NEVER name — two different "John Smith"s, or a
// name-only booking with no contact, must NOT merge (false-merge protection).
function customers_key(array $b): string
{
    $email = strtolower(trim((string) ($b['email'] ?? '')));
    if ($email !== '' && strpos($email, '@') > 0) {
        return 'e:' . $email;
    }
    $phone = preg_replace('/[^0-9]/', '', (string) ($b['phone'] ?? '')) ?? '';
    if (strlen($phone) >= 7) {
        return 'p:' . substr($phone, -10);
    }
    return 'b:' . (string) ($b['id'] ?? '');
}

// Group booking rows into unified customers. Each row needs: id, prop_key, name,
// email, phone, check_in, check_out, total. Returns customers keyed by identity,
// each with stays / lifetime nights + revenue / first + last stay / latest id.
// Not filtered or sorted here — the caller decides (the endpoint keeps repeats).
function customers_group(array $rows): array
{
    $cust = [];
    foreach ($rows as $b) {
        $key = customers_key($b);
        if (!isset($cust[$key])) {
            $cust[$key] = ['key' => $key, 'name' => '', 'stays' => 0, 'nights' => 0,
                'revenue' => 0.0, 'last' => null, 'first' => null, 'latest_id' => null, 'props' => []];
        }
        $c = &$cust[$key];
        $c['stays']++;
        if ($c['name'] === '' && trim((string) ($b['name'] ?? '')) !== '') {
            $c['name'] = trim((string) $b['name']);
        }
        $ci = ($b['check_in'] ?? null) ?: null;
        $co = ($b['check_out'] ?? null) ?: null;
        $ni = $ci ? (int) strtotime((string) $ci) : 0;
        $no = $co ? (int) strtotime((string) $co) : 0;
        $c['nights'] += ($ni && $no) ? max(0, (int) round(($no - $ni) / 86400)) : 0;
        $c['revenue'] += (float) ($b['total'] ?? 0);
        if ($ci && ($c['last'] === null || $ci > $c['last'])) {
            $c['last'] = $ci;
            $c['latest_id'] = (int) ($b['id'] ?? 0);
        }
        if ($ci && ($c['first'] === null || $ci < $c['first'])) {
            $c['first'] = $ci;
        }
        $pk = (string) ($b['prop_key'] ?? '');
        if ($pk !== '' && !in_array($pk, $c['props'], true)) {
            $c['props'][] = $pk;
        }
        unset($c);
    }
    return $cust;
}
