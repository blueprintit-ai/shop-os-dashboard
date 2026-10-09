// "Staff chat on their own computers" section of /users (owner only): the address staff open on the shop
// network, a QR code for it, and one-click shortcut files from GET /api/users/staff-shortcut.
// No imports on purpose: the unit test loads this file straight into jsdom.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const STAFF_PATH = "/employee";
const DL = "/api/users/staff-shortcut?format=";

// status = the /api/status body ({ lan: [ips, best first], port }). Pure: returns {url, others}; url is null without an address.
export function staffAddresses(status) {
  const lan = status?.lan || [], port = status?.port;
  if (!lan.length || !port) return { url: null, others: [] };
  return { url: `http://${lan[0]}:${port}${STAFF_PATH}`, others: lan.slice(1).map((a) => `http://${a}:${port}${STAFF_PATH}`) };
}

export function staffSectionHtml(status) {
  const { url, others } = staffAddresses(status);
  const head = `<h2>Staff chat on their own computers</h2>`;
  const notes = `
    <p class="muted" id="staff-advice">Send this to your team. The address works while the shop computer is on and on the same Wi-Fi. If staff cannot connect after a router restart, ask your IT person to reserve the shop computer's address (a DHCP reservation) so it never changes.</p>
    <p class="muted" id="staff-signin-note">Staff sign in with the username and password you create for them on this page, and they see only the folders you tick.</p>`;
  if (!url) {
    return `${head}<p class="muted" id="staff-none">No shop network address was found on this computer, so staff cannot reach it from their own computers yet. Connect it to the shop Wi-Fi or network and reload this page.</p>${notes}`;
  }
  return `${head}
    <div style="display:flex;gap:1.25rem;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1 1 20rem;min-width:0">
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <a id="staff-url" href="${escapeHtml(url)}" style="font-size:1.35rem;font-weight:600;word-break:break-all">${escapeHtml(url)}</a>
          <button type="button" id="staff-copy">Copy</button>
        </div>
        <p style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.75rem 0">
          <a id="staff-dl-win" href="${DL}url" download="Blueprint OS Staff Chat.url" class="btn">Download for Windows</a>
          <a id="staff-dl-mac" href="${DL}webloc" download="Blueprint OS Staff Chat.webloc" class="btn">Download for Mac</a>
          <a id="staff-dl-txt" href="${DL}bookmark" download="Blueprint OS Staff Chat.txt" class="muted">Plain text link</a>
        </p>
        ${notes}
        ${others.length ? `<div class="muted" id="staff-others">Other addresses, in case the first one is on the wrong network: ${others.map((u) => `<a href="${escapeHtml(u)}">${escapeHtml(u)}</a>`).join(", ")}</div>` : ""}
      </div>
      <div id="staff-qr" role="img" aria-label="QR code for the staff chat address" style="width:180px;height:180px;background:#fff;padding:8px"></div>
    </div>`;
}

export function mountStaffSection(root, status, { qrcode = globalThis.qrcode, clipboard = globalThis.navigator?.clipboard, toast = () => {} } = {}) {
  root.innerHTML = staffSectionHtml(status);
  const { url } = staffAddresses(status);
  if (!url) return;
  const qrEl = root.querySelector("#staff-qr");
  if (qrcode) {
    const qr = qrcode(0, "M");
    qr.addData(url); qr.make();
    qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    const svg = qrEl.querySelector("svg"); if (svg) { svg.setAttribute("width", "164"); svg.setAttribute("height", "164"); }
  } else qrEl.hidden = true;
  root.querySelector("#staff-copy").addEventListener("click", async () => {
    try { await clipboard.writeText(url); toast("Address copied."); }
    catch { toast("Could not copy. Select the address and copy it by hand."); }
  });
}
