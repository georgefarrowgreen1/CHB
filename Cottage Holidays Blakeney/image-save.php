<?php
// ============================================================
//  image-save.php — shared, validated image save used by BOTH the admin
//  uploader (upload.php) and guest photo submissions (photos.php).
//
//  save_uploaded_image($file, $slot, $maxBytes) validates a $_FILES entry by
//  content (not extension), stores it under ./uploads/ with a safe random name,
//  makes an optimised .webp companion, and returns:
//     ['ok'=>true, 'url'=>'uploads/xxxx.jpg']   on success
//     ['error'=>'message', 'code'=>400|500]     on failure
// ============================================================

function save_uploaded_image($file, $slot = '', $maxBytes = null) {
    if ($maxBytes === null) $maxBytes = 8 * 1024 * 1024;   // 8 MB default

    if (!is_array($file)) return ['error' => 'No image received', 'code' => 400];
    if (!empty($file['error'])) {
        $msg = ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE)
            ? 'That image is too large for the server to accept.'
            : 'Upload failed (error code ' . (int)$file['error'] . ').';
        return ['error' => $msg, 'code' => 400];
    }
    if (($file['size'] ?? 0) > $maxBytes) {
        return ['error' => 'Image must be ' . round($maxBytes / 1048576) . ' MB or smaller.', 'code' => 400];
    }

    // Validate it really is an image (by content, not just extension).
    $info = @getimagesize($file['tmp_name']);
    if ($info === false) return ['error' => 'That file does not appear to be an image.', 'code' => 400];
    $allowed = [
        IMAGETYPE_JPEG => 'jpg',
        IMAGETYPE_PNG  => 'png',
        IMAGETYPE_GIF  => 'gif',
        IMAGETYPE_WEBP => 'webp',
    ];
    $type = $info[2];
    if (!isset($allowed[$type])) return ['error' => 'Please use a JPG, PNG, GIF or WEBP image.', 'code' => 400];
    $ext = $allowed[$type];

    $dir = __DIR__ . '/uploads';
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0755) && !is_dir($dir)) {
            return ['error' => 'Could not create the uploads folder on the server.', 'code' => 500];
        }
    }

    $slot = is_string($slot) ? preg_replace('/[^a-z0-9_-]/i', '', $slot) : '';
    $base = $slot !== '' ? $slot . '-' : '';
    $fname = $base . bin2hex(random_bytes(6)) . '.' . $ext;
    $dest = $dir . '/' . $fname;

    if (!@move_uploaded_file($file['tmp_name'], $dest)) {
        return ['error' => 'Could not save the uploaded image (check folder permissions).', 'code' => 500];
    }

    // Privacy: strip metadata (EXIF — incl. GPS location, device, timestamps) from
    // JPEG originals before they're served. Applies any EXIF orientation first so
    // the photo still shows the right way up. Done BEFORE the WebP copy so that
    // companion is built from the clean, correctly-oriented image.
    if ($type === IMAGETYPE_JPEG) strip_jpeg_metadata($dest);

    // Optimised WebP companion (served automatically via .htaccess where supported).
    make_webp_copy($dest, $type, $dest . '.webp');

    return ['ok' => true, 'url' => 'uploads/' . $fname];
}

/**
 * Strip EXIF/metadata from a JPEG in place by re-encoding it through GD, applying
 * the EXIF orientation first so it still displays correctly. Best-effort and
 * orientation-safe: only runs when the exif extension is available (so we can read
 * and bake in the orientation); otherwise it leaves the file untouched rather than
 * risk dropping the orientation tag and rotating the photo.
 */
function strip_jpeg_metadata($path) {
    if (!function_exists('imagecreatefromjpeg') || !function_exists('exif_read_data')) return;
    $orientation = 1;
    try {
        $exif = @exif_read_data($path);
        if (is_array($exif) && !empty($exif['Orientation'])) $orientation = (int)$exif['Orientation'];
    } catch (\Throwable $e) { /* no readable EXIF — treat as orientation 1 */ }
    $img = @imagecreatefromjpeg($path);
    if (!$img) return;   // unreadable — leave the original as-is
    // Bake in orientation (covers the four values phones actually produce).
    if ($orientation === 3)      $img = imagerotate($img, 180, 0);
    elseif ($orientation === 6)  $img = imagerotate($img, -90, 0);   // GD: negative = clockwise
    elseif ($orientation === 8)  $img = imagerotate($img, 90, 0);
    if ($img) {
        @imagejpeg($img, $path, 90);   // re-encode drops ALL metadata (incl. orientation)
        imagedestroy($img);
    }
}

/**
 * Create an optimised WebP copy of an uploaded JPEG/PNG next to the original.
 * Downscales very large photos (keeping aspect ratio). Best-effort.
 */
function make_webp_copy($srcPath, $imageType, $webpPath) {
    if (!function_exists('imagewebp')) return false;
    if ($imageType !== IMAGETYPE_JPEG && $imageType !== IMAGETYPE_PNG) return false;

    $img = ($imageType === IMAGETYPE_JPEG)
        ? @imagecreatefromjpeg($srcPath)
        : @imagecreatefrompng($srcPath);
    if (!$img) return false;

    if ($imageType === IMAGETYPE_PNG) {
        @imagepalettetotruecolor($img);
        imagealphablending($img, false);
        imagesavealpha($img, true);
    }

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

    $ok = @imagewebp($img, $webpPath, 82);
    imagedestroy($img);
    return $ok;
}
