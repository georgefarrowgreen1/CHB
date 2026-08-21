// Screenshot the Mac window's chat surfaces as they really render.
const path = require('path');
const { chromium } = require(path.join('/home/user/CHB/Cottage Holidays Blakeney', 'node_modules', 'playwright'));
const uiDir = path.join('/home/user/CHB/mac-app', 'src', 'ui');
const OUT = '/home/user/CHB/scratch';

const state = {
  paired: true, siteUrl: 'https://cottageholidaysblakeney.co.uk/nightshift.php', siteIsDefault: true,
  secretSet: true, secretHint: '••••', keychain: true, keepAwake: true, models: [
    { id: 'gemma-4b.gguf', name: 'gemma-3-4b-it', sizeGB: 3.2, format: 'gguf' },
  ],
  engines: [], engine: 'llamacpp', engineName: 'llama.cpp', engineServing: true,
  runner: { state: 'running', say: 'llama.cpp · ready' }, jobs: {},
  nextRun: new Date(Date.now() + 3600e3).toISOString(), nextRunAt: '02:00', nextRunSays: 'in an hour',
  asks: { today: 2, log: [] }, nights: [], running: false,
  handoff: { dev: 'web', convo: 4, title: 'the boiler quote', draft: 'and what did we pay las', at: 999 },
};
const hist = {
  cur: 't1',
  threads: [
    { id: 't1', title: 'The boiler and Colin', at: 5, n: 4 },
    { id: 't2', title: 'Pricing for half term', at: 4, n: 6 },
    { id: 't3', title: 'What the welcome book should say', at: 3, n: 2 },
  ],
  thread: [
    { role: 'user', text: 'What did Colin quote for the boiler?', at: '09:04' },
    { role: 'assistant', text: 'I checked the expenses — **£380** on 12 August, logged under Maintenance.', at: '09:04', model: 'gemma-3-4b-it' },
  ],
  instr: '', model: 'gemma-4b.gguf',
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHB_CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
  await page.addInitScript((s) => {
    window.__state = s.state; window.__hist = s.hist;
    window.hand = {
      state: async () => window.__state,
      chatHistory: async () => window.__hist,
      chatPick: async () => window.__hist,
      chatNew: async () => window.__hist,
      chatDelete: async () => window.__hist,
      chatInstr: async () => window.__hist,
      chatExport: async () => ({ ok: true, path: '/x.md' }),
      chatSendToPhone: async () => ({ ok: true, convo: 7, say: 'Sent.' }),
      handoffSay: async () => ({ ok: true }),
      chatContinue: async () => ({ ok: true, id: 5, convo: 4 }),
      webChat: async (convo) => ({ ok: true, convo: convo || 4, convos: [
        { convo: 4, n: 6, title: 'the boiler quote' },
        { convo: 3, n: 2, title: 'Who owes me money?' },
      ], msgs: [
        { who: 'you', text: 'what did colin quote for the boiler?', at: '09:02' },
        { who: 'mac', text: 'Colin quoted £380 — logged on 12 August under Maintenance.', at: '09:02', model: 'gemma-3-4b-it' },
      ] }),
      models: async () => ({ ok: true, models: [] }),
      searchModels: async () => ({ ok: true, results: [] }),
      onProgress: () => {}, onOpenUpdates: () => {}, onDownload: () => {}, onRan: () => {},
      checkUpdate: async () => ({ ok: true, state: 'current', say: 'Newest version.' }),
      startEngine: async () => ({ ok: true }), stopEngine: async () => ({ ok: true }),
      saveConfig: async () => ({ ok: true }), runNow: async () => ({ ok: true }),
      testSite: async () => ({ ok: true, say: 'ok' }), benchModel: async () => ({ ok: true, verdict: { safe: true, say: 'SAFE' } }),
      chatAttach: async () => ({ ok: false, say: '' }), chatStop: () => {},
    };
  }, { state, hist });
  await page.goto('file://' + path.join(uiDir, 'index.html'));
  await page.waitForTimeout(500);
  await page.click('[data-v="4"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/mac-chat-before.png' });
  // the mirror
  await page.click('#phoneView');
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/mac-mirror-before.png' });
  await browser.close();
  console.log('shot');
})();
