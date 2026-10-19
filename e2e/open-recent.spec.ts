import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Issue #201: File > Open Recent in a fresh, empty window opened the file
// in a second window. menu.rs now hands the choice to the focused window
// (menu-open-recent), which keeps the file itself when it holds nothing
// and otherwise asks Rust to open it elsewhere (open_paths).

const editor = '[data-active-tab="true"] .ProseMirror';

function openRecent(page: Page, path: string) {
  return page.evaluate(
    (p) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-open-recent", p),
    path,
  );
}

function openPathsCalls(page: Page) {
  return page.evaluate(() =>
    (
      ((window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? []) as { cmd: string; paths?: string[] }[]
    ).filter((call) => call.cmd === "open_paths"),
  );
}

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    read_text_file: "# Recent\n\nOpened from the menu.",
    open_paths: null,
  });
});

test("an empty window opens a recent file in place", async ({ page }) => {
  await openRecent(page, "/home/me/recent.md");
  await expect(page.locator(`${editor} h1`)).toContainText("Recent");
  await expect(page.locator(".ProseMirror")).toHaveCount(1);
  expect(await openPathsCalls(page)).toEqual([]);
});

test("a window with an edited Untitled document opens it elsewhere", async ({
  page,
}) => {
  await page.locator(editor).click();
  await page.keyboard.type("My own draft");
  await openRecent(page, "/home/me/recent.md");
  await expect
    .poll(() => openPathsCalls(page))
    .toEqual([{ cmd: "open_paths", paths: ["/home/me/recent.md"] }]);
  await expect(page.locator(editor)).toContainText("My own draft");
  await expect(page.locator(editor)).not.toContainText("Opened from the menu");
});
