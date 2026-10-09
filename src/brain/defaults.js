// Default Second Brain map config for a Blueprint OS vault (the folders /bp-setup creates). Same SHAPE as the kit's
// config/departments.json (departments, layers, pathRules, default), with neutral labels and the kit's icon keys.
// An owner (or their agent) can adjust it per vault with Dashboard/brain/departments.json; that file is validated
// here and bad rows are dropped, never trusted.
export const ICON_KEYS = Object.freeze(["visual", "people", "build", "pen", "data", "pulse", "book", "clock", "api", "lock"]);

export const DEFAULT_DEPARTMENTS = Object.freeze([
  { key: "business", label: "Business", color: "#e040fb", icon: "build" },
  { key: "context", label: "Context", color: "#3f8fd4", icon: "book" },
  { key: "intelligence", label: "Intelligence", color: "#9a66e0", icon: "data" },
  { key: "projects", label: "Projects", color: "#26a69a", icon: "pulse" },
  { key: "team", label: "Team", color: "#fdd835", icon: "people" },
].map(Object.freeze));

// A, R, M, S = Applications, Routines, Memory, Skills: the four rings.
export const LAYERS = Object.freeze([
  { key: "A", label: "Applications", color: "#3f8fd4", shape: "hex", blurb: "Tools and services your agents can reach" },
  { key: "R", label: "Routines", color: "#d99a1f", shape: "ringdot", blurb: "Scheduled automations that run without being asked" },
  { key: "M", label: "Memory", color: "#9a66e0", shape: "chip", blurb: "Every note of context, clustered by department" },
  { key: "S", label: "Skills", color: "#ff6b1a", shape: "diamond", blurb: "Capabilities your agents can run on demand" },
].map(Object.freeze));

// First (longest) matching prefix wins; anything unmatched goes to `default`.
export const DEFAULT_PATH_RULES = Object.freeze([
  { prefix: "Context/", dept: "context" },
  { prefix: "Intelligence/", dept: "intelligence" },
  { prefix: "Projects/", dept: "projects" },
  { prefix: "Team/", dept: "team" },
  { prefix: "Departments/", dept: "business" },
  { prefix: "Resources/", dept: "business" },
  { prefix: "Daily/", dept: "business" },
  { prefix: "Onboarding/", dept: "business" },
  { prefix: "Processes/", dept: "business" },
  { prefix: "Chats/", dept: "business" },
  { prefix: "Raw/", dept: "business" },
].map(Object.freeze));

export const DEFAULT_DEPT = "business";

const KEY = /^[a-z][a-z0-9-]{0,23}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const plain = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max && !/[<>"`\u0000-\u001f]/.test(s);

// Merges a (possibly hand-edited) Dashboard/brain/departments.json over the defaults. Shape:
//   { "departments": [{ key, label, color, icon }], "pathRules": [{ prefix, dept }], "default": "<dept key>" }
// Invalid rows are dropped; if nothing valid is left for a section the default stays.
export function mergeConfig(raw) {
  const out = { departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d })), pathRules: DEFAULT_PATH_RULES.map((r) => ({ ...r })), default: DEFAULT_DEPT };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (Array.isArray(raw.departments)) {
    const seen = new Set(), list = [];
    for (const d of raw.departments.slice(0, 12)) {
      if (!d || typeof d !== "object" || !KEY.test(d.key ?? "") || seen.has(d.key) || !plain(d.label, 40) || !COLOR.test(d.color ?? "") || !ICON_KEYS.includes(d.icon)) continue;
      seen.add(d.key); list.push({ key: d.key, label: d.label.trim(), color: d.color, icon: d.icon });
    }
    if (list.length) out.departments = list;
  }
  const keys = new Set(out.departments.map((d) => d.key));
  if (Array.isArray(raw.pathRules)) {
    const list = [];
    for (const r of raw.pathRules.slice(0, 60)) {
      if (!r || typeof r !== "object" || typeof r.prefix !== "string" || r.prefix.length > 120 || r.prefix.includes("..") || /[\\<>"\u0000-\u001f]/.test(r.prefix) || !keys.has(r.dept)) continue;
      list.push({ prefix: r.prefix, dept: r.dept });
    }
    if (list.length) out.pathRules = list;
  }
  out.pathRules = out.pathRules.filter((r) => keys.has(r.dept));
  if (typeof raw.default === "string" && keys.has(raw.default)) out.default = raw.default;
  if (!keys.has(out.default)) out.default = out.departments[0].key;
  return out;
}
