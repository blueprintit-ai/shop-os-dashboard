import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { vaultDashboardDir } from "./lib/paths.js";
import { isPrivatePath } from "./scope.js";

const ICON_RULES = [
  [/deck|slide|present/i, "deck"],
  [/report|audit|analysis/i, "report"],
  [/dash|board|monitor/i, "dash"],
  [/brief|inbox|email|digest/i, "mail"],
  [/lesson|script|video|thumb/i, "video"],
  [/chart|graph|metric|mrr/i, "chart"],
  [/wheel|orb|visual|design/i, "visual"],
  [/prompt|skill|agent/i, "bolt"],
];
function inferIcon(name) {
  for (const [re, ic] of ICON_RULES) if (re.test(name)) return ic;
  return "doc";
}
const CAT_RULES = [
  [/post|newsletter|writ|script|hook|draft|announce|description|blurb|copy/i, "writing"],
  [/landing|site|page|dashboard|app|demo|web|frontend|ui|widget|lab|library|game/i, "frontend"],
  [/infographic|explain|report|guide|map|slide|deck|digest|packag|progress|workshop|kickoff|snapshot/i, "infographic"],
];
function inferCategory(name) {
  for (const [re, cat] of CAT_RULES) if (re.test(name)) return cat;
  return "other";
}

// The kit page assigns an artifact's sidecar `svg` straight to an <svg>'s innerHTML, and
// a sidecar is agent-writable, so it is validated here before /api/artifacts ever serves
// it. Reject-not-strip: the string must be nothing but allowlisted shape elements with
// allowlisted geometry attributes whose values are plain tokens; anything else (script,
// foreignObject, style/href/on* attributes, entities, comments, stray text) yields "" and
// the page falls back to its built-in glyph for the artifact's icon.
const SVG_TAGS = "path|circle|rect|line|polyline|polygon|ellipse|g";
const SVG_ATTR = "(?:d|cx|cy|r|x|y|width|height|x1|y1|x2|y2|points|rx|ry|transform)";
const SVG_VAL = "[-0-9A-Za-z .,()+]*";
const SVG_ATTRS = `(?:\\s+${SVG_ATTR}="${SVG_VAL}")*`;
const SVG_ELEMENT = new RegExp(`^(?:<(${SVG_TAGS})${SVG_ATTRS}\\s*/>|<(${SVG_TAGS})${SVG_ATTRS}\\s*>|</(?:${SVG_TAGS})\\s*>)`);
export function sanitizeArtifactSvg(svg) {
  if (typeof svg !== "string" || !svg || svg.length > 8000) return "";
  const open = [];
  let rest = svg.trim();
  while (rest) {
    const m = SVG_ELEMENT.exec(rest);
    if (!m) return "";
    if (m[2]) open.push(m[2]);
    else if (m[0].startsWith("</")) { const want = /^<\/([a-z0-9]+)/.exec(m[0])[1]; if (open.pop() !== want) return ""; }
    rest = rest.slice(m[0].length).trimStart();
  }
  return open.length ? "" : svg.trim();
}

// filename must be a single path segment ending in .htm/.html - no directory traversal, no nesting,
// and (not incidentally) no reaching the .json sidecar or the _trash folder through this check.
const SAFE_HTML_NAME = /^[^/\\]+\.html?$/i;

export function isSafeArtifactFile(file) {
  return typeof file === "string" && SAFE_HTML_NAME.test(file);
}

export function artifactsDir(vaultPath) {
  return join(vaultDashboardDir(vaultPath), "artifacts");
}

function readSidecar(htmlPath) {
  const side = htmlPath.replace(/\.html?$/i, ".json");
  if (!existsSync(side)) return {};
  try { return JSON.parse(readFileSync(side, "utf8")); } catch { return {}; }
}

// The kit page puts the title into innerHTML (name chips) and the sidecar is agent-writable, so a title
// is only trusted when it has no markup characters or control characters; otherwise the file name stands in.
const UNSAFE_TEXT = /[<>&\u0000-\u001f\u007f]/;
const UNSAFE_TEXT_ALL = new RegExp(UNSAFE_TEXT.source, "g");
const safeTitle = (t, stem) => (typeof t === "string" && t.trim() && !UNSAFE_TEXT.test(t) ? t.trim() : (stem.replace(UNSAFE_TEXT_ALL, "").trim() || "artifact"));

export function listArtifacts(vaultPath, user) {
  const dir = artifactsDir(vaultPath);
  if (!existsSync(dir)) return { fetched: new Date().toISOString(), count: 0, artifacts: [] };
  const files = readdirSync(dir).filter((f) => /\.html?$/i.test(f));
  let artifacts = files.map((f) => {
    const full = join(dir, f);
    const st = statSync(full);
    const meta = readSidecar(full);
    let title = meta.title;
    if (!title) {
      const head = readFileSync(full, "utf8").slice(0, 2000);
      title = (head.match(/<title>([^<]+)<\/title>/i)?.[1] || f.replace(/\.html?$/i, "")).trim();
    }
    title = safeTitle(title, f.replace(/\.html?$/i, ""));
    return {
      file: f, title,
      icon: meta.icon || inferIcon(f + " " + title),
      kind: meta.kind || "artifact",
      note: meta.note || "",
      svg: sanitizeArtifactSvg(meta.svg),
      category: meta.category || inferCategory(f + " " + title + " " + (meta.kind || "")),
      visibility: meta.visibility === "staff" ? "staff" : "owner",
      created: meta.created || st.birthtime.toISOString(),
      modified: st.mtime.toISOString(),
      url: "/artifacts/" + encodeURIComponent(f),
    };
  }).sort((a, b) => new Date(b.modified) - new Date(a.modified));

  if (user.role !== "owner") {
    const shared = user.switches?.artifactsShared === true;
    artifacts = shared ? artifacts.filter((a) => a.visibility === "staff" && !artifactIsPrivate(vaultPath, a.file)) : [];
  }
  return { fetched: new Date().toISOString(), count: artifacts.length, artifacts };
}

// Private rules apply to artifacts too: a file the owner lists in Dashboard/private-paths.json (or a link into a Private
// folder) or a sidecar saying private: true is never shown to staff, whatever its visibility says.
export function artifactIsPrivate(vaultPath, file) {
  const full = join(artifactsDir(vaultPath), file);
  if (isPrivatePath(vaultPath, full)) return true;
  const side = readSidecar(full).private;
  return side === true || (typeof side === "string" && ["true", "yes", "on", "y", "1"].includes(side.trim().toLowerCase()));
}

// Re-check a single file's visibility without listing the whole directory - used to
// gate the static-serve route the same way listArtifacts gates the JSON listing, so a
// staff user can't fetch an owner-only artifact by guessing its filename.
export function artifactVisibility(vaultPath, file) {
  const dir = artifactsDir(vaultPath);
  const full = join(dir, file);
  const meta = readSidecar(full);
  return meta.visibility === "staff" ? "staff" : "owner";
}

export function removeArtifact(vaultPath, file) {
  if (!isSafeArtifactFile(file)) return { error: "bad-path", code: 400 };
  const dir = artifactsDir(vaultPath);
  const htmlPath = join(dir, file);
  const jsonPath = htmlPath.replace(/\.html?$/i, ".json");
  if (!existsSync(htmlPath)) return { error: "not-found", code: 404 };
  const trash = join(dir, "_trash");
  mkdirSync(trash, { recursive: true });
  renameSync(htmlPath, join(trash, basename(htmlPath)));
  if (existsSync(jsonPath)) renameSync(jsonPath, join(trash, basename(jsonPath)));
  return { ok: true };
}
