import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// File > Open Folder… and the sidebar's file-name search (#152, #79, #196).
// The folder pins the tree's root; without one, opening a file deeper in
// the tree no longer re-roots it there. The dev shim's in-memory folder
// (window.__devFs) stands in for the disk.

const FILES: Record<string, string> = {
  "/work/notes/a.md": "# Alpha",
  "/work/notes/novel/ch1.md": "# Chapter one",
  "/work/notes/novel/ch2.md": "# Chapter two",
  "/work/notes/novel/ch10.md": "# Chapter ten",
  "/work/notes/images/chart.png": "not really a picture",
  "/work/notes/essays/第一章 草稿.md": "# 草稿",
  "/work/notes/.hidden/secret.md": "# Hidden",
  "/work/elsewhere/c.md": "# Elsewhere",
};

const editor = '[data-active-tab="true"] .ProseMirror';
const rootLabel = ".sidebar .tree-root-label";

async function open(
  page: Page,
  options: { storage?: Record<string, string>; settings?: object } = {},
) {
  await page.addInitScript((files) => {
    (window as unknown as { __devFs: unknown }).__devFs = files;
  }, FILES);
  await openApp(page, {
    settings: { language: "en", ...options.settings },
    storage: options.storage,
  });
}

function emit(page: Page, event: string, payload?: unknown) {
  return page.evaluate(
    ([name, value]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, value),
    [event, payload] as const,
  );
}

/** Opens a file in a new tab, as the AI panel's project bar does. */
function openInTab(page: Page, path: string) {
  return page.evaluate(
    (p) =>
      window.dispatchEvent(
        new CustomEvent("textus:open-file-in-tab", { detail: p }),
      ),
    path,
  );
}

async function openFolderFromMenu(page: Page, folder: string) {
  await page.evaluate((f) => {
    (window as unknown as { __devPickFolder: string }).__devPickFolder = f;
  }, folder);
  await emit(page, "menu-open-folder");
}

function treeRow(page: Page, name: string) {
  return page.locator(".sidebar .tree-main .tree-row", { hasText: name });
}

test("opening a file in a subfolder keeps the tree where it was", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-open-recent", "/work/notes/a.md");
  await expect(page.locator(`${editor} h1`)).toContainText("Alpha");
  await emit(page, "menu-toggle-sidebar");
  await expect(page.locator(rootLabel)).toHaveText("notes");
  await treeRow(page, "essays").click();
  await expect(treeRow(page, "第一章 草稿.md")).toBeVisible();
  await treeRow(page, "novel").click();
  await treeRow(page, "ch1.md").click();
  await expect(page.locator(`${editor} h1`)).toContainText("Chapter one");
  // Still rooted at notes, with both folders still open.
  await expect(page.locator(rootLabel)).toHaveText("notes");
  await expect(treeRow(page, "a.md")).toBeVisible();
  await expect(treeRow(page, "第一章 草稿.md")).toBeVisible();
  // A document outside the tree moves it.
  await openInTab(page, "/work/elsewhere/c.md");
  await expect(page.locator(rootLabel)).toHaveText("elsewhere");
});

test("Open Folder pins the tree's root and lists the folder as recent", async ({
  page,
}) => {
  await open(page);
  await openFolderFromMenu(page, "/work/notes");
  // The sidebar comes up on its Files tab, at the folder.
  await expect(page.locator(rootLabel)).toHaveText("notes");
  await expect(treeRow(page, "a.md")).toBeVisible();
  await expect(treeRow(page, "secret.md")).toHaveCount(0);
  await openInTab(page, "/work/elsewhere/c.md");
  await expect(page.locator(`${editor} h1`)).toContainText("Elsewhere");
  await expect(page.locator(rootLabel)).toHaveText("notes");
  // Up stops at the folder: it is the edge of what was opened.
  await expect(
    page.getByRole("button", { name: "Parent folder" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("textus-open-folder")),
  ).toBe(JSON.stringify("/work/notes"));
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __devRecents: { folders: string[] } })
          .__devRecents.folders,
    ),
  ).toEqual(["/work/notes"]);
});

test("Close Folder goes back to following the document", async ({ page }) => {
  await open(page);
  await openFolderFromMenu(page, "/work/notes");
  await openInTab(page, "/work/elsewhere/c.md");
  await expect(page.locator(rootLabel)).toHaveText("notes");
  await page.getByRole("button", { name: "Close Folder" }).click();
  await expect(page.locator(rootLabel)).toHaveText("elsewhere");
  await expect(page.getByRole("button", { name: "Close Folder" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => localStorage.getItem("textus-open-folder")),
  ).toBe("null");
});

test("a recent folder opens from File > Open Recent", async ({ page }) => {
  await open(page);
  await emit(page, "menu-open-recent-folder", "/work/notes");
  await expect(page.locator(rootLabel)).toHaveText("notes");
  await expect(
    page.getByRole("button", { name: "Close Folder" }),
  ).toBeVisible();
});

test("the folder comes back with the session", async ({ page }) => {
  await open(page, {
    storage: {
      "textus-open-folder": JSON.stringify("/work/notes"),
      "textus-sidebar-open": "1",
    },
  });
  await expect(page.locator(rootLabel)).toHaveText("notes");
  await expect(
    page.getByRole("button", { name: "Close Folder" }),
  ).toBeVisible();
});

test("the home folder is refused with a reason", async ({ page }) => {
  await open(page);
  await openFolderFromMenu(page, "TOO_BROAD");
  await expect(
    page.getByText("This folder is too broad to open"),
  ).toBeVisible();
});

test("an empty window offers Open Folder in the sidebar", async ({ page }) => {
  await open(page);
  await emit(page, "menu-toggle-sidebar");
  await page.evaluate(() => {
    (window as unknown as { __devPickFolder: string }).__devPickFolder =
      "/work/notes";
  });
  await page
    .locator(".sidebar-body")
    .getByRole("button", { name: "Open Folder…" })
    .click();
  await expect(page.locator(rootLabel)).toHaveText("notes");
});

test("the empty window's Open Folder stays clear of the sidebar's border", async ({
  page,
}) => {
  // The narrowest sidebar, the largest interface text and a long label.
  await open(page, {
    settings: { language: "fr", uiTextScale: 1.25 },
    storage: { "textus-sidebar-width": "180" },
  });
  await emit(page, "menu-toggle-sidebar");
  const button = page
    .locator(".sidebar-body")
    .getByRole("button", { name: "Ouvrir un dossier…" });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width - 12);
  expect(
    await page
      .locator(".sidebar-body")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test.describe("the AI's project folder", () => {
  const agentRoot = (page: Page) =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
          .agentWorkspaceRoot,
    );

  test("follows an opened folder while it has none of its own", async ({
    page,
  }) => {
    await open(page);
    await openFolderFromMenu(page, "/work/notes");
    await expect.poll(() => agentRoot(page)).toBe("/work/notes");
    await page.getByRole("button", { name: "Close Folder" }).click();
    await expect.poll(() => agentRoot(page)).toBe("");
  });

  test("keeps a folder the user chose", async ({ page }) => {
    await open(page, { settings: { agentWorkspaceRoot: "/research" } });
    await openFolderFromMenu(page, "/work/notes");
    await expect(page.locator(rootLabel)).toHaveText("notes");
    expect(await agentRoot(page)).toBe("/research");
  });
});

test.describe("file name search", () => {
  const search = (page: Page) =>
    page.getByRole("searchbox", { name: "Search file names" });
  const results = (page: Page) =>
    page.locator(".file-search-results [role=option]");

  test("the shortcut opens the Files tab with the box focused", async ({
    page,
  }) => {
    await open(page);
    await openFolderFromMenu(page, "/work/notes");
    await emit(page, "menu-toggle-sidebar");
    await expect(page.locator(".sidebar-collapsed")).toHaveCount(1);
    await page.locator(editor).click();
    await page.keyboard.press("ControlOrMeta+Shift+O");
    await expect(search(page)).toBeFocused();
  });

  test("filters across the folder, opens with Enter and clears with Esc", async ({
    page,
  }) => {
    await open(page);
    await openFolderFromMenu(page, "/work/notes");
    // From the editor, where a writer is when they reach for it.
    await page.locator(editor).click();
    await page.keyboard.press("ControlOrMeta+Shift+O");
    await expect(search(page)).toBeFocused();
    await page.keyboard.type("CH");
    // Documents first, numbers in order, then the other files.
    await expect(results(page).locator(".tree-label")).toHaveText([
      "ch1.md",
      "ch2.md",
      "ch10.md",
      "chart.png",
    ]);
    await expect(results(page).first()).toContainText("novel");
    // The tree is hidden behind the results, not gone.
    await expect(page.locator(".tree-main")).toBeHidden();
    await page.keyboard.press("ArrowDown");
    await expect(results(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator(`${editor} h1`)).toContainText("Chapter two");
    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("");
    await expect(page.locator(".tree-main")).toBeVisible();
    await expect(page.locator(editor)).toBeFocused();
  });

  test("the filter keeps to documents, and is remembered", async ({ page }) => {
    await open(page);
    await openFolderFromMenu(page, "/work/notes");
    await search(page).fill("ch");
    await expect(results(page)).toHaveCount(4);
    await page.getByRole("combobox", { name: "Show" }).click();
    await page
      .getByRole("option", { name: "Documents only", exact: true })
      .click();
    await expect(results(page)).toHaveCount(3);
    await expect(results(page).filter({ hasText: "chart.png" })).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("textus-file-search-scope"),
      ),
    ).toBe("documents");
  });

  test("opens another kind of file the way the tree does", async ({ page }) => {
    await open(page);
    await openFolderFromMenu(page, "/work/notes");
    await search(page).fill("chart");
    await results(page).first().click();
    await expect(page.locator(".window-bar-title-text")).toHaveText(
      "chart.png",
    );
    await expect(page.locator(editor)).toContainText("not really a picture");
  });

  test("the tree lists numbered names by their numbers", async ({ page }) => {
    await open(page);
    await openFolderFromMenu(page, "/work/notes");
    await treeRow(page, "novel").click();
    await expect(
      page.locator(".sidebar .tree-main .tree-row .tree-label"),
    ).toHaveText([
      "essays",
      "images",
      "novel",
      "ch1.md",
      "ch2.md",
      "ch10.md",
      "a.md",
    ]);
  });

  test("finds Chinese names and says when nothing matches", async ({
    page,
  }) => {
    await open(page);
    await openFolderFromMenu(page, "/work/notes");
    await search(page).click();
    await search(page).fill("草稿");
    await expect(results(page)).toHaveText(["第一章 草稿.mdessays"]);
    await search(page).fill("secret");
    await expect(page.locator(".file-search-note")).toHaveText(
      "No file names match.",
    );
  });
});
