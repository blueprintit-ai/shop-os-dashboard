import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UserStore } from "../src/users.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "shop-os-dashboard.js");
const FIX = join(HERE, "fixtures", "vault");

test("--reset-owner sets a new password for the single owner and exits 0", async () => {
  const root = mkdtempSync(join(tmpdir(), "sod-cli-"));
  const vault = join(root, "vault"); cpSync(FIX, vault, { recursive: true });
  const home = join(root, "home");
  const users = new UserStore(join(home, "users.json"));
  const owner = await users.create({ username: "glenn", displayName: "Glenn", password: "oldpassword1", role: "owner" });
  const r = spawnSync(process.execPath, [BIN, vault, "--home", home, "--reset-owner", "--new-password", "newpassword22"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Password updated for glenn/);
  const fresh = new UserStore(join(home, "users.json"));
  const { verifyPassword } = await import("../src/users.js");
  assert.equal(await verifyPassword("newpassword22", fresh.getWithHash(owner.id).passwordHash), true);
  rmSync(root, { recursive: true, force: true });
});

test("missing vault path exits 1 with a clear message", () => {
  const r = spawnSync(process.execPath, [BIN, "/no/such/vault", "--no-browser"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Vault folder not found/);
});
