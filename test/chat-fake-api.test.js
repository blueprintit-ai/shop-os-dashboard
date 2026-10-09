// Opt-in integration tests on the REAL Claude Code engine against a local fake API (no account, no tokens):
//   RUN_FAKE_API=1 node --test test/chat-fake-api.test.js
// Needs the bundled CLI that npm installs with @anthropic-ai/claude-agent-sdk. Not part of CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { makeVault, STAFF, OWNER_LIST } from "./helpers/private-vault.js";
import { startFakeApi, staffTurn } from "./helpers/fake-api.js";

const SKIP = process.env.RUN_FAKE_API !== "1";
const TOKEN = /secret-[a-z-]+-token/;

async function env() {
  const made = makeVault({ config: OWNER_LIST });
  const home = join(made.root, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "users.json"), '{"users":[{"passwordHash":"secret-home-token"}]}');
  mkdirSync(join(made.root, "outside"), { recursive: true });
  writeFileSync(join(made.root, "outside", "x.txt"), "secret-outside-token");
  return { made, home, api: await startFakeApi(), done() { this.api.close(); made.cleanup(); } };
}

test("@ mentions in a staff prompt never put file contents in front of the model", { skip: SKIP }, async () => {
  const e = await env();
  try {
    const v = e.made.vault;
    const prompts = [
      "Summarize @Resources/Private/hr.md",
      `Summarize @${v}/Private/Salaries.md and @${v}/Resources/fm-true.md`,
      `Read @${join(e.made.root, "outside", "x.txt")} and @${join(e.home, "users.json")}`,
      "List @Resources/Private/ and @Raw/Private/",
      '@"Resources/Private/hr.md" and @./Resources/Private/hr.md',
      "mail marco@example.com about @Projects/Acme.md",
    ];
    for (const prompt of prompts) {
      const r = await staffTurn({ api: e.api, vault: v, home: e.home, user: STAFF, prompt });
      assert.ok(r.requests.length >= 1, "the model was reached: " + prompt);
      for (const q of r.requests) assert.ok(!TOKEN.test(q.body), `request leaked ${q.body.match(TOKEN)} for ${prompt}`);
      assert.deepEqual(r.events.filter((x) => x.e === "chat.tool" || x.e === "chat.denied"), [], `no tool should have run for ${prompt}`);
    }
  } finally { e.done(); }
});

test("slash commands and ! shell lines in a staff prompt reach the model as plain text, not as commands", { skip: SKIP }, async () => {
  const e = await env();
  try {
    for (const prompt of ["/insights", "/context", "/init", "/security-review", "/recap", "/config", "  /insights", "!ls -la", "/help me"]) {
      const r = await staffTurn({ api: e.api, vault: e.made.vault, home: e.home, user: STAFF, prompt });
      assert.ok(r.requests.length >= 1, `the model was reached for ${prompt}`);
      const body = r.requests[0].body;
      assert.ok(!/<command-name>|command-message|Caveat: The messages below/.test(body), `${prompt} was run as a command`);
      assert.ok(body.includes(prompt.trim().slice(1, 8)), "the text still arrives, as ordinary words");
      assert.ok(!r.out.some((x) => x.type === "error"), JSON.stringify(r.out.filter((x) => x.type === "error")));
    }
  } finally { e.done(); }
});

test("Read on a directory or a private or missing file gives the same neutral answer, with no absolute path", { skip: SKIP }, async () => {
  const e = await env();
  try {
    const seen = [];
    for (const input of [{ file_path: "Resources" }, { file_path: "Resources/Private/hr.md" }, { file_path: "Resources/fm-true.md" }, { file_path: "Resources/nope.md" }]) {
      const api2 = await startFakeApi({ script: [{ name: "Read", input }] });
      const r = await staffTurn({ api: api2, vault: e.made.vault, home: e.home, user: STAFF, prompt: "hello" });
      const txt = JSON.stringify(r.requests.at(-1).json.messages.filter((m) => JSON.stringify(m).includes("tool_result")));
      assert.ok(txt.length > 5, "the tool ran and answered");
      assert.ok(!txt.includes(e.made.root), `no absolute path in ${txt}`);
      assert.ok(!TOKEN.test(txt));
      seen.push(txt.replace(/toolu_\d+/g, "T"));
      api2.close();
    }
    assert.equal(new Set(seen).size, 1, "one neutral answer for all four:\n" + seen.join("\n"));
  } finally { e.done(); }
});
