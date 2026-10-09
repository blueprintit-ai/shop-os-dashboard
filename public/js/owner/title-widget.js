// Title widget: hex logo + the shop name + product name. The name comes from
// document.title ("Blueprint OS — <shop name>"), which the server fills from
// readShopName() -- the same value the page <title> carries, so the browser
// tab and this widget cannot disagree. Built with textContent (never
// innerHTML) because the name is vault content.
const TITLE_PREFIX = "Blueprint OS \u2014 ";
const GENERIC = "this shop";

export function shopNameFromTitle() {
  const t = document.title || "";
  return t.startsWith(TITLE_PREFIX) ? t.slice(TITLE_PREFIX.length).trim() : "";
}

const HEX_LOGO = `<svg class="hexlogo" viewBox="0 0 48 48" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 6l18 10v16L24 42 6 32V16Z"/><path d="M24 6v16l18 10" opacity="0.5"/><path d="M24 22L6 32" opacity="0.5"/></svg>`;

// Returns the <h1> element for the title widget.
export function buildTitleHeading() {
  const name = shopNameFromTitle();
  const h1 = document.createElement("h1");
  h1.insertAdjacentHTML("afterbegin", HEX_LOGO);
  const nameEl = document.createElement("b");
  nameEl.id = "owner-shop-name";
  const suffix = document.createElement("span");
  if (!name || name === GENERIC) {
    nameEl.textContent = "Blueprint OS";
  } else {
    nameEl.textContent = name;
    suffix.textContent = "- Blueprint OS";
  }
  h1.append(nameEl);
  if (suffix.textContent) h1.append(suffix);
  return h1;
}
