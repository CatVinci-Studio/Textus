import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// A picture pasted in source mode is stored as one pasted in the rich
// editor is, and written as Markdown at the caret; Undo takes it back.

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const source = '[data-active-tab="true"] textarea.source-view';

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
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
  const textarea = page.locator(source);
  await expect(textarea).toBeVisible();
  await textarea.evaluate((el: HTMLTextAreaElement, png) => {
    el.focus();
    el.setSelectionRange(7, 7);
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, PNG);
  await expect(textarea).toHaveValue(
    /^Before !\[\]\(<assets\/shot 1\.png>\)after\.\s*$/,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(textarea).toHaveValue(/^Before after\.\s*$/);
});
