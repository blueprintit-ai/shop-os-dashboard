import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
const MAX_UPLOAD = 50 * 1024 * 1024;

const metaFile = (root) => join(root, ".assets.json");
const readMeta = (root) => { try { return JSON.parse(readFileSync(metaFile(root), "utf8")); } catch { return { favorites: [] }; } };
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
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return { abs, rel: relative(root, abs) };
}
export function assetMime(abs) {
  return ASSET_MIME[extname(abs).toLowerCase()] || "application/octet-stream";
}

export function scanAssets(root) {
  mkdirSync(root, { recursive: true });
  const favs = new Set(readMeta(root).favorites || []);
  const categories = [], files = [];
  const add = (cat, abs, name) => {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    const rel = cat ? join(cat, name) : name;
    files.push({
      id: assetId(rel), category: cat || "Uncategorized", name,
      ext: extname(name).slice(1).toLowerCase(), size: st.size,
      modified: st.mtimeMs, favorite: favs.has(rel),
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
  files.sort((a, b) => b.modified - a.modified);
  return {
    dir: root, maxFavorites: MAX_FAVORITES, categories, files,
    favorites: files.filter((f) => f.favorite).slice(0, MAX_FAVORITES),
  };
}

export function setFavorite(root, id, on) {
  const p = assetPath(root, id);
  if (!p || !existsSync(p.abs) || !statSync(p.abs).isFile()) return { error: "not-found", code: 404 };
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

export function saveUpload(root, category, name, buffer) {
  if (buffer.length > MAX_UPLOAD) return { error: "file over 50 MB", code: 413 };
  const dir = category ? join(root, category) : root;
  if (category && (isHidden(category) || !existsSync(dir) || !statSync(dir).isDirectory())) {
    return { error: "unknown category", code: 400 };
  }
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let target = join(dir, name), k = 2;
  while (existsSync(target)) target = join(dir, `${stem} (${k++})${ext}`);
  writeFileSync(target, buffer);
  const rel = relative(root, target);
  return { id: assetId(rel), name: basename(target), category: category || "Uncategorized", size: buffer.length };
}
