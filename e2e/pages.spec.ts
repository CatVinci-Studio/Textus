import { expect, test, type Page } from "@playwright/test";
import {
  dragWithMouse,
  emit,
  selectionRead,
  swallowHtmlDrop,
  END,
} from "./helpers";
import {
  hasPlugin,
  openPath,
  openSidebarList,
  openWithPlugins,
} from "./plugin-helpers";

// Workspace's pages: the folder as a tree of pages, sub-pages made from the
// / menu beside their page, pages dragged onto others, and the pages above
// the one in front.

const ID = "catvinci.database";
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
      [ID]: [
        "files.read",
        "files.write",
        "editor.read",
        "editor.write",
        "ai.tools",
      ],
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
  await page.keyboard.press(END);
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

test("a page dragged onto another becomes its sub-page", async ({ page }) => {
  await swallowHtmlDrop(page);
  await open(page);
  await openPath(page, "/notes/Inbox.md");
  const pages = await openSidebarList(page, "Pages");
  const rows = pages.locator(".plugin-list-row");
  await dragWithMouse(
    page,
    rows.filter({ hasText: "Inbox" }),
    rows.filter({ hasText: "Life" }),
  );
  await expect
    .poll(() => fileText(page, "/notes/Life/Inbox.md"))
    .toBe("# Inbox\n");
  await expect(rows).toHaveText(["☀️ Life"]);
});

test("a row is lit while the pointer is on it, not after it leaves", async ({
  page,
}) => {
  await open(page);
  await openPath(page, "/notes/Inbox.md");
  const pages = await openSidebarList(page, "Pages");
  const life = pages.locator(".plugin-list-row").filter({ hasText: "Life" });
  const lit = () => life.evaluate((el) => getComputedStyle(el).backgroundColor);
  const plain = await lit();
  await life.hover();
  await expect.poll(lit).not.toBe(plain);
  await page.mouse.move(600, 400);
  await expect.poll(lit).toBe(plain);
});

test("a page made a folder for its first sub-page keeps its unsaved words, its tab following it", async ({
  page,
}) => {
  await open(page);
  await openPath(page, "/notes/Inbox.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.getByText("Inbox").click();
  await selectionRead(page);
  await page.keyboard.press(END);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Not saved yet.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/page");
  await page
    .locator(".completion-list")
    .getByText("New Sub-page…", { exact: true })
    .click();
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("textbox").fill("Idea");
  await dialog.getByRole("textbox").press("Enter");
  await expect
    .poll(() => fileText(page, "/notes/Inbox/Idea.md"))
    .toBe("# Idea\n");
  await expect
    .poll(() => fileText(page, "/notes/Inbox/Inbox.md"))
    .toContain("Not saved yet.");
  expect(await fileText(page, "/notes/Inbox.md")).toBeUndefined();
  // Its tab is the moved page's: what is typed there next is saved there.
  await page.getByRole("tab", { name: "Inbox.md" }).click();
  await expect(editor).toContainText("Not saved yet.");
  // The link to the sub-page from where the page is now.
  await expect(
    editor.locator("a, .wikilink").filter({ hasText: "Idea" }),
  ).toHaveCount(1);
  await emit(page, "menu-save-file");
  await expect
    .poll(() => fileText(page, "/notes/Inbox/Inbox.md"))
    .toMatch(/\[Idea\]\(Idea\.md\)|\[\[Idea\]\]/);
  await editor.getByText("Not saved yet.").click();
  await page.keyboard.press(END);
  await page.keyboard.type(" Now it is.");
  await emit(page, "menu-save-file");
  await expect
    .poll(() => fileText(page, "/notes/Inbox/Inbox.md"))
    .toContain("Now it is.");
  expect(await fileText(page, "/notes/Inbox.md")).toBeUndefined();
});
