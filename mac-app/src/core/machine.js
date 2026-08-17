// ============================================================
//  machine.js — what Mac is this, and what will actually run on it.
//
//  The Models screen makes a claim about every model it offers ("Runs well
//  here", "Tight on 16 GB — slow", "Will not fit"), and a claim like that is
//  only worth making if it comes from the machine rather than from a table
//  somebody typed. So this module reads the real thing and nothing else
//  guesses.
//
//  The one judgement worth arguing about is the RAM headroom. A quantised
//  model needs its weights resident plus room for the context and for macOS
//  itself; on Apple silicon that memory is shared with the GPU, so the
//  practical ceiling is well under the installed total. 65% of RAM is the
//  line used here — measured against how llama.cpp actually behaves rather
//  than derived from anything — and it is stated in one place so it can be
//  argued with.
//
//  No dependencies: os + child_process, both built in. That is deliberate —
//  the whole core is testable with `node test/core-test.js` and no install.
// ============================================================
'use strict';
const os = require('os');
const { execFileSync } = require('child_process');

// Fraction of installed memory a model may occupy before it is called slow.
// Above HARD it is not offered as usable at all.
const RAM_SOFT = 0.65;
const RAM_HARD = 0.85;

function sh(cmd, args) {
    try {
        return String(execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000 })).trim();
    } catch (e) {
        return '';
    }
}

// The Mac, as the app reports it. Every field degrades to something honest
// rather than throwing: on a machine that is not a Mac at all (this repo's CI,
// for instance) it answers what it can and says the rest is unknown.
function readMachine() {
    const isMac = process.platform === 'darwin';
    const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
    const ramBytes = os.totalmem();
    const m = {
        isMac,
        arch,
        appleSilicon: isMac && arch === 'arm64',
        // A rosetta-translated process would report x64 on an arm64 Mac and
        // then withhold MLX from a machine that has it. Worth knowing about.
        translated: isMac && arch === 'x64' && sh('sysctl', ['-in', 'sysctl.proc_translated']) === '1',
        cpu: '',
        model: '',
        macos: '',
        cores: os.cpus().length,
        ramBytes,
        ramGB: Math.round((ramBytes / 1073741824) * 10) / 10,
    };
    if (isMac) {
        m.cpu = sh('sysctl', ['-n', 'machdep.cpu.brand_string']);
        m.model = sh('sysctl', ['-n', 'hw.model']);
        m.macos = sh('sw_vers', ['-productVersion']);
    }
    // Translation means the real machine IS Apple silicon; say so, because the
    // engine choice depends on the hardware and not on how we were launched.
    if (m.translated) {
        m.appleSilicon = true;
    }
    return m;
}

// A one-line description for the window's Runner screen.
function describe(m) {
    const bits = [];
    if (m.model) bits.push(m.model);
    if (m.cpu) bits.push(m.cpu.replace(/\s+/g, ' '));
    else if (m.appleSilicon) bits.push('Apple silicon');
    else if (m.arch === 'x64') bits.push('Intel');
    bits.push(m.ramGB + ' GB');
    if (m.macos) bits.push('macOS ' + m.macos);
    return bits.join(' · ');
}

// WILL THIS MODEL RUN HERE? Returns a verdict the UI can print verbatim.
//   ok    — comfortably within the headroom
//   slow  — it will load and it will crawl
//   no    — it will not fit, and offering it would waste a long download
// `sizeGB` is the file size on disk, which for a quantised GGUF is very close
// to its resident size; the context is what the headroom above allows for.
function modelVerdict(m, sizeGB, opts) {
    const o = opts || {};
    const gb = Number(sizeGB) || 0;
    const ram = Number(m && m.ramGB) || 0;
    if (o.mlxOnly && !(m && m.appleSilicon)) {
        return { fit: 'no', why: 'Apple silicon only' };
    }
    if (!ram || !gb) {
        return { fit: 'unknown', why: 'Size unknown' };
    }
    if (gb > ram * RAM_HARD) {
        return { fit: 'no', why: 'Will not fit' };
    }
    if (gb > ram * RAM_SOFT) {
        return { fit: 'slow', why: 'Tight on ' + Math.round(ram) + ' GB — slow' };
    }
    // An Intel Mac has no usable GPU path, so even a model that fits runs on
    // the CPU. That is a fair thing to say up front rather than after the
    // download: it is the difference between tens of tokens a second and a few.
    if (m && !m.appleSilicon) {
        return { fit: 'ok', why: 'Fits — CPU only, so slow' };
    }
    return { fit: 'ok', why: 'Runs well here' };
}

module.exports = { readMachine, describe, modelVerdict, RAM_SOFT, RAM_HARD };
