import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

test("the window bar counts one word as a word", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Hello");
  await expect(page.locator(".window-bar")).toContainText("1 word");
  await expect(page.locator(".window-bar")).not.toContainText("1 words");
  await page.keyboard.press("End");
  await page.keyboard.type(" there");
  await expect(page.locator(".window-bar")).toContainText("2 words");
});
