export async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = "/login"; throw new Error("unauthorized"); }
  return res;
}

export async function sse(path, body, onEvent) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) { location.href = "/login"; return; }
  if (!res.ok || !res.body) { onEvent({ type: "error", message: `Server error ${res.status}` }); return; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const rec = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = rec.split("\n").find((l) => l.startsWith("data: ")); if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch {}
    }
  }
}

export function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

export function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}
