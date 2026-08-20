// ============================================================
//  chat-bench.js — the hand-tool CLI over src/core/bench.js.
//
//  Usage:  node test/chat-bench.js [modelId]
//  Runs the committed cases against whatever engine answers on the default
//  llama.cpp address and prints the scorecard. The CORE (cases, scorer,
//  runner) lives in src/core/bench.js so the packaged app can offer the
//  same measurement from the Library screen — one bench, two doors, and
//  they can never measure different products. See the core for the full
//  header. CI never runs this live (no model there); core-test gates the
//  scorer and case shapes with fixtures.
// ============================================================
'use strict';
const bench = require('../src/core/bench');

module.exports = bench; // core-test may import through either path

if (require.main === module) {
    (async function () {
        const engineMod = require('../src/core/engine');
        const eng = engineMod.makeEngine({ id: 'llamacpp' });
        if (!(await eng.reachable())) {
            console.log('No engine answering on ' + eng.base + ' — start llama-server with the model you want to judge, then re-run.');
            process.exit(0);
        }
        const model = process.argv[2] || 'local';
        console.log('chat-bench · ' + bench.CASES.length + ' cases · model ' + model + ' · ' + eng.base + '\n');
        const out = await bench.benchRun(eng, model, function (i, n, q, pass) {
            console.log((pass ? ' ✓ ' : ' ✗ ') + q);
        });
        console.log('\n' + out.verdict.say);
        process.exit(0);
    })().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
}
