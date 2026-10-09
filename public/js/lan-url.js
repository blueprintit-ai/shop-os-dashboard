// The address a phone on the shop's Wi-Fi can open: first LAN IPv4 (from /api/status -> src/lib/net.js lanAddresses) on the dashboard's port.
export function lanUrl(status) {
  const addr = status?.lan?.[0];
  return addr && status?.port ? `http://${addr}:${status.port}` : null;
}
