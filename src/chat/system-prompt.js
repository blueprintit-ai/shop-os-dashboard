import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function safeRead(p) { if (!existsSync(p)) return null; try { return readFileSync(p, "utf8"); } catch { return null; } }
function extractH1(md) { if (!md) return null; const body = md.replace(/^---[\s\S]*?---\s*/m, ""); const m = body.match(/^#\s+(.+)$/m); return m ? m[1].trim() : null; }
function fmField(md, field) { if (!md) return null; const fm = md.match(/^---\s*([\s\S]*?)---/); if (!fm) return null; const m = fm[1].match(new RegExp(`^${field}\\s*:\\s*(.+)$`, "m")); return m ? m[1].trim() : null; }

// Template H1s the onboarding scaffold may leave behind ("# Organization",
// "# [Company Name]"): they are not a shop name, so keep looking.
const GENERIC_NAME = /^(organi[sz]ation|company|business|shop)(\s+(profile|overview|context|name))?$|^[\[{<].*[\]}>]$/i;
function usable(name) { return name && !GENERIC_NAME.test(name) ? name : null; }

// Order: Context/organization.md H1, then the vault CLAUDE.md front matter
// `license-customer:` (written by the installer, present before /bp-setup has
// created any Context file), then the generic fallback.
export function readShopName(vaultPath) {
  const fromOrg = usable(extractH1(safeRead(join(vaultPath, "Context", "organization.md"))));
  if (fromOrg) return fromOrg;
  const lic = fmField(safeRead(join(vaultPath, "CLAUDE.md")), "license-customer");
  const fromLicense = usable(lic ? lic.replace(/^["']|["']$/g, "").trim() : null);
  return fromLicense ?? "this shop";
}
function readOwnerName(vaultPath) {
  const op = safeRead(join(vaultPath, "Context", "operator.md"));
  return fmField(op, "owner") ?? extractH1(op) ?? "the shop owner";
}

export function buildStaffPrompt({ vaultPath, name, folders }) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Blueprint OS for ${readShopName(vaultPath)}. You are speaking with ${name}, a member of the team.

You can read files in these vault folders to answer questions: ${folders.join(", ")}. Search across those notes, summarize content, pull up job records, pricing, and process steps stored there. Files outside those folders are not available to you and attempts to read them will be refused; do not guess at their contents.

You CANNOT write, edit, modify, or delete any file. If ${name} asks you to create a note, update a record, log a call, or change anything, politely explain that you can only answer questions and direct them to ask ${readOwnerName(vaultPath)}.

Be helpful and concrete, and cite specific files. Wherever you mention a vault entity (a customer, a job, a process, a person), use [[wikilink]] form so ${name} can click through to that note.

Conversation date: ${today}`;
}

export function buildOwnerPrompt({ vaultPath, name }) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Blueprint OS for ${readShopName(vaultPath)}, working with ${name}, the owner. You have full access to this vault, the same as in the Claude Code terminal: read, write, edit, run skills, and organize notes following the routing rules in CLAUDE.md. Prefer editing existing notes over creating duplicates. Use [[wikilink]] form for every vault entity you mention so it is clickable in the dashboard.

Conversation date: ${today}`;
}
