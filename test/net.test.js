import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { findFreePort, lanAddresses } from "../src/lib/net.js";

test("findFreePort skips a busy port", async () => {
  const busy = createServer(); await new Promise((r) => busy.listen(0, "0.0.0.0", r));
  const taken = busy.address().port;
  const p = await findFreePort(taken, taken + 2);
  assert.notEqual(p, taken);
  assert.ok(p > taken && p <= taken + 2);
  busy.close();
});

test("findFreePort throws when the range is exhausted", async () => {
  const busy = createServer(); await new Promise((r) => busy.listen(0, "0.0.0.0", r));
  const taken = busy.address().port;
  await assert.rejects(findFreePort(taken, taken), /No free port/);
  busy.close();
});

test("lanAddresses returns dotted IPv4 strings only", () => {
  for (const a of lanAddresses()) assert.match(a, /^\d+\.\d+\.\d+\.\d+$/);
});
