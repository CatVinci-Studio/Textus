import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";
import { openPath } from "./plugin-helpers";

// `![[...]]` while the caret is away: a picture drawn in place of its source.
test("an image embed shows as its picture, its source hidden", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/a.md": "Before\n\n![[pic.png]]\n\nAfter\n",
      "/work/pic.png": "",
    };
  });
  await openApp(page);
  await openPath(page, "/work/a.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(doc).toContainText("After");
  await expect(doc.locator(".obsidian-embed-source-hidden")).toHaveCount(1);
  await expect(
    doc.locator(".obsidian-embed-rendered, .missing-image").first(),
  ).toBeAttached();
});
