import { getLayout, saveLayout } from "./layout-client.js";

let layout = await getLayout();

document.getElementById("owner-shop-name").textContent = document.title.replace("Blueprint OS — ", "");
document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});
const themeBtn = document.getElementById("theme-btn");
themeBtn.title = document.documentElement.classList.contains("light") ? "Switch to dark theme" : "Switch to light theme";
themeBtn.addEventListener("click", async () => {
  const next = document.documentElement.classList.toggle("light") ? "light" : "dark";
  layout = await saveLayout({ ...layout, theme: next });
  location.reload(); // full reload, matching the reference kit's own theme-switch mechanic (canvas colors can't live-update)
});

export { layout };
