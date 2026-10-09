import { statSync, realpathSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";
import { HIDDEN_DIRS, isPathAllowed } from "../scope.js";
import { isSecret } from "./scan.js";

export const VIEW_MAX = 512 * 1024;
// Same text types the kit's viewer accepts.
export const TEXT_EXT = new Set([".md", ".txt", ".json", ".js", ".ts", ".jsx", ".tsx", ".html", ".htm", ".css", ".py", ".yaml", ".yml", ".toml", ".csv", ".xml", ".bat", ".sh", ".ps1", ".svg", ".log", ".mjs", ".cjs", ".vtt", ".srt"]);
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

// Resolves a vault-relative path from a request to a real file, or says why not.
// Never trusts the string: no absolute paths, no `..`, no hidden or system segments, no secrets, realpath must stay
// inside the vault (so a symlink out is refused), and scope.js isPathAllowed has the final say for staff.
// Returns { abs, rel } or { status, error }.
export function resolveVaultFile(vaultPath, user, raw) {
  if (typeof raw !== "string" || !raw || raw.length > 1024 || raw.includes("\0")) return { status: 400, error: "path required" };
  const norm = raw.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) return { status: 400, error: "bad path" };
  const segs = norm.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return { status: 400, error: "bad path" };
  if (segs.some((s) => s.startsWith(".") || HIDDEN_DIRS.includes(s))) return { status: 403, error: "not available" };
  if (isSecret(norm)) return { status: 403, error: "not available" };
  const abs = join(vaultPath, ...segs);
  let real;
  try { real = realpathSync(abs); } catch { return { status: 404, error: "Not found" }; }
  let root;
  try { root = realpathSync(vaultPath); } catch { return { status: 404, error: "Not found" }; }
  const relReal = relative(root, real);
  if (relReal === "" || relReal.startsWith("..") || relReal.split(sep).some((s) => s.startsWith(".") || HIDDEN_DIRS.includes(s))) return { status: 403, error: "not available" };
  if (!isPathAllowed(vaultPath, user, abs)) return { status: 403, error: "Outside your folders" };
  let st;
  try { st = statSync(real); } catch { return { status: 404, error: "Not found" }; }
  if (!st.isFile()) return { status: 404, error: "Not found" };
  return { abs: real, rel: segs.join("/"), size: st.size };
}

// Text for the in-page viewer (response shape = the kit's /api/file).
export function readViewable(found) {
  const ext = extname(found.abs).toLowerCase();
  if (!TEXT_EXT.has(ext) && ext !== "") return { status: 400, body: { error: "binary", ext, size: found.size } };
  if (found.size > VIEW_MAX) return { status: 400, body: { error: "File too large for the viewer (" + Math.round(found.size / 1024) + " KB)" } };
  return { status: 200, body: { content: readFileSync(found.abs, "utf8"), ext, size: found.size } };
}

export function readSkillText(skill) {
  if (!skill.file) return { content: `# ${skill.name}\n\nA built-in Blueprint OS skill that the dashboard runs for you.${skill.desc ? "\n\n" + skill.desc : ""}\n`, ext: ".md", size: 0 };
  let fd;
  try {
    fd = openSync(skill.file, "r");
    const buf = Buffer.alloc(VIEW_MAX);
    const n = readSync(fd, buf, 0, VIEW_MAX, 0);
    return { content: buf.subarray(0, n).toString("utf8"), ext: ".md", size: skill.size };
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
}

// Where the notes viewer shows a file: notes and text in /notes, images and PDFs as the raw file.
export function viewerUrl(rel) {
  const ext = extname(rel).toLowerCase();
  const q = encodeURIComponent(rel);
  if (ext === ".md" || ext === ".txt") return `/notes?path=${q}`;
  if (IMAGE_EXT.has(ext) || ext === ".pdf") return `/api/notes/raw?path=${q}`;
  return null;
}
