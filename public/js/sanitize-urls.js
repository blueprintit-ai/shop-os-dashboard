// Neutralizes dangerous URL schemes in href/src attributes of already-rendered
// HTML. Runs AFTER markdown parsing, as a second, independent layer: the
// pre-parse `<` escape (see render-markdown.js) blocks raw HTML tags typed
// directly into the source; this blocks dangerous destinations that marked's
// OWN link/image syntax can generate from perfectly ordinary markdown
// (`[text](javascript:...)`), which contains no raw `<` for that first layer
// to catch. Two independent layers because they close two different holes,
// not because either alone is enough.
// Note: "javascript"/"vbscript" URIs are always followed by a scheme colon
// ("javascript:alert(1)"), but a dangerous "data:" URI is NOT followed by a
// second colon after its media type -- it's followed by a comma (optionally
// preceded by ";base64"): "data:text/html,<script>...". So the "javascript"/
// "vbscript" branch requires a trailing colon while the "data:text/..."
// branch matches as a standalone prefix; a single shared `\s*:` suffix for
// both (as if they were symmetric) would silently never match the data: case.
const LEADING_WS = "[\\s\\x00-\\x20]*";
const DANGEROUS_SCHEME = new RegExp(
  "^" + LEADING_WS + "(?:(?:javascript|vbscript)\\s*:|data\\s*:\\s*text/(?:html|javascript))",
  "i"
);

function decodeBasicEntities(s) {
  return String(s)
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

// Browsers ignore TAB/newline/carriage-return characters anywhere in a URL
// when sniffing its scheme (the classic "java<TAB>script:" / "java&#09;script:"
// filter-bypass trick relies on exactly this). Strip them before testing so
// splitting the scheme name across a control character can't slip past
// DANGEROUS_SCHEME the way it would slip past a naive literal match.
function stripSchemeWhitespace(s) {
  return String(s).replace(/[\t\n\r]+/g, "");
}

export function sanitizeUrls(html) {
  return String(html).replace(/\s(href|src)=(["'])(.*?)\2/gi, (full, attr, quote, rawValue) => {
    const decoded = stripSchemeWhitespace(decodeBasicEntities(rawValue));
    const raw = stripSchemeWhitespace(rawValue);
    if (DANGEROUS_SCHEME.test(decoded) || DANGEROUS_SCHEME.test(raw)) {
      return " " + attr + "=" + quote + "#" + quote;
    }
    return full;
  });
}
