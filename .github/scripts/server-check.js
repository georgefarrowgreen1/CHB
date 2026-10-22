#!/usr/bin/env node
// Compares the files on the web host with exactly what the last deploy uploaded, and
// says what does not belong. Read-only: it reports, the owner decides what goes.
//
//   node server-check.js --expected <dir> --listing <file> --server <dir>
//        [--repo <dir>] [--webauthn <file>] [--json <file>] [--summary <file>]
//
// --expected  the staged build of the deployed commit (stage-site.sh's output)
// --listing   lftp `find -l` of the host's web root
// --server    the files downloaded from the host for comparison (scripts, styles,
//             pages, rules: everything but photos, sessions, backups and big binaries)
// --repo      a full clone, to say whether a stray file was ever part of the site
// --webauthn  "<blob> <path>" for every file of every published lbuchs/WebAuthn
//             version: the passkey library is installed by hand, so it is checked
//             against the library's own releases instead of this repository
// --nested    <folder>=<build>: a folder inside the web root that is another copy of
//             the site (the staging site lives in staging/). It is compared with its
//             own build, the same way, instead of being reported file by file.
// --tidy      <file>: what the tidy-up (server-tidy.yml) may delete, as JSON
//             {delete: [paths], keep: [{path, why}]}. The check itself never deletes.
//
// The repository is public, so its logs are too: nothing here prints a session file,
// a photo or a backup by name. Those are counted. A file is named only when it needs
// a look, is left over, or is one of the site's own (public) files.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// What can run, or change what runs, on an Apache + PHP host.
const RUNS = /\.(php\d?|phtml|phar|pht|phps|inc|pl|py|cgi|sh|shtml)$/i;
const RULES = /(^|\/)(\.htaccess|\.user\.ini|php\.ini)$/i;
// What a browser renders as a page or a script from this site's own address.
const RENDERS = /\.(html?|xhtml|svg|js|mjs|xml|swf)$/i;
const PHOTO = /\.(jpe?g|png|gif|webp|avif|heic)$/i;
// What the comparison never downloads, so it is compared by size.
const NOT_DOWNLOADED = /\.(jpe?g|png|gif|webp|avif|heic|ico|woff2?|ttf|otf|eot|zip|gz|bin|onnx)$/i;

// The deny-all rules the app writes into the folders it makes (photo-lib.php,
// db.php): a different rule there could open them to the web.
const GUARD_RULES = new Set([
    '<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n',
    'Require all denied\nDeny from all\n',
    'Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\nOptions -Indexes\n',
]);
const GUARDED_DIRS = new Set(['uploads/pending', 'uploads/private', 'uploads/avatars', 'sessions', 'backups']);

// lftp `find -l`: "-rw-r--r--  user/group  1234 2026-10-22 12:27:30 ./path"
function parseListing(text) {
    const out = [];
    for (const line of String(text).split('\n')) {
        const m = /^([-dlpscb])[-rwxsStT]{9}\S*\s+\S+\s+(\d+|-)\s+.+?\s\.\/(.*)$/.exec(line);
        if (!m || m[3] === '') continue;
        const type = m[1] === 'd' ? 'dir' : m[1] === 'l' ? 'link' : m[1] === '-' ? 'file' : 'other';
        let p = m[3];
        if (type === 'dir') p = p.replace(/\/$/, '');
        if (type === 'link') p = p.replace(/ -> .*$/, '');
        out.push({ path: p, type, size: m[2] === '-' ? -1 : Number(m[2]) });
    }
    return out;
}

function walk(dir, base = dir, out = new Map()) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, base, out);
        else if (e.isFile()) out.set(path.relative(base, full).split(path.sep).join('/'), full);
    }
    return out;
}

function blobHash(buf) {
    return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
}

function sameContent(p, expectedBuf, serverBuf) {
    if (expectedBuf.equals(serverBuf)) return true;
    // A brotli twin is compared by what it decompresses to: the runner's brotli may
    // be a different version from the one the deploy used.
    if (/\.br$/.test(p)) {
        try {
            return zlib.brotliDecompressSync(expectedBuf).equals(zlib.brotliDecompressSync(serverBuf));
        } catch (e) {
            return false;
        }
    }
    return false;
}

// The decision, pure: every input is data. Returns the findings and the counts.
//   expected: Map path -> { size, buf }      what the deploy uploaded
//   remote:   [{ path, type, size }]        what the host lists
//   server:   Map path -> buf               what was downloaded from the host
//   history:  path -> null | 'YYYY-MM-DD'   the last day it was in the code, if ever
//   webauthn: Map path -> Set(blob) | null  the published library's files
function classify({ expected, remote, server, history = () => null, webauthn = null }) {
    const needs = [];
    const changed = [];
    const leftovers = [];
    const counts = { sessions: 0, photos: 0, cachedSizes: 0, backups: 0, library: 0, libraryUnverified: 0 };
    const seen = new Set();
    const was = (p) => {
        const d = history(p);
        return d ? `removed from the code, last there ${d}` : 'never part of the site';
    };

    for (const r of remote) {
        if (r.type === 'dir') continue;
        const p = r.path;
        seen.add(p);
        if (r.type !== 'file') {
            needs.push({ path: p, why: r.type === 'link' ? 'a link to another file (nothing here makes links)' : 'not a regular file' });
            continue;
        }
        const exp = expected.get(p);
        if (exp) {
            const got = server.get(p);
            if (got) {
                if (!sameContent(p, exp.buf, got)) changed.push({ path: p, why: 'its contents differ from what was uploaded' });
            } else if (NOT_DOWNLOADED.test(p)) {
                if (r.size !== exp.size) changed.push({ path: p, why: `its size differs (${r.size} bytes, uploaded ${exp.size})` });
            } else {
                changed.push({ path: p, why: 'it could not be downloaded to compare' });
            }
            continue;
        }

        const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        const name = p.slice(p.lastIndexOf('/') + 1);

        if (p === 'config.php') continue; // the host keeps its own

        if (name === '.htaccess' && GUARDED_DIRS.has(dir)) {
            const got = server.get(p);
            if (!got || !GUARD_RULES.has(got.toString('utf8'))) needs.push({ path: p, why: 'the folder\'s deny-all rule has been changed' });
            continue;
        }

        if (p.startsWith('sessions/')) {
            if (/^sessions\/sess_[A-Za-z0-9,-]+$/.test(p)) counts.sessions++;
            else needs.push({ path: p, why: 'not a session file' });
            continue;
        }
        if (p.startsWith('backups/')) {
            if (/^backups\/chb-(backup-\d{8}-\d{6}\.sql\.gz|files-\d{8}-\d{6}\.zip)$/.test(p)) counts.backups++;
            else needs.push({ path: p, why: 'not one of the site\'s backups' });
            continue;
        }
        if (p.startsWith('uploads/')) {
            if (RUNS.test(p) || RULES.test(p)) needs.push({ path: p, why: 'something the server would run, in the photo folder' });
            else if (RENDERS.test(p)) needs.push({ path: p, why: 'a page or script a browser would open from the site\'s own address' });
            else if (p.startsWith('uploads/cache/') && /\.w\d+\.webp$/.test(p)) counts.cachedSizes++;
            else if (PHOTO.test(p)) counts.photos++;
            else leftovers.push({ path: p, why: 'not a photo', from: 'uploads' });
            continue;
        }
        if (p.startsWith('lib/WebAuthn/')) {
            const rel = p.slice('lib/WebAuthn/'.length);
            if (/(^|\/)(_test|test|tests)\//.test(rel)) {
                needs.push({ path: p, why: 'the passkey library\'s demo files can be opened on the web' });
                continue;
            }
            const got = server.get(p);
            if (!webauthn || !got) {
                counts.libraryUnverified++;
                continue;
            }
            const h = blobHash(got);
            const known = [webauthn.get('src/' + rel), webauthn.get(rel)].some((s) => s && s.has(h));
            if (known) counts.library++;
            else if (RUNS.test(p) || RULES.test(p)) needs.push({ path: p, why: 'a passkey-library file that matches no published version' });
            else leftovers.push({ path: p, why: 'not part of the passkey library', from: 'library' });
            continue;
        }
        if (/^\.well-known\/acme-challenge\/[A-Za-z0-9_-]+$/.test(p)) continue; // certificate renewal

        if (/\.lftp$/.test(p)) {
            leftovers.push({ path: p, why: 'the temporary file of an interrupted upload', from: 'temp' });
        } else if (RUNS.test(p) || RULES.test(p)) {
            needs.push({ path: p, why: `runs on the server, and is not in the site (${was(p)})` });
        } else {
            leftovers.push({ path: p, why: was(p), from: history(p) ? 'repo' : 'never' });
        }
    }

    const missing = [...expected.keys()].filter((p) => !seen.has(p)).sort().map((p) => ({ path: p, why: 'uploaded by the deploy, but not on the server' }));
    const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { needs: needs.sort(byPath), changed: changed.sort(byPath), missing, leftovers: leftovers.sort(byPath), counts };
}

// WHAT THE TIDY-UP MAY DELETE (server-tidy.yml), pure. Only what the check calls left
// over, and of that only what this repository itself put on the host and later removed,
// or an interrupted upload's temp file: a file it cannot account for (a search engine's
// verification page, the host's own error_log, the owner's own file) stays, and so does
// anything that needs a look. Never in the photo, session or backup folders, the passkey
// library, the certificate folder, a config or a rules file, whatever the reason; and
// never a name lftp would have to quote.
const TIDY_NEVER = /(^|\/)(config\.php|\.deploy-commit)$|^(uploads|sessions|backups|lib|\.well-known)(\/|$)/;
function tidyPick(leftovers) {
    const del = [];
    const keep = [];
    for (const it of leftovers) {
        const p = it.path;
        let why = '';
        if (TIDY_NEVER.test(p) || RULES.test(p) || RUNS.test(p)) why = 'in a part of the site the tidy-up never touches';
        else if (it.from !== 'repo' && it.from !== 'temp') why = 'not something this repository put there';
        else if (!/^[A-Za-z0-9._@+][A-Za-z0-9._@+\/-]*$/.test(p) || p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) why = 'a name the tidy-up will not send to the server';
        if (why) keep.push({ path: p, why });
        else del.push(p);
    }
    return { delete: del, keep };
}

// A copy of the site in a folder of the web root: its entries, with the folder taken
// off their paths, apart from everything else.
function splitNested(remote, server, dir) {
    const pre = dir.replace(/\/+$/, '') + '/';
    const inside = (p) => p === pre.slice(0, -1) || p.startsWith(pre);
    const outer = { remote: remote.filter((r) => !inside(r.path)), server: new Map() };
    const inner = { remote: [], server: new Map() };
    for (const r of remote) if (r.path.startsWith(pre)) inner.remote.push({ ...r, path: r.path.slice(pre.length) });
    for (const [p, buf] of server) {
        if (p.startsWith(pre)) inner.server.set(p.slice(pre.length), buf);
        else if (!inside(p)) outer.server.set(p, buf);
    }
    return { outer, inner };
}

function report(r, meta = {}) {
    const n = r.needs.length + r.changed.length + r.missing.length;
    const lines = [];
    lines.push('## ' + (meta.title || 'Server file check'));
    lines.push('');
    if (meta.commit) lines.push(`Compared with commit \`${meta.commit.slice(0, 12)}\`${meta.commitNote ? ' (' + meta.commitNote + ')' : ''}.`);
    lines.push(n === 0
        ? `**Nothing unexpected.** Every file the site ships matches${r.leftovers.length ? `, and ${r.leftovers.length} harmless leftover${r.leftovers.length === 1 ? '' : 's'} could be tidied` : ''}.`
        : `**${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a look.**`);
    const section = (title, items) => {
        if (!items.length) return;
        lines.push('', `### ${title}`, '');
        for (const it of items) lines.push(`- \`${it.path}\`: ${it.why}`);
    };
    section('Needs a look', r.needs);
    section('Changed on the server', r.changed);
    section('Missing from the server', r.missing);
    section('Left over (safe to delete)', r.leftovers);
    const c = r.counts;
    lines.push('', '### Counted, not named', '');
    lines.push(`- ${c.photos} photo${c.photos === 1 ? '' : 's'} and ${c.cachedSizes} resized cop${c.cachedSizes === 1 ? 'y' : 'ies'} in uploads/`);
    lines.push(`- ${c.sessions} session file${c.sessions === 1 ? '' : 's'}, ${c.backups} backup${c.backups === 1 ? '' : 's'}`);
    if (c.library || c.libraryUnverified) {
        lines.push(`- ${c.library} passkey-library file${c.library === 1 ? '' : 's'} matching a published lbuchs/WebAuthn version${c.libraryUnverified ? `, ${c.libraryUnverified} not checked (the library's releases could not be read)` : ''}`);
    }
    if (meta.hostKeys) lines.push('', '### The server\'s SSH host key', '', '```', meta.hostKeys.trim(), '```');
    return lines.join('\n') + '\n';
}

// "<blob> <path>" lines -> Map path -> Set(blob)
function readWebauthn(file) {
    if (!file || !fs.existsSync(file)) return null;
    const m = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const i = line.indexOf(' ');
        if (i !== 40) continue;
        const p = line.slice(i + 1);
        if (!m.has(p)) m.set(p, new Set());
        m.get(p).add(line.slice(0, 40));
    }
    return m.size ? m : null;
}

function gitHistory(repo) {
    if (!repo) return () => null;
    return (p) => {
        const inRepo = p === '.htaccess' ? 'Cottage Holidays Blakeney/htaccess.txt' : 'Cottage Holidays Blakeney/' + p;
        try {
            const out = execFileSync('git', ['-C', repo, 'log', '--all', '-1', '--format=%cs', '--', inRepo], { encoding: 'utf8' }).trim();
            return out || null;
        } catch (e) {
            return null;
        }
    };
}

function readBuild(dir) {
    const out = new Map();
    for (const [p, full] of walk(dir)) {
        const buf = fs.readFileSync(full);
        out.set(p, { size: buf.length, buf });
    }
    return out;
}

function main(argv) {
    const arg = (k) => {
        const i = argv.indexOf('--' + k);
        return i >= 0 ? argv[i + 1] : '';
    };
    const nested = argv.flatMap((a, i) => (a === '--nested' && /^[^=]+=.+$/.test(argv[i + 1] || '') ? [argv[i + 1]] : []))
        .map((s) => ({ dir: s.slice(0, s.indexOf('=')).replace(/^\/+|\/+$/g, ''), build: s.slice(s.indexOf('=') + 1) }));
    const expected = readBuild(arg('expected'));
    let server = new Map();
    for (const [p, full] of walk(arg('server'))) server.set(p, fs.readFileSync(full));
    let remote = parseListing(fs.readFileSync(arg('listing'), 'utf8'));
    // A listing or a build that came back empty would report every file as missing, or
    // nothing at all. Neither is a finding about the server.
    const tooLittle = (what, built, listed) => {
        console.error(`The comparison${what} has too little to go on (${built} built, ${listed} listed).`);
        process.exit(2);
    };
    const history = gitHistory(arg('repo'));
    const webauthn = readWebauthn(arg('webauthn'));
    const parts = [];
    for (const nx of nested) {
        const split = splitNested(remote, server, nx.dir);
        remote = split.outer.remote;
        server = split.outer.server;
        const exp = readBuild(nx.build);
        if (exp.size < 50 || split.inner.remote.length < 50) tooLittle(` of ${nx.dir}/`, exp.size, split.inner.remote.length);
        parts.push({
            prefix: nx.dir + '/',
            r: classify({ expected: exp, remote: split.inner.remote, server: split.inner.server, history, webauthn }),
            meta: { title: `The staging copy in ${nx.dir}/`, commit: process.env.CHECK_NESTED_COMMIT || '', commitNote: process.env.CHECK_NESTED_COMMIT_NOTE || '' },
        });
    }
    if (expected.size < 50 || remote.length < 50) tooLittle('', expected.size, remote.length);
    const live = {
        prefix: '',
        r: classify({ expected, remote, server, history, webauthn }),
        meta: { commit: process.env.CHECK_COMMIT || '', commitNote: process.env.CHECK_COMMIT_NOTE || '', hostKeys: process.env.CHECK_HOST_KEYS || '' },
    };
    parts.unshift(live);
    const text = parts.map((pt) => report(pt.r, pt.meta)).join('\n');
    process.stdout.write(text);
    if (arg('summary')) fs.appendFileSync(arg('summary'), text);
    // One list per kind for the site, each item under its full path on the host.
    const all = (k) => parts.flatMap((pt) => pt.r[k].map((it) => ({ path: pt.prefix + it.path, why: it.why })));
    if (arg('json')) {
        const slim = (items) => items.slice(0, 40).map((it) => it.path + ': ' + it.why);
        fs.writeFileSync(arg('json'), JSON.stringify({
            commit: live.meta.commit,
            needs: slim(all('needs')), changed: slim(all('changed')), missing: slim(all('missing')), leftovers: slim(all('leftovers')),
            counts: live.r.counts,
        }));
    }
    if (arg('tidy')) {
        // Judged per copy of the site (a nested copy's own folders are protected by name
        // too), then named by their full path on the host.
        const picks = parts.map((pt) => ({ prefix: pt.prefix, t: tidyPick(pt.r.leftovers) }));
        fs.writeFileSync(arg('tidy'), JSON.stringify({
            delete: picks.flatMap((x) => x.t.delete.map((p) => x.prefix + p)),
            keep: picks.flatMap((x) => x.t.keep.map((it) => ({ path: x.prefix + it.path, why: it.why }))),
        }));
    }
    for (const it of all('leftovers')) console.log(`::notice::Left over on the server: ${it.path} (${it.why})`);
    const found = [...all('needs'), ...all('changed'), ...all('missing')];
    for (const it of found) console.log(`::error::${it.path}: ${it.why}`);
    return found.length ? 1 : 0;
}

module.exports = { parseListing, classify, report, splitNested, blobHash, sameContent, tidyPick, GUARD_RULES };

if (require.main === module) process.exit(main(process.argv.slice(2)));
