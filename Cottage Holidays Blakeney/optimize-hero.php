<?php
// ============================================================
//  optimize-hero.php — one-click re-encode of the homepage hero.
//
//  The hero is the page's LCP image; a full-resolution upload (the live one
//  measured ~2 MB) is the single biggest load-time cost on the site. This
//  admin action loads the current hero (content key 'hero-bg'), resizes it
//  to at most 1920px wide, re-encodes JPEG q78, writes it as a NEW upload
//  (so every long-cached/service-worker copy of the old URL is naturally
//  bypassed), builds the .webp companion, and points 'hero-bg' at the new
//  file. home.php and the front end pick the new URL up automatically.
//  The original file is left untouched as a fallback.
//
//    POST {action:'status'}   -> current hero file + size (and projected note)
//    POST {action:'optimize'} -> do it; returns before/after bytes
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

$in = body();
$action = $in['action'] ?? '';

function hero_current() {
    $v = content_value('hero-bg');
    if ($v === '' || !preg_match('#^[a-z0-9/_.\-]+\.(jpe?g|png)$#i', $v)) return null;
    $path = __DIR__ . '/' . ltrim($v, '/');
    if (!is_file($path)) return null;
    return ['url' => $v, 'path' => $path, 'bytes' => filesize($path)];
}

if ($action === 'status') {
    $h = hero_current();
    if (!$h) json_out(['ok' => true, 'hero' => null]);
    json_out(['ok' => true, 'hero' => ['url' => $h['url'], 'bytes' => $h['bytes'], 'optimized' => (strpos($h['url'], '-opt') !== false || $h['bytes'] < 400 * 1024)]]);
}

if ($action === 'optimize') {
    if (!function_exists('imagecreatefromjpeg')) json_out(['error' => 'The GD image library is not available on this host.'], 500);
    $h = hero_current();
    if (!$h) json_out(['error' => "No uploaded hero found (content key 'hero-bg')."], 404);

    $info = @getimagesize($h['path']);
    if ($info === false) json_out(['error' => 'The current hero could not be read as an image.'], 500);
    $type = $info[2];
    $img = ($type === IMAGETYPE_PNG) ? @imagecreatefrompng($h['path']) : @imagecreatefromjpeg($h['path']);
    if (!$img) json_out(['error' => 'The current hero could not be decoded.'], 500);

    // Resize to at most 1920px wide (plenty for a full-bleed hero behind a dark
    // scrim), keeping the aspect ratio.
    $w = imagesx($img); $hpx = imagesy($img);
    $maxW = 1920;
    if ($w > $maxW && $w > 0) {
        $nw = $maxW; $nh = (int)round($hpx * ($maxW / $w));
        $resized = imagecreatetruecolor($nw, $nh);
        imagecopyresampled($resized, $img, 0, 0, 0, 0, $nw, $nh, $w, $hpx);
        imagedestroy($img);
        $img = $resized;
    }

    $dir = __DIR__ . '/uploads';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $name = 'uploads/content-hero-bg-' . bin2hex(random_bytes(6)) . '-opt.jpg';
    $dest = __DIR__ . '/' . $name;
    if (!@imagejpeg($img, $dest, 78)) { imagedestroy($img); json_out(['error' => 'Could not write the optimised hero (check uploads/ permissions).'], 500); }

    // WebP companion so the .htaccess content negotiation serves the smaller
    // format to browsers that accept it (same convention as image-save.php).
    if (function_exists('imagewebp')) @imagewebp($img, $dest . '.webp', 74);
    imagedestroy($img);

    // Point the site at the new file. The old upload stays on disk untouched —
    // if anything looks wrong the owner just re-uploads in Website content.
    try {
        db()->prepare("INSERT INTO content (item_key, item_value) VALUES ('hero-bg', ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP")
            ->execute([json_encode($name)]);
    } catch (\Throwable $e) {
        @unlink($dest); @unlink($dest . '.webp');
        json_out(['error' => 'Optimised image saved but the site could not be pointed at it: ' . $e->getMessage()], 500);
    }

    json_out([
        'ok' => true, 'url' => $name,
        'before_bytes' => $h['bytes'], 'after_bytes' => filesize($dest),
        'webp_bytes' => is_file($dest . '.webp') ? filesize($dest . '.webp') : null,
    ]);
}

json_out(['error' => 'Unknown action'], 400);
