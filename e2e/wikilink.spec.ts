import { expect, test } from "@playwright/test";
import { dropPaths, mockInvoke, openApp } from "./helpers";

// Obsidian wikilinks: Ctrl/Cmd+click opens the vault's note by that name in
// a tab, while a plain click only places the caret.

const editor = '[data-active-tab="true"] .ProseMirror';

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    read_text_file: "See [[Page|the page]] here.\n",
    file_mtime_ms: 1,
    resolve_note_link: { path: "/home/me/notes/Page.md", exists: true },
  });
  await dropPaths(page, ["/home/me/index.md"]);
  await expect(page.locator(`${editor} .wikilink`)).toHaveText(
    "[[Page|the page]]",
  );
});

test("a plain click on a wikilink places the caret; Ctrl/Cmd+click opens the note in a tab", async ({
  page,
}) => {
  const before = await page.locator(".ProseMirror").count();
  await page.locator(`${editor} .wikilink`).click();
  // The caret is in the link, and no tab opened.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!window
            .getSelection()
            ?.anchorNode?.parentElement?.closest(".wikilink"),
      ),
    )
    .toBe(true);
  await expect(page.locator(".ProseMirror")).toHaveCount(before);
  await page
    .locator(`${editor} .wikilink`)
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    /Page/,
  );
  await expect(page.locator(".ProseMirror")).toHaveCount(before + 1);
});
