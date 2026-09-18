import { getLayout, saveLayout } from "./layout-client.js";

let layout = await getLayout();

document.getElementById("owner-shop-name").textContent = document.title.replace("Shop OS — ", "");
document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});
document.getElementById("theme-btn").addEventListener("click", async () => {
  const next = document.documentElement.classList.toggle("light") ? "light" : "dark";
  layout = await saveLayout({ ...layout, theme: next });
  location.reload(); // full reload, matching the reference kit's own theme-switch mechanic (canvas colors can't live-update)
});

export { layout };
