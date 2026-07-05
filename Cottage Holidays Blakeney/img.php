<?php
// ============================================================
//  img.php — on-the-fly responsive image resizer with a disk cache.
//  ?src=uploads/xxx.jpg&w=800  →  a WebP resized to <=w px wide, so phones don't
//  download the full 2000px original. Public + cache-friendly. Strictly validates
//  src (only our own uploads/, image extensions, no traversal) and clamps w to an
//  allow-list. Falls back to streaming the original if GD/WebP isn't available or
//  resizing fails.
// ============================================================

$src = (string) ($_GET['src'] ?? '');
$w = (int) ($_GET['w'] ?? 0);
$allowed = [320, 480, 640, 900, 1200, 1600];
if (!in_array($w, $allowed, true)) {
    $w = 900;
}

// Only our uploads/, image extensions, and never a path escape.
if (!preg_match('#^uploads/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$#i', $src) || strpos($src, '..') !== false) {
    http_response_code(400);
    exit();
}
$path = __DIR__ . '/' . $src;
if (!is_file($path)) {
    http_response_code(404);
    exit();
}

$stream = function ($file, $ctype, $maxAge = 31536000) {
    $etag = '"' . md5_file($file) . '"';
    header('Content-Type: ' . $ctype);
    header('Cache-Control: public, max-age=' . $maxAge . ', immutable');
    header('ETag: ' . $etag);
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit();
    }
    readfile($file);
    exit();
};

$cacheDir = __DIR__ . '/uploads/cache';
if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0755, true);
}
$cacheFile = $cacheDir . '/' . preg_replace('/[^A-Za-z0-9._-]/', '_', $src) . '.w' . $w . '.webp';

// Serve a fresh cached copy if we have one (cache newer than the source).
if (is_file($cacheFile) && filemtime($cacheFile) >= filemtime($path)) {
    $stream($cacheFile, 'image/webp');
}

// No GD/WebP → just serve the original.
if (!function_exists('imagecreatetruecolor') || !function_exists('imagewebp')) {
    $ctype = function_exists('mime_content_type') ? mime_content_type($path) : 'image/jpeg';
    $stream($path, $ctype ?: 'image/jpeg', 86400);
}

$info = @getimagesize($path);
if (!$info) {
    $stream($path, 'image/jpeg', 86400);
}
[$srcW, $srcH, $type] = [$info[0], $info[1], $info[2]];

$im = null;
if ($type === IMAGETYPE_JPEG) {
    $im = @imagecreatefromjpeg($path);
} elseif ($type === IMAGETYPE_PNG) {
    $im = @imagecreatefrompng($path);
} elseif ($type === IMAGETYPE_WEBP && function_exists('imagecreatefromwebp')) {
    $im = @imagecreatefromwebp($path);
}
if (!$im || $srcW < 1) {
    $stream($path, 'image/jpeg', 86400);
}

$targetW = min($w, $srcW);
$targetH = max(1, (int) round($srcH * ($targetW / $srcW)));
$dst = imagecreatetruecolor($targetW, $targetH);
if ($type === IMAGETYPE_PNG || $type === IMAGETYPE_WEBP) {
    imagealphablending($dst, false);
    imagesavealpha($dst, true);
}
imagecopyresampled($dst, $im, 0, 0, 0, 0, $targetW, $targetH, $srcW, $srcH);
@imagewebp($dst, $cacheFile, 80);
imagedestroy($im);
imagedestroy($dst);

if (is_file($cacheFile)) {
    $stream($cacheFile, 'image/webp');
}
// Generation failed — fall back to the original.
$stream($path, 'image/jpeg', 86400);
