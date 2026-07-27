<?php
// ============================================================
//  weather-data.php — the daily forecast for Blakeney.
//
//    weather_daily($days = 5) -> ['ok'=>true, 'days'=>[{date,code,tmax,tmin,wind,
//                                 gust,rain,summary}], 'cached'=>?]
//                             -> ['ok'=>false, 'reason'=>'…'] on any failure
//
//  Shaped deliberately like tide_extremes(): same return contract, same
//  degrade-quietly rule, so the two coastal facts behave identically at every
//  call site and one helper can pair them without special cases.
//
//  Open-Meteo needs NO API KEY, no account and no payment, which is the reason it
//  was chosen over the Met Office — tides already cost the owner a key
//  (apikey-tides) and a second one would be a second thing to go stale.
//
//  Cached in the CONTENT TABLE (weather-cache, classified internal in db.php)
//  rather than a new table: it is one row rewritten a few times a day, and a
//  migration for that would be ceremony. Three hours is plenty — a forecast that
//  moves within three hours is not a forecast anyone should act on.
// ============================================================
require_once __DIR__ . '/db.php';

if (!function_exists('weather_daily')) {
    // Blakeney quay. Fixed rather than derived from the properties table: all
    // three cottages are inside the same village and the forecast grid is ~1km,
    // so per-cottage coordinates would be false precision.
    // define(), not const: `const` is only legal at the top level of a file or a
    // class, and this whole block sits inside the function_exists guard.
    defined('WEATHER_LAT') || define('WEATHER_LAT', 52.955);
    defined('WEATHER_LON') || define('WEATHER_LON', 0.972);
    defined('WEATHER_CACHE_KEY') || define('WEATHER_CACHE_KEY', 'weather-cache');
    defined('WEATHER_TTL') || define('WEATHER_TTL', 10800); // 3h

    function weather_daily($days = 5)
    {
        $days = max(1, min(14, (int) $days));

        // ---- cache ----
        try {
            $raw = content_value(WEATHER_CACHE_KEY);
            if ($raw) {
                $c = json_decode($raw, true);
                if (
                    is_array($c) && !empty($c['at']) && !empty($c['days'])
                    && (time() - (int) $c['at']) < WEATHER_TTL
                    && count($c['days']) >= $days
                ) {
                    return ['ok' => true, 'days' => array_slice($c['days'], 0, $days), 'cached' => true];
                }
            }
        } catch (Throwable $e) {
            // A cache miss is never a failure — fall through and fetch.
        }

        // ---- fetch ----
        $url = 'https://api.open-meteo.com/v1/forecast'
            . '?latitude=' . WEATHER_LAT
            . '&longitude=' . WEATHER_LON
            . '&daily=weather_code,temperature_2m_max,temperature_2m_min,'
            . 'wind_speed_10m_max,wind_gusts_10m_max,precipitation_sum'
            . '&wind_speed_unit=mph&timezone=Europe%2FLondon&forecast_days=14';
        $json = null;
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 6, 'header' => "User-Agent: CHB/1.0\r\n"]]);
            $body = @file_get_contents($url, false, $ctx);
            if ($body !== false) {
                $json = json_decode($body, true);
            }
        } catch (Throwable $e) {
            $json = null;
        }
        if (!is_array($json) || empty($json['daily']['time'])) {
            return ['ok' => false, 'reason' => 'forecast unavailable'];
        }

        $d = $json['daily'];
        $out = [];
        foreach ($d['time'] as $i => $date) {
            $code = isset($d['weather_code'][$i]) ? (int) $d['weather_code'][$i] : null;
            $out[] = [
                'date' => $date,
                'code' => $code,
                'summary' => weather_code_text($code),
                'tmax' => isset($d['temperature_2m_max'][$i]) ? round((float) $d['temperature_2m_max'][$i]) : null,
                'tmin' => isset($d['temperature_2m_min'][$i]) ? round((float) $d['temperature_2m_min'][$i]) : null,
                'wind' => isset($d['wind_speed_10m_max'][$i]) ? round((float) $d['wind_speed_10m_max'][$i]) : null,
                'gust' => isset($d['wind_gusts_10m_max'][$i]) ? round((float) $d['wind_gusts_10m_max'][$i]) : null,
                'rain' => isset($d['precipitation_sum'][$i]) ? round((float) $d['precipitation_sum'][$i], 1) : null,
            ];
        }
        if (!$out) {
            return ['ok' => false, 'reason' => 'forecast unavailable'];
        }

        try {
            save_content(WEATHER_CACHE_KEY, json_encode(['at' => time(), 'days' => $out]));
        } catch (Throwable $e) {
            // Serving an uncached forecast beats failing because we couldn't write.
        }
        return ['ok' => true, 'days' => array_slice($out, 0, $days)];
    }

    // WMO weather codes → plain English. Grouped, not enumerated: the owner needs
    // "sleet" not "light freezing drizzle, dense intensity".
    function weather_code_text($code)
    {
        if ($code === null) {
            return '';
        }
        $c = (int) $code;
        if ($c === 0) return 'clear';
        if ($c <= 2) return 'sunny spells';
        if ($c === 3) return 'cloudy';
        if ($c === 45 || $c === 48) return 'fog';
        if ($c >= 51 && $c <= 57) return 'drizzle';
        if ($c >= 61 && $c <= 65) return 'rain';
        if ($c === 66 || $c === 67) return 'freezing rain';
        if ($c >= 71 && $c <= 77) return 'snow';
        if ($c >= 80 && $c <= 82) return 'showers';
        if ($c === 85 || $c === 86) return 'snow showers';
        // BOUNDED at 99, the top of the WMO table. `>= 95` alone reported any
        // garbage code as thunderstorms — a forecast the owner might act on,
        // invented from a number the upstream never sends.
        if ($c >= 95 && $c <= 99) return 'thunderstorms';
        return '';
    }

    // Is a day worth MENTIONING unasked? The brief only earns its place when the
    // answer changes what the owner would do — a gale to warn an arriving guest
    // about, ice against an empty cottage, heat that means the fridge matters.
    // "18°C and cloudy" every morning trains you to ignore the panel.
    function weather_notable($day)
    {
        if (!is_array($day)) {
            return null;
        }
        $gust = $day['gust'] ?? null;
        $tmin = $day['tmin'] ?? null;
        $tmax = $day['tmax'] ?? null;
        $rain = $day['rain'] ?? null;
        if ($gust !== null && $gust >= 45) {
            return ['kind' => 'gale', 'say' => 'Gales — gusting ' . $gust . ' mph'];
        }
        if ($tmin !== null && $tmin <= 0) {
            return ['kind' => 'ice', 'say' => 'Freezing — down to ' . $tmin . '°C'];
        }
        if ($tmax !== null && $tmax >= 28) {
            return ['kind' => 'heat', 'say' => 'Hot — up to ' . $tmax . '°C'];
        }
        if ($rain !== null && $rain >= 20) {
            return ['kind' => 'rain', 'say' => 'Heavy rain — ' . $rain . ' mm'];
        }
        return null;
    }
}
