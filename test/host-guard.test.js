import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { hostAllowed } from "../src/lib/http.js";
import { bootAsOwner } from "./helpers/boot.js";

const req = (host, localPort = 4747) => ({ headers: { host }, socket: { localPort } });

test("hostAllowed: loopback names, LAN addresses and this computer's name on the listening port only", () => {
  const opts = { lan: ["192.168.1.20"], hostnames: ["shop-pc", "shop-pc.local"] };
  for (const h of ["localhost:4747", "127.0.0.1:4747", "[::1]:4747", "192.168.1.20:4747", "SHOP-PC.local:4747", "shop-pc:4747"]) {
    assert.equal(hostAllowed(req(h), opts), true, h);
  }
  for (const h of ["evil.example:4747", "127.0.0.1.nip.io:4747", "localhost:80", "localhost", "192.168.1.99:4747", "", undefined]) {
    assert.equal(hostAllowed(req(h), opts), false, String(h));
  }
});

function getWithHost(port, host) {
  return new Promise((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path: "/api/ping", headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on("error", reject);
    r.end();
  });
}

test("server refuses requests that arrive under a foreign Host name (DNS rebinding)", async () => {
  const b = await bootAsOwner();
  try {
    const port = b.server.address().port;
    assert.equal(await getWithHost(port, `attacker.example:${port}`), 421);
    assert.notEqual(await getWithHost(port, `127.0.0.1:${port}`), 421);
  } finally {
    await b.cleanup();
  }
});

test("DELETE without a matching Origin is refused like POST", async () => {
  const b = await bootAsOwner();
  try {
    const res = await fetch(`${b.url}/api/users/x`, { method: "DELETE", headers: { origin: "http://evil.example" } });
    assert.equal(res.status, 403);
  } finally {
    await b.cleanup();
  }
});
