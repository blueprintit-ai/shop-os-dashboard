import { api, escapeHtml, toast } from "/static/js/api.js";
import { sanitizeUrls } from "/static/js/sanitize-urls.js";

const root = document.getElementById("notes-root");

root.innerHTML = `
  <div class="tree" id="notes-tree"><p class="muted">Loading…</p></div>
  <div class="notes-main">
    <input type="search" id="notes-search-input" placeholder="Search notes…">
    <div id="notes-search-results"></div>
    <article class="viewer" id="notes-viewer"><p class="muted">Select a note from the list.</p></article>
  </div>
`;

const els = {
  tree: document.getElementById("notes-tree"),
  searchInput: document.getElementById("notes-search-input"),
  searchResults: document.getElementById("notes-search-results"),
  viewer: document.getElementById("notes-viewer"),
};

function renderNode(node) {
  if (node.type === "dir") {
    const kids = (node.children || []).map((c) => `<li>${renderNode(c)}</li>`).join("");
    return `<details class="dir"><summary>${escapeHtml(node.name)}</summary><ul>${kids}</ul></details>`;
  }
  return `<a data-path="${escapeHtml(node.path)}" href="/api/notes/view?path=${encodeURIComponent(node.path)}">${escapeHtml(node.name)}</a>`;
}

export async function loadTree() {
  els.tree.innerHTML = `<p class="muted">Loading…</p>`;
  const res = await api("GET", "/api/notes/tree");
  if (!res.ok) { els.tree.innerHTML = `<p class="muted">Could not load notes.</p>`; return; }
  const nodes = await res.json();
  els.tree.innerHTML = `<ul>${nodes.map((n) => `<li>${renderNode(n)}</li>`).join("")}</ul>`;
}

function renderProps(frontmatter) {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return "";
  const rows = Object.entries(frontmatter)
    .map(([k, v]) => `<span class="prop"><b>${escapeHtml(k)}</b>${escapeHtml(v)}</span>`)
    .join("");
  return `<div class="props">${rows}</div>`;
}

function renderBacklinks(backlinks) {
  if (!backlinks || backlinks.length === 0) return "";
  const items = backlinks.map((b) => `<li><a href="/api/notes/view?path=${encodeURIComponent(b.path)}" class="wikilink" data-path="${escapeHtml(b.path)}">${escapeHtml(b.title)}</a></li>`).join("");
  return `<div class="backlinks"><h2>Linked from</h2><ul>${items}</ul></div>`;
}

export async function openNote(path) {
  els.viewer.innerHTML = `<p class="muted">Loading…</p>`;
  const res = await api("GET", `/api/notes/view?path=${encodeURIComponent(path)}`);
  if (res.status === 413) {
    els.viewer.innerHTML = `<p>This file is too large to preview. <a href="/api/notes/raw?path=${encodeURIComponent(path)}">Open the raw file</a>.</p>`;
    return;
  }
  if (res.status === 403) {
    els.viewer.innerHTML = `<p>That note is outside your folders.</p>`;
    return;
  }
  if (res.status === 404) {
    els.viewer.innerHTML = `<p>Note not found.</p>`;
    return;
  }
  if (!res.ok) {
    els.viewer.innerHTML = `<p>Could not load that note.</p>`;
    return;
  }
  const note = await res.json();
  const safeHtml = sanitizeUrls(note.html);
  els.viewer.innerHTML = `<h1>${escapeHtml(note.title)}</h1>${renderProps(note.frontmatter)}<div class="note-body">${safeHtml}</div>${renderBacklinks(note.backlinks)}`;
}

function renderSearchResults(rows) {
  if (rows.length === 0) { els.searchResults.innerHTML = `<p class="muted">No matches.</p>`; return; }
  els.searchResults.innerHTML = rows.map((r) =>
    `<div class="search-row"><a href="/api/notes/view?path=${encodeURIComponent(r.path)}" class="wikilink" data-path="${escapeHtml(r.path)}"><strong>${escapeHtml(r.title)}</strong></a><div class="muted">${escapeHtml(r.snippet)}</div></div>`
  ).join("");
}

export async function search(q) {
  if (!q) { els.searchResults.innerHTML = ""; return; }
  const res = await api("GET", `/api/notes/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) { els.searchResults.innerHTML = `<p class="muted">Search failed.</p>`; return; }
  const rows = await res.json();
  renderSearchResults(rows);
}

let searchTimer = null;
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = els.searchInput.value.trim();
  searchTimer = setTimeout(() => search(q), 250);
});

function pathFromHref(href) {
  try { return new URL(href, location.origin).searchParams.get("path"); } catch { return null; }
}

function qFromHref(href) {
  try { return new URL(href, location.origin).searchParams.get("q"); } catch { return null; }
}

root.addEventListener("click", (e) => {
  const treeLink = e.target.closest('#notes-tree a[data-path]');
  if (treeLink) {
    e.preventDefault();
    openNote(treeLink.dataset.path);
    return;
  }
  const tagLink = e.target.closest("a.tag");
  if (tagLink) {
    e.preventDefault();
    const q = qFromHref(tagLink.getAttribute("href"));
    if (q) { els.searchInput.value = q; search(q); }
    return;
  }
  const searchLink = e.target.closest("#notes-search-results a[data-path]");
  if (searchLink) {
    e.preventDefault();
    openNote(searchLink.dataset.path);
    return;
  }
  const wikilink = e.target.closest('a.wikilink[href^="/api/notes/view"]');
  if (wikilink) {
    e.preventDefault();
    const path = pathFromHref(wikilink.getAttribute("href")) || wikilink.dataset.path;
    if (path) openNote(path);
    return;
  }
});

window.openNoteByTarget = async (target) => {
  window.showNotesTab?.();
  const res = await api("GET", `/api/notes/search?q=${encodeURIComponent(target)}`);
  if (!res.ok) { toast("Note not found or not in your folders"); return; }
  const rows = await res.json();
  const needle = String(target).trim().toLowerCase();
  const match = rows.find((r) => r.title.trim().toLowerCase() === needle);
  if (!match) { toast("Note not found or not in your folders"); return; }
  openNote(match.path);
};

loadTree();
