<?php
// ============================================================
//  weather.php — the Blakeney forecast, for the owner's search answers and the
//  day brief.
//
//    GET ?days=1..14  -> { ok, days:[{date,code,summary,tmax,tmin,wind,gust,rain}] }
//                     -> { ok:false, reason } when the fetch fails
//
//  PUBLIC GET, for the same reason tides.php is public: a forecast for a village
//  is not sensitive, it is the same data anyone can read off a weather site, and
//  keeping it public means the guest pages can use it later without a session.
//  Unlike tides there is no key to protect — Open-Meteo needs none.
//
//  The fetch + caching live in weather-data.php.
// ============================================================
require_once __DIR__ . '/weather-data.php';
header('Content-Type: application/json; charset=utf-8');
// Half an hour at the edge; weather-data.php caches for three hours behind it.
header('Cache-Control: public, max-age=1800');
echo json_encode(weather_daily($_GET['days'] ?? 5));
