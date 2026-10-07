const RULES = [
  [/(ENOTFOUND|EAI_AGAIN|getaddrinfo)[^\n]*github|github[^\n]*(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET)/i, "GitHub unreachable, likely a firewall or proxy."],
  [/UNABLE_TO_VERIFY_LEAF_SIGNATURE|self[- ]signed certificate|CERT_HAS_EXPIRED|CERT_UNTRUSTED|CERT_NOT_YET_VALID|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|DEPTH_ZERO_SELF_SIGNED_CERT/i, "TLS certificate not trusted: likely a corporate proxy that inspects traffic."],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, "DNS lookup failed: no internet, or a firewall/DNS filter is blocking a site."],
  [/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ESOCKETTIMEDOUT|socket hang up|network (is )?unreachable/i, "Network connection timed out or was reset: likely a firewall, proxy or unstable connection."],
  [/\(timed out\)/i, "A step took too long and was stopped: a slow connection, antivirus scanning, or a busy computer."],
  [/ENOSPC|no space left/i, "The disk is full."],
  [/EACCES|EPERM|Access is denied|Operation not permitted/i, "Permission denied: antivirus, a locked folder or Controlled Folder Access may be blocking the installer."],
  [/Command 'git' not found|git: command not found|'git' is not recognized/i, "Git is missing and could not be provided automatically."],
  [/xcode-select|Command Line Tools/i, "This Mac needs the Xcode Command Line Tools (run: xcode-select --install)."],
];

export function hintFor(input) {
  const { message, outTail } = input ?? {};
  const text = `${String(message ?? "")}\n${String(outTail ?? "")}`;
  for (const [re, hint] of RULES) if (re.test(text)) return hint;
  return null;
}
