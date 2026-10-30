import { expect, test, type Page } from "@playwright/test";
import { HOME, selectionRead } from "./helpers";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The Quick Insert plugin: blocks from the / menu, Turn into…, and emoji
// after a colon - all through Textus's own Format commands.

const ID = "catvinci.quick-insert";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

async function open(page: Page, doc: string) {
  await openWithPlugins(page, {
    plugins: { [ID]: ["editor.read", "editor.write"] },
    folder: { "/work/a.md": doc },
  });
  await openPath(page, "/work/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  // The file's text, not the empty tab before it.
  await expect(editor).toContainText(doc.trim().split("\n").pop()!);
  await editor.locator("p").last().click();
  await selectionRead(page);
  await page.keyboard.press("End");
  return editor;
}

/** Types `/query` and takes the item called `name`. */
async function slash(page: Page, query: string, name: string) {
  const list = page.locator(".completion-list");
  await page.keyboard.type(`/${query}`);
  await list.getByText(name, { exact: true }).click();
  await expect(list).toBeHidden();
}

test("the / menu puts in headings, lists, formulas and dividers", async ({
  page,
}) => {
  const editor = await open(page, "# Notes\n\nFirst line\n");
  await page.keyboard.press("Enter");
  await slash(page, "heading", "Heading 2");
  await page.keyboard.type("Plan");
  await expect(editor.locator("h2")).toContainText("Plan");

  await page.keyboard.press("Enter");
  await slash(page, "to-do", "To-do list");
  await page.keyboard.type("Buy milk");
  await expect(editor.locator('li[data-item-type="task"]')).toHaveText(
    "Buy milk",
  );

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await slash(page, "div", "Divider");
  await expect(editor.locator("hr")).toHaveCount(1);
  await slash(page, "formula", "Formula");
  await page.keyboard.type("E=mc^2");
  await expect(editor.locator('[data-type="math_block"]')).toBeVisible();
});

test("Chinese names are found by pinyin, and English ones in any language", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { [ID]: ["editor.read", "editor.write"] },
    folder: { "/work/a.md": "第一行\n" },
    language: "zh",
  });
  await openPath(page, "/work/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("第一行");
  await editor.locator("p").click();
  await selectionRead(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const list = page.locator(".completion-list");
  await page.keyboard.type("/yinyong");
  await list.getByText("引用", { exact: true }).click();
  await page.keyboard.type("名言");
  await expect(editor.locator("blockquote")).toHaveText("名言");

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await expect(list).toContainText("表格");
});

test("Turn into… makes the paragraph a heading, then text again", async ({
  page,
}) => {
  const editor = await open(page, "A title\n");
  // At the line's start, as / opens only at a word's start.
  await page.keyboard.press(HOME);
  await slash(page, "turn", "Turn into…");
  await page.getByRole("option", { name: "Heading 1" }).click();
  await expect(editor.locator("h1")).toContainText("A title");
  await page.keyboard.press(HOME);
  await slash(page, "turn", "Turn into…");
  await page.getByRole("option", { name: "Text" }).click();
  await expect(editor.locator("h1")).toHaveCount(0);
  await expect(editor.locator("p")).toHaveText("A title");
});

test("a colon and a word offer emoji, but not in a time", async ({ page }) => {
  const editor = await open(page, "Done\n");
  const list = page.locator(".completion-list");
  await page.keyboard.type(" at 10:30");
  await expect(list).toBeHidden();
  await page.keyboard.type(" :tada");
  await expect(list).toContainText("🎉");
  await page.keyboard.press("Enter");
  await expect(editor.locator("p")).toHaveText("Done at 10:30 🎉");
});
