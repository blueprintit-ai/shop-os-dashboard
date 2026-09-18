import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { JsonStore } from "./lib/store.js";
import { lanAddresses } from "./lib/net.js";

const AUTH_FAILURE_PATTERNS = [/not authenticated/i, /log ?in/i, /credentials/i, /unauthorized/i];

function defaults() {
  return { claude: { signedIn: "unknown", lastMessage: null, observedAt: null } };
}

export class StatusStore {
  constructor(homeDir) {
    this.store = new JsonStore(`${homeDir}/status.json`, defaults());
  }
  get() { return this.store.load(); }
  recordClaudeObservation(ok, message = null) {
    const current = this.get();
    current.claude = { signedIn: ok ? "yes" : "no", lastMessage: message, observedAt: new Date().toISOString() };
    this.store.save(current);
  }
  // Called from chat-routes.js after each turn's error event, so a turn that
  // streamed real content narrows "unknown" -> "yes" and an error whose
  // message looks auth-shaped narrows it to "no". Anything else is left alone.
  observeChatError(message) {
    if (AUTH_FAILURE_PATTERNS.some((re) => re.test(message))) this.recordClaudeObservation(false, message);
  }
}

export function checkStatus({ vaultPath, statusStore, licenseCheck, port, updateInfo, spawnSyncImpl = defaultSpawnSync }) {
  const probe = spawnSyncImpl(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
  const present = probe.status === 0;
  return {
    claude: { present, signedIn: statusStore.get().claude.signedIn },
    license: licenseCheck(),
    vault: { reachable: existsSync(vaultPath) },
    port,
    lan: lanAddresses(),
    update: updateInfo ?? { updateAvailable: false },
  };
}
