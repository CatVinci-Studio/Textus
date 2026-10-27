import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// File > Reopen Closed Tab (Cmd/Ctrl+Shift+T): the documents closed in the
// window come back, the latest first.

const tabs = '.tab-bar [role="tab"]';

function drop(page: Page, path: string, text: string) {
  return page.evaluate(
    ({ path, text }) => {
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
    { path, text },
  );
}

function emit(page: Page, name: string) {
  return page.evaluate(
    (name) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(name, null),
    name,
  );
}

test("closed tabs reopen, the latest first", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await drop(page, "/notes/one.md", "# One");
  await drop(page, "/notes/two.md", "# Two");
  await drop(page, "/notes/three.md", "# Three");
  // Beside the blank document the window opened with.
  await expect(page.locator(tabs)).toHaveCount(4);
  await emit(page, "menu-close-tab");
  await page.locator(tabs, { hasText: "one.md" }).click();
  await emit(page, "menu-close-tab");
  await expect(page.locator(tabs)).toHaveCount(2);

  await emit(page, "menu-reopen-closed-tab");
  await expect(page.locator(tabs)).toHaveCount(3);
  await expect(page.locator(`${tabs}[aria-selected="true"]`)).toContainText(
    "one.md",
  );
  await emit(page, "menu-reopen-closed-tab");
  await expect(page.locator(`${tabs}[aria-selected="true"]`)).toContainText(
    "three.md",
  );
  // Nothing left closed: nothing happens.
  await emit(page, "menu-reopen-closed-tab");
  await expect(page.locator(tabs)).toHaveCount(4);
});
