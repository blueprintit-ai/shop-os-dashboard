import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApps, DEFAULT_APPS } from "../src/apps.js";

test("an old sbRow row pointing at /notes is read as /brain with the normal subtitle, without rewriting the file", () => {
  const v = mkdtempSync(join(tmpdir(), "apps-"));
  try {
    mkdirSync(join(v, "Dashboard"));
    const raw = JSON.stringify([{ id: "sbRow", name: "Second Brain", sub: "Have one? It auto-links. If not, learn to build it", url: "/notes", icon: "brain" }, { id: "crm", name: "CRM", url: "/notes", icon: "gen" }]);
    writeFileSync(join(v, "Dashboard", "apps.json"), raw);
    const apps = readApps(v);
    assert.equal(apps[0].url, "/brain");
    assert.equal(apps[0].sub, "Your whole workspace as a living map");
    assert.equal(apps[1].url, "/notes", "other rows are untouched");
    assert.equal(readFileSync(join(v, "Dashboard", "apps.json"), "utf8"), raw);
    assert.equal(DEFAULT_APPS[0].url, "/brain");
    writeFileSync(join(v, "Dashboard", "apps.json"), JSON.stringify([{ id: "sbRow", name: "Second Brain", sub: "mine", url: "http://localhost:5210", icon: "brain" }]));
    assert.equal(readApps(v)[0].url, "http://localhost:5210", "a deliberate custom url stays");
  } finally { rmSync(v, { recursive: true, force: true }); }
});
