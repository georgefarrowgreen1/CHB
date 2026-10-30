<?php
// ============================================================
//  FILES THE SITE NO LONGER HAS, REMOVED FROM THE HOST BY ITS OWN MAINTENANCE.
//  The deploy uploads and never deletes, so a file the code stops shipping stays on
//  the host for good, and the weekly server file check (.github/scripts/server-check.js)
//  names it every Monday. Self-repair ("Fix safe issues" on Manage → Status, and every
//  night) removes the files listed here from the site's own folder.
//
//  Rules, held by smoke-test §7 against what the deploy really uploads: every name is a
//  plain path inside the site's folder; none is shipped by the deploy (stage-site.sh);
//  none is config.php, a rules file or .deploy-commit; and none is in uploads/,
//  sessions/, backups/, lib/ or .well-known/.
//
//  It only runs in a folder the deploy wrote .deploy-commit into, so a developer's
//  checkout (where the development files on this list live) is never touched.
//
//  When a file leaves the code, add it here if it was ever uploaded.
// ============================================================

const RETIRED_FILES = [
    // On the host since before this repository's history and never part of the site:
    // a mail test any visitor could run.
    'mailtest.php',
    // Development files the deploy never uploads, which reached the host by hand.
    'test-pop3-server.php',
    'vapid-keygen.php',
    // Removed from the code. Harmless, but the check names them every week.
    'DEPLOYMENT.md',
    'PHOTOS.md',
    '__sweep-8414.js',
    '__sweep-8414.js.br',
    '__sweep-8415.js',
    '__sweep-8415.js.br',
    'assist-embed.bin',
    'migration-chat-attachment.sql',
    'migration-chat-typing.sql',
    'migration-messages-thread-index.sql',
    'migration-payment-damages-kind.sql',
    'migration-payment-lifecycle.sql',
    'migration-payment-snapshot.sql',
    'sitemap.xml',
    // The staging site's own pages, retired with it on 30/10/2026. On the live host the
    // gate answered only a staging host name and the Test centre refused every other
    // host, but both were still there.
    'staging-gate.php',
    'testcentre.php',
];

// A name this may ever delete: a plain relative path, no folder the site keeps
// private or that other people's files live in, never a config or a rules file.
function retired_name_ok(string $p): bool
{
    if (!preg_match('#^[A-Za-z0-9._@+-]+(/[A-Za-z0-9._@+-]+)*$#', $p)) {
        return false;
    }
    foreach (explode('/', $p) as $seg) {
        if ($seg === '.' || $seg === '..') {
            return false;
        }
    }
    if (preg_match('#^(uploads|sessions|backups|lib|\.well-known)(/|$)#', $p)) {
        return false;
    }
    return !preg_match('#(^|/)(config\.php|\.deploy-commit|\.htaccess|\.user\.ini|php\.ini)$#i', $p);
}

// Removes each listed file that is there, from $dir only. Returns what it removed.
function retired_remove(string $dir, array $list = RETIRED_FILES): array
{
    $out = [];
    $stamp = is_file($dir . '/.deploy-commit') ? (string) @file_get_contents($dir . '/.deploy-commit') : '';
    if (!preg_match('/^[0-9a-f]{40}\s*$/', $stamp)) {
        return $out;
    }
    foreach ($list as $p) {
        if (!is_string($p) || !retired_name_ok($p)) {
            continue;
        }
        $f = $dir . '/' . $p;
        if (is_link($f) || !is_file($f)) {
            continue;
        }
        if (@unlink($f)) {
            $out[] = $p;
        }
    }
    return $out;
}
