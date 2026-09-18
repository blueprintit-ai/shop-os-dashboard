// Structural, DOM-based sanitizer for the agent-writable artifact-sidecar
// `svg` field (src/artifacts.js's meta.svg, sourced from a JSON sidecar an
// agent run can write into <vault>/Dashboard/artifacts/) before ring.js
// assigns it to an <svg>'s innerHTML. Not trusted input.
//
// This replaces an earlier regex-based version that blocked <script>/
// <foreignObject>, on* handlers, and javascript: hrefs by string-matching --
// and had a real, documented bypass: /\son\w+\s*=/i requires literal
// whitespace right before the attribute name, but `<image/onerror=alert(1)>`
// (a `/` immediately after the tag name, no whitespace) is exactly the
// well-known <svg/onload=...>-style filter-evasion syntax documented on
// PortSwigger's XSS cheat sheet / OWASP -- and it still produces a working
// onerror handler once the browser tokenizes it. There was also a second,
// narrower bypass: an href carrying an embedded-tab/entity javascript: URL
// that the literal-string href match missed.
//
// Same fix shape as public/js/sanitize-urls.js's own round-2 rewrite: stop
// pattern-matching raw text (every regex is a guess at the syntaxes an
// attacker might use) and instead parse the fragment into a real DOM tree,
// then allowlist-filter it structurally. Parsing is done in strict XML mode
// (image/svg+xml, not text/html) specifically so HTML-parser tokenization
// quirks like the slash-instead-of-whitespace trick above never get a
// chance to run -- malformed markup simply fails to parse at all (see the
// parsererror check below), rather than degrading into "parse what you can".
//
// Allowed tags cover every shape the built-in ART_GLYPH table and the
// reference kit's sample sidecars actually use (rect/path/circle), plus the
// rest of the SVG basic-shape family for headroom (line/polyline/polygon/
// ellipse/g). No fill/stroke/style/href/on* attribute is ever allowed
// through -- not because each is individually detected as dangerous, but
// because only pure shape-geometry attributes are on the allowlist at all;
// the ball draws its own stroke color via CSS (see ring.js's ART_GLYPH
// comment), so custom glyphs were never meant to carry styling anyway.
const SVG_ALLOWED_TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "g"]);
const SVG_ALLOWED_ATTRS = new Set(["d", "cx", "cy", "r", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points", "rx", "ry", "transform"]);

// `DOMParserImpl`/`doc` are injectable so this is testable under Node with
// jsdom; they default to the real globals at runtime in the browser.
export function sanitizeArtifactSvg(svg, DOMParserImpl = globalThis.DOMParser, doc = globalThis.document) {
  if (!svg) return svg;
  try {
    const parsed = new DOMParserImpl().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
      "image/svg+xml"
    );
    if (parsed.querySelector("parsererror")) return "";
    const root = parsed.documentElement;
    for (const el of root.querySelectorAll("*")) {
      const tag = el.tagName.toLowerCase();
      // Any disallowed element anywhere in the tree rejects the whole
      // sidecar (falls through to the built-in icon table at the call
      // site) rather than trying to salvage the rest of the markup.
      if (!SVG_ALLOWED_TAGS.has(tag)) return "";
      for (const attr of [...el.attributes]) {
        if (!SVG_ALLOWED_ATTRS.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
      }
    }
    // Re-serialize through the real HTML document (rather than reading the
    // XML document's own innerHTML) so the result doesn't carry a redundant
    // xmlns="..." on every child -- innerHTML on an XML document re-declares
    // the default namespace at each node it walks, which is harmless but
    // noisy. Importing the already-filtered nodes into an HTML-namespace
    // <svg> container and reading innerHTML back from there serializes them
    // the same plain way ring.js's own inline ART_GLYPH strings look.
    const container = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const child of [...root.childNodes]) container.appendChild(doc.importNode(child, true));
    return container.innerHTML;
  } catch {
    return "";
  }
}
