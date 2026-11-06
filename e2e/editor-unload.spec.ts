import { expect, test, type Page } from "@playwright/test";
import { END, openApp } from "./helpers";

// A document's editor out of sight ten minutes is let go, to give back its
// memory; shown again it opens at its text, its undo history kept.

const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";

async function openFile(page: Page, name: string, text: string) {
  await page.evaluate(
    ([path, text]) => {
      const w = window as unknown as Record<string, unknown> & {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = {
        ...(w.__devFiles as Record<string, string> | undefined),
        [path]: text,
      };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
    },
    [`/notes/${name}`, text],
  );
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText(text);
}

const editorOf = (page: Page, name: string) =>
  page.locator(`[data-tab-id]:has(.ProseMirror) .ProseMirror`, {
    hasText: name,
  });

test("a tab out of sight ten minutes lets its editor go and comes back with its undo history", async ({
  page,
}) => {
  await page.clock.install();
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await openFile(page, "a.md", "Alpha");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.press(END);
  await page.keyboard.type(" one");
  await expect(editor).toHaveText("Alpha one");
  await page.keyboard.press("ControlOrMeta+s");
  await page.clock.runFor(1000);
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);

  await openFile(page, "b.md", "Beta");
  await page.clock.runFor(9 * 60_000);
  await expect(editorOf(page, "Alpha one")).toHaveCount(1);
  await page.clock.runFor(2 * 60_000);
  await expect(editorOf(page, "Alpha one")).toHaveCount(0);

  await page.locator(".tab-pill-title", { hasText: "a.md" }).click();
  await page.clock.runFor(1000);
  await expect(editor).toHaveText("Alpha one");
  // Its history given back changes nothing: it is still saved.
  await page.clock.runFor(3000);
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await editor.click();
  await page.keyboard.press(UNDO);
  await expect(editor).toHaveText("Alpha");
});
