import { expect, test } from "@playwright/test";
import { openApp, PHONE } from "./helpers";
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

// `[TOC]` lists the document's headings, on the desktop and on a phone.
for (const phone of [false, true]) {
  test.describe(phone ? "on a phone" : "on the desktop", () => {
    if (phone) test.use(PHONE);
    test("[TOC] lists the headings", async ({ page }) => {
      await page.addInitScript(() => {
        (
          window as unknown as { __devFiles: Record<string, string> }
        ).__devFiles = {
          "/work/toc.md": "# Title\n\n[TOC]\n\n## One\n\nText\n\n## Two\n",
        };
      });
      await openApp(page);
      await openPath(page, "/work/toc.md");
      const toc = page.locator('[data-active-tab="true"] .ProseMirror .md-toc');
      await expect(toc.locator(".md-toc-item")).toHaveText([
        "Title",
        "One",
        "Two",
      ]);
    });
  });
}
