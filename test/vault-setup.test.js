// test/vault-setup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  createVaultClaudeMd, createRawInbox, buildPermissionAllowList,
  enableForVault, enableForUser, saveLicenseFile, installMarketplaces,
  normalizeLicenseKey, looksLikeLicenseKey, validateLicense,
} from "../installer/vault-setup.js";

function tarGzWithManifest(pluginName) {
  function header(name, size) {
    const buf = Buffer.alloc(512);
    buf.write(name, 0, "utf8");
    buf.write("0000644\0", 100, "utf8"); buf.write("0000000\0", 108, "utf8"); buf.write("0000000\0", 116, "utf8");
    buf.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8");
    buf.write("00000000000\0", 136, "utf8"); buf.write("        ", 148, "utf8"); buf.write("0", 156, "utf8");
    buf.write("ustar\0", 257, "utf8"); buf.write("00", 263, "utf8");
    let sum = 0; for (const b of buf) sum += b;
    buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
    return buf;
  }
  const data = Buffer.from(JSON.stringify({ plugins: [{ name: pluginName }] }), "utf8");
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([header("repo-main/.claude-plugin/marketplace.json", data.length), data, pad, Buffer.alloc(1024)]));
}

test("createVaultClaudeMd writes once, never overwrites an existing vault", () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const license = { customer: "Acme", product: "foundation" };
  assert.equal(createVaultClaudeMd(vault, license), true);
  assert.match(readFileSync(join(vault, "CLAUDE.md"), "utf8"), /Acme/);
  writeFileSync(join(vault, "CLAUDE.md"), "custom content");
  assert.equal(createVaultClaudeMd(vault, license), false);
  assert.equal(readFileSync(join(vault, "CLAUDE.md"), "utf8"), "custom content");
});

test("createRawInbox creates Raw/ and Raw/processed/ once", () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const first = createRawInbox(vault);
  assert.equal(first.created, true);
  assert.ok(existsSync(join(vault, "Raw", "processed")));
  const second = createRawInbox(vault);
  assert.equal(second.created, false);
});

test("buildPermissionAllowList includes the vault-scoped write pattern", () => {
  const list = buildPermissionAllowList("/any/vault");
  assert.ok(list.includes("Write(/**)"));
  assert.ok(list.includes("Read"));
});

test("enableForVault merges plugin ids into .claude/settings.json without clobbering existing keys", () => {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(vault, ".claude"), { recursive: true });
  writeFileSync(join(vault, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "other@mp": true } }));
  const { path, warning } = enableForVault(vault, ["obsidian@blueprint-skills"]);
  assert.equal(warning, null);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(settings.enabledPlugins["other@mp"], true);
  assert.equal(settings.enabledPlugins["obsidian@blueprint-skills"], true);
});

test("a malformed settings.json is backed up to .bak and reported, not silently destroyed", () => {
  // A real ~/.claude/settings.json carries hooks, permissions and MCP config.
  // readJSON's swallow-and-return-{} behaviour meant a trailing comma (or a
  // file caught mid-write) got rewritten with nothing but enabledPlugins.
  const claudeRoot = mkdtempSync(join(tmpdir(), "claude-"));
  const malformed = '{\n  "hooks": { "Stop": [] },\n  "permissions": { "allow": ["Read"] },\n}';
  writeFileSync(join(claudeRoot, "settings.json"), malformed, "utf8");

  const { path, warning } = enableForUser(claudeRoot, ["obsidian@blueprint-skills"]);
  assert.ok(warning, "an unparseable settings.json must be reported, not silently succeed");
  assert.match(warning, /not valid JSON/);
  assert.equal(readFileSync(`${path}.bak`, "utf8"), malformed, "the original bytes must survive in the .bak");
  const rewritten = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(rewritten.enabledPlugins["obsidian@blueprint-skills"], true);
});

test("a missing settings.json is NOT treated as a parse failure (no spurious .bak)", () => {
  const claudeRoot = mkdtempSync(join(tmpdir(), "claude-"));
  const { path, warning } = enableForUser(claudeRoot, ["obsidian@blueprint-skills"]);
  assert.equal(warning, null);
  assert.equal(existsSync(`${path}.bak`), false);
});

test("saveLicenseFile writes a chmod-600 record under the given home", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const path = saveLicenseFile({ key: "SHOP-AAAA-BBBB-CCCC", customer: "Acme", product: "foundation", entitlements: ["foundation"] }, home);
  const record = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(record.customer, "Acme");
});

test("installMarketplaces fetches both marketplaces via tarball, no git", async () => {
  const claudeRoot = mkdtempSync(join(tmpdir(), "claude-"));
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => tarGzWithManifest("obsidian") });
  const result = await installMarketplaces({ claudeRoot, fetchImpl });
  assert.equal(result.failed.length, 0);
  assert.equal(result.added.length, 2);
  const known = JSON.parse(readFileSync(join(claudeRoot, "plugins", "known_marketplaces.json"), "utf8"));
  assert.ok(known["blueprint-skills"]);
  assert.ok(known["claude-plugins-official"]);
  // "github" is the source TYPE Claude Code understands (github|directory|path);
  // "tarball" is only how this installer happened to fetch the bytes.
  assert.equal(known["blueprint-skills"].source.source, "github");
  assert.equal(known["blueprint-skills"].source.repo, "blueprintit-ai/blueprint-skills");
  assert.equal(known["claude-plugins-official"].source.source, "github");
});

test("installMarketplaces does not create an empty known_marketplaces.json when every fetch fails", async () => {
  const claudeRoot = mkdtempSync(join(tmpdir(), "claude-"));
  const fetchImpl = async () => { throw new Error("offline"); };
  const result = await installMarketplaces({ claudeRoot, fetchImpl });
  assert.equal(result.added.length, 0);
  assert.equal(result.failed.length, 2);
  assert.equal(existsSync(join(claudeRoot, "plugins", "known_marketplaces.json")), false);
});

test("normalizeLicenseKey uppercases, trims, and strips internal whitespace", () => {
  assert.equal(normalizeLicenseKey("  shop-aaaa-bbbb-cccc  "), "SHOP-AAAA-BBBB-CCCC");
  assert.equal(normalizeLicenseKey("SHOP-AAAA BBBB-CCCC"), "SHOP-AAAABBBB-CCCC");
});

test("looksLikeLicenseKey matches the SHOP-XXXX-XXXX-XXXX shape only", () => {
  assert.equal(looksLikeLicenseKey("SHOP-AAAA-BBBB-CCCC"), true);
  assert.equal(looksLikeLicenseKey("not-a-key"), false);
});

test("validateLicense returns the license body on a 200, and ok:false with the server's message otherwise", async () => {
  const okFetch = async () => ({ ok: true, text: async () => JSON.stringify({ customer: "Acme", product: "foundation", entitlements: ["foundation"] }) });
  const okResult = await validateLicense("SHOP-AAAA-BBBB-CCCC", { fetchImpl: okFetch });
  assert.equal(okResult.ok, true);
  assert.equal(okResult.license.customer, "Acme");

  const rejectFetch = async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: "License expired" }) });
  const rejected = await validateLicense("SHOP-AAAA-BBBB-CCCC", { fetchImpl: rejectFetch });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "License expired");
});
