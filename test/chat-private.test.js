import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildQueryOptions } from "../src/chat/options.js";
import { buildStaffPrompt } from "../src/chat/system-prompt.js";
import { makeVault, writeConfig, link, STAFF, OWNER, OWNER_LIST } from "./helpers/private-vault.js";

function setup(config) {
  const made = makeVault({ config });
  const audit = { events: [], log(e, f) { this.events.push({ e, ...f }); } };
  const o = buildQueryOptions({ vaultPath: made.vault, user: STAFF, systemPrompt: "x", claudeSessionId: null, audit });
  const hook = o.hooks.PreToolUse[0].hooks[0];
  const viaHook = (tool, input) => hook({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });
  const viaCan = (tool, input) => o.canUseTool(tool, input, {});
  return { ...made, o, audit, viaHook, viaCan };
}
const denied = async (c, tool, input) => {
  const h = await c.viaHook(tool, input);
  const d = await c.viaCan(tool, input);
  return h.decision === "block" && d.behavior === "deny";
};

test("Read: every private path is denied by both the hook and canUseTool, with reason 'private' in the audit", async () => {
  const c = setup(OWNER_LIST);
  try {
    link(join(c.vault, "Resources", "Private", "hr.md"), join(c.vault, "Resources", "innocent.md"));
    link(join(c.vault, "Resources", "Private"), join(c.vault, "Projects", "docs"));
    const v = c.vault;
    const paths = [
      join(v, "Resources/Private/hr.md"), join(v, "Resources/PRIVATE/hr.md"), join(v, "Resources/Private /hr.md"), join(v, "Resources/Private./hr.md"),
      join(v, "Resources\\Private\\hr.md"), join(v, "Resources/../Private/Salaries.md"), join(v, "Projects/Deep/er/Private/x/y.md"),
      join(v, "Private/Salaries.md"), join(v, "Raw/Private/inbox.txt"), join(v, "Resources/Private/_processed/orig.txt"),
      join(v, "Resources/fm-true.md"), join(v, "Resources/fm-yes.md"), join(v, "Resources/fm-quoted.md"),
      join(v, "Resources/innocent.md"), join(v, "Projects/docs/hr.md"),
      join(v, "Resources/salary-2025.md"), join(v, "Resources/bank-statement.txt"), join(v, "Resources/Payroll Notes/q1.md"), join(v, "Resources/Finance/Owner Draw/draw.md"),
      "Resources/Private/hr.md", "./Resources/../Resources/Private/hr.md", "Projects/../Private/Salaries.md",
    ];
    for (const p of paths) {
      assert.ok(await denied(c, "Read", { file_path: p }), p);
      assert.ok(await denied(c, "Read", { path: p }), "alternate field " + p);
    }
    assert.ok(c.audit.events.some((e) => e.e === "chat.denied" && e.reason === "private"));
    assert.ok(c.audit.events.some((e) => e.e === "chat.denied" && e.reason === "private" && e.via === "hook"));
    const out = await c.viaCan("Read", { file_path: join(v, "Context/operator.md") });
    assert.equal(out.behavior, "deny");
    // ordinary reads still work
    assert.equal((await c.viaCan("Read", { file_path: join(v, "Resources/ok.md") })).behavior, "allow");
    assert.deepEqual(await c.viaHook("Read", { file_path: "Resources/ok.md" }), {});
    assert.ok(c.audit.events.some((e) => e.reason === "out-of-scope"), "plain out-of-scope keeps its own reason");
  } finally { c.cleanup(); }
});

test("the private denial message names nothing and does not confirm the file exists", async () => {
  const c = setup();
  try {
    const d = await c.viaCan("Read", { file_path: join(c.vault, "Resources/Private/hr.md") });
    assert.ok(!/hr\.md|Private|Salary/i.test(d.message), d.message);
    const e = await c.viaCan("Read", { file_path: join(c.vault, "Resources/Private/zzz-nope.md") });
    assert.equal(d.message, e.message);
  } finally { c.cleanup(); }
});

test("the SDK built-ins that search below a folder are not available, whatever path they get", async () => {
  const c = setup();
  try {
    for (const t of ["Grep", "Glob", "Bash", "Write", "Edit", "WebFetch", "Task", "NotebookRead", "ToolSearch", "mcp__other__search"]) {
      assert.ok(await denied(c, t, { path: join(c.vault, "Resources"), pattern: "secret", command: "grep -r secret ." }), t);
    }
    assert.deepEqual([...c.o.tools], ["Read"]);
  } finally { c.cleanup(); }
});

test("vault tools through the hook and canUseTool: allowed folders pass, private and out-of-scope folders do not", async () => {
  const c = setup(OWNER_LIST);
  try {
    for (const t of ["mcp__vault__search", "mcp__vault__list"]) {
      assert.deepEqual(await c.viaHook(t, { query: "x", folder: "Resources" }), {});
      assert.equal((await c.viaCan(t, { query: "x" })).behavior, "allow");
      for (const folder of ["Resources/Private", "resources/private", "Resources\\Private\\_processed", "Private", "Context", "Resources/../Private", "Resources/Payroll Notes", "Resources/Finance/Owner Draw", "/etc", "../"]) {
        assert.ok(await denied(c, t, { query: "x", folder }), `${t} ${folder}`);
      }
    }
  } finally { c.cleanup(); }
});

test("the vault tool handlers behind the real MCP server never return private text", async () => {
  const c = setup(OWNER_LIST);
  try {
    const srv = c.o.mcpServers.vault;
    const tools = srv.instance._registeredTools ?? {};
    const names = Object.keys(tools).sort();
    assert.deepEqual(names, ["list", "search"]);
    for (const secret of ["secret-hr-token", "secret-fm-token", "secret-root-private-token", "secret-pattern-token", "secret-bank-token", "secret-margin-token"]) {
      const r = await (tools.search.handler ?? tools.search.callback)({ query: secret }, {});
      assert.ok(!JSON.stringify(r).includes(secret), secret);
    }
    const r = await (tools.search.handler ?? tools.search.callback)({ query: "visible-ok-token" }, {});
    assert.match(JSON.stringify(r), /Resources\/ok\.md/);
  } finally { c.cleanup(); }
});

test("a deny-list change reaches the chat tools without rebuilding the options (no restart)", async () => {
  const c = setup({ paths: [], patterns: [] });
  try {
    assert.equal((await c.viaCan("Read", { file_path: join(c.vault, "Resources/ok.md") })).behavior, "allow");
    writeConfig(c.vault, { paths: ["Resources/ok.md"], patterns: [] });
    assert.equal((await c.viaCan("Read", { file_path: join(c.vault, "Resources/ok.md") })).behavior, "deny");
    assert.equal((await c.viaHook("Read", { file_path: join(c.vault, "Resources/ok.md") })).decision, "block");
  } finally { c.cleanup(); }
});

test("owner chat is unchanged: full tool set, everything allowed, nothing denied for Private", async () => {
  const made = makeVault({ config: OWNER_LIST });
  try {
    const audit = { events: [], log(e, f) { this.events.push({ e, ...f }); } };
    const o = buildQueryOptions({ vaultPath: made.vault, user: OWNER, systemPrompt: "x", claudeSessionId: null, audit });
    assert.equal(o.tools, undefined);
    assert.equal(o.mcpServers, undefined);
    assert.equal(o.hooks, undefined);
    assert.equal((await o.canUseTool("Read", { file_path: join(made.vault, "Resources/Private/hr.md") }, {})).behavior, "allow");
    assert.equal((await o.canUseTool("Grep", { pattern: "x" }, {})).behavior, "allow");
    assert.ok(!audit.events.some((e) => e.e === "chat.denied"));
  } finally { made.cleanup(); }
});

test("the staff prompt describes the tools truthfully and tells the model not to hunt for unavailable files", () => {
  const { vault, cleanup } = makeVault();
  try {
    const p = buildStaffPrompt({ vaultPath: vault, name: "Marco", folders: ["Projects", "Resources"] });
    assert.match(p, /search/); assert.match(p, /list/); assert.match(p, /Read/);
    assert.match(p, /not available to you/i);
    assert.match(p, /do not try to find, guess/i);
    assert.doesNotMatch(p, /Grep|Glob/);
    assert.doesNotMatch(p, /Private/, "the prompt does not even name the Private convention");
  } finally { cleanup(); }
});

test("Read of a directory, a missing file, a private file and an out-of-folder file all get the identical neutral message", async () => {
  const c = setup(OWNER_LIST);
  try {
    const v = c.vault;
    const msgs = new Set();
    for (const file_path of [join(v, "Resources"), "Resources", join(v, "Resources/nope.md"), join(v, "Resources/Private/hr.md"), join(v, "Resources/fm-true.md"), join(v, "Resources/salary-2025.md"), join(v, "Context/operator.md"), join(v, "Resources/Private/nope.md")]) {
      const d = await c.viaCan("Read", { file_path });
      assert.equal(d.behavior, "deny", file_path);
      assert.ok(!d.message.includes(v), "no absolute path");
      msgs.add(d.message);
      const h = await c.viaHook("Read", { file_path });
      assert.equal(h.reason, d.message);
    }
    assert.equal(msgs.size, 1, [...msgs].join(" | "));
  } finally { c.cleanup(); }
});

test("staff options switch off skills and bundled skills", () => {
  const c = setup();
  try {
    assert.deepEqual(c.o.skills, []);
    assert.ok(["Skill", "SlashCommand", "Grep", "Glob", "Bash"].every((t) => c.o.disallowedTools.includes(t)));
    assert.equal(c.o.settings.disableBundledSkills, true);
  } finally { c.cleanup(); }
});
