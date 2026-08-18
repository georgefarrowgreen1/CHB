// ============================================================
//  models.js — the model library. The screen this whole app was asked for.
//
//  Three sources, one list, and the important part is that every row carries a
//  verdict about THIS Mac (machine.modelVerdict) rather than a size the reader
//  has to do arithmetic on. "19.9 GB" means nothing; "Tight on 16 GB — slow"
//  is a decision.
//
//  A MODEL IS A FILE, and that is the whole point of running it here — so the
//  installed list is a directory listing, not a database. Delete the file and
//  the model is gone; drop one in and it appears. Nothing to reconcile.
//
//  GGUF is the format because it is the one that runs on both architectures.
//  MLX builds of the same model are listed too, marked Apple-silicon-only, so
//  the catalogue is one list on either machine — which is what "all integrated
//  into that app" has to mean once two engines exist.
//
//  No dependencies: fs, path, and Node's fetch.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { modelVerdict } = require('./machine');

const HF_API = 'https://huggingface.co/api/models';

// The uploaders whose quantisations are worth offering. Not a whitelist for
// safety — anyone can be searched — but a default sort order, because a search
// for "qwen" on Hugging Face returns hundreds of forks and three of them are
// the ones anybody actually wants.
const KNOWN_GOOD = ['bartowski', 'unsloth', 'lmstudio-community', 'mlx-community', 'ggml-org', 'ggerganov', 'Qwen', 'meta-llama'];

// A PROJECTOR IS NOT A MODEL. Vision repos ship an `mmproj-*.gguf` beside the
// chat model — the multimodal projector, a companion file llama-server takes
// via --mmproj and which cannot draft anything on its own. It is still a
// .gguf, so both listings offered it as if it were a model, and picking it is
// exactly how the reply job ended up pointed at a file that answers nothing
// (seen live: mmproj-gemma-4-E4B-it-BF16.gguf chosen on the Jobs screen).
// One predicate, used by the installed listing AND the download picker, so
// the file can neither be offered for download nor resurface from disk.
// Prefix-anchored on purpose: "mmproj" mid-name is somebody's own naming.
function isProjector(name) {
    return /^mmproj[-._]/i.test(String(name));
}

// ── WHAT IS INSTALLED ────────────────────────────────────────────────────
// A directory of .gguf files (and MLX model folders). Never throws: a missing
// folder is an empty library, which is the correct first-run state.
function installed(dir) {
    const out = [];
    let names = [];
    try {
        names = fs.readdirSync(dir);
    } catch (e) {
        return out;
    }
    names.forEach(function (n) {
        const full = path.join(dir, n);
        let st;
        try {
            st = fs.statSync(full);
        } catch (e) {
            return;
        }
        if (st.isFile() && /\.gguf$/i.test(n) && !isProjector(n)) {
            out.push({
                id: n,
                file: full,
                name: prettyName(n),
                quant: quantOf(n),
                format: 'gguf',
                sizeGB: Math.round((st.size / 1073741824) * 10) / 10,
                mtime: st.mtimeMs,
            });
        } else if (st.isDirectory() && looksMlx(full)) {
            out.push({
                id: n,
                file: full,
                name: prettyName(n),
                quant: 'MLX',
                format: 'mlx',
                sizeGB: Math.round((dirSize(full) / 1073741824) * 10) / 10,
                mtime: st.mtimeMs,
            });
        }
    });
    return out.sort(function (a, b) { return b.mtime - a.mtime; });
}

// An MLX model is a folder with a config and safetensors in it.
function looksMlx(dir) {
    try {
        const f = fs.readdirSync(dir);
        return f.indexOf('config.json') !== -1 && f.some(function (n) { return /\.safetensors$/i.test(n); });
    } catch (e) {
        return false;
    }
}

function dirSize(dir) {
    let total = 0;
    try {
        fs.readdirSync(dir).forEach(function (n) {
            try {
                const st = fs.statSync(path.join(dir, n));
                total += st.isFile() ? st.size : 0;
            } catch (e) { /* a file that vanished mid-listing is not an error */ }
        });
    } catch (e) { /* unreadable folder → 0 */ }
    return total;
}

// "Qwen2.5-14B-Instruct-Q4_K_M.gguf" → "Qwen 2.5 14B Instruct".
function prettyName(file) {
    let s = String(file).replace(/\.gguf$/i, '');
    s = s.replace(/[-_.](?:Q\d[_A-Z0-9]*|IQ\d[_A-Z0-9]*|f16|bf16|\d+bit)$/i, '');
    s = s.replace(/-GGUF$/i, '').replace(/[-_]+/g, ' ');
    // Qwen2.5 → Qwen 2.5, Llama3.1 → Llama 3.1
    s = s.replace(/([A-Za-z])(\d)/g, '$1 $2');
    return s.replace(/\s+/g, ' ').trim();
}

function quantOf(file) {
    const m = /[-_.](I?Q\d[_A-Z0-9]*|f16|bf16|\d+bit)(?:\.gguf)?$/i.exec(String(file));
    return m ? m[1].toUpperCase() : '';
}

// ── SEARCHING HUGGING FACE ───────────────────────────────────────────────
// One request, mapped to rows the window can print. `fetchImpl` is injectable
// so the whole mapping — including the fit verdicts — is tested with no network.
async function search(term, machine, opts) {
    const o = opts || {};
    const f = o.fetch || fetch;
    const q = String(term || '').trim();
    if (q.length < 2) {
        return { ok: true, rows: [] };
    }
    const url = HF_API + '?search=' + encodeURIComponent(q) + '&filter=gguf&sort=downloads&direction=-1&limit=' + (o.limit || 20);
    let list;
    try {
        const res = await f(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
            return { ok: false, say: 'Hugging Face answered ' + res.status + '.' };
        }
        list = await res.json();
    } catch (e) {
        return { ok: false, say: 'Could not reach Hugging Face: ' + (e && e.message ? e.message : 'no answer') };
    }
    if (!Array.isArray(list)) {
        return { ok: false, say: 'Hugging Face answered with something unexpected.' };
    }
    const rows = list.map(function (m) { return mapRepo(m, machine); }).filter(Boolean);
    rows.sort(function (a, b) {
        const ka = KNOWN_GOOD.indexOf(a.owner) === -1 ? 1 : 0;
        const kb = KNOWN_GOOD.indexOf(b.owner) === -1 ? 1 : 0;
        if (ka !== kb) return ka - kb;
        return (b.downloads || 0) - (a.downloads || 0);
    });
    return { ok: true, rows: rows };
}

// One Hugging Face repo → one row. Size is ESTIMATED from the parameter count
// in the name when the API does not give file sizes, and the row says which it
// is: a guessed size that quietly becomes a verdict would be the worst of both.
function mapRepo(repo, machine) {
    const id = String((repo && repo.modelId) || (repo && repo.id) || '');
    if (!id) {
        return null;
    }
    const owner = id.split('/')[0] || '';
    const mlx = /^mlx-community\//i.test(id) || /-mlx$/i.test(id);
    const params = paramsOf(id);
    const est = params ? Math.round(params * 0.6 * 10) / 10 : 0; // ~4-bit + overhead
    const v = modelVerdict(machine, est, { mlxOnly: mlx });
    return {
        id: id,
        owner: owner,
        name: prettyName(id.split('/').pop() || id),
        format: mlx ? 'mlx' : 'gguf',
        params: params,
        sizeGB: est,
        sizeIsEstimate: true,
        downloads: parseInt(repo && repo.downloads, 10) || 0,
        fit: v.fit,
        why: v.why,
    };
}

// "Qwen2.5-14B-Instruct" → 14. Billions only; anything else is unknown.
function paramsOf(id) {
    const m = /(\d+(?:\.\d+)?)\s*[bB](?![a-z])/.exec(String(id).replace(/[-_]/g, ' '));
    if (!m) {
        return 0;
    }
    const n = parseFloat(m[1]);
    return isFinite(n) && n > 0 && n < 2000 ? n : 0;
}

// ── DOWNLOADING ──────────────────────────────────────────────────────────
// Streams a file to disk with progress, resumable-safe by writing to `.part`
// and renaming only on a complete transfer — a half file that looked whole
// would be a model that loads and produces noise.
async function download(url, destDir, filename, onProgress, opts) {
    const o = opts || {};
    const f = o.fetch || fetch;
    const dest = path.join(destDir, filename);
    const part = dest + '.part';
    try {
        fs.mkdirSync(destDir, { recursive: true });
    } catch (e) { /* already there */ }
    let res;
    try {
        res = await f(url);
    } catch (e) {
        return { ok: false, say: 'Could not start the download: ' + (e && e.message ? e.message : 'no answer') };
    }
    if (!res.ok || !res.body) {
        return { ok: false, say: 'The download was refused (' + res.status + ').' };
    }
    const total = parseInt(res.headers.get('content-length'), 10) || 0;
    let got = 0;
    const out = fs.createWriteStream(part);
    try {
        for await (const chunk of res.body) {
            got += chunk.length;
            out.write(chunk);
            if (onProgress) {
                try { onProgress({ got: got, total: total, pct: total ? Math.round((got / total) * 100) : null }); } catch (e) { /* display only */ }
            }
        }
    } catch (e) {
        try { out.close(); fs.unlinkSync(part); } catch (e2) { /* nothing to clean */ }
        return { ok: false, say: 'The download stopped part way: ' + (e && e.message ? e.message : 'connection lost') };
    }
    await new Promise(function (r) { out.end(r); });
    if (total && got !== total) {
        try { fs.unlinkSync(part); } catch (e) { /* nothing to clean */ }
        return { ok: false, say: 'The download was short — nothing was kept.' };
    }
    try {
        fs.renameSync(part, dest);
    } catch (e) {
        return { ok: false, say: 'Downloaded, but could not be saved: ' + (e && e.message ? e.message : 'rename failed') };
    }
    return { ok: true, file: dest, bytes: got };
}


// ── THE FILES INSIDE A REPO ──────────────────────────────────────────────
// A repo is not a file. "Qwen2.5-14B-Instruct-GGUF" holds a dozen
// quantisations from Q2 to f16, and which one you want is the whole decision —
// so the search row expands into THIS rather than guessing. One more request,
// and it is what turns the Models screen from a browser into a library.
//
// Sizes here are REAL (the API reports them per file), so the fit verdict on a
// file is a fact rather than the estimate a repo row has to make.
async function files(repoId, machine, opts) {
    const o = opts || {};
    const f = o.fetch || fetch;
    const id = String(repoId || '').trim();
    if (!id) {
        return { ok: false, say: 'No model was named.' };
    }
    let j;
    try {
        const res = await f('https://huggingface.co/api/models/' + encodeURI(id) + '?blobs=true',
            { headers: { Accept: 'application/json' } });
        if (!res.ok) {
            return { ok: false, say: 'Hugging Face answered ' + res.status + ' for that model.' };
        }
        j = await res.json();
    } catch (e) {
        return { ok: false, say: 'Could not reach Hugging Face: ' + (e && e.message ? e.message : 'no answer') };
    }
    const sibs = (j && Array.isArray(j.siblings)) ? j.siblings : [];
    const mlx = /^mlx-community\//i.test(id);
    const rows = sibs.filter(function (s) {
        return s && typeof s.rfilename === 'string' && /\.gguf$/i.test(s.rfilename)
            && !isProjector(s.rfilename);
    }).map(function (s) {
        const bytes = Number(s.size) || 0;
        const gb = bytes ? Math.round((bytes / 1073741824) * 10) / 10 : 0;
        const v = modelVerdict(machine, gb, { mlxOnly: mlx });
        return {
            filename: s.rfilename,
            quant: quantOf(s.rfilename),
            sizeGB: gb,
            sizeIsEstimate: !bytes,
            fit: v.fit,
            why: v.why,
            // The direct download. `resolve/main` is Hugging Face's own stable
            // path for a file at the tip of the default branch.
            url: 'https://huggingface.co/' + id + '/resolve/main/' + encodeURIComponent(s.rfilename) + '?download=true',
        };
    });
    // Best first: what fits, biggest of those, since a bigger quantisation of
    // the same model is better as long as it runs.
    const order = { ok: 0, slow: 1, unknown: 2, no: 3 };
    rows.sort(function (a, b) {
        if (order[a.fit] !== order[b.fit]) { return order[a.fit] - order[b.fit]; }
        return b.sizeGB - a.sizeGB;
    });
    return { ok: true, rows: rows, sharded: sibs.some(function (s) { return /-\d{5}-of-\d{5}\.gguf$/i.test(String(s.rfilename || '')); }) };
}

module.exports = { installed, search, mapRepo, download, files, prettyName, quantOf, paramsOf, isProjector, KNOWN_GOOD, HF_API };
