import { closeSync, lstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { HIDDEN_DIRS, createScope, toVaultRelative } from "../scope.js";

// The only way staff chat can search or list the vault. The SDK's built-in Grep and Glob return matches from every
// file below the folder they are pointed at, whatever a path check on the folder said, so staff do not get them.
// These two tools walk the vault themselves and ask scope.js isPathAllowed about EVERY entry they would return or
// descend into, which is the same function the notes viewer uses, so private material (and anything outside the
// staff user's folders) can neither match nor be named.

export const VAULT_SERVER_NAME = "vault";
export const VAULT_TOOL_NAMES = Object.freeze([`mcp__${VAULT_SERVER_NAME}__search`, `mcp__${VAULT_SERVER_NAME}__list`]);

export const LIMITS = Object.freeze({
  maxResults: 25, defaultResults: 15, maxHitsPerFile: 3, snippetChars: 160, maxOutputChars: 12000,
  maxFileBytes: 1024 * 1024, maxFilesScanned: 4000, maxDepth: 12, maxMillis: 4000, maxQuery: 200, maxListEntries: 300,
});

const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".csv", ".json", ".yaml", ".yml", ".log", ".html", ".htm", ".xml", ".vtt", ".srt"]);
// One answer for "no such folder", "not yours" and "private": a guessed name confirms nothing.
const FOLDER_UNAVAILABLE = "That folder is not available to you. Use list with no folder to see the folders you can use.";

const reply = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

function isDirectory(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

// A folder argument -> an absolute directory the user may use, or null. Never throws.
function resolveFolder(scope, vaultPath, folder) {
  if (folder === undefined || folder === null || folder === "") return { roots: scope.roots(), rel: "" };
  if (typeof folder !== "string" || folder.length > 400 || folder.includes("\0")) return null;
  const norm = folder.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm) || isAbsolute(folder)) return null;
  const segs = norm.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.length === 0) return { roots: scope.roots(), rel: "" };
  if (segs.includes("..")) return null;
  const abs = resolve(vaultPath, ...segs);
  if (!scope.allowed(abs) || !isDirectory(abs)) return null;
  return { roots: [abs], rel: segs.join("/") };
}

function snippet(line, needleLower) {
  const clean = line.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const i = clean.toLowerCase().indexOf(needleLower);
  const half = Math.floor((LIMITS.snippetChars - needleLower.length) / 2);
  const start = Math.max(0, i - half);
  const piece = clean.slice(start, start + LIMITS.snippetChars);
  return (start > 0 ? "..." : "") + piece + (start + LIMITS.snippetChars < clean.length ? "..." : "");
}

function readTextHead(abs, size) {
  let fd;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(Math.min(size, LIMITS.maxFileBytes));
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, Math.min(n, 4096));
    if (head.includes(0)) return null; // binary
    return buf.subarray(0, n).toString("utf8");
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
}

function entriesOf(dir) {
  let list = [];
  try { list = readdirSync(dir, { withFileTypes: true }); } catch { /* unreadable folder: nothing to list */ }
  return list.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.isDirectory() ? -1 : 1));
}

const hiddenName = (n) => n.startsWith(".") || HIDDEN_DIRS.includes(n);

export function vaultSearch(vaultPath, user, args) {
  const a = args && typeof args === "object" ? args : {};
  const query = typeof a.query === "string" ? a.query.trim() : "";
  if (!query || query.length > LIMITS.maxQuery || query.includes("\0")) return reply("Give a word or phrase to search for (up to 200 characters).", true);
  const scope = createScope(vaultPath, user);
  const target = resolveFolder(scope, vaultPath, a.folder);
  if (!target) return reply(FOLDER_UNAVAILABLE, true);
  const max = Math.max(1, Math.min(LIMITS.maxResults, Number.isFinite(Number(a.max)) ? Math.floor(Number(a.max)) : LIMITS.defaultResults));
  const needle = query.toLowerCase();
  const started = Date.now();
  const hits = [];
  let scanned = 0, stopped = false;

  const visit = (dir, depth) => {
    if (stopped) return;
    for (const ent of entriesOf(dir)) {
      if (hits.length >= max || scanned >= LIMITS.maxFilesScanned || Date.now() - started > LIMITS.maxMillis) { stopped = true; return; }
      if (hiddenName(ent.name)) continue;
      const abs = join(dir, ent.name);
      // Linked folders are never walked (no loops, no way round a folder rule); a linked file is read only if its REAL
      // location passes the same check as everything else.
      if (ent.isSymbolicLink()) { let st; try { st = statSync(abs); } catch { continue; } if (!st.isFile()) continue; }
      if (!scope.allowed(abs)) continue;
      if (ent.isDirectory()) { if (depth < LIMITS.maxDepth) visit(abs, depth + 1); continue; }
      let st; try { st = lstatSync(abs); if (st.isSymbolicLink()) st = statSync(abs); } catch { continue; }
      if (!st.isFile()) continue;
      scanned++;
      const rel = toVaultRelative(vaultPath, abs);
      if (ent.name.toLowerCase().includes(needle)) hits.push({ rel, line: 0, text: "(file name matches)" });
      if (hits.length >= max) { stopped = true; return; }
      if (!TEXT_EXT.has(extname(ent.name).toLowerCase()) || st.size > LIMITS.maxFileBytes) continue;
      const text = readTextHead(abs, st.size);
      if (text === null) continue;
      let perFile = 0;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && perFile < LIMITS.maxHitsPerFile && hits.length < max; i++) {
        if (lines[i].toLowerCase().includes(needle)) { hits.push({ rel, line: i + 1, text: snippet(lines[i], needle) }); perFile++; }
      }
    }
  };
  for (const root of target.roots) { visit(root, 0); if (stopped) break; }

  if (hits.length === 0) return reply("No matches in the files you can read.");
  let out = "";
  let shown = 0;
  for (const h of hits) {
    const line = `${h.rel}:${h.line}: ${h.text}\n`;
    if (out.length + line.length > LIMITS.maxOutputChars) break;
    out += line; shown++;
  }
  const more = stopped || shown < hits.length ? `\n(Showing the first ${shown} matches. Search for something more specific, or pass a folder, to narrow it down.)` : "";
  return reply(out.trimEnd() + more);
}

export function vaultList(vaultPath, user, args) {
  const a = args && typeof args === "object" ? args : {};
  const scope = createScope(vaultPath, user);
  const target = resolveFolder(scope, vaultPath, a.folder);
  if (!target) return reply(FOLDER_UNAVAILABLE, true);
  if (target.rel === "") {
    const names = target.roots.map((r) => toVaultRelative(vaultPath, r) + "/");
    return reply(names.length ? `Folders you can read:\n${names.join("\n")}` : "No folders are shared with you yet.");
  }
  const dir = target.roots[0];
  const out = [];
  let more = 0;
  for (const ent of entriesOf(dir)) {
    if (hiddenName(ent.name)) continue;
    const abs = join(dir, ent.name);
    if (!scope.allowed(abs)) continue;
    let st; try { st = statSync(abs); } catch { continue; }
    if (out.length >= LIMITS.maxListEntries) { more++; continue; }
    out.push(st.isDirectory() ? `${basename(abs)}/` : `${ent.name} (${st.size} bytes)`);
  }
  if (out.length === 0) return reply(`${target.rel}/ has nothing you can read.`);
  return reply(`${target.rel}/\n${out.join("\n")}${more ? `\n...and ${more} more. Use search to find a specific file.` : ""}`);
}

export function createVaultServer({ vaultPath, user, audit }) {
  const log = (name, input) => {
    try { audit?.log("chat.tool", { userId: user.id, username: user.username, role: user.role, tool: `mcp__${VAULT_SERVER_NAME}__${name}`, folder: typeof input?.folder === "string" ? input.folder.slice(0, 200) : undefined, query: typeof input?.query === "string" ? input.query.slice(0, 100) : undefined }); } catch { /* auditing never breaks a tool */ }
  };
  return createSdkMcpServer({
    name: VAULT_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        "search",
        "Search the text of the files you are allowed to read for a word or phrase (case-insensitive). Returns up to 25 matches as path:line: snippet. Optionally pass a folder (inside your folders) to narrow the search.",
        { query: z.string().describe("Word or phrase to look for"), folder: z.string().optional().describe("Optional folder inside your folders, e.g. Projects") },
        async (args) => { log("search", args); return vaultSearch(vaultPath, user, args); },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "list",
        "List the files and folders you are allowed to read. With no folder it lists your top-level folders; pass a folder to see what is inside it.",
        { folder: z.string().optional().describe("Folder to list, e.g. Resources. Leave empty to see your folders.") },
        async (args) => { log("list", args); return vaultList(vaultPath, user, args); },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}
