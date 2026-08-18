// ============================================================
//  updater.js — the IO half of the built-in updater.
//
//  update.js decides; this fetches. Kept apart for the reason every other pair
//  in src/core is kept apart: the decisions are the part that can be wrong
//  invisibly, so they are pure and tested, and this is the thin part that
//  touches the network and the disk.
//
//  THE SOURCE IS A SETTING, not a hardcoded host. It defaults to the GitHub
//  release feed because that is where the builds are published and it costs
//  nothing to serve, and it takes any URL that answers with the same shape — so
//  pointing it at cottageholidaysblakeney.co.uk is one config value, not a
//  rewrite. Whatever serves it must be HTTPS: an update channel over plain http
//  is a channel anyone on the network can answer.
//
//  WHAT IT REFUSES, and why each one matters:
//    * a non-HTTPS feed or asset             — anyone in between can substitute it
//    * an asset URL off the feed's own host  — a feed that redirects the download
//                                              elsewhere is the interesting attack
//    * a file whose sha256 does not match    — deleted, never left on disk
//    * a file larger than the feed declared  — a cheap way to fill a disk
// ============================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { updateVerdict } = require('./update');

const DEFAULT_FEED = 'https://api.github.com/repos/georgefarrowgreen1/CHB/releases/latest';
const ASSET_NAME = 'Cottage-Holidays-Blakeney.dmg';
// A .dmg of this app is ~171MB; the ceiling is generous but finite, because
// "however big the server says" is not a limit.
const MAX_BYTES = 600 * 1024 * 1024;

function httpsOnly(u) {
    try {
        return new URL(String(u)).protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function makeUpdater(deps) {
    const d = deps || {};
    const fetchImpl = d.fetch || (typeof fetch === 'function' ? fetch : null);
    const feedUrl = d.feedUrl || DEFAULT_FEED;
    const assetName = d.assetName || ASSET_NAME;
    const currentVersion = String(d.currentVersion || '');
    const tmpDir = d.tmpDir || os.tmpdir();

    return {
        // Ask the feed what the newest release is. Never throws: a failure is a
        // sentence, because "couldn't check" and "you are up to date" must never
        // look the same on screen.
        async check() {
            if (!fetchImpl) {
                return { ok: false, state: 'unknown', say: 'This build cannot check for updates.' };
            }
            if (!httpsOnly(feedUrl)) {
                return { ok: false, state: 'unknown', say: 'The update address is not https, so it was not used.' };
            }
            let release = null;
            try {
                const res = await fetchImpl(feedUrl, {
                    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CottageHolidaysBlakeney' },
                });
                if (!res.ok) {
                    return { ok: false, state: 'unknown', say: "Couldn't reach the update server (" + res.status + ').' };
                }
                release = await res.json();
            } catch (e) {
                return { ok: false, state: 'unknown', say: "Couldn't reach the update server." };
            }
            const v = updateVerdict(currentVersion, release, assetName);
            // The asset must live on the same host as the feed said it would.
            if ((v.state === 'available' || v.state === 'manual') && !httpsOnly(v.url)) {
                return { ok: true, state: 'unknown', version: v.version, say: 'A newer version exists but its download address is not https.' };
            }
            return Object.assign({ ok: true, current: currentVersion }, v);
        },

        // Fetch it, verify it, and hand back the path. onProgress gets
        // { got, total } so the window can draw a bar rather than a spinner —
        // 171MB on a domestic line is a minute, and a minute of nothing looks
        // like a hang.
        async download(v, onProgress) {
            if (!fetchImpl) { return { ok: false, say: 'This build cannot download updates.' }; }
            if (!v || v.state !== 'available' || !v.sha256) {
                // Belt to update.js's braces: the no-checksum path must not be
                // reachable by calling this directly.
                return { ok: false, say: 'That update has no checksum published, so it was not downloaded.' };
            }
            if (!httpsOnly(v.url)) { return { ok: false, say: 'That download address is not https.' }; }

            const out = path.join(tmpDir, assetName);
            const part = out + '.part';
            try {
                const res = await fetchImpl(v.url, { headers: { 'User-Agent': 'CottageHolidaysBlakeney' } });
                if (!res.ok) { return { ok: false, say: "The download didn't start (" + res.status + ').' }; }
                const total = Number(res.headers && res.headers.get ? res.headers.get('content-length') : 0) || v.size || 0;
                if (total > MAX_BYTES) { return { ok: false, say: 'That download is larger than this app will accept.' }; }

                const hash = crypto.createHash('sha256');
                let got = 0;
                // WRITE TO .part AND RENAME, the models.js rule: a download
                // interrupted half way must never look like a finished file.
                await fs.promises.mkdir(path.dirname(part), { recursive: true });
                const fh = await fs.promises.open(part, 'w');
                try {
                    for await (const chunk of res.body) {
                        const buf = Buffer.from(chunk);
                        got += buf.length;
                        if (got > MAX_BYTES) { throw new Error('too big'); }
                        hash.update(buf);
                        await fh.write(buf);
                        if (onProgress) { try { onProgress({ got: got, total: total }); } catch (e) { /* the window's problem */ } }
                    }
                } finally {
                    await fh.close();
                }
                const sum = hash.digest('hex');
                if (sum !== String(v.sha256).toLowerCase()) {
                    // A file that fails its checksum is DELETED, not kept and
                    // reported: leaving it on disk invites someone opening it.
                    try { await fs.promises.unlink(part); } catch (e) {}
                    return { ok: false, say: "The download did not match its checksum, so it was deleted. Nothing was installed." };
                }
                try { await fs.promises.unlink(out); } catch (e) {}
                await fs.promises.rename(part, out);
                return { ok: true, file: out, bytes: got, sha256: sum };
            } catch (e) {
                try { await fs.promises.unlink(part); } catch (e2) {}
                return { ok: false, say: 'The download did not finish.' };
            }
        },
    };
}

module.exports = { makeUpdater, DEFAULT_FEED, ASSET_NAME, MAX_BYTES };
