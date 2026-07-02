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

// Full pick-your-address list — only when the owner has pasted an address-lookup
// key in Settings → Integrations (house-level data is Royal Mail-licensed; the
// open data above has none). The provider is detected from the key format:
//   ak_…            -> Ideal Postcodes (pay-as-you-go PAF reseller)
//   anything else   -> OS Places API (OS Data Hub project key)
// Soft per-session cap so a scripted visitor can't burn the owner's lookup
// credit. Failures just omit the list; recognition still works.
if (isset($_GET['addresses'])) {
    $key = content_value('apikey-address');
    $used = (int)($_SESSION['pc_addr_lookups'] ?? 0);
    if ($key !== '' && $used < 40) {
        $_SESSION['pc_addr_lookups'] = $used + 1;
        $tidy = function ($s) {   // licensed feeds are UPPERCASE; title-case for display
            return preg_replace_callback('/[A-Za-z][A-Za-z\']*/u', fn($m) => mb_convert_case(mb_strtolower($m[0]), MB_CASE_TITLE), $s);
        };
        $url = (strpos($key, 'ak_') === 0)
            ? 'https://api.ideal-postcodes.co.uk/v1/postcodes/' . rawurlencode($resp['postcode']) . '?api_key=' . rawurlencode($key)
            : 'https://api.os.uk/search/places/v1/postcode?postcode=' . rawurlencode($resp['postcode']) . '&key=' . rawurlencode($key);
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 3]);
        $araw = curl_exec($ch);
        $ast = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($ast === 200 && $araw) {
            $ad = json_decode($araw, true);
            $list = [];
            if (strpos($key, 'ak_') === 0) {
                // Ideal Postcodes: result[] rows with line_1/2/3 + post_town.
                foreach ((array)($ad['result'] ?? []) as $row) {
                    if (!is_array($row)) continue;
                    $parts = array_values(array_filter(array_map('trim', [
                        (string)($row['line_1'] ?? ''), (string)($row['line_2'] ?? ''),
                        (string)($row['line_3'] ?? ''), $tidy((string)($row['post_town'] ?? '')),
                    ]), fn($x) => $x !== ''));
                    if ($parts) $list[] = implode(', ', $parts);
                    if (count($list) >= 60) break;
                }
            } else {
                // OS Places: results[].DPA.ADDRESS is one UPPERCASE line ending in the postcode.
                foreach ((array)($ad['results'] ?? []) as $row) {
                    $line = (string)($row['DPA']['ADDRESS'] ?? '');
                    if ($line === '') continue;
                    $line = trim(preg_replace('/,\s*' . preg_quote($resp['postcode'], '/') . '\s*$/i', '', $line));
                    if ($line !== '') $list[] = $tidy($line);
                    if (count($list) >= 60) break;
                }
            }
            if ($list) $resp['addresses'] = $list;
        }
    }
}

json_out($resp);
