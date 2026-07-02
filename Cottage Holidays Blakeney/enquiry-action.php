<?php
// ============================================================
//  enquiry-action.php — one-tap approve / decline from the owner's email.
//
//  The new-enquiry email carries links here signed with an HMAC over the
//  enquiry id + action (enquiry_action_token in enquiry-actions.php), so the
//  link itself is the authorisation — no login needed on the owner's phone.
//
//  Two-step on purpose: GET shows a confirmation page (mail scanners and
//  link previewers prefetch GETs, so a GET must never act); pressing the
//  button POSTs back with the same token and only then does anything happen.
//  Approving runs the exact same enquiry_approve() the admin inbox uses —
//  booking + confirmation emails + automatic payment request.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';
require_once __DIR__ . '/enquiry-actions.php';

header('Content-Type: text/html; charset=utf-8');

$id     = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
$action = (string)($_GET['a'] ?? $_POST['a'] ?? '');
$token  = (string)($_GET['t'] ?? $_POST['t'] ?? '');
$esc    = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');

// Minimal branded page (standalone — must work even if the app shell is broken).
function ea_page($title, $bodyHtml) {
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
       . '<meta name="robots" content="noindex"><title>' . htmlspecialchars($title, ENT_QUOTES) . ' — Cottage Holidays Blakeney</title>'
       . '<style>body{margin:0;font-family:Montserrat,system-ui,sans-serif;background:#121316;color:#F4F5F7;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}'
       . '.box{max-width:460px;width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:22px;padding:34px 30px;text-align:center;}'
       . 'h1{font-family:Georgia,serif;font-weight:400;font-size:1.6rem;margin:0 0 10px;}p{color:#B4B8C6;font-size:.92rem;line-height:1.6;margin:0 0 12px;}'
       . '.row{margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}'
       . 'button,a.btn{display:inline-block;border:0;border-radius:999px;padding:13px 26px;font:600 .85rem Montserrat,sans-serif;letter-spacing:.4px;cursor:pointer;text-decoration:none;}'
       . '.go{background:#D6A785;color:#1b1208;}.quiet{background:rgba(255,255,255,.07);color:#F4F5F7;}'
       . '.detail{background:rgba(255,255,255,.04);border-radius:14px;padding:14px 16px;margin:16px 0;font-size:.9rem;color:#F4F5F7;line-height:1.7;text-align:left;}'
       . '</style></head><body><div class="box">' . $bodyHtml . '</div></body></html>';
    exit;
}

// Validate the link before anything else.
if ($id <= 0 || !in_array($action, ['approve', 'decline'], true)
    || !hash_equals(enquiry_action_token($id, $action), $token)) {
    http_response_code(403);
    ea_page('Link not valid', '<h1>That link isn&rsquo;t valid</h1><p>It may have been altered in transit. Open the enquiry from Settings &rarr; Enquiries instead.</p>');
}

// Load the enquiry (it may already have been handled from the inbox).
$st = db()->prepare('SELECT * FROM enquiries WHERE id = ?');
$st->execute([$id]);
$e = $st->fetch();
if (!$e) {
    ea_page('Already handled', '<h1>Already handled</h1><p>This enquiry is no longer pending &mdash; it was approved or declined earlier (possibly from the inbox).</p>');
}

$prop = function_exists('prop_display') ? (prop_display($e['prop_key'])['name'] ?? $e['prop_key']) : $e['prop_key'];
$summary = '<div class="detail"><strong>' . $esc($e['name']) . '</strong> &middot; ' . $esc($e['email'])
         . '<br>' . $esc($prop) . '<br>' . $esc($e['check_in']) . ' &rarr; ' . $esc($e['check_out'])
         . '<br>' . (int)$e['adults'] . ' adult' . ((int)$e['adults'] === 1 ? '' : 's')
         . ((int)$e['children'] ? ' + ' . (int)$e['children'] . ' child' . ((int)$e['children'] === 1 ? '' : 'ren') : '') . '</div>';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    // Confirmation page — the GET never acts.
    $clash = dates_clash($e['prop_key'], $e['check_in'], $e['check_out']);
    $warn = ($action === 'approve' && $clash)
        ? '<p style="color:#FFB74D;">Heads up: these dates now overlap another booking &mdash; approving will be blocked.</p>' : '';
    $verb = $action === 'approve' ? 'Approve this enquiry?' : 'Decline this enquiry?';
    $note = $action === 'approve'
        ? 'Approving creates the booking and sends the guest their confirmation and payment request.'
        : 'Declining removes the enquiry. The guest is not emailed automatically.';
    ea_page($verb,
        '<h1>' . $verb . '</h1>' . $summary . $warn . '<p>' . $note . '</p>'
        . '<form method="post" class="row"><input type="hidden" name="id" value="' . (int)$id . '">'
        . '<input type="hidden" name="a" value="' . $esc($action) . '"><input type="hidden" name="t" value="' . $esc($token) . '">'
        . '<button type="submit" class="go">' . ($action === 'approve' ? 'Approve booking' : 'Decline enquiry') . '</button></form>');
}

// POST: perform the action via the same shared logic the admin inbox uses.
if ($action === 'decline') {
    enquiry_decline($id);
    ea_page('Declined', '<h1>Enquiry declined</h1><p>' . $esc($e['name']) . '&rsquo;s enquiry for ' . $esc($prop) . ' has been removed.</p>');
}

$r = enquiry_approve($id);
if (!empty($r['error'])) {
    http_response_code((int)($r['code'] ?? 400));
    ea_page('Could not approve', '<h1>Could not approve</h1>' . $summary . '<p>' . $esc($r['error']) . '</p>');
}
$payNote = !empty($r['payment_request']['ok'])
    ? 'Their payment request has been emailed automatically.'
    : 'Confirmation emails have been sent.';
ea_page('Booking confirmed', '<h1>Booking confirmed &#127881;</h1>' . $summary
      . '<p>' . $esc($e['name']) . ' is booked in. ' . $payNote . '</p>');
