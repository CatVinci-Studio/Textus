import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// View › Read Only: nothing changes the document, a padlock beside the
// title turns it off, and the file is still read-only when opened again.

const editor = '[data-active-tab="true"] .ProseMirror';

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

async function openNote(page: Page) {
  await page.evaluate(
    (files) =>
      ((window as unknown as Record<string, unknown>).__devFiles = files),
    { "/notes/kept.md": "Kept as it is." },
  );
  await emit(page, "tauri://drag-drop", {
    paths: ["/notes/kept.md"],
    position: { x: 0, y: 0 },
  });
  await expect(page.locator(editor)).toHaveText("Kept as it is.");
}

function paste(page: Page, text: string) {
  return page.evaluate(
    ([sel, value]) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      document.querySelector(sel)!.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [editor, text] as const,
  );
}

test("a read-only document takes no change, and its padlock turns it off", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await openNote(page);
  await emit(page, "menu-toggle-read-only");
  const lock = page.getByRole("button", { name: /Read-only/ });
  await expect(lock).toBeVisible();
  await page.locator(editor).click();
  await page.keyboard.type("typed", { delay: 20 });
  // Typing is refused, and the writer hears why.
  await expect(page.locator(".ai-notice")).toContainText("read-only");
  await paste(page, " pasted");
  await expect(page.locator(editor)).toHaveText("Kept as it is.");
  // Selecting and copying still work.
  await page.keyboard.press("ControlOrMeta+a");
  await expect
    .poll(() => page.evaluate(() => String(getSelection())))
    .toContain("Kept as it is.");
  await lock.click();
  await expect(lock).toHaveCount(0);
  await page.locator(editor).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!", { delay: 20 });
  await expect(page.locator(editor)).toContainText("!");
});

test("a file left read-only is read-only when opened again", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await openNote(page);
  await emit(page, "menu-toggle-read-only");
  await expect(page.getByRole("button", { name: /Read-only/ })).toBeVisible();
  await page.reload();
  await page.waitForSelector(editor);
  await openNote(page);
  await expect(page.getByRole("button", { name: /Read-only/ })).toBeVisible();
  await page.locator(editor).click();
  await page.keyboard.type("typed", { delay: 20 });
  await expect(page.locator(editor)).toHaveText("Kept as it is.");
});
