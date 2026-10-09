import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { join, relative, sep, basename, extname } from "node:path";
import { HIDDEN_DIRS } from "../scope.js";
import { extractWikilinks, splitFrontmatter } from "./render.js";

const TEXT_EXT = new Set([".md", ".txt"]);

function walk(root, dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (HIDDEN_DIRS.includes(e.name)) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) walk(root, abs, out);
    else if (e.isFile()) out.push(abs);
  }
}

function titleOf(abs, md) {
  const { body } = splitFrontmatter(md);
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : basename(abs, extname(abs));
}

export class LinkIndex {
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
    this.byBase = new Map();      // lowercased basename (with and without ext) -> [relPath]
    this.byTitle = new Map();     // lowercased note title (H1, Obsidian-style link target) -> [relPath]
    this.outgoing = new Map();    // relPath -> Set(relPath)
    this.incoming = new Map();    // relPath -> Set(relPath)
    this.meta = new Map();        // relPath -> { title, mtime }
    this.watcher = null;
    this.timer = null;
  }

  rel(abs) { return relative(this.vaultPath, abs).split(sep).join("/"); }

  build() {
    this.byBase.clear(); this.byTitle.clear(); this.outgoing.clear(); this.incoming.clear(); this.meta.clear();
    const files = [];
    walk(this.vaultPath, this.vaultPath, files);
    const pending = [];
    for (const abs of files) {
      const rel = this.rel(abs);
      const base = basename(abs).toLowerCase();
      const noExt = basename(abs, extname(abs)).toLowerCase();
      for (const k of new Set([base, noExt])) {
        if (!this.byBase.has(k)) this.byBase.set(k, []);
        this.byBase.get(k).push(rel);
      }
      let mtime = 0; try { mtime = statSync(abs).mtimeMs; } catch {}
      if (TEXT_EXT.has(extname(abs).toLowerCase())) {
        let md = ""; try { md = readFileSync(abs, "utf8"); } catch {}
        const title = titleOf(abs, md);
        this.meta.set(rel, { title, mtime });
        const titleKey = title.toLowerCase();
        if (!this.byTitle.has(titleKey)) this.byTitle.set(titleKey, []);
        this.byTitle.get(titleKey).push(rel);
        pending.push([rel, extractWikilinks(md)]);
      } else {
        this.meta.set(rel, { title: basename(abs), mtime });
      }
    }
    for (const list of this.byBase.values()) list.sort((a, b) => a.length - b.length);
    for (const list of this.byTitle.values()) list.sort((a, b) => a.length - b.length);
    for (const [rel, links] of pending) {
      const targets = new Set();
      for (const l of links) { const t = this.resolve(l.target); if (t) targets.add(t); }
      this.outgoing.set(rel, targets);
      for (const t of targets) {
        if (!this.incoming.has(t)) this.incoming.set(t, new Set());
        this.incoming.get(t).add(rel);
      }
    }
  }

  // `accept(rel)` lets a caller resolve among only the notes it may use (staff: never one that is private), so a
  // private note can neither shadow a visible note of the same name nor be handed back to a caller who cannot see it.
  resolve(target, accept = null) {
    const ok = accept ?? (() => true);
    const t = String(target).trim().toLowerCase().replace(/\\/g, "/");
    // exact vault-relative path first
    for (const rel of this.meta.keys()) if ((rel.toLowerCase() === t || rel.toLowerCase() === t + ".md") && ok(rel)) return rel;
    const base = t.split("/").pop();
    const byBase = [...new Set([...(this.byBase.get(base) ?? []), ...(this.byBase.get(base + ".md") ?? [])])].filter(ok);
    if (byBase.length) return byBase[0];
    // Obsidian also resolves a link target against a note's title (its H1), not
    // only its filename -- e.g. [[Acme Cabinets]] resolving to a file named
    // organization.md whose first heading is "# Acme Cabinets".
    return (this.byTitle.get(base) ?? []).find(ok) ?? null;
  }

  backlinks(relPath) { return [...(this.incoming.get(relPath) ?? [])]; }

  notes() {
    return [...this.meta.entries()].filter(([p]) => TEXT_EXT.has(extname(p).toLowerCase())).map(([path, m]) => ({ path, ...m }));
  }

  // `watchImpl` and `debounceMs` are injectable so the debounce/rescan path can be tested without real fs events
  // (which macOS delivers late or coalesced under load). Rebuilds once, `debounceMs` after the last change event.
  watch(onChange, { watchImpl = watch, debounceMs = 750 } = {}) {
    try {
      this.watcher = watchImpl(this.vaultPath, { recursive: true }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.build(); onChange?.(); }, debounceMs);
        this.timer.unref?.();
      });
      this.watcher.on("error", () => {});
      this.watcher.unref?.(); // never the thing that keeps the process alive (the HTTP server does that)
    } catch (e) {
      console.error("[notes] watch unavailable, use manual rescan:", e.message);
    }
  }

  close() { clearTimeout(this.timer); this.watcher?.close(); this.watcher = null; }
}
