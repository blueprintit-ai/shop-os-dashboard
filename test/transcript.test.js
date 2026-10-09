import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTranscript, writeTranscript, transcriptFilename } from "../src/chat/transcript.js";

const sampleSession = {
  id: "uuid-1",
  name: "Marco",
  startedAt: new Date("2026-05-25T14:32:00").getTime(),
  lastActivityAt: new Date("2026-05-25T14:51:00").getTime(),
  turns: [
    { role: "user", content: "What was the Smith quote total?" },
    { role: "assistant", content: "The [[Smith Quote]] totalled $4,200." },
    { role: "user", content: "When is it due?" },
    { role: "assistant", content: "[[Smith Quote]] is due 2026-06-01." },
  ],
};

test("transcriptFilename uses timezone-aware local time and lowercased name slug", () => {
  const name = transcriptFilename(sampleSession);
  // Format: YYYY-MM-DD-HHmm-<slug>.md
  assert.match(name, /^\d{4}-\d{2}-\d{2}-\d{4}-marco\.md$/);
});

test("transcriptFilename slugifies names with spaces and special chars", () => {
  const s = { ...sampleSession, name: "María José" };
  const name = transcriptFilename(s);
  assert.match(name, /maria-jose\.md$/);
});

test("buildTranscript produces frontmatter with required fields", () => {
  const md = buildTranscript(sampleSession);
  assert.match(md, /^---\n/);
  assert.match(md, /type: chat-transcript/);
  assert.match(md, /project: shop-os-chat/);
  assert.match(md, /user: marco/);
  assert.match(md, /turn-count: 4/);
});

test("buildTranscript alternates ## User and ## Assistant sections", () => {
  const md = buildTranscript(sampleSession);
  const userCount = (md.match(/^## User$/gm) || []).length;
  const asstCount = (md.match(/^## Assistant$/gm) || []).length;
  assert.equal(userCount, 2);
  assert.equal(asstCount, 2);
});

test("buildTranscript preserves wikilinks verbatim", () => {
  const md = buildTranscript(sampleSession);
  assert.match(md, /\[\[Smith Quote\]\]/);
});

test("writeTranscript writes to <vault>/Chats/<filename> and creates folder", () => {
  const vault = mkdtempSync(join(tmpdir(), "shopos-vault-"));
  try {
    const path = writeTranscript(vault, sampleSession);
    assert.ok(existsSync(path), "file should exist");
    const content = readFileSync(path, "utf8");
    assert.match(content, /turn-count: 4/);
    assert.ok(existsSync(join(vault, "Chats", "CLAUDE.md")), "Chats/CLAUDE.md should be created");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("owner transcripts are marked private; staff transcripts are not; staff never read Chats/ either way", async () => {
  const { buildTranscript } = await import("../src/chat/transcript.js");
  const { makeVault, STAFF } = await import("./helpers/private-vault.js");
  const { isPathAllowed } = await import("../src/scope.js");
  const s = { name: "pat", startedAt: Date.now(), lastActivityAt: Date.now(), turns: [{ role: "user", content: "hi" }] };
  assert.match(buildTranscript({ ...s, role: "owner" }), /^---\n[\s\S]*\nprivate: true\n---/);
  assert.doesNotMatch(buildTranscript({ ...s, role: "staff" }), /private: true/);
  const { vault, cleanup } = makeVault();
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(join(vault, "Chats"), { recursive: true });
    writeFileSync(join(vault, "Chats", "a.md"), buildTranscript({ ...s, role: "staff" }));
    const granted = { ...STAFF, switches: { folders: ["Chats"], teamFolder: null } };
    assert.equal(isPathAllowed(vault, granted, join(vault, "Chats", "a.md")), false);
  } finally { cleanup(); }
});
