import { expect, test, type Page } from "@playwright/test";
import { selectionRead } from "./helpers";
import {
  hasPlugin,
  openPath,
  openSidebarList,
  openWithPlugins,
} from "./plugin-helpers";

// The Pages plugin: the folder as a tree of pages, sub-pages made from the
// / menu beside their page, and the pages above the one in front.

const ID = "catvinci.pages";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

const FOLDER = {
  "/notes/Inbox.md": "# Inbox\n",
  "/notes/Life.md": "---\nicon: ☀️\n---\n\n# Life\n\nPlans for the year.\n",
  "/notes/Life/2026 Calendar.md": "# 2026 Calendar\n",
  "/notes/Life/2026 Calendar/Week1.md": "# Week 1\n",
};

async function open(page: Page) {
  await openWithPlugins(page, {
    plugins: {
      [ID]: ["files.read", "files.write", "editor.read", "editor.write"],
    },
    folder: FOLDER,
  });
}

const fileText = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[p],
    path,
  );

test("the sidebar shows pages inside pages, and the status bar the pages above", async ({
  page,
}) => {
  await open(page);
  await openPath(page, "/notes/Inbox.md");
  const pages = await openSidebarList(page, "Pages");
  const rows = pages.locator(".plugin-list-row");
  await expect(rows).toHaveText(["Inbox", "☀️ Life"]);
  await pages.getByRole("button", { name: "☀️ Life" }).click();
  await pages.getByRole("button", { name: "2026 Calendar" }).click();
  await expect(rows).toHaveText(["Inbox", "☀️ Life", "2026 Calendar", "Week1"]);
  await rows.filter({ hasText: "Week1" }).click();
  const crumb = page.locator(".window-bar .plugin-status-item");
  await expect(crumb).toHaveText("☀️ Life › 2026 Calendar › Week1");
  // A page at the top has nothing above it.
  await rows.filter({ hasText: "Inbox" }).click();
  await expect(crumb).toHaveCount(0);
});

test("/page makes a sub-page beside its page, links it, and opens it", async ({
  page,
}) => {
  await open(page);
  await openPath(page, "/notes/Life.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("Plans for the year.");
  await editor.getByText("Plans for the year.").click();
  await selectionRead(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/page");
  await page
    .locator(".completion-list")
    .getByText("New Sub-page…", { exact: true })
    .click();
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("textbox").fill("Trip");
  await dialog.getByRole("textbox").press("Enter");
  await expect(
    page.locator(".tab.is-active, [aria-selected=true]").first(),
  ).toContainText("Trip");
  await expect
    .poll(() => fileText(page, "/notes/Life/Trip.md"))
    .toBe("# Trip\n");
  // Back on its page: the link where the caret was.
  await page.getByRole("tab", { name: "Life.md" }).click();
  await expect(editor).toContainText("Plans for the year.");
  await expect(
    editor.locator(".wikilink, a").filter({ hasText: "Trip" }),
  ).toHaveCount(1);
});
