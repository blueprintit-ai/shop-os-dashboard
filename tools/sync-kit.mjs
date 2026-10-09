#!/usr/bin/env node
// Syncs the product's owner pages from the RoboNuggets "Rubric Agentic OS" kit
// (CC BY 4.0, see NOTICE.md). The kit page is the design; this script copies it
// and applies ONLY the named rules in RULES below. Each rule is anchored to
// exact kit text and the script FAILS loudly if an anchor is not found exactly
// once, so a kit change that moves one is noticed instead of silently skipped.
//
//   node tools/sync-kit.mjs [kit-folder]         write the files and tools/sync-kit.lock.json
//   node tools/sync-kit.mjs --check [kit-folder] exit 1 if the committed files differ
//
// The kit folder is required: the first argument, else $KIT_DIR (no default path is baked in).
// tools/sync-kit.lock.json records the sha256 of every raw kit input, every output file and the
// rule set, so test/kit-lock.test.js can prove in CI (without the kit) that the committed pages are
// exactly what these rules produced. test/kit-parity.test.js
// re-runs syncKit() and asserts the committed files equal its output and that the
// output differs from the raw kit only inside these rules' regions.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_FILE = join(ROOT, "tools", "sync-kit.lock.json");

// kit file -> product file
export const FILES = [
  { src: "dashboard.html", dest: "public/owner.html", text: true },
  { src: "widgets.html", dest: "public/widgets.html", text: true },
  { src: "assets.html", dest: "public/assets.html", text: true },
  { src: "vendor/thinking-orbs.js", dest: "public/vendor/thinking-orbs.js", text: false },
];

// ---- replacement fragments -------------------------------------------------

const FRAG = (name) => readFileSync(join(ROOT, "tools", "sync-kit", name), "utf8").replace(/\r\n/g, "\n");
const SKOOL_CLASSROOM = "https://www.skool.com/robonuggets/classroom/7e082e48?md=21b57bd12152486eb6280168c7ea5ac4";

const FONT_LINK = '<link rel="stylesheet" href="/static/css/kit-fonts.css">';

const ACCT_POP_HTML = `<div id="acctpop">
  <div class="pk">ACCOUNT</div>
  <div id="acctRows"><div class="row"><span>status</span><span>loading...</span></div></div>
  <label for="chatModelSel">Model (this chat)</label>
  <select id="chatModelSel"><option value="">Account default</option></select>
  <label for="chatEffortSel">Effort (this chat)</label>
  <select id="chatEffortSel"><option value="">Account default</option></select>
  <div class="arow">
    <button class="refresh" id="acctRefresh">REFRESH</button>
    <button class="switch" id="acctLogout">LOGOUT</button>
  </div>
</div>`;

// Same structure as the kit's popover script; only the data source (/api/me),
// the rows, and the SWITCH ACCOUNT button (which logged the whole machine out of
// Claude Code) differ. Logout is the product's own: POST /api/logout, then /login.
const ACCT_POP_JS = `/* ---- account / model / effort popover for the chat bar ---- */
(() => {
  const btn = document.getElementById('chatAcct'), pop = document.getElementById('acctpop');
  const rows = document.getElementById('acctRows');
  const modelSel = document.getElementById('chatModelSel'), effortSel = document.getElementById('chatEffortSel');
  const refreshBtn = document.getElementById('acctRefresh'), logoutBtn = document.getElementById('acctLogout');
  if (!btn || !pop) return;
  const escA = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

  function fillSelects() {
    if (modelSel.options.length <= 1) MODELS.forEach(m => modelSel.add(new Option(m, m)));
    if (effortSel.options.length <= 1) EFFORTS.forEach(e => effortSel.add(new Option(e, e)));
    modelSel.value = window.CHATCFG.model || '';
    effortSel.value = window.CHATCFG.effort || '';
  }
  function saveCfg() {
    window.CHATCFG = { model: modelSel.value, effort: effortSel.value };
    try { localStorage.setItem('os-chat-modeff', JSON.stringify(window.CHATCFG)); } catch (_) {}
  }
  modelSel.addEventListener('change', saveCfg);
  effortSel.addEventListener('change', saveCfg);

  fetch(API + '/api/me').then(r => r.json())
    .then(a => { btn.querySelector('.dot').className = 'dot ' + (a.user ? 'ok' : 'bad'); })
    .catch(() => {});

  function loadStatus() {
    rows.innerHTML = '<div class="row"><span>status</span><span>loading...</span></div>';
    fetch(API + '/api/me').then(r => r.json()).then(a => {
      const u = a.user;
      btn.querySelector('.dot').className = 'dot ' + (u ? 'ok' : 'bad');
      if (!u) { rows.innerHTML = '<div class="row"><span>status</span><span>signed out</span></div>'; return; }
      rows.innerHTML = \`<div class="row"><span>user</span><span>\${escA(u.displayName || u.username || '-')}</span></div>
        <div class="row"><span>role</span><span>\${escA(u.role || '-')}</span></div>\`
        + (u.role === 'owner' ? '<div class="row"><span>users</span><span><a href="/users">Users</a></span></div>' : '');
    }).catch(() => {
      rows.innerHTML = '<div class="row"><span>status</span><span>server unreachable</span></div>';
      btn.querySelector('.dot').className = 'dot bad';
    });
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const willShow = !pop.classList.contains('show');
    pop.classList.toggle('show', willShow);
    if (!willShow) return;
    fillSelects(); loadStatus();
    const r = btn.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - pr.width - 8, r.left)) + 'px';
    pop.style.top = Math.max(8, r.top - pr.height - 10) + 'px';
  });
  document.addEventListener('pointerdown', e => {
    if (pop.classList.contains('show') && !e.target.closest('#acctpop') && !e.target.closest('#chatAcct'))
      pop.classList.remove('show');
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') pop.classList.remove('show'); });
  refreshBtn.addEventListener('click', loadStatus);
  logoutBtn.addEventListener('click', () => {
    logoutBtn.disabled = true;
    fetch(API + '/api/logout', { method: 'POST' }).catch(() => {}).then(() => { location.href = '/login'; });
  });
})();

`;

// ---- rule machinery --------------------------------------------------------

// A rule is { id, file (kit file name), doc, find: string|RegExp, replace: string|() => string }
// or { id, file, doc, between: [startText, endText], maxBytes, replace } which swaps
// everything from startText up to (not including) the first endText after it, and
// fails if that span is larger than maxBytes (a runaway match would eat kit code).
// The start anchor must be found exactly once.

export const RULES = [
  { id: "fonts-link-owner", file: "dashboard.html",
    doc: "(a) Google Fonts preconnect + stylesheet <link>s -> local /static/css/kit-fonts.css (Outfit 300-700, Doto 700/900 from public/vendor/fonts).",
    find: /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\r?\n<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/, replace: FONT_LINK },
  { id: "fonts-link-widgets", file: "widgets.html",
    doc: "(a) same font rule for the widget library page.",
    find: /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\r?\n<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/, replace: FONT_LINK },
  { id: "fonts-link-assets", file: "assets.html",
    doc: "(a) same font rule for the Business Assets page.",
    find: /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\r?\n<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/, replace: FONT_LINK },

  { id: "three-importmap", file: "dashboard.html",
    doc: "(b) three.js importmap CDN URL (jsdelivr three@0.160.0) -> vendored /static/vendor/three.module.min.js (vendored build is r160, the version the kit expects).",
    find: "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", replace: "/static/vendor/three.module.min.js" },

  { id: "api-base", file: "dashboard.html",
    doc: "(c) the kit's API base constant (http: -> same origin, file: -> localhost:50000) -> same-origin ''.",
    find: "const API = (location.protocol === 'http:' ? '' : 'http://localhost:50000');", replace: "const API = '';" },

  { id: "title-owner", file: "dashboard.html",
    doc: "(d) <title> -> 'Blueprint OS - <shop name>'; __SHOP_NAME__ is filled server-side (src/routes/pages.js, HTML-escaped).",
    find: "<title>Blueprint IT - Shop OS</title>", replace: "<title>Blueprint OS — __SHOP_NAME__</title>" },
  { id: "title-h1", file: "dashboard.html",
    doc: "(d) title widget heading 'Blueprint IT <span>- Shop OS</span>' -> '<shop name> <span>- Blueprint OS</span>'; __SHOP_NAME_JS__ is HTML-escaped and made safe for the JS template literal it sits in.",
    find: "</svg>Blueprint IT <span>- Shop OS</span></h1>", replace: "</svg>__SHOP_NAME_JS__ <span>- Blueprint OS</span></h1>" },
  { id: "title-widgets", file: "widgets.html",
    doc: "(d) widget library <title>.",
    find: "<title>Blueprint IT - Shop OS Widget Library</title>", replace: "<title>Blueprint OS — Widget Library</title>" },
  { id: "title-assets", file: "assets.html",
    doc: "(d) Business Assets <title>.",
    find: "<title>Blueprint IT - Business Assets</title>", replace: "<title>Blueprint OS — Business Assets</title>" },

  { id: "acct-popover-html", file: "dashboard.html",
    doc: "(e) #acctpop contents: 'CLAUDE CODE ACCOUNT' rows + SWITCH ACCOUNT (logs the whole machine out of Claude Code, unsafe on a customer PC) -> product account rows + LOGOUT. The model/effort selects are unchanged.",
    between: ['<div id="acctpop">', '\n\n<div id="profilePop">'], maxBytes: 1200, replace: ACCT_POP_HTML },
  { id: "acct-popover-js", file: "dashboard.html",
    doc: "(e) the popover's script: /api/account -> /api/me, rows = signed-in user + role + Users link (owners), SWITCH ACCOUNT -> POST /api/logout then /login.",
    between: ["/* ---- account / model / effort popover for the chat bar ---- */", "/* ---- kit boot glue:"], maxBytes: 6000, replace: ACCT_POP_JS },

  { id: "orbs-script-path", file: "dashboard.html",
    doc: "(f) <script src=\"vendor/thinking-orbs.js\"> -> /static/vendor/thinking-orbs.js (the product serves public/ under /static).",
    find: '<script src="vendor/thinking-orbs.js"></script>', replace: '<script src="/static/vendor/thinking-orbs.js"></script>' },

  { id: "gmail-account-hint", file: "dashboard.html",
    doc: "(g) the inbox row link carried the owner's personal ?authuser=<address>; dropped so no address is baked in (mail is not wired in the product).",
    find: /https:\/\/mail\.google\.com\/mail\/\?authuser=[^#"'\s]+#all\//, replace: "https://mail.google.com/mail/#all/" },

  { id: "asset-open-owner", file: "dashboard.html",
    doc: "(g) widget 'open document' called the kit's POST /api/assets/open, which shells out `open <path>` on the server; the product opens the document's own viewer URL in a new tab instead.",
    find: "const openDoc = id => fetch(API + '/api/assets/open', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});",
    replace: "const openDoc = id => { window.open(API + '/assets/file/' + encodeURIComponent(id), '_blank'); };" },
  { id: "apps-rows", file: "dashboard.html",
    doc: "(h) SHOP APPS: the hardcoded launcher rows (the kit author's local tools on 127.0.0.1:5298/5055/5058/5071/5303/50002/50003 and the Skool classroom) are removed; the container is filled from GET /api/apps (vault Dashboard/apps.json, default = the Second Brain row).",
    between: ['<div class="approws" style="margin-top:4px">', "\n    </div>`,\n  'w-mail':"], maxBytes: 3000, replace: '<div class="approws" id="appRows" style="margin-top:4px">' },
  { id: "apps-render", file: "dashboard.html",
    doc: "(h) adds renderAppRows() (rows from /api/apps, clicks open in a new tab with rel=noopener, http(s) or same-origin paths only) and calls it first thing in the kit's mountApps().",
    find: "function mountApps() {\n", replace: () => FRAG("apps-render.js") + "\nfunction mountApps() {\n  renderAppRows();\n" },
  { id: "add-app-prompt", file: "dashboard.html",
    doc: "(h) the '+ ADD APP' popup still gives the agent a paste-ready prompt, but it now describes Dashboard/apps.json instead of editing dashboard.html.",
    between: ["const ADD_APP_PROMPT = `", "`;\n\n/* sprite grids"], maxBytes: 800, replace: () => "const ADD_APP_PROMPT = `" + FRAG("add-app-prompt.txt").trimEnd() },
  { id: "second-brain-fallback-store", file: "dashboard.html",
    doc: "(h) the STORE wheel action's fallback when no Second Brain answers on :5210: the kit's Skool classroom -> the product's own /notes viewer.",
    find: `: '${SKOOL_CLASSROOM}', '_blank');`, replace: ": '/notes', '_blank');" },
  { id: "second-brain-fallback-orb", file: "dashboard.html",
    doc: "(h) same fallback for a click on the orb.",
    find: `else window.open('${SKOOL_CLASSROOM}', '_blank');`, replace: "else window.open('/notes', '_blank');" },

  { id: "widgets-board-path", file: "widgets.html",
    doc: "(i) library prompts: the board is not 'dashboard.html in this OS folder'; it is the vault's Dashboard folder.",
    find: "const BOARD_PATH = 'dashboard.html (in this OS folder)';", replace: "const BOARD_PATH = 'the Dashboard folder of this vault (Dashboard/)';" },
  { id: "widgets-served-at", file: "widgets.html",
    doc: "(i) library prompts: the dashboard runs from the installed Blueprint OS package, not 'node server.js in the same folder'.",
    find: "(served at http://localhost:50000, node server.js in the same folder)", replace: "(the dashboard runs from the installed Blueprint OS package and is served at the address it is opened at)" },
  { id: "widgets-verify-url", file: "widgets.html",
    doc: "(i) library prompts: verify against the dashboard's own address, not localhost:50000.",
    find: "open http://localhost:50000 headless", replace: "open the dashboard (the address it normally runs at) headless" },
  { id: "widgets-assets-folder", file: "widgets.html",
    doc: "(i) library preview text: the assets repository is the Business Assets folder, not 'Dropbox folder'.",
    find: "repository (Dropbox folder, subfolders = categories)", replace: "repository (the Business Assets folder, subfolders = categories)" },
  { id: "product-extras", file: "dashboard.html",
    doc: "(j) loads /static/js/product-extras.js last: adds the product's Users link, status dot and Update control to the kit toolbar (owners only).",
    find: "</body>", replace: '<script src="/static/js/product-extras.js"></script>\n</body>' },
  { id: "theme-icon-inline", file: "dashboard.html",
    doc: "(k) the light/dark toggle was an EMPTY <svg> filled in later by the kit's boot script, so any time that script did not run (or the title widget was rebuilt) the toolbar showed a blank gap. The button now carries both glyphs inline (sun and moon, drawn with the same stroke styling as the other toolbar icons), and CSS shows the right one for the theme.",
    find: '<button id="themeBtn" title="Toggle light / dark"><svg viewBox="0 0 24 24"></svg></button>',
    replace: '<button id="themeBtn" title="Toggle light / dark"><svg viewBox="0 0 24 24"><g class="th-sun"><circle cx="12" cy="12" r="4.6"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5 5l1.9 1.9M17.1 17.1L19 19M19 5l-1.9 1.9M6.9 17.1L5 19"/></g><g class="th-moon"><path d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6z"/></g></svg></button>' },
  { id: "theme-icon-css", file: "dashboard.html",
    doc: "(k) show the moon in the light theme and the sun in the dark theme (html.light is set by the kit's first script).",
    find: ".tbar button:hover svg { stroke:var(--accent); }",
    replace: ".tbar button:hover svg { stroke:var(--accent); }\n  html.light #themeBtn .th-sun, html:not(.light) #themeBtn .th-moon { display:none; }" },
  { id: "theme-icon-boot", file: "dashboard.html",
    doc: "(k) the kit's boot script no longer overwrites the inline glyphs, and the click handler is delegated from the document so it survives a rebuild of the title widget.",
    between: ["    themeBtn.querySelector('svg').innerHTML = LIGHT ? MOONPATH : SUNPATH;\n    themeBtn.addEventListener('click', () => {\n      localStorage.setItem('os-theme', LIGHT ? 'dark' : 'light');\n      location.reload();\n    });\n", "  }\n  fetch(API + '/api/skills')"], maxBytes: 300,
    replace: "    document.addEventListener('click', e => {\n      if (!e.target.closest('#themeBtn')) return;\n      localStorage.setItem('os-theme', LIGHT ? 'dark' : 'light');\n      location.reload();\n    });\n" },
  { id: "edit-mode-chatbar-passthrough", file: "dashboard.html",
    doc: "(k) the kit's default layout ends the STATS (and any bottom-row) widget at the very bottom of the window, under the 62px chat bar (z-index 70), so its resize handle could not be grabbed while editing the layout. While the layout editor is on, the chat bar and an open transcript are dimmed and let pointer events through to the widgets beneath; leaving edit mode restores them.",
    find: "  body.chatcollapsed #chatLog { display:none; }",
    replace: "  body.chatcollapsed #chatLog { display:none; }\n  body.edit #chatBar, body.edit #chatLog { pointer-events:none; opacity:.35; }" },
  { id: "assets-folder-copy", file: "assets.html",
    doc: "(j) upload popup copy: 'your Dropbox' -> 'your Business Assets folder' (the folder is set in Users > Business Assets folder).",
    find: "category's folder in your Dropbox.", replace: "category's folder in your Business Assets folder." },
  { id: "asset-open-assets", file: "assets.html",
    doc: "(g) same as asset-open-owner, on the Business Assets page.",
    find: "const openDoc = f => fetch('/api/assets/open', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ id: f.id }) }).then(() => toast('Opening ' + f.name)).catch(() => toast('could not open'));",
    replace: "const openDoc = f => { window.open('/assets/file/' + encodeURIComponent(f.id), '_blank'); toast('Opening ' + f.name); };" },
];

function applyRule(rule, text) {
  let start, end;
  if (rule.between) {
    const [a, b] = rule.between;
    start = text.indexOf(a);
    if (start < 0 || text.indexOf(a, start + 1) >= 0) throw new Error(`sync-kit: anchor not found exactly once for rule ${rule.id} (start: ${JSON.stringify(a.slice(0, 60))}) in ${rule.file}`);
    end = text.indexOf(b, start + a.length); // the first end anchor after the start
    if (end < 0) throw new Error(`sync-kit: anchor not found for rule ${rule.id} (end: ${JSON.stringify(b.slice(0, 60))}) in ${rule.file}`);
    if (!Number.isInteger(rule.maxBytes)) throw new Error(`sync-kit: rule ${rule.id} is a between-rule without maxBytes`);
    if (Buffer.byteLength(text.slice(start, end)) > rule.maxBytes) throw new Error(`sync-kit: rule ${rule.id} would replace ${Buffer.byteLength(text.slice(start, end))} bytes, over its ${rule.maxBytes}-byte cap (did an anchor move?)`);
  } else if (rule.find instanceof RegExp) {
    const g = new RegExp(rule.find.source, "g");
    const hits = [...text.matchAll(g)];
    if (hits.length !== 1) throw new Error(`sync-kit: anchor not found exactly once (${hits.length} matches) for rule ${rule.id} in ${rule.file}: ${rule.find}`);
    start = hits[0].index; end = start + hits[0][0].length;
  } else {
    start = text.indexOf(rule.find);
    if (start < 0 || text.indexOf(rule.find, start + 1) >= 0) throw new Error(`sync-kit: anchor not found exactly once for rule ${rule.id} in ${rule.file}: ${JSON.stringify(rule.find.slice(0, 80))}`);
    end = start + rule.find.length;
  }
  const before = text.slice(start, end);
  const after = typeof rule.replace === "function" ? rule.replace() : rule.replace;
  return { text: text.slice(0, start) + after + text.slice(end), before, after };
}

// Pure: reads the kit folder, returns what the product's files should contain.
export function syncKit(kitDir) {
  const outputs = new Map(), raw = new Map(), applied = [];
  for (const f of FILES) {
    const p = join(kitDir, f.src);
    if (!existsSync(p)) throw new Error(`sync-kit: kit file missing: ${p}`);
    const buf = readFileSync(p);
    raw.set(f.dest, buf);
    if (!f.text) { outputs.set(f.dest, buf); continue; }
    let text = buf.toString("utf8");
    for (const rule of RULES.filter((r) => r.file === f.src)) {
      const r = applyRule(rule, text);
      text = r.text;
      applied.push({ rule: rule.id, dest: f.dest, before: r.before, after: r.after });
    }
    outputs.set(f.dest, Buffer.from(text, "utf8"));
  }
  return { outputs, raw, applied };
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// The rule set as data (functions evaluated), so any change to a rule or fragment changes the digest.
export function rulesDigest() {
  const ser = RULES.map((r) => ({
    id: r.id, file: r.file, doc: r.doc, maxBytes: r.maxBytes ?? null,
    find: r.find instanceof RegExp ? { regex: r.find.source } : (r.find ?? null),
    between: r.between ?? null,
    replace: typeof r.replace === "function" ? r.replace() : r.replace,
  }));
  return sha(JSON.stringify(ser));
}

export function buildLock({ outputs, raw }) {
  const files = Object.fromEntries(FILES.map((f) => [f.dest, { kitSource: f.src, input: sha(raw.get(f.dest)), output: sha(outputs.get(f.dest)) }]));
  return { note: "Generated by tools/sync-kit.mjs; do not edit. Hashes are sha256 of raw kit inputs, the committed outputs and the rule set.", rules: rulesDigest(), files };
}

// Problems between the lock and the committed outputs (and the current rule set); [] when consistent.
// `readOutput(rel)` returns the committed bytes, so a test can feed it a tampered copy.
export function checkLock(lock, readOutput) {
  const problems = [];
  if (lock.rules !== rulesDigest()) problems.push("the rule set changed since the lock was written: run node tools/sync-kit.mjs");
  for (const f of FILES) {
    const want = lock.files?.[f.dest]?.output;
    let got = null;
    try { got = sha(readOutput(f.dest)); } catch { /* missing */ }
    if (!want || got !== want) problems.push(`${f.dest} does not match the lock (hand-edited or out of sync): run node tools/sync-kit.mjs`);
  }
  return problems;
}

// Hashes of the kit inputs that differ from the lock: the kit moved on, re-sync.
export function changedInputs(lock, raw) {
  return FILES.filter((f) => lock.files?.[f.dest]?.input !== sha(raw.get(f.dest))).map((f) => f.src);
}

function main(argv) {
  const check = argv.includes("--check");
  const arg = argv.find((a) => !a.startsWith("--"));
  const kit = arg || process.env.KIT_DIR;
  if (!kit) throw new Error("sync-kit: pass the kit folder (node tools/sync-kit.mjs <kit-folder>) or set KIT_DIR");
  const { outputs, raw, applied } = syncKit(kit);
  let dirty = 0;
  for (const [rel, buf] of outputs) {
    const dest = join(ROOT, rel);
    const same = existsSync(dest) && Buffer.compare(readFileSync(dest), buf) === 0;
    if (check) { if (!same) { dirty++; console.error(`out of sync: ${rel}`); } continue; }
    if (!same) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf); }
    console.log(`${same ? "unchanged" : "wrote    "} ${rel}`);
  }
  const lock = JSON.stringify(buildLock({ outputs, raw }), null, 2) + "\n";
  const lockSame = existsSync(LOCK_FILE) && readFileSync(LOCK_FILE, "utf8") === lock;
  if (check) { if (!lockSame) { dirty++; console.error("out of sync: tools/sync-kit.lock.json"); } }
  else { if (!lockSame) writeFileSync(LOCK_FILE, lock); console.log(`${lockSame ? "unchanged" : "wrote    "} tools/sync-kit.lock.json`); }
  console.log(`${applied.length} rule applications from ${kit}`);
  if (check && dirty) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
