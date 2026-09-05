import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_LICENSE_PATH = join(homedir(), ".shopos", "license.json");

export function readLicense(path = DEFAULT_LICENSE_PATH) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function validateLicense(license) {
  if (!license) {
    return { ok: false, error: "License file not found. Reinstall Shop OS or contact support." };
  }
  const ents = Array.isArray(license.entitlements) ? license.entitlements : [];
  if (!ents.includes("foundation")) {
    return { ok: false, error: "This license does not include the Foundation entitlement required to run Shop OS Dashboard." };
  }
  if (license.valid_until) {
    const expiry = new Date(license.valid_until);
    if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
      return { ok: false, error: `Your Shop OS license expired on ${expiry.toISOString().slice(0, 10)}. Reply to your welcome email to renew.` };
    }
  }
  return { ok: true };
}
