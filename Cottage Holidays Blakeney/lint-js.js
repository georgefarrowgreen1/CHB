#!/usr/bin/env node
// ============================================================
//  lint-js.js — static "undefined reference" gate for the front-end JS
//  (dev/CI only, never deployed).
//
//  php -l has a JS equivalent gap: nothing catches a reference to a name that
//  exists NOWHERE — a typo'd function/variable — until that code path runs in a
//  browser (the "X is not defined" errors that trip the self-heal reload). This
//  runs ESLint's no-undef (+ a couple of unambiguous bug rules) over the app JS
//  so those fail CI instead of shipping.
//
//  The three script files load into ONE shared global scope in the browser
//  (separate <script> tags, classic scripts), so a function defined in app.js
//  and called in admin.js is perfectly valid. To mirror that, we lint the files
//  CONCATENATED in load order — otherwise every cross-file reference would look
//  undefined. Errors are mapped back to the real file:line.
//
//  Run:  node lint-js.js        (needs `npm i eslint globals`)
// ============================================================
const { ESLint } = require('eslint');
const globals = require('globals');
const fs = require('fs');
const path = require('path');

// Browser load order (see index.html): app.js, then guest-app.js; admin.js is
// fetched on demand but shares the same global scope, so include it too.
const ORDER = ['app.js', 'admin.js', 'guest-app.js'];

// Library globals loaded at runtime (not bundled): Leaflet (maps), the Square
// Web Payments SDK, and onnxruntime-web (`ort` — the Darkstar-C encoder
// runtime, SRI-pinned lazy load). Everything else comes from the standard
// browser/worker sets.
const EXTRA = { L: 'readonly', Square: 'readonly', jspdf: 'readonly', jsPDF: 'readonly', ort: 'readonly' };

(async () => {
  const dir = __dirname;
  let concat = '';
  const map = [];
  let line = 1;
  for (const f of ORDER) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const n = src.split('\n').length;
    map.push({ f, start: line, end: line + n - 1 });
    concat += src + '\n';
    line += n + 1;
  }
  const locate = (ln) => {
    const s = map.find((x) => ln >= x.start && ln <= x.end);
    return s ? `${s.f}:${ln - s.start + 1}` : `concat:${ln}`;
  };

  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'script',
        globals: { ...globals.browser, ...globals.serviceworker, ...EXTRA },
      },
      // Only unambiguous "this is a bug" rules — no style opinions. no-undef is
      // the headline; the others catch copy-paste slips that also break at runtime.
      rules: {
        'no-undef': 'error',
        'no-dupe-keys': 'error',
        'no-dupe-args': 'error',
        'no-func-assign': 'error',
        'no-unsafe-negation': 'error',
      },
    },
  });

  const results = await eslint.lintText(concat, { filePath: 'concat.js' });
  const messages = results[0] ? results[0].messages : [];
  if (!messages.length) {
    console.log('  JS lint clean ✅  (no undefined references)');
    process.exit(0);
  }
  console.log(`  ✗ ${messages.length} issue(s):`);
  for (const m of messages) {
    console.log(`    ${m.severity === 2 ? 'error' : 'warn'}  ${locate(m.line)}  ${m.ruleId}  ${m.message}`);
  }
  // Fail only on error-level findings.
  process.exit(messages.some((m) => m.severity === 2) ? 1 : 0);
})().catch((e) => {
  console.error('lint-js failed to run:', e.message);
  process.exit(1);
});
