import { expect, test } from "@playwright/test";
import { PHONE, mockInvoke, openPhone, pasteMarkdown } from "./helpers";

// Editing by finger on the iPhone layout: the keyboard toolbar follows the
// caret into tables, its "More" stands in for the right-click menu, and a
// grammar underline answers a tap. Chromium with touch (see PHONE in
// helpers.ts) - iOS WebKit's own keyboard and text menu aren't reachable.
test.use(PHONE);

const TABLE = `Before the table.

| A | B |
|---|---|
| 1 | 2 |

After the table.
`;

test("in a table the keyboard toolbar adds rows; outside it, formatting is back", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, TABLE);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const toolbar = page.getByRole("toolbar");

  await editor.locator("td").first().tap();
  const addRow = toolbar.getByRole("button", { name: "Insert Row Below" });
  await expect(addRow).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Delete Table" }),
  ).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveCount(0);
  // The hover "+" strips give way to the toolbar.
  await expect(editor.locator(".table-add-row-btn")).toBeHidden();

  await expect(editor.locator("tr")).toHaveCount(2);
  await addRow.tap();
  await expect(editor.locator("tr")).toHaveCount(3);
  // The editor kept its focus: the toolbar is still up, still for a table.
  await expect(addRow).toBeVisible();

  await editor.getByText("After the table.").tap();
  await expect(toolbar.getByRole("button", { name: "Bold" })).toBeVisible();
  await expect(addRow).toHaveCount(0);
});

test("a swipe along the keyboard toolbar that starts on Delete Table deletes nothing", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, TABLE);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("td").first().tap();
  const remove = page
    .getByRole("toolbar")
    .getByRole("button", { name: "Delete Table" });
  await expect(remove).toBeVisible();

  // A finger down on the button, dragged sideways to scroll the row, then
  // lifted: Playwright's touchscreen only taps, so the raw touch events.
  // The row starts scrolled to its beginning, which may leave the button
  // past the screen's edge.
  await remove.scrollIntoViewIfNeeded();
  const box = (await remove.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number }[],
  ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [{ x, y }]);
  for (let dx = 10; dx <= 80; dx += 10)
    await touch("touchMove", [{ x: x - dx, y }]);
  await touch("touchEnd", []);

  await expect(editor.locator("table")).toHaveCount(1);
  // While a tap still presses it.
  await editor.locator("td").first().tap();
  await remove.tap();
  await expect(editor.locator("table")).toHaveCount(0);
});

test("More opens the editor's menu for the caret as an action sheet", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, TABLE);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const more = page.getByRole("toolbar").getByRole("button", { name: "More" });

  // In a table: what the toolbar doesn't carry there - alignment, say.
  await editor.locator("td").first().tap();
  await more.tap();
  const sheet = page.locator(".action-sheet");
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("menuitem", { name: "Align Center" }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("menuitem", { name: "Insert Row Below" }),
  ).toHaveCount(0);
  await sheet.getByRole("menuitem", { name: "Align Center" }).tap();
  await expect(sheet).toBeHidden();
  await expect(editor.locator("th").first()).toHaveAttribute(
    "style",
    /text-align: center/,
  );

  // In text: inserting a table, which has no toolbar button.
  await editor.getByText("After the table.").tap();
  await more.tap();
  await expect(
    sheet.getByRole("menuitem", { name: "Insert Table" }),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).tap();
  await expect(sheet).toBeHidden();
});

// A 200x100 block, so there is something to tap.
const IMAGE =
  "![chart](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzhhYyIvPjwvc3ZnPg==)";

test("a tapped image gets width presets and delete on the toolbar", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, `Text above.\n\n${IMAGE}\n\nText below.\n`);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const toolbar = page.getByRole("toolbar");
  const image = editor.locator(".image-view");

  await image.tap();
  const half = toolbar.getByRole("button", { name: "Image width: 50%" });
  await expect(half).toBeVisible();
  // The drag grip is too small for a finger; the presets replace it.
  await expect(image.locator(".image-resize-handle")).toBeHidden();

  await half.tap();
  await expect(image).toHaveAttribute("style", /width: 50%/);
  await expect(half).toHaveAttribute("aria-pressed", "true");

  await toolbar.getByRole("button", { name: "Delete Image" }).tap();
  await expect(image).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Bold" })).toBeVisible();
});

test("a tap on a grammar underline offers the fix in a bottom card", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, "She go to school.");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  // A canned answer from the checker: no backend needed.
  await mockInvoke(page, {
    ai_grammar_check: [
      {
        start: 4,
        end: 6,
        issue: "The verb should agree with “she”.",
        suggestion: "goes",
        original: "go",
      },
    ],
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("textus:trigger-grammar-check")),
  );
  await editor.locator(".grammar-issue").tap();
  const card = page.locator(".bottom-card");
  await expect(card).toContainText("The verb should agree with “she”.");
  await expect(card.locator(".grammar-kind")).toHaveText("Grammar");
  await expect(page.locator(".grammar-popover")).toHaveCount(0);
  await card.getByRole("button", { name: "Change to “goes”" }).tap();
  await expect(editor).toContainText("She goes to school.");
});

test("a code block's language picker is a touch-sized control", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, "```js\nconsole.log(1);\n```\n");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("pre code").tap();
  const select = editor.locator(".code-block-language-select");
  await expect(select).toBeVisible();
  const box = await select.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await select.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    "16px",
  );
});
