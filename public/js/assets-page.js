// Business Assets full-page browser (public/assets.html).
//
// Ported in structure from Robonuggets/agentic-os/assets.html's own <script>
// block (category nav / search / doc grid / drag-drop upload / preview
// overlay), wired to this project's real routes (src/routes/assets-routes.js,
// Task 6) instead of the kit's:
//   - GET  /api/assets                 (same shape: {dir, maxFavorites,
//                                        categories, files, favorites})
//   - POST /api/assets/favorite        (same body: {id, on})
//   - POST /api/assets/upload?category=&name=  (same: raw body, one file)
//   - GET  /assets/file/:id[?download] (same)
// Two deliberate drops, both YAGNI -- no equivalent route exists in this
// project for either:
//   - the kit's "OPEN" button POSTed to /api/assets/open (reveal a local
//     path in Finder/Explorer); here OPEN is just a link to
//     /assets/file/:id, same as the assets-widget.js favorites list.
//   - the kit's "FOLDER" header button (same /api/open reveal action).
import { api, escapeHtml, toast } from "/static/js/api.js";

const $ = (s) => document.querySelector(s);
let DATA = { categories: [], files: [], favorites: [], maxFavorites: 4, dir: "" };
let view = "all"; // "all" | "fav" | a category name
let q = "";

const KIND = (ext) => (/^pdf$/.test(ext) ? "pdf" : /^(png|jpe?g|gif|webp|heic)$/.test(ext) ? "img"
  : /^(xlsx?|csv)$/.test(ext) ? "xls" : /^(docx?|pages)$/.test(ext) ? "doc" : "txt");
const PREVIEWABLE = (ext) => /^(pdf|png|jpe?g|gif|webp|txt|md|csv|html)$/.test(ext);
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

async function load() {
  const res = await api("GET", "/api/assets");
  if (!res.ok) {
    $("#assets-grid").innerHTML = "";
    $("#assets-empty").hidden = false;
    $("#assets-empty").innerHTML = res.status === 403
      ? "<b>Business Assets isn't turned on for your account.</b>"
      : "<b>Could not load Business Assets.</b>";
    return;
  }
  DATA = await res.json();
  render();
}

function render() {
  const favN = DATA.files.filter((f) => f.favorite).length;
  const nav = $("#assets-cats");
  nav.innerHTML = `<div class="lbl">Library</div>`
    + `<button data-v="all" class="${view === "all" ? "on" : ""}">All documents<span class="n">${DATA.files.length}</span></button>`
    + `<button data-v="fav" class="${view === "fav" ? "on" : ""}"><span class="star">&#9733;</span>Favorites<span class="n">${favN}/${DATA.maxFavorites}</span></button>`
    + `<div class="lbl" style="margin-top:14px">Categories</div>`
    + DATA.categories.map((c) => `<button data-v="${escapeHtml(c.name)}" class="${view === c.name ? "on" : ""}">${escapeHtml(c.name)}<span class="n">${c.count}</span></button>`).join("");
  nav.querySelectorAll("button").forEach((b) => { b.onclick = () => { view = b.dataset.v; render(); }; });

  let list = DATA.files;
  if (view === "fav") list = list.filter((f) => f.favorite);
  else if (view !== "all") list = list.filter((f) => f.category === view);
  if (q) list = list.filter((f) => (f.name + " " + f.category).toLowerCase().includes(q));

  $("#assets-sec-title").textContent = view === "all" ? "All documents" : view === "fav" ? "Favorites" : view;
  $("#assets-sec-count").textContent = `${list.length} DOCUMENT${list.length === 1 ? "" : "S"}`;

  const grid = $("#assets-grid"), empty = $("#assets-empty");
  grid.innerHTML = list.map((f) => `
    <div class="doc" data-id="${escapeHtml(f.id)}">
      <div class="top">
        <div class="ic ${KIND(f.ext)}">${escapeHtml((f.ext || "file").slice(0, 4).toUpperCase())}</div>
        <div><div class="nm">${escapeHtml(f.name)}</div><div class="cat">${escapeHtml(f.category)}</div></div>
        <button class="fav ${f.favorite ? "on" : ""}" type="button" title="${f.favorite ? "Remove from the dashboard widget" : "Pin to the dashboard widget"}">${f.favorite ? "&#9733;" : "&#9734;"}</button>
      </div>
      <div class="meta">${fmtSize(f.size)} &middot; ${fmtDate(f.modified)}</div>
      <div class="acts">
        <a class="btn solid" href="/assets/file/${encodeURIComponent(f.id)}" target="_blank">Open</a>
        ${PREVIEWABLE(f.ext) ? `<button class="btn act-prev" type="button">Preview</button>` : ""}
        <a class="btn" href="/assets/file/${encodeURIComponent(f.id)}?download" title="Download a copy">&darr;</a>
      </div>
    </div>`).join("");
  empty.hidden = list.length !== 0;
  empty.innerHTML = DATA.files.length === 0
    ? `<b>No documents yet.</b><br>Drop files anywhere on this page, use Upload, or add them to<br><code>${escapeHtml(DATA.dir || "")}</code>.`
    : q ? `Nothing matches <b>${escapeHtml(q)}</b>.`
    : `<b>Nothing here yet.</b><br>${view === "fav" ? "Star a document (&#9734;) to pin it to the dashboard widget." : "Drop files here or use Upload."}`;

  grid.querySelectorAll(".doc").forEach((el) => {
    const f = DATA.files.find((x) => x.id === el.dataset.id);
    el.querySelector(".fav").onclick = () => toggleFav(f);
    const pv = el.querySelector(".act-prev");
    if (pv) pv.onclick = () => preview(f);
  });
}

async function toggleFav(f) {
  const res = await api("POST", "/api/assets/favorite", { id: f.id, on: !f.favorite });
  const j = await res.json();
  if (!res.ok) { toast(j.error || "could not update"); return; }
  toast(f.favorite ? "Removed from widget" : "Pinned to dashboard");
  load();
}

function preview(f) {
  $("#assets-preview-name").textContent = f.name;
  $("#assets-preview-frame").src = `/assets/file/${encodeURIComponent(f.id)}`;
  $("#assets-preview-open").href = `/assets/file/${encodeURIComponent(f.id)}`;
  $("#assets-preview-dl").href = `/assets/file/${encodeURIComponent(f.id)}?download`;
  $("#assets-preview-ov").hidden = false;
}
$("#assets-preview-close").onclick = () => { $("#assets-preview-ov").hidden = true; $("#assets-preview-frame").src = "about:blank"; };

/* ---- upload: button or drag-and-drop anywhere on the page ---- */
let pending = [];
const MAX_UPLOAD = 50 * 1024 * 1024;
function askUpload(files) {
  pending = [...files].filter((f) => f.size <= MAX_UPLOAD);
  if (!pending.length) { toast("no files (50 MB max each)"); return; }
  const sel = $("#assets-upload-cat");
  sel.innerHTML = DATA.categories.filter((c) => c.name !== "Uncategorized")
    .map((c) => `<option ${c.name === view ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  $("#assets-upload-files").innerHTML = pending.map((f) => `${escapeHtml(f.name)} <span style="color:var(--muted)">&middot; ${fmtSize(f.size)}</span>`).join("<br>");
  $("#assets-upload-ov").hidden = false;
}
$("#assets-upload-btn").onclick = () => $("#assets-file-input").click();
$("#assets-file-input").onchange = (e) => { askUpload(e.target.files); e.target.value = ""; };
$("#assets-upload-cancel").onclick = () => { $("#assets-upload-ov").hidden = true; };
$("#assets-upload-go").onclick = async () => {
  const cat = $("#assets-upload-cat").value;
  $("#assets-upload-ov").hidden = true;
  let ok = 0;
  for (const f of pending) {
    try {
      const res = await fetch(`/api/assets/upload?category=${encodeURIComponent(cat)}&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      if (res.ok) ok++; else toast((await res.json()).error || "upload failed");
    } catch { toast("upload failed"); }
  }
  toast(`${ok} of ${pending.length} uploaded`);
  pending = [];
  load();
};

let dragN = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); dragN++; document.body.classList.add("dragging"); });
addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragN <= 0) { dragN = 0; document.body.classList.remove("dragging"); } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragN = 0; document.body.classList.remove("dragging");
  if (e.dataTransfer.files.length) askUpload(e.dataTransfer.files);
});

$("#assets-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });
addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.closest("input,textarea,select")) { e.preventDefault(); $("#assets-q").focus(); }
  if (e.key === "Escape") { $("#assets-preview-close").click(); $("#assets-upload-ov").hidden = true; }
});

load();
setInterval(load, 60000); // pick up files added on disk directly
