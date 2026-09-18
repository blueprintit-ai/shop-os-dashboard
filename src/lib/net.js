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

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}
