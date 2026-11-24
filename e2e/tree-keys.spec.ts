import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

/*
 * The file tree's keys (as on Windows and Linux): F2 renames in the row,
 * Delete moves to the Trash, Enter opens, typing finds a row; and a new
 * entry or a rename whose name is taken says so under the field.
 */

async function openFolder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/proj/alpha.md": "# Alpha\n",
      "/proj/beta.md": "# Beta\n",
      "/proj/notes/n.md": "# N\n",
    };
    w.__devPickFolder = "/proj";
  });
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
}

const row = (page: Page, name: string) =>
  page.locator(".tree-row", { hasText: name });

const files = (page: Page) =>
  page.evaluate(() =>
    Object.keys(
      (window as unknown as { __devFs: Record<string, string> }).__devFs,
    ),
  );

test("F2 renames in the row: a taken name is said there, Escape gives up, Enter renames", async ({
  page,
}) => {
  await openFolder(page);
  await row(page, "alpha.md").click();
  await page.keyboard.press("F2");
  const field = page.getByRole("textbox", { name: "New name" });
  await expect(field).toBeFocused();
  // The name without its extension is selected: typing replaces it.
  await page.keyboard.type("beta");
  await expect(field).toHaveValue("beta.md");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("beta.md");
  await expect(field).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(row(page, "alpha.md")).toBeFocused();

  await page.keyboard.press("F2");
  await page.keyboard.type("gamma");
  await page.keyboard.press("Enter");
  await expect.poll(() => files(page)).toContain("/proj/gamma.md");
  await expect(row(page, "gamma.md")).toBeFocused();
  // And back with Undo.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => files(page)).toContain("/proj/alpha.md");
});

test("Delete asks, can be told not to ask again, and is undone; Enter opens; typing finds a row", async ({
  page,
}) => {
  await openFolder(page);
  await row(page, "beta.md").click();
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect.poll(() => files(page)).not.toContain("/proj/beta.md");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => files(page)).toContain("/proj/beta.md");

  // Not asked again.
  await row(page, "beta.md").focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => files(page)).not.toContain("/proj/beta.md");
  await expect(dialog).toHaveCount(0);

  await row(page, "notes").focus();
  await page.keyboard.press("a");
  await expect(row(page, "alpha.md")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Alpha");
});

test("a new folder is named in place, and a taken name is said there", async ({
  page,
}) => {
  await openFolder(page);
  // A file's menu makes new things in its folder.
  await row(page, "beta.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New Folder" }).click();
  const field = page.getByRole("textbox", { name: "Name of the new folder" });
  await expect(field).toBeFocused();
  await page.keyboard.type("notes");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("notes");
  await page.keyboard.type(" 2");
  await page.keyboard.press("Enter");
  await expect.poll(() => files(page)).toContain("/proj/notes 2/.keep");
});
