import { extname } from "node:path";

// Headers for serving user- or agent-supplied files from the dashboard's own origin.
// `inline` is the caller's decision (an allowlist of types that cannot run script, or an
// SVG served as an image); everything else downloads. nosniff stops a browser re-typing a
// file; the CSP sandbox is the backstop (it also neutralizes script in an inline SVG).
// PDFs are the exception to the sandbox: Chrome's built-in viewer refuses sandboxed documents.
export function safeFileHeaders({ filename, mime, inline }) {
  const ext = extname(filename).slice(1).toLowerCase();
  return {
    "content-type": mime,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "x-content-type-options": "nosniff",
    "cross-origin-opener-policy": "same-origin",
    ...(ext === "pdf" ? {} : { "content-security-policy": "sandbox" }),
  };
}
