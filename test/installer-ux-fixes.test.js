import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createContext } from "../installer/core/context.js";
import { runSteps } from "../installer/core/runner.js";
import { vaultLocationStep, PICKER_PS1 } from "../installer/steps/vault-location.js";
import { parseArgs } from "../installer/run-install.js";

// Fake timers: tick(ms) advances a virtual clock and fires due intervals.
function fakeTime() {
  let t = 0;
  const timers = new Map();
  let id = 0;
  return {
    now: () => t,
    setInterval: (fn, ms) => { timers.set(++id, { fn, ms, next: t + ms }); return id; },
    clearInterval: (h) => { timers.delete(h); },
    active: () => timers.size,
    tick(ms) {
      const end = t + ms;
      for (;;) {
        let best = null;
        for (const x of timers.values()) if (x.next <= end && (!best || x.next < best.next)) best = x;
        if (!best) break;
        t = best.next; best.next += best.ms; best.fn();
      }
      t = end;
    },
  };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise((r) => setImmediate(r));
const okSnap = { os: "x", free_disk_mb: 50000, reach: { github: true, npm: true, claude_ai: true } };
const mk = (extra = {}) => createContext({ platform: "win32", snapshot: async () => okSnap, ...extra });

// ---- runner heartbeat ----
test("runner: a step still running after 8s prints a still-working line every 10s, and stops when it ends", async () => {
  const ft = fakeTime();
  const printed = [];
  const d = deferred();
  const ctx = { print: (m) => printed.push(m) };
  const p = runSteps([{ id: "slow", title: "Installing things", severity: "stop", action: () => d.promise }], ctx, { sleep: async () => {}, now: ft.now, setInterval: ft.setInterval, clearInterval: ft.clearInterval });
  await flush();
  ft.tick(7000);
  assert.equal(printed.length, 0);
  ft.tick(1000); // 8s
  assert.equal(printed.length, 1);
  assert.equal(printed[0], 'Still working on "Installing things"... please keep this window open. (8s)');
  ft.tick(9000); // 17s: not yet 10s since last
  assert.equal(printed.length, 1);
  ft.tick(1000); // 18s
  assert.equal(printed.length, 2);
  d.resolve();
  await p;
  assert.equal(ft.active(), 0);
  ft.tick(60000);
  assert.equal(printed.length, 2);
});
test("runner: quick steps and steps marked heartbeat:false print nothing and leave no timers", async () => {
  const ft = fakeTime();
  const printed = [];
  const d = deferred();
  const ctx = { print: (m) => printed.push(m) };
  const opts = { sleep: async () => {}, now: ft.now, setInterval: ft.setInterval, clearInterval: ft.clearInterval };
  await runSteps([{ id: "q", title: "Q", severity: "stop", action: async () => {} }], ctx, opts);
  assert.equal(ft.active(), 0);
  const p = runSteps([{ id: "vault-location", title: "Own", severity: "stop", heartbeat: false, action: () => d.promise }], ctx, opts);
  await flush();
  ft.tick(120000);
  assert.deepEqual(printed, []);
  d.resolve();
  await p;
});
test("runner: heartbeat is cleared on failure and between retries, and never goes to the reporter", async () => {
  const ft = fakeTime();
  const printed = [];
  const sent = [];
  const ds = [deferred(), deferred()];
  let n = 0;
  const ctx = { print: (m) => printed.push(m) };
  const p = runSteps([{ id: "r", title: "Retrying", severity: "stop", retries: 1, action: () => ds[n++].promise }], ctx, { reporter: { send: (e) => { sent.push(e); return Promise.resolve(); } }, sleep: async () => {}, now: ft.now, setInterval: ft.setInterval, clearInterval: ft.clearInterval });
  await flush();
  ft.tick(9000);
  assert.equal(printed.length, 1);
  assert.match(printed[0], /\(8s\)$/);
  ds[0].reject(new Error("boom"));
  await flush(); await flush();
  assert.equal(ft.active(), 1, "one timer for the second attempt only");
  ft.tick(9000);
  assert.match(printed[1], /\(8s\)$/, "elapsed restarts for the new attempt");
  ds[1].reject(new Error("boom2"));
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(ft.active(), 0);
  assert.ok(sent.every((e) => !JSON.stringify(e).includes("Still working")));
});
test("runner: a broken print never breaks the step", async () => {
  const ft = fakeTime();
  const d = deferred();
  const p = runSteps([{ id: "s", title: "S", severity: "stop", action: () => d.promise }], { print: () => { throw new Error("closed"); } }, { sleep: async () => {}, now: ft.now, setInterval: ft.setInterval, clearInterval: ft.clearInterval });
  await flush();
  ft.tick(30000);
  d.resolve();
  assert.equal((await p).ok, true);
});

// ---- picker messages ----
test("vault location: says it is opening the window, then reminds every 10s until the picker returns", async () => {
  const ft = fakeTime();
  const printed = [];
  const d = deferred();
  const ctx = mk({ print: (m) => printed.push(m), setInterval: ft.setInterval, clearInterval: ft.clearInterval, run: () => d.promise, prompt: async (q, def) => def, exists: () => false });
  const p = runSteps([vaultLocationStep()], ctx, { sleep: async () => {}, now: ft.now, setInterval: ft.setInterval, clearInterval: ft.clearInterval });
  await flush();
  assert.ok(printed.includes("Opening the folder window. The first time this can take up to a minute."));
  ft.tick(10000);
  ft.tick(10000);
  const reminders = printed.filter((m) => m.startsWith("Still waiting for the folder window."));
  assert.deepEqual(reminders, [
    'Still waiting for the folder window. Look for a window called "Browse For Folder" in your taskbar, or press Alt+Tab. (10s)',
    'Still waiting for the folder window. Look for a window called "Browse For Folder" in your taskbar, or press Alt+Tab. (20s)',
  ]);
  assert.ok(!printed.some((m) => m.startsWith("Still working on")), "no generic heartbeat for this step");
  d.resolve({ ok: true, stdout: "C:\\Users\\a\\Dropbox\r\n" });
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(ft.active(), 0);
  ft.tick(60000);
  assert.equal(printed.filter((m) => m.startsWith("Still waiting")).length, 2);
});
test("vault location: timer is cleared when the picker throws", async () => {
  const ft = fakeTime();
  const ctx = mk({ print: () => {}, setInterval: ft.setInterval, clearInterval: ft.clearInterval, run: async () => { throw new Error("spawn failed"); } });
  const r = await runSteps([vaultLocationStep()], ctx, { sleep: async () => {} });
  assert.equal(r.ok, false);
  assert.equal(ft.active(), 0);
});
test("picker script: ASCII, shows the owner form and activates it before the dialog, disposes on every path", () => {
  assert.ok(/^[\x00-\x7f]*$/.test(PICKER_PS1));
  assert.match(PICKER_PS1, /Add-Type -AssemblyName System\.Drawing/);
  assert.match(PICKER_PS1, /Opacity = 0/);
  assert.match(PICKER_PS1, /\$f\.Show\(\)/);
  assert.match(PICKER_PS1, /\$f\.Activate\(\)/);
  assert.match(PICKER_PS1, /TopMost = \$true/);
  assert.ok(PICKER_PS1.indexOf("$f.Show()") < PICKER_PS1.indexOf("ShowDialog($f)"));
  assert.match(PICKER_PS1, /try \{/);
  assert.match(PICKER_PS1, /finally \{[^}]*\$f\.Dispose\(\)/);
});

// ---- reuse saved vault ----
function reuseCtx({ platform = "win32", state, files, extra = {} } = {}) {
  const printed = [];
  const home = platform === "win32" ? "C:\\Users\\a" : "/Users/a";
  const stateFile = join(home, ".shopos", "install-state.json");
  const present = new Set(files ?? []);
  const ctx = createContext({
    platform, homeDir: home, shoposHome: join(home, ".shopos"), env: {}, print: (m) => printed.push(m), snapshot: async () => okSnap,
    exists: (p) => present.has(p),
    readText: (p) => { if (p !== stateFile) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); if (state === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return state; },
    run: async () => { throw new Error("picker must not run"); },
    prompt: async () => { throw new Error("prompt must not run"); },
    ...extra,
  });
  return { ctx, printed };
}
for (const platform of ["win32", "darwin"]) {
  const vp = platform === "win32" ? "D:\\Dropbox\\Blueprint OS" : "/Users/a/Dropbox/Blueprint OS";
  test(`reuse (${platform}): saved vault with CLAUDE.md skips picker and name prompt`, async () => {
    const { ctx, printed } = reuseCtx({ platform, state: JSON.stringify({ vaultPath: vp }), files: [vp, join(vp, "CLAUDE.md")] });
    const r = await runSteps([vaultLocationStep()], ctx, { sleep: async () => {} });
    assert.equal(r.ok, true);
    assert.equal(r.timeline[0].status, "skipped");
    assert.equal(ctx.vaultPath, vp);
    assert.ok(printed.includes(`Using your existing Blueprint OS folder: ${vp}`));
  });
}
const vp = "/Users/a/Dropbox/Blueprint OS";
const askAgain = async (opts, label) => {
  let picked = false;
  const { ctx } = reuseCtx({ platform: "darwin", ...opts, extra: { run: async () => { picked = true; return { ok: true, stdout: "/Users/a/Other\n" }; }, prompt: async (q, d) => d, ...(opts.extra ?? {}) } });
  const r = await runSteps([vaultLocationStep()], ctx, { sleep: async () => {} });
  assert.equal(r.ok, true, label);
  assert.equal(picked, true, label);
  assert.equal(ctx.vaultPath, join("/Users/a/Other", "Blueprint OS"), label);
};
test("reuse: missing state file asks normally", () => askAgain({ state: undefined, files: [] }, "missing"));
test("reuse: corrupt JSON asks normally", () => askAgain({ state: "{not json", files: [] }, "corrupt"));
test("reuse: non-string vaultPath asks normally", () => askAgain({ state: JSON.stringify({ vaultPath: 5 }), files: [] }, "type"));
test("reuse: saved folder gone asks normally", () => askAgain({ state: JSON.stringify({ vaultPath: vp }), files: [] }, "gone"));
test("reuse: saved folder without CLAUDE.md asks normally", () => askAgain({ state: JSON.stringify({ vaultPath: vp }), files: [vp] }, "no claude.md"));
test("reuse: SHOPOS_CHOOSE_FOLDER=1 asks again", () => askAgain({ state: JSON.stringify({ vaultPath: vp }), files: [vp, join(vp, "CLAUDE.md")], extra: { env: { SHOPOS_CHOOSE_FOLDER: "1" } } }, "env"));
test("reuse: flags.chooseFolder asks again", () => askAgain({ state: JSON.stringify({ vaultPath: vp }), files: [vp, join(vp, "CLAUDE.md")], extra: { flags: { chooseFolder: true } } }, "flag"));
test("reuse: a preset vault wins over the saved one", async () => {
  const { ctx, printed } = reuseCtx({ platform: "darwin", state: JSON.stringify({ vaultPath: vp }), files: [vp, join(vp, "CLAUDE.md")], extra: { vaultPath: "/preset/Vault" } });
  const r = await runSteps([vaultLocationStep()], ctx, { sleep: async () => {} });
  assert.equal(r.ok, true);
  assert.equal(ctx.vaultPath, "/preset/Vault");
  assert.ok(!printed.some((m) => m.startsWith("Using your existing")));
});
test("parseArgs: --choose-folder flag and SHOPOS_CHOOSE_FOLDER=1", () => {
  assert.equal(parseArgs([], {}).chooseFolder, false);
  assert.equal(parseArgs(["--choose-folder"], {}).chooseFolder, true);
  assert.equal(parseArgs([], { SHOPOS_CHOOSE_FOLDER: "1" }).chooseFolder, true);
});
