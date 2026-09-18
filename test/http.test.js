import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCookies, serializeCookie, isLoopback } from "../src/lib/http.js";

test("parseCookies splits a cookie header", () => {
  const req = { headers: { cookie: "a=1; sod=abc%20def; b=x=y" } };
  assert.deepEqual(parseCookies(req), { a: "1", sod: "abc def", b: "x=y" });
});

test("parseCookies returns empty object with no header", () => {
  assert.deepEqual(parseCookies({ headers: {} }), {});
});

test("serializeCookie emits HttpOnly, SameSite, Path and Max-Age", () => {
  const c = serializeCookie("sod", "tok", { maxAge: 3600, httpOnly: true, sameSite: "Lax", path: "/" });
  assert.equal(c, "sod=tok; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax");
});

test("isLoopback recognizes IPv4 and IPv6 loopback only", () => {
  assert.equal(isLoopback({ socket: { remoteAddress: "127.0.0.1" } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: "::1" } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: "192.168.1.20" } }), false);
});
