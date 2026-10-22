#!/usr/bin/env node
// The server file check's judgement (server-check.js classify/report), on fixtures:
// what needs a look, what is counted and never named, and what the report may print
// in a public log. No network, no server.
'use strict';

const zlib = require('zlib');
const { parseListing, classify, report, blobHash, sameContent, GUARD_RULES } = require('./server-check.js');

let fails = 0;
let n = 0;
function ok(label, cond) {
    n++;
    if (cond) {
        console.log('  ✓ ' + label);
    } else {
        fails++;
        console.log('  ✗ ' + label);
    }
}

const B = (s) => Buffer.from(s);
const br = (s) => zlib.brotliCompressSync(B(s));
function site(files) {
    const m = new Map();
    for (const [p, v] of Object.entries(files)) {
        const buf = Buffer.isBuffer(v) ? v : B(v);
        m.set(p, { size: buf.length, buf });
    }
    return m;
}
const expected = site({
    'index.html': '<!doctype html>',
    'app.js': 'console.log(1)',
    'app.js.br': br('console.log(1)'),
    'db.php': '<?php // db',
    'tide-push.php': '<?php http_response_code(410);',
    'favicon.png': Buffer.alloc(100, 1),
    '.htaccess': 'Options -Indexes',
    'uploads/.htaccess': 'deny',
    'uploads/README.txt': 'photos',
    'sessions/.htaccess': 'deny',
    'lib/WebAuthn/PLACE-LIBRARY-HERE.txt': 'note',
});
const libPhp = B('<?php class WebAuthn {}');
const webauthn = new Map([['src/WebAuthn.php', new Set([blobHash(libPhp)])], ['README.md', new Set([blobHash(B('readme'))])]]);
const history = (p) => ({ 'old-endpoint.php': '2026-06-22', 'old-page.html': '2025-01-03' })[p] || null;

// A host that matches: the shipped files, then what the site makes while it runs.
function cleanHost() {
    const remote = [];
    const server = new Map();
    for (const [p, v] of expected) {
        remote.push({ path: p, type: 'file', size: v.size });
        if (!/\.png$/.test(p)) server.set(p, v.buf);
    }
    const add = (p, buf, size) => {
        remote.push({ path: p, type: 'file', size: size == null ? buf.length : size });
        if (buf) server.set(p, buf);
    };
    add('config.php', null, 900);
    add('sessions/sess_2b0e5b1c9f3a4d6e8f7a6b5c4d3e2f1a', null, 120);
    add('sessions/sess_77aa', null, 80);
    add('uploads/guest-a1b2c3.jpg', null, 5000);
    add('uploads/guest-a1b2c3.jpg.webp', null, 3000);
    add('uploads/private/chat-9f9f.jpg', null, 4000);
    add('uploads/private/.htaccess', B([...GUARD_RULES][0]));
    add('uploads/avatars/0123456789abcdef0123456789abcdef.jpg', null, 2000);
    add('uploads/avatars/.htaccess', B('Require all denied\nDeny from all\n'));
    add('uploads/cache/uploads_guest-a1b2c3.jpg.w640.webp', null, 1500);
    add('backups/chb-backup-20261020-020000.sql.gz', null, 99999);
    add('backups/chb-files-20261020-020000.zip', null, 88888);
    add('.well-known/acme-challenge/abcDEF_123-x', B('token'));
    add('lib/WebAuthn/WebAuthn.php', libPhp);
    add('lib/WebAuthn/README.md', B('readme'));
    remote.push({ path: 'uploads', type: 'dir', size: 4096 });
    return { remote, server };
}

console.log('== the listing ==');
{
    const rows = parseListing([
        'drwxr-xr-x                      - - ./',
        '-rw-r--r--  u/g     2 2026-10-22 12:27:30 ./.deploy-commit',
        '-rw-r--r--  u/g     0 2026-10-22 12:27:30 ./sp ace.txt',
        'drwxr-xr-x  u/g  4096 2026-10-22 12:27:30 ./uploads/',
        'lrwxrwxrwx  u/g    10 2026-10-22 12:27:30 ./uploads/x.jpg -> ../config.php',
        'garbage line',
    ].join('\n'));
    ok('files, a name with a space, a folder and a link are read; the root and noise are not', rows.length === 4);
    ok('…a file keeps its size and path', rows[0].path === '.deploy-commit' && rows[0].size === 2 && rows[0].type === 'file');
    ok('…a space in a name survives', rows[1].path === 'sp ace.txt');
    ok('…a folder loses its slash', rows[2].path === 'uploads' && rows[2].type === 'dir');
    ok('…a link is a link, named without its target', rows[3].type === 'link' && rows[3].path === 'uploads/x.jpg');
}

console.log('== a host that matches ==');
{
    const { remote, server } = cleanHost();
    const r = classify({ expected, remote, server, history, webauthn });
    ok('nothing needs a look, changed or missing', r.needs.length === 0 && r.changed.length === 0 && r.missing.length === 0);
    ok('…and nothing is left over', r.leftovers.length === 0);
    ok('session files, photos, resized copies and backups are counted', r.counts.sessions === 2 && r.counts.photos === 4 && r.counts.cachedSizes === 1 && r.counts.backups === 2);
    ok('the passkey library is verified against its published files', r.counts.library === 2 && r.counts.libraryUnverified === 0);
    const text = report(r, { commit: 'abc123def4567890' });
    ok('the report says so', /Nothing unexpected/.test(text));
    ok('…and names no session file, photo, backup or the config', !/sess_|guest-a1b2|chat-9f9f|0123456789abcdef|chb-backup|chb-files|config\.php/.test(text));
}

console.log('== what needs a look ==');
{
    const { remote, server } = cleanHost();
    const plant = (p, s) => {
        remote.push({ path: p, type: 'file', size: s.length });
        server.set(p, B(s));
    };
    plant('uploads/shell.php', '<?php system($_GET[1]);');
    plant('uploads/pending/x.phtml', '<?php');
    plant('uploads/page.html', '<script>');
    plant('uploads/pic.svg', '<svg onload=alert(1)>');
    plant('uploads/.user.ini', 'auto_prepend_file=x');
    plant('uploads/notes.pdf', '%PDF');
    plant('old-endpoint.php', '<?php');
    plant('wp-login.php', '<?php');
    plant('old-page.html', '<p>');
    plant('deploy.tmp.lftp', 'x');
    plant('sessions/evil.php', '<?php');
    plant('sessions/readme.txt', 'x');
    plant('backups/dump.sql', 'x');
    plant('lib/WebAuthn/Attestation/Evil.php', '<?php');
    plant('lib/WebAuthn/_test/server.php', '<?php');
    plant('lib/WebAuthn/notes.txt', 'x');
    server.set('uploads/private/.htaccess', B('Allow from all\n'));
    remote.push({ path: 'uploads/link.jpg', type: 'link', size: 10 });
    const r = classify({ expected, remote, server, history, webauthn });
    const need = (p) => r.needs.find((x) => x.path === p);
    const left = (p) => r.leftovers.find((x) => x.path === p);
    ok('a script in the photo folder needs a look', need('uploads/shell.php') && need('uploads/pending/x.phtml'));
    ok('a page or an SVG in the photo folder needs a look', need('uploads/page.html') && need('uploads/pic.svg'));
    ok('a PHP settings file in the photo folder needs a look', need('uploads/.user.ini'));
    ok('…a file that is not a photo is only left over', left('uploads/notes.pdf') && !need('uploads/notes.pdf'));
    const why = (x) => (x ? x.why : '');
    ok('a script nobody shipped needs a look, wherever it is', need('old-endpoint.php') && need('wp-login.php'));
    ok('…and says whether it was ever part of the site', /removed from the code, last there 2026-06-22/.test(why(need('old-endpoint.php'))) && /never part of the site/.test(why(need('wp-login.php'))));
    ok('an old page is left over, with its history', /2025-01-03/.test(why(left('old-page.html'))));
    ok('an interrupted upload\'s temp file is left over', left('deploy.tmp.lftp'));
    ok('anything but a session file in sessions/ needs a look', need('sessions/evil.php') && need('sessions/readme.txt'));
    ok('anything but a backup in backups/ needs a look', need('backups/dump.sql'));
    ok('a library file matching no published version needs a look', need('lib/WebAuthn/Attestation/Evil.php'));
    ok('the library\'s demo files need a look', need('lib/WebAuthn/_test/server.php'));
    ok('a non-script that is not the library is left over', left('lib/WebAuthn/notes.txt'));
    ok('a changed deny-all rule needs a look', need('uploads/private/.htaccess'));
    ok('a link needs a look', need('uploads/link.jpg'));
    const text = report(r, {});
    ok('the report names what needs a look', /uploads\/shell\.php/.test(text) && /\*\*\d+ things need a look\.\*\*/.test(text));
    ok('…and still no session file, photo or backup', !/sess_2b0e|guest-a1b2|chb-backup/.test(text));
}

console.log('== the site\'s own files ==');
{
    const { remote, server } = cleanHost();
    server.set('db.php', B('<?php // db changed'));
    remote.find((x) => x.path === 'favicon.png').size = 99;
    server.set('app.js.br', zlib.brotliCompressSync(B('console.log(1)'), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } }));
    const idx = remote.findIndex((x) => x.path === 'index.html');
    remote.splice(idx, 1);
    server.delete('index.html');
    const r = classify({ expected, remote, server, history, webauthn });
    ok('a changed script is reported', r.changed.some((x) => x.path === 'db.php'));
    ok('a binary is compared by size', r.changed.some((x) => x.path === 'favicon.png' && /99 bytes/.test(x.why)));
    ok('a brotli twin compressed differently but holding the same file is not changed', !r.changed.some((x) => x.path === 'app.js.br'));
    ok('a missing file is reported', r.missing.length === 1 && r.missing[0].path === 'index.html');
    ok('sameContent opens a brotli twin before comparing', sameContent('a.js.br', br('x'), zlib.brotliCompressSync(B('x'), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 2 } })) && !sameContent('a.js.br', br('x'), br('y')));
}

console.log('== without the library\'s releases ==');
{
    const { remote, server } = cleanHost();
    const r = classify({ expected, remote, server, history, webauthn: null });
    ok('the library is counted as not checked, never as a finding', r.counts.libraryUnverified === 2 && r.needs.length === 0);
    ok('…and the report says it could not be checked', /not checked/.test(report(r, {})));
}

console.log(fails ? `\n  ${fails} of ${n} FAILED ❌` : `\n  ALL ${n} CHECKS PASSED ✅`);
process.exit(fails ? 1 : 0);
