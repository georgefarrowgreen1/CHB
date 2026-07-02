<?php
// ============================================================
//  postcode-lookup.php — is this a REAL UK postcode, and where is it?
//
//  Powers the live "✓ NR25 7AB — Blakeney, Norfolk" recognition on the
//  enquiry form. Proxies api.postcodes.io (free, open ONS/OS data, no key)
//  server-side so the browser never talks to a third party (CSP stays
//  tight) . Best-effort by design: on any failure the caller shows nothing
//  and the form's own format validation still applies.
//
//    GET ?pc=NR25 7AB  ->  { ok:true, valid:true,  place:"Blakeney, Norfolk" }
//                          { ok:true, valid:false }             (real lookup, no such postcode)
//                          { ok:false }                          (couldn't check)
// ============================================================
require_once __DIR__ . '/db.php';

$pc = strtoupper(trim((string)($_GET['pc'] ?? '')));
$pc = preg_replace('/[^A-Z0-9 ]/', '', $pc);
if ($pc === '' || strlen($pc) > 10) json_out(['ok' => false]);

$ch = curl_init('https://api.postcodes.io/postcodes/' . rawurlencode($pc));
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 4,
    CURLOPT_CONNECTTIMEOUT => 3,
]);
$raw = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($status === 404) json_out(['ok' => true, 'valid' => false]);
if ($status !== 200 || !$raw) json_out(['ok' => false]);

$d = json_decode($raw, true);
$r = $d['result'] ?? null;
if (!is_array($r)) json_out(['ok' => false]);

// Friendliest available "place" line: parish/town first, then county/region.
$town = trim((string)($r['parish'] ?? ''));
$town = trim(preg_replace('/,?\s*unparished area$/i', '', $town));
if ($town === '') $town = trim((string)($r['admin_district'] ?? ''));
$county = trim((string)($r['admin_county'] ?? '')) ?: trim((string)($r['region'] ?? ''));
$place = trim($town . ($county && strcasecmp($county, $town) !== 0 ? ', ' . $county : ''), ', ');

$resp = ['ok' => true, 'valid' => true, 'place' => $place, 'postcode' => (string)($r['postcode'] ?? $pc)];

json_out($resp);
