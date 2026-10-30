#!/usr/bin/env node
// The server file check's judgement (server-check.js classify/report), on fixtures:
// what needs a look, what is counted and never named, and what the report may print
// in a public log. No network, no server.
'use strict';

const zlib = require('zlib');
const { parseListing, classify, report, splitNested, findCopies, fromFolder, blobHash, sameContent, tidyPick, GUARD_RULES } = require('./server-check.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

console.log('== a staging copy in a folder of the web root ==');
{
    // The live host with the staging site deployed into staging/: the same shipped
    // files, its own config and sessions, and two things nobody shipped.
    const { remote, server } = cleanHost();
    const stg = cleanHost();
    remote.push({ path: 'staging', type: 'dir', size: 4096 });
    for (const r of stg.remote) remote.push({ ...r, path: 'staging/' + r.path });
    for (const [p, buf] of stg.server) server.set('staging/' + p, buf);
    remote.push({ path: 'staging/mailtest.php', type: 'file', size: 5 });
    server.set('staging/mailtest.php', B('<?php'));
    remote.push({ path: 'staging/.user.ini', type: 'file', size: 9 });
    server.set('staging/.user.ini', B('x=1'));
    remote.push({ path: 'staging-notes.php', type: 'file', size: 5 });
    server.set('staging-notes.php', B('<?php'));

    const unsplit = classify({ expected, remote, server, history, webauthn });
    ok('…which, compared as the live site alone, reads as dozens of strays (the first run\'s 150)', unsplit.needs.filter((x) => x.path.startsWith('staging/')).length >= 5);

    const { outer, inner } = splitNested(remote, server, 'staging/');
    ok('the live part holds nothing from the folder, its own entry included', !outer.remote.some((r) => r.path === 'staging' || r.path.startsWith('staging/')) && ![...outer.server.keys()].some((p) => p.startsWith('staging/')));
    ok('…but a root file whose name only starts like it stays live', outer.remote.some((r) => r.path === 'staging-notes.php'));
    ok('the staging part has the folder taken off its paths', inner.remote.some((r) => r.path === 'mailtest.php') && inner.server.has('db.php') && !inner.remote.some((r) => r.path.startsWith('staging/')));
    const live = classify({ expected, remote: outer.remote, server: outer.server, history, webauthn });
    ok('the live site then reports only its own stray', live.needs.length === 1 && live.needs[0].path === 'staging-notes.php' && live.changed.length === 0 && live.missing.length === 0);
    const copy = classify({ expected, remote: inner.remote, server: inner.server, history, webauthn });
    ok('the staging copy reports what nobody shipped there, under its own paths', copy.needs.map((x) => x.path).sort().join() === '.user.ini,mailtest.php');
    ok('…keeps its own config unread and unreported', !copy.needs.concat(copy.leftovers).some((x) => x.path === 'config.php'));
    ok('…and counts its sessions and photos rather than naming them', copy.counts.sessions === 2 && copy.counts.photos === 4 && copy.changed.length === 0 && copy.missing.length === 0);
    const text = report(copy, { title: 'The staging copy in staging/' });
    ok('its report is headed as the staging copy, and names no session or photo', /^## The staging copy in staging\//.test(text) && !/sess_|guest-a1b2|chat-9f9f/.test(text));
}

console.log('== which folders are copies of the site ==');
{
    // The check's own listing: the live site, a staging copy with its .deploy-commit,
    // and folders that only look like one.
    const remote = [{ path: '.deploy-commit', type: 'file', size: 41 }];
    const files = (pre, k) => {
        for (let i = 0; i < k; i++) remote.push({ path: `${pre}f${i}.css`, type: 'file', size: 3 });
    };
    files('', 60);
    for (const d of ['staging/', 'staging/inner/', 'tiny/', 'uploads/old/', 'sp ace/', 'old/']) files(d, d === 'tiny/' ? 3 : 60);
    for (const d of ['staging', 'staging/inner', 'tiny', 'uploads/old', 'sp ace']) remote.push({ path: d + '/.deploy-commit', type: 'file', size: 41 });
    remote.push({ path: 'staging', type: 'dir', size: 4096 });
    const found = findCopies(remote);
    ok('a folder the deploy wrote a .deploy-commit into is found (' + found.join(', ') + ')', found.join() === 'staging');
    ok('…not a copy inside it, a near-empty folder, one in the photo folder, a name the shell would quote, or a folder with no .deploy-commit', !found.some((d) => /inner|tiny|uploads|sp ace|^old$/.test(d)));
    ok('the root\'s own .deploy-commit is not a copy', !found.includes('') && !found.includes('.'));
    ok('fromFolder finds a folder at any depth, and only a whole folder name', fromFolder('a/uploads/x.jpg', 'uploads') === 'uploads/x.jpg' && fromFolder('uploads/x.jpg', 'uploads') === 'uploads/x.jpg' && fromFolder('myuploads/x.jpg', 'uploads') === null);
}

console.log('== private files at any depth, even in a copy the check did not recognise ==');
{
    // The 26/10/2026 report: the staging copy was not recognised and its sessions were
    // named in the public log. Whatever the folder, a session file, a photo and a backup
    // are counted and never named.
    const { remote, server } = cleanHost();
    const add = (p, size) => remote.push({ path: p, type: 'file', size });
    add('staging/sessions/sess_9f8e7d6c5b4a39281706f5e4d3c2b1a0', 300);
    add('staging/sessions/sess_00aa', 0);
    add('staging/uploads/guest-77aa.jpg', 4000);
    add('staging/uploads/private/chat-12ab.jpg', 4000);
    add('staging/uploads/cache/uploads_guest-77aa.jpg.w640.webp', 900);
    add('staging/backups/chb-backup-20261025-020000.sql.gz', 5000);
    add('stray/sess_5e5e5e5e5e5e5e5e5e5e', 100);
    add('chb-backup-20261001-020000.sql.gz', 7000);
    add('holiday-snap-oh8.jpg', 9000);
    add('old-hero.jpg', 9000);
    const hist = (p) => (p === 'old-hero.jpg' ? '2025-02-01' : p === 'test-pop3-server.php' ? 'dev' : null);
    add('test-pop3-server.php', 900);
    server.set('test-pop3-server.php', B('<?php'));
    const r = classify({ expected, remote, server, history: hist, webauthn });
    ok('sessions, photos, resized copies and backups in the unrecognised copy are counted', r.counts.sessions === 5 && r.counts.photos === 6 && r.counts.cachedSizes === 2 && r.counts.backups === 4);
    ok('a session file outside a sessions folder needs a look, under a stand-in name', r.needs.some((x) => x.path === 'stray/(a session file)'));
    ok('…as does a backup outside the backups folder', r.needs.some((x) => x.path === '(a backup)'));
    ok('an image the site never shipped is counted, not named; one it once shipped is a named leftover', r.counts.strayImages === 1 && r.leftovers.some((x) => x.path === 'old-hero.jpg'));
    ok('a development file the deploy never uploads says so', /development file the deploy never uploads/.test((r.needs.find((x) => x.path === 'test-pop3-server.php') || {}).why || ''));
    const text = report(r, {});
    const all = [text, ...r.needs.map((x) => x.path), ...r.leftovers.map((x) => x.path), ...r.changed.map((x) => x.path)].join('\n');
    ok('nothing in the report names a session file, a photo or a backup', !/sess_|guest-77aa|chat-12ab|holiday-snap|chb-backup-2026/.test(all));
    ok('…and the report says how many images it counted', /1 other image the site never shipped/.test(text));
    ok('a finding that deleting the file resolves is marked so; a stand-in name is not', r.needs.find((x) => x.path === 'test-pop3-server.php').gone === true && !r.needs.find((x) => x.path === '(a backup)').gone);
}

console.log('== without the library\'s releases ==');
{
    const { remote, server } = cleanHost();
    const r = classify({ expected, remote, server, history, webauthn: null });
    ok('the library is counted as not checked, never as a finding', r.counts.libraryUnverified === 2 && r.needs.length === 0);
    ok('…and the report says it could not be checked', /not checked/.test(report(r, {})));
}

console.log('== the tidy-up ==');
{
    const { remote, server } = cleanHost();
    const plant = (p, s) => {
        remote.push({ path: p, type: 'file', size: s.length });
        server.set(p, B(s));
    };
    plant('old-page.html', '<p>');
    plant('deploy.tmp.lftp', 'x');
    plant('google1234abcd.html', 'google-site-verification: google1234abcd.html');
    plant('error_log', 'PHP Warning');
    plant('uploads/notes.pdf', '%PDF');
    plant('lib/WebAuthn/notes.txt', 'x');
    plant('old-endpoint.php', '<?php');
    plant('old file.css', 'x');
    const hist = (p) => ({ 'old-endpoint.php': '2026-06-22', 'old-page.html': '2025-01-03', 'old file.css': '2024-05-01', 'uploads/notes.pdf': '2024-01-01' })[p] || null;
    const r = classify({ expected, remote, server, history: hist, webauthn });
    const t = tidyPick(r.leftovers);
    const kept = (p) => t.keep.find((k) => k.path === p);
    ok('what this repository put there and later removed goes, with an interrupted upload\'s temp file', t.delete.slice().sort().join() === 'deploy.tmp.lftp,old-page.html');
    ok('a file the repository never shipped stays (a verification page, the host\'s error_log)', /not something this repository/.test((kept('google1234abcd.html') || {}).why) && kept('error_log'));
    ok('nothing in the photo folder or the passkey library goes, whatever its history', /never touches/.test((kept('uploads/notes.pdf') || {}).why) && /never touches/.test((kept('lib/WebAuthn/notes.txt') || {}).why));
    ok('a name lftp would have to quote stays', /will not send/.test((kept('old file.css') || {}).why));
    ok('a script that needs a look is in neither list: the owner decides', !t.delete.includes('old-endpoint.php') && !kept('old-endpoint.php'));
    const forged = tidyPick([
        { path: 'uploads/x.txt', from: 'repo' }, { path: 'sessions/sess_x', from: 'temp' }, { path: 'backups/a.txt', from: 'repo' },
        { path: 'config.php', from: 'repo' }, { path: 'staging/config.php', from: 'repo' }, { path: 'a/.htaccess', from: 'repo' },
        { path: '.user.ini', from: 'repo' }, { path: 'x.php', from: 'repo' }, { path: '.deploy-commit', from: 'repo' },
        { path: '.well-known/x', from: 'repo' }, { path: 'a/../index.html', from: 'repo' }, { path: '-rf', from: 'repo' },
        { path: 'a//b.css', from: 'repo' }, { path: 'x"; rm -r .; "', from: 'repo' },
    ]);
    ok('…and the protected places hold even against a list that says otherwise (' + forged.delete.join(',') + ')', forged.delete.length === 0 && forged.keep.length === 14);
}

console.log('== the tidy-up list, as the command line writes it ==');
{
    // The real main(): a host with a staging copy in staging/, each with a leftover of
    // each kind. The list names the staging copy's under its full path on the host.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-tidy-'));
    const build = path.join(dir, 'build');
    const host = path.join(dir, 'server');
    const lines = [];
    const put = (root, p, s) => {
        fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
        fs.writeFileSync(path.join(root, p), s);
    };
    const list = (p, s) => lines.push(`-rw-r--r--  u/g  ${Buffer.byteLength(s)} 2026-10-22 12:00:00 ./${p}`);
    for (let i = 0; i < 60; i++) {
        const p = `page-${i}.css`;
        put(build, p, 'a{}');
        for (const pre of ['', 'staging/']) {
            put(host, pre + p, 'a{}');
            list(pre + p, 'a{}');
        }
    }
    for (const pre of ['', 'staging/']) {
        for (const [p, s] of [['deploy.tmp.lftp', 'x'], ['never.txt', 'x'], ['uploads/notes.txt', 'x']]) {
            put(host, pre + p, s);
            list(pre + p, s);
        }
    }
    // The staging copy's own .deploy-commit (the build carries the same), and a folder
    // that is NOT a copy, with a sign-in's file and a photo in it.
    put(build, '.deploy-commit', 'a'.repeat(40) + '\n');
    for (const pre of ['', 'staging/']) {
        put(host, pre + '.deploy-commit', 'a'.repeat(40) + '\n');
        list(pre + '.deploy-commit', 'a'.repeat(40) + '\n');
    }
    list('old/sessions/sess_4f4f4f4f4f4f4f4f4f4f4f4f', 'x'.repeat(90));
    list('old/uploads/guest-99zz.jpg', 'x'.repeat(900));
    put(host, 'old/run.php', '<?php');
    list('old/run.php', '<?php');
    fs.writeFileSync(path.join(dir, 'listing.txt'), lines.join('\n'));
    const copies = execFileSync(process.execPath, [path.join(__dirname, 'server-check.js'), '--copies', path.join(dir, 'listing.txt')], { encoding: 'utf8' });
    ok('--copies names the staging copy from the listing alone (' + copies.trim() + ')', copies.trim() === 'staging');
    let st = 0;
    let printed = '';
    try {
        printed = execFileSync(process.execPath, [path.join(__dirname, 'server-check.js'), '--expected', build, '--listing', path.join(dir, 'listing.txt'),
            '--server', host, '--tidy', path.join(dir, 'tidy.json'), '--json', path.join(dir, 'result.json'), '--summary', path.join(dir, 'summary.md'),
            '--nested', 'staging=' + build], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        st = e.status;
        printed = String(e.stdout || '');
    }
    const out = fs.existsSync(path.join(dir, 'tidy.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'tidy.json'), 'utf8')) : { delete: [], keep: [] };
    ok(`the check ran (exit ${st}: old/run.php needs a look) and wrote the list`, st === 1 && Array.isArray(out.delete));
    ok('temp files go from both copies, under their full paths (' + out.delete.join(', ') + ')', out.delete.slice().sort().join() === 'deploy.tmp.lftp,staging/deploy.tmp.lftp');
    ok('…and what stays is named the same way', out.keep.some((k) => k.path === 'staging/never.txt') && out.keep.some((k) => k.path === 'staging/uploads/notes.txt') && out.keep.some((k) => k.path === 'never.txt'));
    const res = fs.existsSync(path.join(dir, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) : {};
    ok('the site is sent the whole count, not the first 40', res.total && res.total.needs === 1 && res.total.leftovers === 6);
    ok('…and what it can check for itself: a file whose removal resolves its finding', res.open && res.open.gone.join() === 'old/run.php' && res.open.goneAll === 1 && res.open.other === 0 && res.open.back.length === 0);
    const summary = fs.existsSync(path.join(dir, 'summary.md')) ? fs.readFileSync(path.join(dir, 'summary.md'), 'utf8') : '';
    ok('the staging copy\'s report says which commit it is', /## The copy of the site in staging\/\n\nCompared with commit `aaaaaaaaaaaa`/.test(summary));
    const everything = printed + summary + JSON.stringify(res) + JSON.stringify(out);
    ok('nothing printed, summarised, sent or listed names the sign-in\'s file or the photo', everything.length > 500 && !/sess_|guest-99zz/.test(everything));
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fails ? `\n  ${fails} of ${n} FAILED ❌` : `\n  ALL ${n} CHECKS PASSED ✅`);
process.exit(fails ? 1 : 0);
