// public/js/owner/status-widget.js
// Registered into boot.js's `allKinds` map -- there is no "WIDGET_TYPES"
// map in widgets.js; kinds are plain entries merged from data-widgets.js's
// kindRenderers plus skills/assets/status (see boot.js). Renderer contract
// matches every other kind in data-widgets.js: (el) => Promise<void>,
// called once by widgets.js's mountGrid with only the widget's .wb body
// element -- no injected `{ fetchJSON }` argument and no teardown-function
// contract exist anywhere in the shipped grid engine (widgets.js:
// `allKinds[w.kind]?.(el.querySelector(".wb"))`, return value ignored, so a
// setInterval refresh loop would leak after the widget is removed via its
// ✕ button). Consistent with every other data widget here (none of which
// poll), this renders once per page load -- a manual reload is already how
// every other widget in this dashboard picks up new data.
import { api, escapeHtml } from "/static/js/api.js";

export async function renderStatusWidget(el) {
  el.innerHTML = `
    <div class="rows status-cards"></div>
    <div class="lan-address"></div>
    <canvas class="qr-code" width="160" height="160"></canvas>
    <div class="update-banner" hidden>
      <span>Update available</span>
      <button class="hbtn solid update-now" type="button">Update now</button>
    </div>
  `;
  const cardsEl = el.querySelector(".status-cards");
  const addrEl = el.querySelector(".lan-address");
  const canvas = el.querySelector("canvas.qr-code");
  const banner = el.querySelector(".update-banner");

  const res = await api("GET", "/api/status");
  if (!res.ok) { el.innerHTML = `<p class="muted">Status not available.</p>`; return; }
  const status = await res.json();

  cardsEl.innerHTML = [
    ["Claude Code", status.claude.present],
    ["Claude signed in", status.claude.signedIn !== "no"],
    ["License", status.license.ok],
    ["Vault reachable", status.vault.reachable],
  ].map(([label, ok]) => `<div class="rowi"><span class="dot${ok ? " hot" : ""}"></span>${escapeHtml(label)}</div>`).join("");

  const addr = status.lan[0];
  const url = addr ? `http://${addr}:${status.port}` : null;
  addrEl.textContent = url ?? "No LAN address detected — this computer only";
  if (url && window.qrcode) {
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const ctx = canvas.getContext("2d");
    const size = qr.getModuleCount();
    const cell = canvas.width / size;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
  }

  banner.hidden = !status.update?.updateAvailable;
  banner.querySelector(".update-now").addEventListener("click", async (e) => {
    await api("POST", "/api/update"); // api() also gets us the 401-redirect-to-login handling every other button here relies on; a raw fetch would not
    e.target.textContent = "Restarting…";
  });
}
