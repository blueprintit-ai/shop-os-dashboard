// Neutralizes dangerous URL schemes (javascript:, vbscript:, data:text/html,
// data:text/javascript) in already-rendered HTML, by parsing the HTML into a
// real (detached) DOM element and reading back the browser's OWN resolved
// href/src -- not by pattern-matching the raw string.
//
// This replaces two earlier rounds of regex-based detection. Round 1 handled
// literal schemes; round 2 added data: URI and literal-whitespace handling;
// both were defeated by HTML named character references (`&colon;`, `&Tab;`,
// and ~2000 others) that decode into scheme-relevant characters the regex
// never accounted for. Reimplementing HTML entity decoding well enough to
// catch every such case is not a fight worth having: the browser already
// does this decoding correctly and completely every time it parses HTML.
// Reading back `.protocol`/`.src` AFTER real parsing is authoritative -- if
// the browser would navigate somewhere dangerous, these properties say so,
// with no guesswork about how the danger was encoded.
//
// `doc` is injectable so this is testable under Node with jsdom; it defaults
// to the real global `document` at runtime in the browser.
const DANGEROUS_PROTOCOLS = new Set(["javascript:", "vbscript:"]);

function isDangerousDataUrl(resolved) {
  // .protocol on any data: URL is always exactly "data:" regardless of media
  // type, so the media-type check has to run on the fully-resolved string
  // itself -- which, read back from a DOM property after real parsing, is
  // already decoded (no entities, no escapes left to hide behind).
  return /^data:\s*text\/(html|javascript)/i.test(resolved);
}

export function sanitizeUrls(html, doc = globalThis.document) {
  const container = doc.createElement("div");
  container.innerHTML = html;

  for (const el of container.querySelectorAll("a[href]")) {
    if (DANGEROUS_PROTOCOLS.has(el.protocol) || isDangerousDataUrl(el.href)) {
      el.setAttribute("href", "#");
    }
  }
  for (const el of container.querySelectorAll("img[src]")) {
    let protocol = "";
    try { protocol = new URL(el.src, doc.baseURI || "http://localhost/").protocol; } catch { /* relative/invalid: not a scheme attack */ }
    if (DANGEROUS_PROTOCOLS.has(protocol) || isDangerousDataUrl(el.src)) {
      el.removeAttribute("src");
    }
  }
  return container.innerHTML;
}
