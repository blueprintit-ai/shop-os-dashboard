import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

function tryPort(port, host) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export async function findFreePort(start = 50000, end = 50010, host = "0.0.0.0") {
  for (let p = start; p <= end; p++) if (await tryPort(p, host)) return p;
  throw new Error(`No free port available in ${start}-${end}.`);
}

const VIRTUAL_NIC = /vethernet|wsl|hyper-v|docker|veth|br-|virbr|vbox|virtualbox|vmware|vmnet|tailscale|zerotier|vpn|\btun|\btap|utun|ppp|bridge|loopback pseudo/i;
const isPrivate = (ip) => {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

// All usable IPv4 addresses, best first: real private LAN ranges (10/8, 172.16/12, 192.168/16) before other
// addresses, link-local 169.254.* dropped, and virtual / VPN / WSL-looking interfaces after everything else.
// `ifaces` is os.networkInterfaces()-shaped so it can be tested.
export function rankAddresses(ifaces) {
  const rows = [];
  for (const [name, list] of Object.entries(ifaces ?? {})) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal || i.address.startsWith("169.254.")) continue;
      const virtual = VIRTUAL_NIC.test(name);
      rows.push({ ip: i.address, rank: (virtual ? 4 : 0) + (isPrivate(i.address) ? 0 : 2) });
    }
  }
  return rows.map((r, n) => ({ ...r, n })).sort((a, b) => a.rank - b.rank || a.n - b.n).map((r) => r.ip);
}

export function lanAddresses() { return rankAddresses(networkInterfaces()); }
