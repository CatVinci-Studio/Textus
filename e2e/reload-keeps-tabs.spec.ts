import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// A reloaded page (an error screen's Reload, a refresh) is handed none of
// the launch-time documents again: the window brings back its own tabs.

const editor = '[data-active-tab="true"] .ProseMirror';

test("a reload brings back an unsaved draft's text", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await page.keyboard.type("A long piece, written before the reload.");
  await expect(page.locator(editor)).toContainText("before the reload");
  await page.reload();
  await expect(page.locator(editor)).toContainText(
    "A long piece, written before the reload.",
  );
});

test("a reload brings back every tab, unsaved edits and all", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__devFiles = {
      "/notes/a.md": "# First\n\nOn disk.",
      "/notes/b.md": "# Second\n\nAlso on disk.",
    };
  });
  await openApp(page, { settings: { language: "en", newDocumentMode: "tab" } });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      }
    ).__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/notes/a.md", "/notes/b.md"],
      position: { x: 0, y: 0 },
    }),
  );
  await expect(page.locator(".tab-pill-title")).toHaveText(["a.md", "b.md"]);
  await page.locator(".tab-pill-title", { hasText: "b.md" }).click();
  await page.locator(editor).getByText("Also on disk.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" And edited.");

  await page.reload();
  await expect(page.locator(".tab-pill-title")).toHaveText(["a.md", "b.md"]);
  await expect(page.locator(editor)).toContainText("Also on disk. And edited.");
  await page.locator(".tab-pill-title", { hasText: "a.md" }).click();
  await expect(page.locator(editor)).toContainText("On disk.");
});
