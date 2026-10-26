import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

const editor = '[data-active-tab="true"] .ProseMirror';
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function imageAlign(page: import("@playwright/test").Page) {
  await pasteMarkdown(page, `Before\n\n![dot](${PIXEL})\n\nAfter`);
  const paragraph = page.locator(`${editor} p.image-paragraph`);
  await expect(paragraph).toHaveCount(1);
  return paragraph.evaluate((p) => getComputedStyle(p).textAlign);
}

test("an image on its own line is centered by default", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  expect(await imageAlign(page)).toBe("center");
});

test("the setting puts it on the left", async ({ page }) => {
  await openApp(page, { settings: { language: "en", imageAlign: "left" } });
  expect(await imageAlign(page)).toBe("left");
});
