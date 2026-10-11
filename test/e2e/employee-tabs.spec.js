// Real-browser check that /employee shows one tab panel at a time on a wide window. base.css lays #notes-root out as a
// grid at 900px and up, which used to beat the [hidden] attribute, so the notes browser sat under the Chat tab.
import { test, expect } from "@playwright/test";
import { bootAsOwner, STAFF_USERNAME, STAFF_PASSWORD } from "../helpers/boot.js";

test("/employee on a wide window: Chat hides the notes panel, Notes hides the chat panel", async ({ page }) => {
  const b = await bootAsOwner();
  const errors = [];
  try {
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`${b.url}/login`);
    await page.fill("input[name=username]", STAFF_USERNAME);
    await page.fill("input[name=password]", STAFF_PASSWORD);
    await Promise.all([page.waitForURL(/\/employee$/), page.click("button[type=submit]")]);
    await expect(page.locator("#chat-root")).toBeVisible();
    await expect(page.locator("#notes-root")).toBeHidden();
    await page.click('[data-tab="notes"]');
    await expect(page.locator("#notes-root")).toBeVisible();
    await expect(page.locator("#chat-root")).toBeHidden();
    await page.click('[data-tab="chat"]');
    await expect(page.locator("#notes-root")).toBeHidden();
    expect(errors).toEqual([]);
  } finally { b.cleanup(); }
});
