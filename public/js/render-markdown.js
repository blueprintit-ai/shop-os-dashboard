import { sanitizeUrls } from "./sanitize-urls.js";

// Renders chat markdown to safe HTML. Escapes every raw `<` in the source text
// BEFORE markdown parsing, exactly mirroring src/notes/render.js's proven
// approach — since the source here is untrusted (a user's own typed message,
// or an assistant response that may echo arbitrary note content read via the
// Read tool), and the only legitimate HTML in the output (the wikilink anchor)
// is built by the regex step below, strictly after this escape runs and after
// marked has already produced its output. `markedParse` is injected so this
// function is unit-testable with the real `marked` package outside a browser.
//
// The pre-parse escape only blocks raw HTML typed directly into the source.
// It does nothing about dangerous URLs that marked's OWN link/image syntax
// can generate from ordinary markdown (`[text](javascript:...)`), since that
// markdown contains no raw `<` for the escape to catch — so sanitizeUrls()
// runs as a second, independent layer right after markedParse().
export function renderMarkdown(md, markedParse, escapeHtmlFn) {
  const safe = String(md).replace(/</g, "&lt;");
  const html = sanitizeUrls(markedParse(safe));
  return html.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) =>
    `<a class="wikilink" href="#" data-target="${escapeHtmlFn(target.trim())}">${escapeHtmlFn(alias || target)}</a>`);
}
