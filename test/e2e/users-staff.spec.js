// Real-browser check of the "Staff chat on their own computers" section on /users.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { bootAsOwner } from "../helpers/boot.js";

test("/users shows the staff chat address, QR and downloads; the Windows button downloads the .url file", async ({ page }) => {
  const b = await bootAsOwner({ lanImpl: () => ["192.168.1.20", "10.0.0.5"], port: 50001 });
  const errors = [];
  try {
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${b.url}/login`);
    await page.fill("input[name=username]", b.username);
    await page.fill("input[name=password]", b.password);
    await Promise.all([page.waitForURL(/\/owner$/), page.click("button[type=submit]")]);
    await page.goto(`${b.url}/users`);
    const section = page.locator("#staff-chat");
    await expect(section.locator("h2")).toHaveText("Staff chat on their own computers");
    await expect(section.locator("#staff-url")).toHaveText("http://192.168.1.20:50001/employee");
    await expect(section.locator("#staff-qr svg")).toBeVisible();
    await expect(section.locator("#staff-advice")).toContainText("DHCP reservation");
    await expect(section.locator("#staff-signin-note")).toContainText("only the folders you tick");
    const [download] = await Promise.all([page.waitForEvent("download"), section.locator("#staff-dl-win").click()]);
    expect(download.suggestedFilename()).toBe("Blueprint OS Staff Chat.url");
    const text = readFileSync(await download.path(), "utf8");
    expect(text).toMatch(/^\[InternetShortcut\]\r\nURL=http:\/\/192\.168\.1\.20:50001\/employee\r\nIconIndex=0\r\n$/);
    expect(errors).toEqual([]);
  } finally { b.cleanup(); }
});
