import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Closing tabs as a browser does: a middle click, and the tab menu's
// Close Others and Close Tabs to the Left or Right.

const titles = '[role="tab"] .tab-pill-title';

async function openFiles(page: Page, names: string[]) {
  for (const name of names) {
    await page.evaluate((path) => {
      const w = window as unknown as Record<string, unknown> & {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = {
        ...(w.__devFiles as Record<string, string> | undefined),
        [path]: `# ${path}`,
      };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
    }, `/notes/${name}`);
    await expect(
      page.locator('[data-active-tab="true"] .ProseMirror'),
    ).toContainText(`/notes/${name}`);
  }
}

const tab = (page: Page, name: string) =>
  page.locator('[role="tab"]', { hasText: name });

async function fromMenu(page: Page, name: string, item: string) {
  await tab(page, name).click({ button: "right" });
  await page
    .locator(".context-menu-item")
    .getByText(item, { exact: true })
    .click();
}

test("a middle click closes a tab, and the tab menu closes those to its right, left, or all others", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await openFiles(page, ["a.md", "b.md", "c.md", "d.md", "e.md"]);
  await tab(page, "e.md").click({ button: "middle" });
  // The window's untouched first tab gave way to a.md.
  await expect(page.locator(titles)).toHaveText([
    "a.md",
    "b.md",
    "c.md",
    "d.md",
  ]);
  await fromMenu(page, "c.md", "Close Tabs to the Right");
  await expect(page.locator(titles)).toHaveText(["a.md", "b.md", "c.md"]);
  await fromMenu(page, "b.md", "Close Tabs to the Left");
  await expect(page.locator(titles)).toHaveText(["b.md", "c.md"]);
  await fromMenu(page, "c.md", "Close Others");
  // One tab left: the bar steps aside.
  await expect(page.locator(titles)).toHaveCount(0);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("/notes/c.md");
});

test("Close Others leaves a tab with unsaved changes open", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab", autosave: false },
  });
  await openFiles(page, ["a.md", "b.md", "c.md"]);
  // On the title: a narrow pill's centre can be its close button.
  await tab(page, "a.md").locator(".tab-pill-title").click();
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("changed", { delay: 20 });
  await expect(tab(page, "a.md").locator(".tab-pill-dirty-dot")).toHaveCount(1);
  await fromMenu(page, "c.md", "Close Others");
  await expect(page.locator(titles)).toHaveText(["a.md", "c.md"]);
});
