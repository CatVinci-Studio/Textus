import { expect, test } from "@playwright/test";
import { MAC, openApp, PHONE, sourceOf } from "./helpers";
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

test("a heading folds its section away, keeps the text, and opens for a caret", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/f.md":
        "# One\n\nfirst body\n\n## Inner\n\ninner body\n\n# Two\n\nsecond body\n",
    };
  });
  await openApp(page);
  await openPath(page, "/work/f.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(doc).toContainText("second body");
  await doc.locator("h1", { hasText: "One" }).hover();
  await doc.locator("h1", { hasText: "One" }).locator(".heading-fold").click();
  // Everything under One, up to Two, is gone; Two's section stays.
  await expect(doc.getByText("first body")).toBeHidden();
  await expect(doc.getByText("inner body")).toBeHidden();
  await expect(doc.getByText("second body")).toBeVisible();
  // Only the drawing changed: the text is the same.
  expect(await sourceOf(page)).toBe(
    "# One\n\nfirst body\n\n## Inner\n\ninner body\n\n# Two\n\nsecond body",
  );
  // Kept through the editor being made again. Arrows pass it by; a caret
  // sent into it (the outline's heading under it) opens it.
  await expect(doc.getByText("first body")).toBeHidden();
  await page.locator('[data-rail-id="outline"]').click();
  await page.locator(".outline-row", { hasText: "Inner" }).click();
  await expect(doc.getByText("first body")).toBeVisible();
  await expect(doc.getByText("inner body")).toBeVisible();
  // From the keyboard: the caret's section (Inner, from the outline's
  // jump) folds and opens.
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft",
  );
  await expect(doc.getByText("inner body")).toBeHidden();
  await expect(doc.getByText("first body")).toBeVisible();
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketRight" : "Control+Shift+BracketRight",
  );
  await expect(doc.getByText("inner body")).toBeVisible();
});
