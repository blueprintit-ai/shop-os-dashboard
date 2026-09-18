#!/usr/bin/env node
import { resolve, join } from "node:path";
import { existsSync, statSync, readFileSync } from "node:fs";
import { exec } from "node:child_process";
import { platform } from "node:os";
import { createServer } from "../src/server.js";
import { checkForUpdate } from "../src/updater.js";
import { findFreePort, lanAddresses } from "../src/lib/net.js";
import { dashboardHome } from "../src/lib/paths.js";
import { UserStore } from "../src/users.js";
import { readLicense } from "../src/license.js";
import { Audit } from "../src/audit.js";
import { Auth } from "../src/auth.js";

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function die(msg) {
  console.error(c.red("! ") + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const a = { vault: null, port: null, noBrowser: false, home: null, resetOwner: false, newPassword: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--help" || x === "-h") a.help = true;
    else if (x === "--no-browser") a.noBrowser = true;
    else if (x === "--port") a.port = parseInt(argv[++i], 10);
    else if (x === "--home") a.home = argv[++i];
    else if (x === "--reset-owner") a.resetOwner = true;
    else if (x === "--new-password") a.newPassword = argv[++i];
    else if (!a.vault) a.vault = x;
  }
  return a;
}

function help() {
  console.log(`
Shop OS Dashboard

Usage:  shop-os-dashboard <vault-path> [options]

Options:
  --port <N>          Use a specific port (default: first free in 50000-50010)
  --no-browser        Do not open the browser
  --home <dir>        Data folder (default ~/.shopos/dashboard)
  --reset-owner       Reset the owner password (run on the shop computer), then exit
  --new-password <p>  Password for --reset-owner (prompted if omitted)
  --help, -h          Show this message
`);
}

async function promptText(question) {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

function openBrowser(url) {
  const cmd = platform() === "darwin" ? `open "${url}"` : platform() === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function resetOwner({ home, newPassword }) {
  const users = new UserStore(join(home, "users.json"));
  const owners = users.list().filter((u) => u.role === "owner");
  if (owners.length === 0) {
    die("No owner account exists yet. Open the dashboard on this computer to set one up.");
    return;
  }
  let target = owners[0];
  if (owners.length > 1) {
    console.log("Owners: " + owners.map((o) => o.username).join(", "));
    const name = await promptText("Which owner? ");
    const found = owners.find((o) => o.username.toLowerCase() === name.trim().toLowerCase());
    if (!found) {
      die("No such owner.");
      return;
    }
    target = found;
  }
  const pw = newPassword ?? (await promptText(`New password for ${target.username} (10+ chars): `));
  try {
    await users.setPassword(target.id, pw);
  } catch (e) {
    die(e.message);
    return;
  }
  const audit = new Audit(join(home, "activity.jsonl"));
  const auth = new Auth({ users, sessionsPath: join(home, "sessions.json"), audit });
  auth.revokeAllForUser(target.id);
  console.log(c.green("v ") + `Password updated for ${target.username}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    process.exit(0);
  }
  const home = args.home ? resolve(args.home) : dashboardHome();

  if (args.resetOwner) {
    await resetOwner({ home, newPassword: args.newPassword });
    process.exit(0);
  }

  if (!args.vault) die("Missing vault path. Run: shop-os-dashboard <vault-path>");
  const vaultPath = resolve(args.vault);
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    die(`Vault folder not found: ${vaultPath}`);
  }

  const license = readLicense();
  console.log(c.bold(c.cyan("Shop OS Dashboard")));
  console.log(c.dim(`  vault: ${vaultPath}`));
  console.log(c.dim(`  data:  ${home}`));
  console.log(c.dim(`  customer: ${license?.customer ?? "unknown (license check happens per request)"}`));

  let port = args.port;
  if (!port) {
    try {
      port = await findFreePort();
    } catch (e) {
      die(e.message);
      return;
    }
  }

  const updateInfo = { updateAvailable: false, latest: null };
  async function refreshUpdateInfo() {
    const result = await checkForUpdate({ currentVersion: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version });
    Object.assign(updateInfo, result);
  }
  refreshUpdateInfo();
  setInterval(refreshUpdateInfo, 24 * 60 * 60 * 1000).unref?.();

  const server = createServer({
    vaultPath, homeDir: home,
    port, // the resolved listening port (from parseArgs/findFreePort above) — so /api/status reports the real port, not the default null
    appDir: join(home, "app"),
    npmBin: process.env.SHOPOS_NPM_BIN || "npm",
    updateInfo, // same object refreshUpdateInfo mutates — see Task 7's server.js wiring
    restart: () => process.exit(0), // the registered auto-start task/agent relaunches it
  });
  server.on("error", (e) => die(`Could not start: ${e.message}`));
  server.listen(port, "0.0.0.0", () => {
    console.log(c.green("v ") + `Listening on port ${port}`);
    console.log(`  This computer: ${c.cyan(`http://localhost:${port}`)}`);
    for (const a of lanAddresses()) console.log(`  Shop network:  ${c.cyan(`http://${a}:${port}`)}`);
    console.log(c.dim("  Press Ctrl-C to stop."));
    if (!args.noBrowser) setTimeout(() => openBrowser(`http://localhost:${port}`), 250);
  });

  const shutdown = () => {
    console.log("\n" + c.dim("Stopping..."));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref?.();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => die(err.message || String(err)));
