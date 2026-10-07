const RULES = [
  [/(ENOTFOUND|EAI_AGAIN|getaddrinfo)[^\n]*github|github[^\n]*(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET)/i, "GitHub unreachable, likely a firewall or proxy."],
  [/UNABLE_TO_VERIFY_LEAF_SIGNATURE|self[- ]signed certificate|CERT_[A-Z_]+/i, "TLS certificate not trusted: likely a corporate proxy that inspects traffic."],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, "DNS lookup failed: no internet, or a firewall/DNS filter is blocking a site."],
  [/ETIMEDOUT|ECONNRESET|ECONNREFUSED|timed out|network:/i, "Network connection timed out or was reset: likely a firewall, proxy or unstable connection."],
  [/ENOSPC|no space left/i, "The disk is full."],
  [/EACCES|EPERM|Access is denied|Operation not permitted/i, "Permission denied: antivirus, a locked folder or Controlled Folder Access may be blocking the installer."],
  [/Command 'git' not found|git: command not found|'git' is not recognized/i, "Git is missing and could not be provided automatically."],
  [/xcode-select|Command Line Tools/i, "This Mac needs the Xcode Command Line Tools (run: xcode-select --install)."],
];

export function hintFor({ message = "", outTail = "" } = {}) {
  const text = `${message}\n${outTail}`;
  for (const [re, hint] of RULES) if (re.test(text)) return hint;
  return null;
}
