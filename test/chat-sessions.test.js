import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../src/chat/sessions.js";

test("SessionStore.create returns a fresh session with an id", () => {
  const store = new SessionStore();
  const session = store.create({ name: "Marco" });
  assert.equal(typeof session.id, "string");
  assert.ok(session.id.length > 0);
  assert.equal(session.name, "Marco");
  assert.equal(typeof session.startedAt, "number");
  assert.equal(typeof session.lastActivityAt, "number");
  assert.equal(session.claudeSessionId, null);
  assert.deepEqual(session.turns, []);
});

test("SessionStore.get returns a stored session", () => {
  const store = new SessionStore();
  const created = store.create({ name: "Marco" });
  const got = store.get(created.id);
  assert.equal(got.id, created.id);
});

test("SessionStore.get returns null for unknown id", () => {
  const store = new SessionStore();
  assert.equal(store.get("nope"), null);
});

test("SessionStore.touch updates lastActivityAt", async () => {
  const store = new SessionStore();
  const s = store.create({ name: "Marco" });
  const before = s.lastActivityAt;
  await new Promise(r => setTimeout(r, 10));
  store.touch(s.id);
  assert.ok(store.get(s.id).lastActivityAt > before);
});

test("SessionStore.recordTurn appends to turns array", () => {
  const store = new SessionStore();
  const s = store.create({ name: "Marco" });
  store.recordTurn(s.id, { role: "user", content: "hi" });
  store.recordTurn(s.id, { role: "assistant", content: "hello" });
  const t = store.get(s.id).turns;
  assert.equal(t.length, 2);
  assert.equal(t[0].role, "user");
  assert.equal(t[1].role, "assistant");
});

test("SessionStore.end removes a session and returns it", () => {
  const store = new SessionStore();
  const s = store.create({ name: "Marco" });
  const ended = store.end(s.id);
  assert.equal(ended.id, s.id);
  assert.equal(store.get(s.id), null);
});

test("SessionStore.gc removes sessions older than maxAgeMs", () => {
  const store = new SessionStore();
  const s = store.create({ name: "Marco" });
  store.get(s.id).lastActivityAt = Date.now() - 1000 * 60 * 60 * 2; // 2h ago
  const removed = store.gc(1000 * 60 * 60); // 1h max age
  assert.equal(removed, 1);
  assert.equal(store.get(s.id), null);
});
