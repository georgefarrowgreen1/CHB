<?php
// ============================================================
//  self-repair.php — nightly state checks with SAFE automatic fixes.
//  The site already self-heals a lot in place (idempotent migrations, folder
//  guards, offline-queue replay…); this job extends that to DATA invariants:
//  it detects drift, mechanically fixes the cases with exactly one safe
//  answer, and logs every fix to the activity feed so nothing is silent.
//  Anything ambiguous is FLAGGED to "Needs attention", never touched.
//
//  Fixes (safe by construction):
//   1. Gallery entries pointing at deleted upload files → entry removed, so
//      guests never see a broken tile. (External URLs are never touched.)
//   2. Card-hold authorisations still 'authorized' long past Square's ~6-day
//      auth window → marked 'expired' (mirrors reality; bookings.php already
//      treats an expired auth as released).
//   3. Active cottages missing a slug or accent (pre-migration rows) →
//      regenerated with the same helpers rates.php 'create' uses.
//   4. Curated review names still carrying import paste artifacts
//      ("2. Rebecca — 5 stars — May 2026" → "Rebecca") — the numbering,
//      star count and month are display noise the review card already
//      renders properly from its own fields.
//  Flags (owner decides):
//   5. Payments whose booking row no longer exists (orphans) — money records
//      are NEVER deleted; logged once when the count grows.
//
//  Run daily via cron.php, or manually as a signed-in admin (POST — CSRF).
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/rates.php'; // library include: unique_prop_slug/next_prop_accent

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron) {
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
}

$fixed = [];
$flagged = [];
$actor = $isCron ? 'cron' : 'owner';

// ---- 0. Square settlement back-fill ---------------------------------------
// A payment's processing fee and a refund's final status settle a day or two
// after the action. The square-webhook.php events push them live, and the
// recent_payments view reconciles on demand — but if the webhook is unconfigured
// and the owner doesn't open Payments, the ledger would drift. Run the same
// best-effort back-fill daily so fees + refund statuses stay honest regardless.
try {
    require_once __DIR__ . '/payments-reconcile.php';
    reconcile_missing_fees();
    reconcile_pending_refunds();
} catch (\Throwable $e) {
}

// ---- 1. Dead gallery references -------------------------------------------
// 'images-<prop>' content keys hold JSON arrays of image URLs; locally-uploaded
// ones are relative 'uploads/<file>'. If the file is gone (manual FTP cleanup,
// failed upload), drop the entry — a missing tile is strictly worse than one
// fewer photo. Only clearly-local entries are candidates; anything else
// (external URLs, unexpected shapes) is left alone.
try {
    $props = db()->query('SELECT prop_key FROM properties WHERE archived_at IS NULL')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($props as $prop) {
        $key = 'images-' . $prop;
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute([$key]);
        $raw = $s->fetchColumn();
        if ($raw === false) {
            continue;
        }
        $list = json_decode((string) $raw, true);
        if (!is_array($list) || !$list) {
            continue;
        }
        $kept = [];
        $dropped = 0;
        foreach ($list as $url) {
            if (!is_string($url)) {
                continue; // malformed entry — drop (renderers expect strings)
            }
            // Normalise to a local uploads path if this is our own upload.
            $path = preg_replace('~^https?://[^/]+/~i', '', trim($url));
            $path = strtok($path, '?');
            if (strpos($path, 'uploads/') === 0 && strpos($path, '..') === false) {
                if (!is_file(__DIR__ . '/' . $path)) {
                    $dropped++;
                    continue; // file is gone — drop the dead reference
                }
            }
            $kept[] = $url;
        }
        if (count($kept) !== count($list)) {
            db()
                ->prepare('UPDATE content SET item_value = ? WHERE item_key = ?')
                ->execute([json_encode(array_values($kept), JSON_UNESCAPED_SLASHES), $key]);
            $n = count($list) - count($kept);
            $fixed[] = "removed $n dead gallery reference(s) from " . $prop;
            log_activity('media', 'selfrepair.gallery', 'Self-repair: removed ' . $n . ' dead gallery reference(s) — ' . prop_display($prop)['name'], [
                'actor' => $actor,
                'prop_key' => $prop,
                'entity' => 'content',
            ]);
        }
    }
} catch (\Throwable $e) {
}

// ---- 2. Stale card-hold authorisations -------------------------------------
// Square authorisations lapse after ~6 days; a row still 'authorized' a week on
// holds no real money. Marking it 'expired' mirrors reality (bookings.php
// treats expired as released) and unblocks the "place a new hold" flow.
try {
    $s = db()->prepare(
        "SELECT id, name, prop_key FROM bookings
          WHERE hold_status = 'authorized'
            AND hold_authorized_at IS NOT NULL
            AND hold_authorized_at < DATE_SUB(NOW(), INTERVAL 7 DAY)",
    );
    $s->execute();
    foreach ($s->fetchAll() as $b) {
        db()
            ->prepare("UPDATE bookings SET hold_status = 'expired' WHERE id = ? AND hold_status = 'authorized'")
            ->execute([(int) $b['id']]);
        $fixed[] = 'expired stale card hold on booking #' . $b['id'];
        log_activity('payment', 'selfrepair.hold_expired', 'Self-repair: card-hold auth lapsed (Square ~6-day window) — marked expired' . ($b['name'] ? ' · ' . $b['name'] : ''), [
            'actor' => $actor,
            'prop_key' => $b['prop_key'] ?? '',
            'entity' => 'booking',
            'entity_id' => (string) $b['id'],
        ]);
    }
} catch (\Throwable $e) {
}

// ---- 3. Active cottages missing slug/accent --------------------------------
// Pre-migration rows (or hand-inserted ones) without a slug break /cottages/<slug>
// SEO pages; without an accent the UI falls back to grey. Regenerate with the
// exact helpers the owner's "Add accommodation" flow uses.
try {
    $s = db()->query(
        "SELECT prop_key, name, slug, accent FROM properties
          WHERE archived_at IS NULL AND (slug IS NULL OR slug = '' OR accent IS NULL OR accent = '')",
    );
    foreach ($s->fetchAll() as $p) {
        $slug = $p['slug'] !== null && $p['slug'] !== '' ? $p['slug'] : unique_prop_slug($p['name'] ?: $p['prop_key'], $p['prop_key']);
        $accent = $p['accent'] !== null && $p['accent'] !== '' ? $p['accent'] : next_prop_accent();
        db()
            ->prepare('UPDATE properties SET slug = ?, accent = ? WHERE prop_key = ?')
            ->execute([$slug, $accent, $p['prop_key']]);
        $fixed[] = 'regenerated slug/accent for ' . $p['prop_key'];
        log_activity('settings', 'selfrepair.propmeta', 'Self-repair: regenerated missing slug/accent — ' . ($p['name'] ?: $p['prop_key']), [
            'actor' => $actor,
            'prop_key' => $p['prop_key'],
            'entity' => 'property',
        ]);
    }
} catch (\Throwable $e) {
}

// ---- 4. Review names carrying import paste artifacts ------------------------
// Owner-curated reviews (content key 'reviews') imported by copy-paste sometimes
// keep the platform's listing line as the NAME: "2. Rebecca — 5 stars — May 2026".
// The numbering, star count and month are noise (the card renders stars and the
// cottage from its own fields) — strip them down to the guest's name. Only names
// matching the exact artifact shape are touched; everything else stays
// byte-identical, so the pass is idempotent and can never mangle a real name.
try {
    $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
    $s->execute(['reviews']);
    $raw = $s->fetchColumn();
    $list = $raw !== false ? json_decode((string) $raw, true) : null;
    if (is_array($list) && $list) {
        $months = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
        $cleaned = 0;
        foreach ($list as $i => $r) {
            if (!is_array($r) || !isset($r['name']) || !is_string($r['name'])) {
                continue;
            }
            $name = $r['name'];
            // Trailing " — 5 stars — May 2026" (any dash style, any case).
            $new = preg_replace('/\s*[—–-]+\s*\d\s*stars?\s*[—–-]+\s*' . $months . '\s+\d{4}\s*$/iu', '', $name);
            // Leading "2. " / "12) " numbering — only alongside-or-after the
            // suffix strip, so a genuine name like "2. Corinthians" alone is
            // never touched unless it carried the full artifact shape.
            if ($new !== $name) {
                $new = preg_replace('/^\s*\d{1,3}\s*[.)]\s*/', '', $new);
            }
            $new = trim($new);
            if ($new !== $name && $new !== '') {
                $list[$i]['name'] = $new;
                $cleaned++;
            }
        }
        if ($cleaned > 0) {
            db()
                ->prepare('UPDATE content SET item_value = ? WHERE item_key = ?')
                ->execute([json_encode(array_values($list), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'reviews']);
            $fixed[] = "cleaned $cleaned imported review name(s)";
            log_activity('settings', 'selfrepair.reviews', 'Self-repair: cleaned ' . $cleaned . ' imported review name(s) — paste artifacts removed', [
                'actor' => $actor,
                'entity' => 'content',
            ]);
        }
    }
} catch (\Throwable $e) {
}

// ---- 4b. Expired guest registrations (UK 12-month retention) ---------------
// The party register is a legal duty kept for 12 months after checkout; past
// that we MUST delete it. Rows carry expires_at (checkout + 12mo); purge any
// that are due. Best-effort + idempotent (also survives the table not existing).
try {
    $st = db()->prepare('DELETE FROM guest_registrations WHERE expires_at IS NOT NULL AND expires_at < CURDATE()');
    $st->execute();
    $purged = (int) $st->rowCount();
    if ($purged > 0) {
        $fixed[] = "purged $purged expired guest registration(s)";
        log_activity('settings', 'selfrepair.guestreg', 'Self-repair: deleted ' . $purged . ' guest registration(s) past the 12-month retention limit', [
            'actor' => $actor,
            'entity' => 'guest_registrations',
        ]);
    }
} catch (\Throwable $e) {
}

// ---- 4c. Storage hygiene: dead resizer cache + orphaned uploads -------------
// Two different rules for two different kinds of file. uploads/cache/ holds
// DERIVED data (img.php's resized .webp variants): an entry whose source image
// is gone can never be served again, so it's deleted — safe, regenerable.
// Original uploads are the owner's photos: a file no longer referenced by any
// content value or UGC row is only FLAGGED (count, state-deduped like the
// orphan payments) — never deleted automatically. Files younger than 30 days
// are never counted (an upload can legitimately sit unreferenced mid-edit),
// and .webp companions follow their parent (image-save.php writes
// <original>.webp beside every upload).
try {
    $upDir = __DIR__ . '/uploads';
    $cacheDir = $upDir . '/cache';
    $pruned = 0;
    if (is_dir($cacheDir)) {
        foreach (scandir($cacheDir) ?: [] as $cf) {
            if (!preg_match('/^(.+)\.w\d+\.webp$/', $cf, $m)) {
                continue; // not ours (or . / ..) — leave alone
            }
            if (!is_file($upDir . '/' . $m[1])) {
                if (@unlink($cacheDir . '/' . $cf)) {
                    $pruned++;
                }
            }
        }
    }
    if ($pruned > 0) {
        $fixed[] = "pruned $pruned resized image(s) whose original is gone";
        log_activity('system', 'selfrepair.cache_pruned', 'Self-repair: pruned ' . $pruned . ' resized image(s) whose original upload is gone', [
            'actor' => $actor,
            'entity' => 'uploads',
        ]);
    }

    if (is_dir($upDir)) {
        // Everything that can legitimately reference an upload, in one haystack.
        $hay = '';
        try {
            $hay .= implode("\n", db()->query('SELECT item_value FROM content')->fetchAll(PDO::FETCH_COLUMN));
        } catch (\Throwable $e) {
        }
        foreach ([['guest_photos', 'url'], ['experiences', 'image_url'], ['messages', 'attachment']] as [$tbl, $col]) {
            try {
                $hay .= "\n" . implode("\n", db()->query("SELECT $col FROM $tbl WHERE $col IS NOT NULL AND $col != ''")->fetchAll(PDO::FETCH_COLUMN));
            } catch (\Throwable $e) {
                // table not migrated yet — fine
            }
        }
        $orphanFiles = 0;
        foreach (scandir($upDir) ?: [] as $uf) {
            if ($uf === '.' || $uf === '..' || $uf === 'cache' || $uf[0] === '.' || is_dir($upDir . '/' . $uf)) {
                continue;
            }
            if (filemtime($upDir . '/' . $uf) > time() - 30 * 86400) {
                continue; // too fresh to judge
            }
            // A companion (<parent>.webp with the parent still present) follows
            // its parent — the parent is what content references.
            $isCompanion = substr($uf, -5) === '.webp' && is_file($upDir . '/' . substr($uf, 0, -5));
            $probe = $isCompanion ? substr($uf, 0, -5) : $uf;
            if (strpos($hay, $probe) === false) {
                $orphanFiles++;
            }
        }
        $stateH = content_json('self-repair-state', []);
        $prevOrphanFiles = (int) ($stateH['orphan_uploads'] ?? 0);
        if ($orphanFiles > $prevOrphanFiles) {
            $flagged[] = "$orphanFiles uploaded image(s) look unreferenced (kept — review before deleting)";
            log_activity('system', 'selfrepair.orphan_uploads', 'Self-repair: ' . $orphanFiles . ' uploaded image(s) look unreferenced by any gallery, photo or chat (kept untouched — worth a look if disk space matters)', [
                'actor' => $actor,
                'severity' => 'info',
                'entity' => 'uploads',
            ]);
        }
        $stateH['orphan_uploads'] = $orphanFiles;
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('self-repair-state', ?)
                 ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode($stateH)]);
    }
} catch (\Throwable $e) {
}

// ---- 5. Orphaned payment rows (flag only — never delete money records) -----
// ---- 6. Monthly digest into the activity log --------------------------------
try {
    $orphans = (int) db()
        ->query('SELECT COUNT(*) FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE b.id IS NULL')
        ->fetchColumn();
    $state = content_json('self-repair-state', []);
    $prevOrphans = (int) ($state['orphan_payments'] ?? 0);
    if ($orphans > $prevOrphans) {
        $flagged[] = "$orphans payment row(s) reference deleted bookings";
        log_activity('payment', 'selfrepair.orphans', 'Self-repair: ' . $orphans . ' payment row(s) reference deleted bookings (kept for the record — review in Money)', [
            'actor' => $actor,
            'severity' => 'warn',
            'entity' => 'payments',
        ]);
    }
    $state['orphan_payments'] = $orphans;

    // Monthly rollup: fixes are counted in this state as they happen (immune to
    // the activity log's 5000-row trim), and when the month rolls over the
    // finished month gets ONE summary line in the log — so the quiet
    // maintenance stays visible without emailing anyone.
    $curMonth = date('Y-m');
    $stMonth = (string) ($state['month'] ?? '');
    $stFixes = (int) ($state['month_fixes'] ?? 0);
    if ($stMonth !== '' && $stMonth !== $curMonth) {
        $label = date('F Y', strtotime($stMonth . '-01'));
        log_activity(
            'system',
            'selfrepair.digest',
            $stFixes > 0
                ? 'Self-repair: quietly fixed ' . $stFixes . ' thing' . ($stFixes === 1 ? '' : 's') . ' in ' . $label
                : 'Self-repair: nothing needed fixing in ' . $label,
            ['actor' => $actor, 'entity' => 'selfrepair'],
        );
        $stFixes = 0;
    }
    $state['month'] = $curMonth;
    $state['month_fixes'] = $stFixes + count($fixed);

    db()
        ->prepare(
            "INSERT INTO content (item_key, item_value) VALUES ('self-repair-state', ?)
             ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
        )
        ->execute([json_encode($state)]);
} catch (\Throwable $e) {
}

json_out([
    'ok' => true,
    'fixed' => $fixed,
    'flagged' => $flagged,
]);
