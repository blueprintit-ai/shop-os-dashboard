import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueryOptions, STAFF_TOOLS } from "../src/chat/options.js";

const VAULT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "vault");
const staff = { id: "s1", username: "marco", displayName: "Marco", role: "staff", switches: { folders: ["Projects"], teamFolder: null } };
const owner = { id: "o1", username: "glenn", displayName: "Glenn", role: "owner", switches: { folders: [], teamFolder: null } };
const audit = { events: [], log(e, f) { this.events.push({ e, ...f }); } };

test("staff options restrict tools, use default permission mode, no allowedTools", () => {
  const o = buildQueryOptions({ vaultPath: VAULT, user: staff, systemPrompt: "x", claudeSessionId: null, audit });
  assert.deepEqual([...o.tools].sort(), [...STAFF_TOOLS].sort());
  assert.equal(o.allowedTools, undefined);
  assert.equal(o.permissionMode, "default");
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.cwd, VAULT);
  assert.equal(o.maxTurns, 20);
  assert.equal(o.resume, undefined);
});

test("staff canUseTool allows in-scope reads and denies out-of-scope, non-whitelisted tools, and shell", async () => {
  const o = buildQueryOptions({ vaultPath: VAULT, user: staff, systemPrompt: "x", claudeSessionId: "abc", audit });
  assert.equal(o.resume, "abc");
  const ok = await o.canUseTool("Read", { file_path: join(VAULT, "Projects", "Acme Kitchen.md") }, { signal: new AbortController().signal });
  assert.equal(ok.behavior, "allow");
  const denied = await o.canUseTool("Read", { file_path: join(VAULT, "Context", "operator.md") }, {});
  assert.equal(denied.behavior, "deny");
  const glob = await o.canUseTool("Glob", { pattern: "**/*.md", path: join(VAULT, "Intelligence") }, {});
  assert.equal(glob.behavior, "deny");
  const globOk = await o.canUseTool("Glob", { pattern: "*.md" }, {});
  assert.equal(globOk.behavior, "allow", "Glob with no path defaults to cwd; scope is applied per-result by Read, so allow");
  const grep = await o.canUseTool("Grep", { pattern: "price", path: join(VAULT, "Projects") }, {});
  assert.equal(grep.behavior, "allow");
  assert.equal((await o.canUseTool("Grep", { pattern: "x" }, {})).behavior, "deny");
  const bash = await o.canUseTool("Bash", { command: "ls" }, {});
  assert.equal(bash.behavior, "deny");
  const rel = await o.canUseTool("Read", { file_path: "Projects/../Context/operator.md" }, {});
  assert.equal(rel.behavior, "deny");
  assert.ok(audit.events.some((x) => x.e === "chat.denied" && x.userId === "s1"));
});

test("owner options allow writes and skills", async () => {
  const o = buildQueryOptions({ vaultPath: VAULT, user: owner, systemPrompt: "x", claudeSessionId: null, audit });
  assert.equal(o.tools, undefined, "owner gets the full default tool set");
  assert.equal(o.permissionMode, "acceptEdits");
  assert.deepEqual(o.settingSources, ["user", "project"]);
  assert.equal(o.skills, "all");
  assert.equal(o.maxTurns, 60);
  const r = await o.canUseTool("Bash", { command: "ls" }, {});
  assert.equal(r.behavior, "allow");
  assert.ok(audit.events.some((x) => x.e === "chat.tool" && x.tool === "Bash" && x.userId === "o1"));
});
