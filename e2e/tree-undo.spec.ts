import { expect, test, type Page } from "@playwright/test";
import { devDisk, emit, openTreeFolder, treeRow } from "./helpers";

const openFolder = (page: Page, fs: Record<string, string>) =>
  openTreeFolder(page, "/proj", fs);

const row = treeRow;

const disk = devDisk;

/*
 * The file tree's own undo: a move, its link updates, a rename and a
 * delete are taken back with the Undo key while the tree has the keyboard,
 * and done again with Redo.
 */

async function drag(page: Page, name: string, onto: string) {
  const from = (await row(page, name).boundingBox())!;
  const to = (await row(page, onto).boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("a move and the links it updated are taken back with Undo, and done again with Redo", async ({
  page,
}) => {
  await openFolder(page, {
    "/proj/index.md": "[p](plan.md)\n",
    "/proj/plan.md": "# Plan\n",
    "/proj/notes/n.md": "# N\n",
  });
  await expect(row(page, "plan.md")).toBeVisible();
  await drag(page, "plan.md", "notes");
  await page.getByRole("button", { name: "Update Links" }).click();
  await expect
    .poll(async () => (await disk(page))["/proj/index.md"])
    .toBe("[p](notes/plan.md)\n");

  // The moved row has the keyboard: the key takes the move back.
  await expect(row(page, "plan.md")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => Object.keys(await disk(page)))
    .toContain("/proj/plan.md");
  await expect
    .poll(async () => (await disk(page))["/proj/index.md"])
    .toBe("[p](plan.md)\n");

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => Object.keys(await disk(page)))
    .toContain("/proj/notes/plan.md");
  await expect
    .poll(async () => (await disk(page))["/proj/index.md"])
    .toBe("[p](notes/plan.md)\n");
});

test("a delete is put back from the Trash with Undo, or its notice's Undo", async ({
  page,
}) => {
  await openFolder(page, { "/proj/a.md": "# A\n", "/proj/b.md": "# B\n" });
  const trash = async (name: string) => {
    await row(page, name).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await expect(row(page, name)).toHaveCount(0);
  };
  await trash("a.md");
  await page
    .locator(".notice", { hasText: "Moved 1 item to the Trash" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(row(page, "a.md")).toBeVisible();
  expect((await disk(page))["/proj/a.md"]).toBe("# A\n");

  // The row beside has the keyboard: the key takes the delete back.
  await trash("b.md");
  await expect(row(page, "a.md")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(row(page, "b.md")).toBeVisible();
});

test("the tree's undo outlives switching to another panel and back", async ({
  page,
}) => {
  await openFolder(page, {
    "/proj/plan.md": "# Plan\n",
    "/proj/notes/n.md": "",
  });
  await drag(page, "plan.md", "notes");
  await expect
    .poll(async () => Object.keys(await disk(page)))
    .toContain("/proj/notes/plan.md");
  await page.locator('[data-rail-id="outline"]').click();
  await expect(page.locator(".tree-row")).toHaveCount(0);
  await page.locator('[data-rail-id="tree"]').click();
  await row(page, "notes").first().focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => Object.keys(await disk(page)))
    .toContain("/proj/plan.md");
});

test("rows picked or being renamed let go once another app removes them", async ({
  page,
}) => {
  await openFolder(page, {
    "/proj/a.md": "# A\n",
    "/proj/b.md": "# B\n",
    "/proj/c.md": "# C\n",
  });
  await row(page, "a.md").click();
  await row(page, "b.md").click({ modifiers: ["Shift"] });
  await expect(page.locator(".file-tree-picking")).toHaveCount(1);
  await row(page, "c.md").focus();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "New name" })).toBeVisible();
  await page.evaluate(() => {
    const fs = (window as unknown as { __devFs: Record<string, string> })
      .__devFs;
    for (const f of ["/proj/a.md", "/proj/b.md", "/proj/c.md"]) delete fs[f];
  });
  await emit(page, "tree-dirs-changed", { dirs: ["/proj"], all: false });
  await expect(page.locator(".file-tree-picking")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "New name" })).toHaveCount(0);
});
