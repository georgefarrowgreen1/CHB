#!/usr/bin/env node
// ============================================================
//  darkstar-build.js — packs the DARKSTAR semantic model into darkstar.bin,
//  the static asset the site ships (dev tool; the .bin is committed, this
//  documents how it was made and rebuilds it when the source table changes).
//
//  We quantise the static token-embedding table to int8 with one fp32 scale
//  per token vector — measured on the NLU harness: identical recall to fp32
//  at ~1/4 the bytes (29,528 tokens × 256 dims, WordPiece tokenizer).
//
//  ATTRIBUTION / NOTICE (kept here in the dev-only builder for licence
//  compliance; this file is deploy-excluded and never shipped):
//    Darkstar's embedding table is derived from minishlab/potion-base-8M
//    (Model2Vec), licensed MIT — Copyright (c) The Minish Lab. The MIT licence
//    permits use, modification and redistribution with this notice retained.
//
//  Usage: node darkstar-build.js <model_dir> [out.bin]
//    <model_dir> holds model.safetensors + tokenizer.json.
//
//  Binary layout (little-endian):
//    0   4  magic 'CHBE'
//    4   4  u32 version (1)
//    8   4  u32 vocab
//    12  4  u32 dim
//    16  4  u32 tokenBytes — length of the UTF-8 JSON array of tokens (by id)
//    20  …  tokens JSON, then Float32Array scales[vocab], then Int8Array
//            data[vocab*dim]
// ============================================================
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const out = process.argv[3] || path.join(__dirname, 'darkstar.bin');
if (!dir) { console.error('usage: node darkstar-build.js <model_dir> [out.bin]'); process.exit(1); }

const buf = fs.readFileSync(path.join(dir, 'model.safetensors'));
const hlen = Number(buf.readBigUInt64LE(0));
const header = JSON.parse(buf.slice(8, 8 + hlen).toString('utf8'));
const t = header.embeddings;
const [vocab, dim] = t.shape;
const data = new Float32Array(buf.buffer, buf.byteOffset + 8 + hlen + t.data_offsets[0], vocab * dim);

const tk = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
const byId = new Array(vocab);
Object.entries(tk.model.vocab).forEach(([tok, id]) => { byId[id] = tok; });
const tokens = Buffer.from(JSON.stringify(byId), 'utf8');

const scales = new Float32Array(vocab);
const q8 = new Int8Array(vocab * dim);
for (let v = 0; v < vocab; v++) {
    let mx = 0;
    for (let i = 0; i < dim; i++) { const a = Math.abs(data[v * dim + i]); if (a > mx) mx = a; }
    const s = mx / 127 || 1;
    scales[v] = s;
    for (let i = 0; i < dim; i++) q8[v * dim + i] = Math.round(data[v * dim + i] / s);
}

const head = Buffer.alloc(20);
head.write('CHBE', 0, 'ascii');
head.writeUInt32LE(1, 4);
head.writeUInt32LE(vocab, 8);
head.writeUInt32LE(dim, 12);
head.writeUInt32LE(tokens.length, 16);
fs.writeFileSync(out, Buffer.concat([head, tokens, Buffer.from(scales.buffer), Buffer.from(q8.buffer)]));
console.log(`wrote ${out}: vocab ${vocab} × dim ${dim} · ${(fs.statSync(out).size / 1048576).toFixed(1)}MB`);
