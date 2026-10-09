// The warning on the owner's /users page when the private-files list (Dashboard/private-paths.json) is not working as written.
// privateList = { state: "ok" | "failClosed" | "keptLastGood", ignoredEntries: N } from GET /api/status (owners only).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function privateListMessages(p) {
  if (!p || typeof p !== "object") return [];
  const out = [];
  if (p.state === "failClosed") out.push("Your private-files list could not be read, so staff cannot open any files until it is fixed. Edit Dashboard/private-paths.json.");
  else if (p.state === "keptLastGood") out.push("Your private-files list could not be read after your last edit, so the previous version is still in use. Edit Dashboard/private-paths.json to fix it.");
  const n = Number(p.ignoredEntries) || 0;
  if (n > 0) out.push(`${n} ${n === 1 ? "entry" : "entries"} in your private-files list ${n === 1 ? "was" : "were"} ignored: patterns match one file or folder name, use "paths" for folders, and paths must stay inside the vault (no ".." or drive letters). The activity log says which.`);
  return out;
}

export function mountPrivateBanner(root, p) {
  const msgs = privateListMessages(p);
  root.hidden = msgs.length === 0;
  root.innerHTML = msgs.map((m) => `<p class="private-warning" role="alert" style="margin:0 0 .5rem;padding:.6rem .8rem;border:1px solid #b45309;background:#fffbeb;color:#78350f;border-radius:6px">${esc(m)}</p>`).join("");
  return msgs;
}
