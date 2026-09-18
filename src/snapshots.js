import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function snapshotsDir(vaultPath) {
  return join(vaultPath, "Dashboard", "snapshots");
}

export function readStats(vaultPath) {
  const f = join(snapshotsDir(vaultPath), "stats.json");
  if (!existsSync(f)) return { needsSetup: true };
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { return { error: "stats.json: " + e.message }; }
}

export function readRoutines(vaultPath) {
  const f = join(snapshotsDir(vaultPath), "routines.json");
  if (!existsSync(f)) return { needsSetup: true, sources: [], routines: [], counts: {} };
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { return { error: "routines.json: " + e.message, sources: [], routines: [] }; }
}
