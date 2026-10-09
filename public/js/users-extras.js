// /users page extras for the owner: the Business Assets folder setting (GET/PUT /api/settings) and
// the staff chat shortcut section (public/js/staff-chat.js), the phone/LAN access QR (address from /api/status, drawn with the vendored qrcode-generator).
import { api, escapeHtml, toast } from "/static/js/api.js";
import { lanUrl } from "/static/js/lan-url.js";
import { mountStaffSection } from "/static/js/staff-chat.js";

const root = document.getElementById("extras-root");

root.innerHTML = `
  <section class="extras-card" id="staff-chat"></section>
  <section class="extras-card" id="assets-setting">
    <h2>Business Assets folder</h2>
    <p class="muted">The folder the Business Assets page and widget read from. Sub-folders become categories. Leave empty to use the default (<span id="assets-default"></span>).</p>
    <form id="assets-form"><input id="assets-dir" name="assetsDir" placeholder="Default folder" autocomplete="off" style="width:100%;max-width:36rem"> <button type="submit">Save</button></form>
  </section>
  <section class="extras-card" id="phone-access">
    <h2>Phone and shop Wi-Fi access</h2>
    <p class="muted">Scan with a phone on the same Wi-Fi to open the dashboard.</p>
    <div id="phone-addr" class="muted">Loading…</div>
    <div id="phone-qr" style="width:180px;height:180px;background:#fff;padding:8px"></div>
  </section>
`;

async function loadSettings() {
  const res = await api("GET", "/api/settings");
  if (!res.ok) return;
  const s = await res.json();
  document.getElementById("assets-dir").value = s.assetsDir || "";
  document.getElementById("assets-default").textContent = "inside the dashboard's data folder";
}

document.getElementById("assets-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("PUT", "/api/settings", { assetsDir: document.getElementById("assets-dir").value.trim() });
  const data = await res.json().catch(() => ({}));
  toast(res.ok ? "Business Assets folder saved." : (data.error || "Could not save."));
});

async function loadPhone() {
  const addrEl = document.getElementById("phone-addr"), qrEl = document.getElementById("phone-qr");
  const res = await api("GET", "/api/status");
  const status = res.ok ? await res.json() : null;
  mountStaffSection(document.getElementById("staff-chat"), status, { toast });
  const url = lanUrl(status);
  if (!url) { addrEl.textContent = "No Wi-Fi address detected: the dashboard is only reachable from this computer."; qrEl.hidden = true; return; }
  addrEl.innerHTML = `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  // the best address (private LAN first, VPN/WSL last) gets the QR; any others are listed in case it is the wrong network
  const others = (status.lan || []).slice(1).map((a) => `http://${a}:${status.port}`);
  if (others.length) addrEl.innerHTML += `<div class="muted">Other addresses: ${others.map((u) => `<a href="${escapeHtml(u)}">${escapeHtml(u)}</a>`).join(", ")}</div>`;
  if (!window.qrcode) { qrEl.hidden = true; return; }
  const qr = window.qrcode(0, "M");
  qr.addData(url); qr.make();
  qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  const svg = qrEl.querySelector("svg"); if (svg) { svg.setAttribute("width", "164"); svg.setAttribute("height", "164"); }
}

loadSettings();
loadPhone();
