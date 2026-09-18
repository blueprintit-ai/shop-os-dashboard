import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { runSetup } from "../bin/shop-os-dashboard-setup.js";

function tarGzWithManifest() {
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
  const data = Buffer.from(JSON.stringify({ plugins: [{ name: "obsidian" }] }), "utf8");
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([header("repo-main/.claude-plugin/marketplace.json", data.length), data, pad, Buffer.alloc(1024)]));
}

test("runSetup scaffolds the vault and reports each step, tolerating a failed auto-start", async () => {
  // homeOverride stands in for the plain OS home (os.homedir()); homeDir and
  // claudeRoot are DELIBERATELY DISTINCT tmp dirs derived from it, exactly
  // mirroring production's real relationship (homeDir defaults to
  // join(homedir(), ".shopos"), claudeRoot to join(homedir(), ".claude") —
  // siblings under the OS home, not nested in each other). Reusing one tmp
  // dir for all three (as an earlier draft of this test did) makes every
  // isolation assertion below vacuous: a regression that passes the WRONG
  // path to saveLicenseFile or registerAutoStart would produce the exact
  // same on-disk result when homeDir === homeOverride, so the test could
  // never catch it. With them distinct, a regression produces a visibly
  // different (and asserted-against) path.
  const homeOverride = mkdtempSync(join(tmpdir(), "os-home-"));
  const homeDir = join(homeOverride, ".shopos");
  const claudeRoot = join(homeOverride, ".claude");
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-"));
  const desktopDir = mkdtempSync(join(tmpdir(), "desktop-"));
  const license = { key: "SHOP-AAAA-BBBB-CCCC", customer: "Acme", product: "foundation", entitlements: ["foundation"] };
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => tarGzWithManifest() });
  // Simulate: claude present, but schtasks/launchctl denied — setup must still report ok overall.
  const spawnSyncImpl = (cmd) => (/schtasks|launchctl|cscript/.test(cmd) ? { status: 1, stderr: "denied" } : { status: 0, stdout: "v22.0.0\n" });

  const result = await runSetup({ vaultPath, license, homeDir, isWindows: false, desktopDir, homeOverride, claudeRoot, fetchImpl, spawnSyncImpl });

  assert.equal(result.ok, true);
  assert.ok(existsSync(join(vaultPath, "CLAUDE.md")));
  assert.ok(existsSync(join(vaultPath, "Raw", "processed")));
  const autostartStep = result.steps.find((s) => s.name === "autostart");
  assert.equal(autostartStep.ok, false); // reported, not thrown (launchctl "denied" above)
  // registerAutoStart writes the plist to disk before calling launchctl, so
  // it's there even though the step's overall result is ok:false. A negative
  // check against the REAL ~/Library/LaunchAgents/... would be unreliable —
  // on any machine where Shop OS Dashboard has actually been installed, that
  // exact path legitimately exists — so assert the isolated one positively
  // instead, proving homeOverride was actually used.
  assert.ok(existsSync(join(homeOverride, "Library", "LaunchAgents", "ai.blueprintit.shop-os-dashboard.plist")),
    "LaunchAgents plist must land under the isolated homeOverride, not the real machine's home");
  // Same reasoning for marketplaces: a negative check against the real
  // ~/.claude/plugins/marketplaces/blueprint-skills is unreliable (it
  // legitimately exists on any machine with Claude Code + that marketplace
  // already installed — true for whoever develops this plan). Assert the
  // fake tarball content landed in the isolated claudeRoot instead.
  assert.ok(existsSync(join(claudeRoot, "plugins", "marketplaces", "blueprint-skills", ".claude-plugin", "marketplace.json")),
    "marketplace content must land in the isolated claudeRoot");
  // saveLicenseFile appends ".shopos" itself, so passing homeOverride (not
  // homeDir, which is already "~/.shopos"-shaped) must land the file at
  // exactly homeDir/license.json (== join(homeOverride, ".shopos",
  // "license.json")) — matching where the running server's readLicense()
  // actually looks. If runSetup regressed to passing homeDir instead, the
  // file would land one level deeper, at homeDir/.shopos/license.json, and
  // this assertion would fail.
  assert.ok(existsSync(join(homeDir, "license.json")),
    "license must be saved where readLicense() will actually find it, not double-nested");
});
