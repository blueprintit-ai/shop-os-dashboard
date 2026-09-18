import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Audit, readAll } from "../src/audit.js";

test("Audit appends JSON lines with timestamp and reads them back", () => {
  const dir = mkdtempSync(join(tmpdir(), "sod-audit-"));
  const p = join(dir, "activity.jsonl");
  const a = new Audit(p);
  a.log("login", { userId: "u1", username: "glenn" });
  a.log("note.view", { userId: "u1", path: "Projects/Acme.md" });
  const rows = readAll(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, "login");
  assert.equal(typeof rows[0].ts, "string");
  assert.equal(rows[1].path, "Projects/Acme.md");
  rmSync(dir, { recursive: true, force: true });
});
