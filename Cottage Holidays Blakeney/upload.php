<?php
// ============================================================
//  upload.php — admin-only image upload.
//  POST (multipart/form-data) with field "image".
//  Saves into ./uploads/ and returns { ok:true, url:"uploads/xxxx.jpg" }.
//  Security: admin session required, image types only, size capped,
//  safe generated filename, no executable extensions.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || empty($_FILES['image'])) {
    json_out(['error' => 'No image received'], 400);
}

$file = $_FILES['image'];
if (!empty($file['error'])) {
    $msg = ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE)
        ? 'That image is too large for the server to accept.'
        : 'Upload failed (error code ' . (int)$file['error'] . ').';
    json_out(['error' => $msg], 400);
}

// ---- Size cap (8 MB) ----
$maxBytes = 8 * 1024 * 1024;
if ($file['size'] > $maxBytes) {
    json_out(['error' => 'Image must be 8 MB or smaller.'], 400);
}

// ---- Validate it is really an image (by content, not just extension) ----
$info = @getimagesize($file['tmp_name']);
if ($info === false) {
    json_out(['error' => 'That file does not appear to be an image.'], 400);
}
$allowed = [
    IMAGETYPE_JPEG => 'jpg',
    IMAGETYPE_PNG  => 'png',
    IMAGETYPE_GIF  => 'gif',
    IMAGETYPE_WEBP => 'webp',
];
$type = $info[2];
if (!isset($allowed[$type])) {
    json_out(['error' => 'Please use a JPG, PNG, GIF or WEBP image.'], 400);
}
$ext = $allowed[$type];

// ---- Ensure uploads/ exists ----
$dir = __DIR__ . '/uploads';
if (!is_dir($dir)) {
    if (!@mkdir($dir, 0755) && !is_dir($dir)) {
        json_out(['error' => 'Could not create the uploads folder on the server.'], 500);
    }
}

// ---- Optional logical name (e.g. "hero", "21a-2") to keep things tidy ----
$slot = isset($_POST['slot']) ? preg_replace('/[^a-z0-9_-]/i', '', $_POST['slot']) : '';
$base = $slot !== '' ? $slot . '-' : '';
// Always add randomness so re-uploads don't clobber and caches refresh
$fname = $base . bin2hex(random_bytes(6)) . '.' . $ext;
$dest = $dir . '/' . $fname;

if (!@move_uploaded_file($file['tmp_name'], $dest)) {
    json_out(['error' => 'Could not save the uploaded image (check folder permissions).'], 500);
}

// ---- Make an optimised WebP companion so the site serves smaller images ----
// The .htaccess rule serves "<file>.webp" automatically when the browser
// supports WebP, so generating it here means every uploaded photo benefits
// with no extra steps. Best-effort: if the server lacks GD/WebP support we
// simply skip it and the original image is still served normally.
make_webp_copy($dest, $type, $dest . '.webp');

json_out(['ok' => true, 'url' => 'uploads/' . $fname]);

/**
 * Create an optimised WebP copy of an uploaded JPEG/PNG next to the original.
 * Downscales very large photos (keeping aspect ratio) so phones aren't sent
 * oversized images. Returns true on success, false if it couldn't/shouldn't run.
 */
function make_webp_copy($srcPath, $imageType, $webpPath) {
    if (!function_exists('imagewebp')) return false;            // server can't make WebP
    // Only convert JPEG/PNG. WebP uploads need no copy; GIFs may be animated.
    if ($imageType !== IMAGETYPE_JPEG && $imageType !== IMAGETYPE_PNG) return false;

    $img = ($imageType === IMAGETYPE_JPEG)
        ? @imagecreatefromjpeg($srcPath)
        : @imagecreatefrompng($srcPath);
    if (!$img) return false;

    // Preserve PNG transparency in the WebP output.
    if ($imageType === IMAGETYPE_PNG) {
        @imagepalettetotruecolor($img);
        imagealphablending($img, false);
        imagesavealpha($img, true);
    }

    // Downscale if wider than the cap. 2000px is ample for full-bleed hero
    // images even on high-density (retina) phone screens.
    $maxW = 2000;
    $w = imagesx($img);
    $h = imagesy($img);
    if ($w > $maxW && $w > 0) {
        $nw = $maxW;
        $nh = (int) round($h * ($maxW / $w));
        $resized = imagecreatetruecolor($nw, $nh);
        if ($imageType === IMAGETYPE_PNG) {
            imagealphablending($resized, false);
            imagesavealpha($resized, true);
        }
        imagecopyresampled($resized, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagedestroy($img);
        $img = $resized;
    }

    $ok = @imagewebp($img, $webpPath, 82);   // quality 82 ≈ visually lossless, ~30% smaller
    imagedestroy($img);
    return $ok;
}
