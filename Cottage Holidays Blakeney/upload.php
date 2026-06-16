<?php
// ============================================================
//  upload.php — admin-only image upload.
//  POST (multipart/form-data) with field "image" (+ optional "slot").
//  Saves into ./uploads/ and returns { ok:true, url:"uploads/xxxx.jpg" }.
//  Validation + WebP companion live in image-save.php (shared with photos.php).
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/image-save.php';
require_admin();

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || empty($_FILES['image'])) {
    json_out(['error' => 'No image received'], 400);
}

$res = save_uploaded_image($_FILES['image'], $_POST['slot'] ?? '');
if (!empty($res['error'])) json_out(['error' => $res['error']], $res['code'] ?? 400);

json_out(['ok' => true, 'url' => $res['url']]);
