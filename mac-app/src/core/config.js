// ============================================================
//  config.js — settings on disk, and the secret NOT on disk.
//
//  The site secret is the one credential this app holds, and it is the same
//  APP_SECRET the cron URLs use — so it must not sit in a JSON file next to the
//  app where a backup, a screen-share or Spotlight can pick it up. It goes in
//  the macOS Keychain via the `security` binary, which is already on every Mac
//  and needs no dependency.
//
//  There is deliberately NO plaintext fallback for the secret. If the Keychain
//  refuses, the app has no secret, says so, and does nothing — the same posture
//  the site's backup encryption takes: "we couldn't protect it" must never
//  degrade into "here it is in a file".
//
//  Everything else — the address, which engine, which model per job, what is
//  switched on — is ordinary settings and lives in a JSON file.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SERVICE = 'Cottage Holidays Blakeney';
const ACCOUNT = 'site-secret';
// NB the app was briefly called "Blakeney Hand", and this file carried a
// fallback that read that folder and that Keychain entry when the new ones were
// absent. It is gone: the only build ever published under the old name was
// never installed, so the state it protected cannot exist, and a compatibility
// path for an impossible state is code nothing will ever exercise or check.

function appDir() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', SERVICE);
    }
    // Not a Mac: only the test suite and development ever get here.
    return path.join(os.homedir(), '.cottage-holidays-blakeney');
}

const DEFAULTS = {
    siteUrl: '',
    engine: '',                 // '' = let the app pick by architecture
    modelsDir: '',              // '' = <appDir>/Models
    jobs: { reply: { on: false, model: '', at: '02:00' } },
    keepAwake: true,
    lastRun: null,
    // STARTING THE MODEL SERVER. Default ON, because the whole point is that
    // nobody should have to leave a Terminal window open overnight — and it is
    // a switch rather than a hard-wired behaviour because someone already
    // running llama-server their own way must be able to stop this app
    // starting a second one on the same port.
    autoStart: true,
    // '' = look in the app's own bundle, then Homebrew. A path here is an
    // explicit override and wins over both (see core/runner.js).
    runnerPath: '',
};

function paths(dirOverride) {
    const dir = dirOverride || appDir();
    return {
        dir: dir,
        config: path.join(dir, 'config.json'),
        models: path.join(dir, 'Models'),
        log: path.join(dir, 'nights.json'),
    };
}

function load(dirOverride) {
    const p = paths(dirOverride);
    let raw = null;
    try {
        raw = JSON.parse(fs.readFileSync(p.config, 'utf8'));
    } catch (e) {
        raw = null;
    }
    const c = merge(DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    if (!c.modelsDir) {
        c.modelsDir = p.models;
    }
    return c;
}

function save(cfg, dirOverride) {
    const p = paths(dirOverride);
    try {
        fs.mkdirSync(p.dir, { recursive: true });
        fs.writeFileSync(p.config, JSON.stringify(cfg, null, 2), 'utf8');
        return { ok: true };
    } catch (e) {
        return { ok: false, say: 'Could not save settings: ' + (e && e.message ? e.message : 'write failed') };
    }
}

// A shallow-per-key merge that keeps unknown stored keys (so a settings file
// written by a newer version is not destroyed by an older one) and never lets
// a stored value change the SHAPE of a known one.
function merge(base, over) {
    const out = {};
    Object.keys(base).forEach(function (k) {
        const b = base[k];
        const o = over[k];
        if (b && typeof b === 'object' && !Array.isArray(b)) {
            out[k] = merge(b, o && typeof o === 'object' ? o : {});
        } else if (o === undefined || o === null) {
            out[k] = b;
        } else if (typeof b === typeof o || b === null) {
            out[k] = o;
        } else {
            out[k] = b;
        }
    });
    Object.keys(over).forEach(function (k) {
        if (!(k in out)) {
            out[k] = over[k];
        }
    });
    return out;
}

// ── THE SECRET ───────────────────────────────────────────────────────────
// `runner` is injectable so the test suite drives every branch — including a
// Keychain that refuses — without touching a real keychain.
function makeSecrets(opts) {
    const o = opts || {};
    const run = o.run || function (args) {
        return String(execFileSync('security', args, { encoding: 'utf8', timeout: 5000 })).replace(/\n$/, '');
    };
    const mac = o.platform !== undefined ? o.platform === 'darwin' : process.platform === 'darwin';

    return {
        available: mac,
        // '' when there is none. Never throws.
        get() {
            if (!mac) {
                return '';
            }
            try {
                return run(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']).trim();
            } catch (e) {
                return '';
            }
        },
        set(value) {
            if (!mac) {
                return { ok: false, say: 'The Keychain is only available on macOS.' };
            }
            const v = String(value || '');
            if (!v) {
                return this.clear();
            }
            try {
                // -U updates in place rather than failing on an existing item.
                run(['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', v, '-U']);
                return { ok: true };
            } catch (e) {
                // NO PLAINTEXT FALLBACK. See the header.
                return { ok: false, say: 'The Keychain refused to store the secret, so it was not saved anywhere.' };
            }
        },
        clear() {
            if (!mac) {
                return { ok: true };
            }
            try {
                run(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]);
            } catch (e) { /* not there is the same as cleared */ }
            return { ok: true };
        },
        // For the Connection screen: whether one is set, and never what it is.
        state() {
            const v = this.get();
            return { set: !!v, hint: v ? '•'.repeat(Math.min(16, Math.max(8, v.length))) : '' };
        },
    };
}

module.exports = { load, save, paths, appDir, merge, makeSecrets, DEFAULTS, SERVICE, ACCOUNT };
