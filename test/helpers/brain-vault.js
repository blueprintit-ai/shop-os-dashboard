// Builds a throwaway Blueprint OS style vault for the Second Brain tests (and the browser check).
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";

export function put(vault, rel, text = "# x\n", mtime) {
  const abs = join(vault, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return abs;
}

// The folders /bp-setup creates, a few linked notes, a skill, hidden folders that must never show up.
export function buildDemoVault(vault) {
  put(vault, "CLAUDE.md", "# Vault router\n\nSee [[organization]] and [[Acme Kitchen]].\n");
  put(vault, "Context/organization.md", "# Acme Cabinets\n\nOperator: [[operator]]\n");
  put(vault, "Context/operator.md", "# Operator\n\nBack to [organization](organization.md)\n");
  put(vault, "Context/CLAUDE.md", "# Context index\n");
  put(vault, "Projects/Acme Kitchen.md", "# Acme Kitchen\n\nClient: [[organization]]\nSee ../Intelligence/competitors/Big Box.md\n");
  put(vault, "Projects/CLAUDE.md", "# Projects index\n");
  put(vault, "Intelligence/competitors/Big Box.md", "# Big Box\n");
  put(vault, "Intelligence/market/Trends.md", "# Trends\n[[Big Box]]\n");
  put(vault, "Intelligence/decisions/2026-09-01.md", "# Decision\n");
  put(vault, "Team/acme/Profiles/marco/Marco.md", "# Marco\n");
  put(vault, "Daily/2026-09-04.md", "# Daily\n");
  put(vault, "Resources/Pricing Sheet.md", "# Pricing\n");
  put(vault, "Raw/inbox-note.txt", "raw text\n");
  put(vault, "Skills/my-skill/SKILL.md", "---\nname: my-skill\ndescription: Does a vault thing\n---\n# My skill\n");
  put(vault, "Dashboard/apps.json", JSON.stringify([{ id: "crm", name: "Shop CRM", sub: "Customers", url: "https://example.com", icon: "gen" }]));
  put(vault, "Dashboard/snapshots/routines.json", JSON.stringify({ sources: [{ key: "desktop", label: "Desktop" }], routines: [{ t: "07:00", d: "daily", src: "desktop", n: "Morning briefing", desc: "Every morning" }, { t: "18:00", d: "fri", src: "desktop", n: "Weekly digest" }], counts: {} }));
  // must never appear
  put(vault, ".obsidian/app.json", "{}");
  put(vault, ".claude/settings.json", "{}");
  put(vault, ".git/config", "[core]");
  put(vault, "Context/.hidden.md", "# hidden\n");
  put(vault, "Context/.env", "KEY=1\n");
  put(vault, "Context/api-token.json", "{}");
  put(vault, "node_modules/x/index.js", "1");
  return vault;
}

export function linkOutside(vault, outsideFile) {
  try { symlinkSync(outsideFile, join(vault, "Context", "escape.md")); return true; } catch { return false; }
}
