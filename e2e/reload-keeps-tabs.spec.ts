import { expect, test } from "@playwright/test";
import { dropPaths, openApp, END } from "./helpers";

// A reloaded page (an error screen's Reload, a refresh) is handed none of
// the launch-time documents again: the window brings back its own tabs.

const editor = '[data-active-tab="true"] .ProseMirror';

test("a reload brings back every tab, an unsaved draft and unsaved edits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__devFiles = {
      "/notes/a.md": "# First\n\nOn disk.",
      "/notes/b.md": "# Second\n\nAlso on disk.",
    };
  });
  await openApp(page, { settings: { language: "en", newDocumentMode: "tab" } });
  await page.locator(editor).click();
  await page.keyboard.type("A long piece, written before the reload.");
  await dropPaths(page, ["/notes/a.md", "/notes/b.md"]);
  const tabs = page.locator(".tab-pill-title");
  await expect(tabs).toHaveCount(3);
  const names = await tabs.allTextContents();
  await page.locator(".tab-pill-title", { hasText: "b.md" }).click();
  await page.locator(editor).getByText("Also on disk.").click();
  await page.keyboard.press(END);
  await page.keyboard.type(" And edited.");

  await page.reload();
  await expect(tabs).toHaveText(names);
  await expect(page.locator(editor)).toContainText("Also on disk. And edited.");
  await page.locator(".tab-pill-title", { hasText: "a.md" }).click();
  await expect(page.locator(editor)).toContainText("On disk.");
  await tabs.first().click();
  await expect(page.locator(editor)).toContainText(
    "A long piece, written before the reload.",
  );
});
