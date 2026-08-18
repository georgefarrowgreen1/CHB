// ============================================================
//  update.js — is there a newer version, and may we install it?
//
//  PURE. It takes the version this copy reports and whatever the release feed
//  said, and returns a verdict. No network, no filesystem, no Electron — so
//  every refusal below is testable, and test/core-test.js drives all of them.
//
//  WHAT THIS DELIBERATELY DOES NOT DO: replace the running app. macOS's own
//  updater (Squirrel, under electron-updater) refuses to apply an update to an
//  UNSIGNED app, and that refusal is correct rather than an obstacle — without
//  a code signature the only thing standing between this app and whatever the
//  server sends is a checksum served by that same server, so one compromised
//  host defeats both. So the app checks, downloads, VERIFIES, and then hands
//  the disk image to the owner to install. The moment there is a signing
//  certificate, the last step becomes safe and can be automated; until then it
//  is a step a person takes, knowingly.
//
//  Consequence, stated because it is the whole safety story: NO CHECKSUM, NO
//  DOWNLOAD. A release whose asset carries no sha256 is offered as a link to
//  open in a browser, never as a file this app fetches and tells you to run.
// ============================================================
'use strict';

// The tag GitHub mints for a build is `hand-build-YYYYMMDD-HHMM`, and a hand-cut
// release may be `hand-v1.2.0`. Both have to order correctly against each other
// and against themselves, so a version is reduced to a comparable tuple.
//
// A DATE BUILD IS ALWAYS NEWER THAN A SEMVER ONE of the same lineage: the dated
// tags are what CI publishes, so treating "1.0.0" as newer than a build from
// last week would offer a downgrade for ever.
function parseVersion(raw) {
    const s = String(raw || '').trim();
    if (!s) { return null; }
    let m = s.match(/^\D*(\d{8})-(\d{4})$/);
    if (m) { return { kind: 'build', parts: [Number(m[1]), Number(m[2])], text: s }; }
    m = s.match(/^\D*(\d+)\.(\d+)(?:\.(\d+))?/);
    if (m) { return { kind: 'semver', parts: [Number(m[1]), Number(m[2]), Number(m[3] || 0)], text: s }; }
    return null;
}

// -1 / 0 / 1, or null when either side cannot be read. NEVER guess an order
// from strings that did not parse: an unknown version must produce "I don't
// know", which the caller reports honestly, not "there is an update".
function compareVersions(a, b) {
    const A = parseVersion(a);
    const B = parseVersion(b);
    if (!A || !B) { return null; }
    if (A.kind !== B.kind) { return A.kind === 'build' ? 1 : -1; }
    for (let i = 0; i < Math.max(A.parts.length, B.parts.length); i++) {
        const x = A.parts[i] || 0;
        const y = B.parts[i] || 0;
        if (x !== y) { return x > y ? 1 : -1; }
    }
    return 0;
}

// GitHub's release JSON gives every asset a `digest` of the form
// "sha256:<64 hex>". Anything else is treated as absent rather than trusted.
function assetSha256(asset) {
    const d = String((asset && asset.digest) || '');
    const m = d.match(/^sha256:([0-9a-f]{64})$/i);
    return m ? m[1].toLowerCase() : '';
}

function pickAsset(release, wantName) {
    const list = (release && Array.isArray(release.assets)) ? release.assets : [];
    const name = String(wantName || '');
    return list.find((a) => a && String(a.name) === name) || null;
}

// THE VERDICT. states:
//   'current'    — this copy is the newest there is
//   'available'  — newer, with a file this app may fetch and verify
//   'manual'     — newer, but with no checksum: offered as a link, never a
//                  download-and-run
//   'unknown'    — the feed said nothing we can read. Says so; never invents.
function updateVerdict(currentVersion, release, wantName) {
    const out = { state: 'unknown', version: '', url: '', size: 0, sha256: '', say: '' };
    if (!release || typeof release !== 'object') {
        out.say = "Couldn't check for updates just now.";
        return out;
    }
    const tag = String(release.tag_name || '');
    const cmp = compareVersions(tag, currentVersion);
    if (cmp === null) {
        out.say = 'There is a release, but its version could not be read.';
        return out;
    }
    out.version = tag;
    if (cmp <= 0) {
        out.state = 'current';
        out.say = 'This is the newest version.';
        return out;
    }
    const asset = pickAsset(release, wantName);
    if (!asset || !asset.browser_download_url) {
        out.state = 'unknown';
        out.say = 'A newer version exists, but this build was not published with it.';
        return out;
    }
    out.url = String(asset.browser_download_url);
    out.size = Number(asset.size) || 0;
    out.sha256 = assetSha256(asset);
    if (!out.sha256) {
        // NO CHECKSUM, NO DOWNLOAD — see the header. The owner can still get it,
        // through a browser, where the usual quarantine warnings apply.
        out.state = 'manual';
        out.say = 'A newer version is available. It has no checksum published, so open it in a browser rather than letting this app fetch it.';
        return out;
    }
    out.state = 'available';
    out.say = 'A newer version is available.';
    return out;
}

// Human-readable size, for the button that is about to spend someone's data.
function sizeWords(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) { return ''; }
    if (n < 1024 * 1024) { return Math.round(n / 1024) + ' KB'; }
    return (n / (1024 * 1024)).toFixed(0) + ' MB';
}

module.exports = { parseVersion, compareVersions, assetSha256, pickAsset, updateVerdict, sizeWords };
