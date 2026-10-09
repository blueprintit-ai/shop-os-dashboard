import { test } from "node:test";
import assert from "node:assert/strict";
import { rankAddresses } from "../src/lib/net.js";

const nic = (address, extra = {}) => ({ family: "IPv4", internal: false, address, ...extra });

test("rankAddresses: private LAN ranges first, link-local dropped, virtual/VPN-looking interfaces last, all candidates kept", () => {
  const ifaces = {
    "vEthernet (WSL)": [nic("172.28.80.1")],
    "Wi-Fi": [nic("192.168.1.20"), { family: "IPv6", internal: false, address: "fe80::1" }],
    "Ethernet 2": [nic("169.254.10.7")],
    lo0: [nic("127.0.0.1", { internal: true })],
    "Tailscale": [nic("100.64.1.2")],
    "en1": [nic("10.0.0.5")],
    "docker0": [nic("172.17.0.1")],
    "en2": [nic("8.8.4.4")],
    "Loopback": undefined,
  };
  const out = rankAddresses(ifaces);
  assert.deepEqual(out, ["192.168.1.20", "10.0.0.5", "8.8.4.4", "172.28.80.1", "172.17.0.1", "100.64.1.2"]);
  assert.ok(!out.includes("169.254.10.7") && !out.includes("127.0.0.1"));
});

test("rankAddresses: 172.16/12 is private but 172.32 is not; nothing usable gives []", () => {
  assert.deepEqual(rankAddresses({ a: [nic("172.32.0.1")], b: [nic("172.16.5.5")] }), ["172.16.5.5", "172.32.0.1"]);
  assert.deepEqual(rankAddresses({ a: [nic("169.254.1.1")], lo: [nic("127.0.0.1", { internal: true })] }), []);
  assert.deepEqual(rankAddresses({}), []);
});
