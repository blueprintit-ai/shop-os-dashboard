import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const ASSET_MIME = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8", ".csv": "text/csv", ".html": "text/html", ".json": "application/json",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const MAX_FAVORITES = 4;
const REMINDER_DAYS = 30;
// extensions Claude can read directly (the Read tool); the rest are "unsupported" for the expiry scan
const SCANNABLE = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "csv"]);
export const isScannable = (ext) => SCANNABLE.has(String(ext).toLowerCase());
export const MAX_UPLOAD = 50 * 1024 * 1024;

const metaFile = (root) => join(root, ".assets.json");
const readMeta = (root) => { try { return JSON.parse(readFileSync(metaFile(root), "utf8")); } catch { return { favorites: [], docMeta: {} }; } };
const writeMeta = (root, m) => writeFileSync(metaFile(root), JSON.stringify(m, null, 2));
const isHidden = (n) => n.startsWith(".") || n.startsWith("~$");

export function assetId(rel) {
  return Buffer.from(rel, "utf8").toString("base64url");
}
export function assetPath(root, id) {
  let rel;
  try { rel = Buffer.from(String(id || ""), "base64url").toString("utf8"); } catch { return null; }
  if (!rel || rel.includes("\0")) return null;
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep)) return null; // strictly inside: the root itself is not an asset
  return { abs, rel: relative(root, abs) };
}
// What /assets/file, favorite, scan and remind may touch: exactly what the listing exposes. At most
// Category/file (depth 2), no hidden or lock files at any level, a regular file, and its real path
// (symlinks resolved) still inside the root's real path.
export function listedAssetPath(root, id) {
  const a = assetPath(root, id);
  if (!a) return null;
  const segs = a.rel.split(sep);
  if (segs.length > 2 || segs.some(isHidden)) return null;
  try {
    if (!statSync(a.abs).isFile()) return null;
    if (!realpathSync(a.abs).startsWith(realpathSync(root) + sep)) return null;
  } catch { return null; }
  return a;
}
export function assetMime(abs) {
  return ASSET_MIME[extname(abs).toLowerCase()] || "application/octet-stream";
}

// Per-document expiry results from the kit's "scan" action live in .assets.json -> docMeta[rel].
export function setDocMeta(root, rel, result) {
  const meta = readMeta(root);
  meta.docMeta = { ...(meta.docMeta || {}), [rel]: { ...result, scannedAt: new Date().toISOString() } };
  writeMeta(root, meta);
}
export function getDocMeta(root, rel) { return (readMeta(root).docMeta || {})[rel] || null; }

export function scanAssets(root) {
  mkdirSync(root, { recursive: true });
  const meta = readMeta(root);
  const favs = new Set(meta.favorites || []);
  const docMeta = meta.docMeta || {};
  const categories = [], files = [];
  const add = (cat, abs, name) => {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    const rel = cat ? join(cat, name) : name;
    const ext = extname(name).slice(1).toLowerCase();
    const dm = docMeta[rel] || {};
    files.push({
      id: assetId(rel), category: cat || "Uncategorized", name,
      ext, size: st.size,
      modified: st.mtimeMs, favorite: favs.has(rel),
      expires: dm.expires || null, scanStatus: dm.scanStatus || null, scannable: isScannable(ext),
    });
    return true;
  };
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { /* fresh install: root may not exist yet */ }
  for (const ent of entries) {
    if (isHidden(ent.name)) continue;
    if (ent.isDirectory()) {
      let n = 0;
      for (const f of readdirSync(join(root, ent.name))) {
        if (isHidden(f)) continue;
        try { if (add(ent.name, join(root, ent.name, f), f)) n++; } catch { /* unreadable file: skip it */ }
      }
      categories.push({ name: ent.name, count: n });
    } else if (ent.isFile()) {
      try { add("", join(root, ent.name), ent.name); } catch { /* unreadable file: skip it */ }
    }
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));
  const unc = files.filter((f) => f.category === "Uncategorized").length;
  if (unc) categories.push({ name: "Uncategorized", count: unc });
  files.sort((a, b) => b.modified - a.modified);
  return {
    dir: root, maxFavorites: MAX_FAVORITES, reminderDays: REMINDER_DAYS, categories, files,
    favorites: files.filter((f) => f.favorite).slice(0, MAX_FAVORITES),
  };
}

export function setFavorite(root, id, on) {
  const p = listedAssetPath(root, id);
  if (!p) return { error: "not-found", code: 404 };
  const meta = readMeta(root);
  let favs = (meta.favorites || []).filter((r) => { try { return statSync(join(root, r)).isFile(); } catch { return false; } });
  if (on) {
    if (!favs.includes(p.rel)) {
      if (favs.length >= MAX_FAVORITES) return { error: `only ${MAX_FAVORITES} favorites fit`, code: 409 };
      favs.push(p.rel);
    }
  } else {
    favs = favs.filter((r) => r !== p.rel);
  }
  writeMeta(root, { ...meta, favorites: favs });
  return { ok: true, favorite: on, favorites: favs.length };
}

const isInside = (root, p) => p.startsWith(root + sep);
// One path segment that cannot climb, nest, hide or name a drive.
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FORMAT_CHARS = /[\u0000-\u001f\u007f\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069\u2028\u2029]/;
// Also refuses what Windows mangles or reserves (CON, NUL.txt, trailing dots/spaces) and bidi/format characters that disguise names.
const safeSegment = (n) => typeof n === "string" && n.length > 0 && n.length <= 200 && !/[\/\\:\0]/.test(n) && !n.startsWith(".")
  && n.trim() === n && !/[. ]$/.test(n) && !FORMAT_CHARS.test(n) && !RESERVED_WIN.test(n.split(".")[0].trim());

export function saveUpload(root, category, name, buffer) {
  if (buffer.length > MAX_UPLOAD) return { error: "file over 50 MB", code: 413 };
  if (!safeSegment(name)) return { error: "bad file name", code: 400 };
  root = resolve(root);
  if (category === "Uncategorized" && !existsSync(join(root, "Uncategorized"))) category = ""; // the listing's name for the root
  let dir = root;
  if (category) {
    if (!safeSegment(category)) return { error: "unknown category", code: 400 };
    dir = join(root, category);
    let ok = false;
    try { ok = statSync(dir).isDirectory() && isInside(realpathSync(root), realpathSync(dir)); } catch { /* missing */ }
    if (!ok) return { error: "unknown category", code: 400 };
  }
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let target = join(dir, name), k = 2;
  while (existsSync(target)) target = join(dir, `${stem} (${k++})${ext}`);
  if (!isInside(root, resolve(target))) return { error: "bad file name", code: 400 };
  try { writeFileSync(target, buffer, { flag: "wx" }); }
  catch { return { error: "could not save the file", code: 500 }; } // never echo the server's path or the OS error
  const rel = relative(root, target);
  return { id: assetId(rel), name: basename(target), category: category || "Uncategorized", size: buffer.length };
}
