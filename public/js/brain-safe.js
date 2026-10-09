// Second Brain page (/brain): the in-page file viewer renders a vault note with marked. Notes can be written by staff
// and this is the OWNER's session, so: (1) the page's viewer escapes every `<` in the note BEFORE markdown runs (the same
// rule as src/notes/render.js), and (2) this is the backstop on marked's own output. It parses ONCE, in a document that
// never runs scripts or loads images, removes active/foreign-content elements and unsafe attributes in place, and returns
// the inert nodes adopted into the live document: nothing is re-serialized and re-parsed (that is what mutation XSS needs).
const DROP = "script, iframe, frame, frameset, object, embed, style, link, meta, base, form, noscript, template, applet, area, map, svg, math, textarea, select, input, button, audio, video, source, track";
const URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction", "data", "poster", "background", "cite", "srcset", "ping"];
const SAFE_IMG_DATA = /^data:image\/(png|gif|jpe?g|webp);/;

const squash = (v) => String(v).replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, "").toLowerCase();

function urlOk(el, name, value) {
  const v = squash(value);
  if (/^(javascript|vbscript|livescript):/.test(v)) return false;
  if (v.startsWith("data:")) return el.localName === "img" && name === "src" && SAFE_IMG_DATA.test(v);
  return true;
}

export function brainSafeFragment(html, doc = globalThis.document) {
  const inert = doc.implementation.createHTMLDocument("");
  const box = inert.createElement("div");
  box.innerHTML = String(html);
  for (const el of [...box.querySelectorAll(DROP)]) el.remove();
  for (const el of box.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "srcdoc" || n === "usemap" || n === "style") { el.removeAttribute(a.name); continue; }
      if (URL_ATTRS.includes(n) && !urlOk(el, n, a.value)) el.removeAttribute(a.name);
    }
  }
  const frag = doc.createDocumentFragment();
  while (box.firstChild) frag.appendChild(doc.adoptNode(box.firstChild));
  return frag;
}

globalThis.brainSafeFragment = (html) => brainSafeFragment(html);
