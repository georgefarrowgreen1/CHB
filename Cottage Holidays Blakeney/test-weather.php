<?php
// ============================================================
//  test-weather.php — the pure parts of weather-data.php. DEV/CI only
//  (deploy-excluded with the other test-*.php).
//
//      php test-weather.php
//
//  Deliberately tests NO NETWORK. weather_daily() reaches Open-Meteo, and a test
//  that depends on a third party's uptime is a test that fails for reasons that
//  are nothing to do with this codebase. What IS worth pinning is the judgement:
//  which forecasts are worth interrupting the owner for, and how a WMO code reads
//  in English. Those are the parts a change could silently get wrong.
// ============================================================
require_once __DIR__ . '/weather-data.php';

$fails = 0;
function chk($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  ✓ $name\n";
    } else {
        $fails++;
        echo "  ✗ $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

echo "\n== weather: plain English + what's worth saying ==\n";

// ---- 1. codes read like a person talking ----
chk('code 0 is clear', weather_code_text(0) === 'clear', weather_code_text(0));
chk('code 3 is cloudy', weather_code_text(3) === 'cloudy', weather_code_text(3));
chk('code 63 is rain', weather_code_text(63) === 'rain', weather_code_text(63));
chk('code 95 is thunderstorms', weather_code_text(95) === 'thunderstorms', weather_code_text(95));
chk('code 48 is fog', weather_code_text(48) === 'fog', weather_code_text(48));
chk('code 71 is snow', weather_code_text(71) === 'snow', weather_code_text(71));
chk('an unknown code says nothing rather than guessing', weather_code_text(999) === '', weather_code_text(999));
chk('a missing code says nothing', weather_code_text(null) === '', (string) weather_code_text(null));

// ---- 2. NOTABLE — the brief may only interrupt when it changes what you'd do.
// This is the whole discipline of the feature: "18°C and cloudy" every morning
// trains the owner to ignore the panel, so an ordinary day must return null.
echo "\n-- worth mentioning unasked? --\n";
$ordinary = ['date' => '2026-08-01', 'code' => 3, 'tmax' => 19, 'tmin' => 12, 'wind' => 12, 'gust' => 22, 'rain' => 1.0];
chk('an ordinary summer day is NOT worth a row', weather_notable($ordinary) === null, json_encode(weather_notable($ordinary)));

$gale = array_merge($ordinary, ['gust' => 52]);
$g = weather_notable($gale);
chk('a gale is', is_array($g) && $g['kind'] === 'gale', json_encode($g));
chk('and it names the gust so the owner can judge it', is_array($g) && strpos($g['say'], '52') !== false, json_encode($g));

$breezy = array_merge($ordinary, ['gust' => 44]);
chk('44mph is still just breezy — the threshold is a real edge, not decoration', weather_notable($breezy) === null, json_encode(weather_notable($breezy)));

$ice = array_merge($ordinary, ['tmin' => 0]);
$i = weather_notable($ice);
chk('freezing is worth saying (pipes, an empty cottage)', is_array($i) && $i['kind'] === 'ice', json_encode($i));
chk('1°C is not', weather_notable(array_merge($ordinary, ['tmin' => 1])) === null, json_encode(weather_notable(array_merge($ordinary, ['tmin' => 1]))));

$heat = array_merge($ordinary, ['tmax' => 29]);
$h = weather_notable($heat);
chk('a heatwave is', is_array($h) && $h['kind'] === 'heat', json_encode($h));

$wet = array_merge($ordinary, ['rain' => 24.0]);
$w = weather_notable($wet);
chk('a soaking is', is_array($w) && $w['kind'] === 'rain', json_encode($w));

// ---- 3. precedence: wind beats everything. A freezing gale is a WIND problem
// for a boat and an arriving guest; leading with the temperature would bury it.
$both = array_merge($ordinary, ['gust' => 60, 'tmin' => -2]);
$b = weather_notable($both);
chk('a freezing gale reports as a GALE, not as ice', is_array($b) && $b['kind'] === 'gale', json_encode($b));

// ---- 4. junk in, null out — never a crash and never a false alarm ----
chk('garbage is not notable', weather_notable('not a day') === null);
chk('an empty day is not notable', weather_notable([]) === null);
chk('missing fields are not notable', weather_notable(['date' => '2026-01-01']) === null);

echo "\n" . ($fails ? "  $fails WEATHER CHECK(S) FAILED ❌\n\n" : "  ALL WEATHER CHECKS PASSED ✅\n\n");
exit($fails ? 1 : 0);
