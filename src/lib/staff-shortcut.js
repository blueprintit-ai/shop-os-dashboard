// The shareable "Blueprint OS Staff Chat" link: nothing but the staff page's address on the shop network.
export const STAFF_PATH = "/employee";
const BASE_NAME = "Blueprint OS Staff Chat";

export const staffUrl = (ip, port) => `http://${ip}:${port}${STAFF_PATH}`;

const xmlEscape = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// format: "url" (Windows Internet Shortcut), "webloc" (macOS), "bookmark" (plain text fallback).
export function buildStaffShortcut(format, url) {
  if (format === "url") return { fileName: `${BASE_NAME}.url`, contentType: "application/octet-stream", body: `[InternetShortcut]\r\nURL=${url}\r\nIconIndex=0\r\n` };
  if (format === "webloc") {
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>${xmlEscape(url)}</string>\n</dict>\n</plist>\n`;
    return { fileName: `${BASE_NAME}.webloc`, contentType: "application/octet-stream", body };
  }
  if (format === "bookmark") return { fileName: `${BASE_NAME}.txt`, contentType: "text/plain; charset=utf-8", body: `${url}\n` };
  return null;
}
