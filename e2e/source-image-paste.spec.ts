import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown, sourceValue } from "./helpers";

// A picture pasted in source mode is stored as one pasted in the rich
// editor is, and written as Markdown at the caret; Undo takes it back.

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Source mode is CodeMirror: `.cm-content` is the editable node.
const SOURCE = '[data-active-tab="true"] .source-view .cm-content';

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
}

/** A paste carrying `PNG`, as Chromium builds one for a copied screenshot. */
function pastePicture(page: Page, png: string) {
  return page.locator(SOURCE).evaluate((el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
}

test("a picture pasted in source mode is stored and written at the caret", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", imageNamingMode: "auto" },
  });
  await pasteMarkdown(page, "Before after.");
  await mockInvoke(page, { save_pasted_image: { src: "assets/shot 1.png" } });
  await emit(page, "menu-toggle-source-mode");
  const content = page.locator(SOURCE);
  await expect(content).toBeVisible();
  await content.click();
  // The caret goes after "Before ", seven characters in.
  await page.keyboard.press("ControlOrMeta+Home");
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
  await pastePicture(page, PNG);
  await expect
    .poll(() => sourceValue(page))
    .toMatch(/^Before !\[\]\(<assets\/shot 1\.png>\)after\.\s*$/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => sourceValue(page)).toMatch(/^Before after\.\s*$/);
});
