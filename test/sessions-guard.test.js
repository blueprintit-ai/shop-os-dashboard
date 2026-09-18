import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionsGuard } from "../src/sessions-guard.js";

test("guard runs up to max concurrently and queues the rest in order", async () => {
  const g = new SessionsGuard({ max: 2 });
  const r1 = await g.acquire("a");
  const r2 = await g.acquire("b");
  assert.deepEqual(g.stats(), { running: 2, queued: 0 });
  let gotC = false;
  const pC = g.acquire("c").then((rel) => { gotC = true; return rel; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gotC, false);
  assert.equal(g.position("c"), 1);
  assert.equal(g.position("a"), 0);
  r1();
  const r3 = await pC;
  assert.equal(gotC, true);
  assert.deepEqual(g.stats(), { running: 2, queued: 0 });
  r2(); r3();
  assert.deepEqual(g.stats(), { running: 0, queued: 0 });
});

test("release is idempotent", async () => {
  const g = new SessionsGuard({ max: 1 });
  const r = await g.acquire("a");
  r(); r();
  assert.deepEqual(g.stats(), { running: 0, queued: 0 });
});
