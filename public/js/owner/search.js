export function mountSearch(root, getArtifacts) {
  const bar = document.createElement("div");
  bar.id = "searchBar";
  bar.innerHTML = `<input id="searchIn" placeholder="Search artifacts…" /><div id="searchN"></div>`;
  root.appendChild(bar);
  const input = bar.querySelector("#searchIn");
  const results = bar.querySelector("#searchN");

  function open() {
    document.body.classList.add("searchopen");
    input.value = "";
    input.focus();
    apply("");
  }
  function close() {
    document.body.classList.remove("searchopen");
  }
  function apply(q) {
    const list = getArtifacts().filter((a) => (a.title + " " + a.note).toLowerCase().includes(q.toLowerCase()));
    results.innerHTML = list.map((a) => `<a href="${a.url}" target="_blank">${a.title}</a>`).join("");
  }
  input.addEventListener("input", () => apply(input.value));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); open(); }
    if (e.key === "Escape") close();
  });
  document.getElementById("searchBtn")?.addEventListener("click", open);
}
