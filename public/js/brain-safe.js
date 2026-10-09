// Second Brain page (/brain): the in-page file viewer renders a vault note with marked and puts the result in
// the page. Notes can be written by staff, and the page is the OWNER's session, so the HTML is made inert first:
// parsed in a document that never runs scripts or loads images, active elements and every on* attribute removed,
// then dangerous URL schemes neutralized by the same sanitizeUrls the notes viewer uses.
import { sanitizeUrls } from "./sanitize-urls.js";

const DROP = "script, iframe, frame, frameset, object, embed, style, link, meta, base, form, noscript, template, applet";

export function brainSafeHtml(html, doc = globalThis.document) {
  const inert = doc.implementation.createHTMLDocument("");
  const box = inert.createElement("div");
  box.innerHTML = String(html);
  for (const el of box.querySelectorAll(DROP)) el.remove();
  for (const el of box.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || a.name === "srcdoc" || a.name === "formaction") el.removeAttribute(a.name);
    }
  }
  return sanitizeUrls(box.innerHTML, doc);
}

globalThis.brainSafeHtml = (html) => brainSafeHtml(html);
