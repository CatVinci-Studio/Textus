import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A table's own tools at its top right: they show on hover and while the
// caret is in it, and change what the file says.

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";

async function open(page: Page, markdown = TABLE) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false, language: "en" } });
  await page.locator(".ProseMirror:visible").first().click();
  await pasteMarkdown(page, markdown);
  return page.locator(".table-wrapper").first();
}

const tool = (page: Page, name: string, exact = true) =>
  page.locator(".table-toolbar").getByRole("button", { name, exact });

test("a table's tools align the caret's column, size it, and delete it", async ({
  page,
}) => {
  const table = await open(page);
  await table.locator("td", { hasText: "2" }).click();
  await expect(tool(page, "Align Center")).toBeVisible();
  await page.screenshot({ path: "test-results/table-tools.png" });
  await tool(page, "Align Center").click();
  await expect(table.locator("th").nth(1)).toHaveCSS("text-align", "center");
  await expect(table.locator("td").nth(1)).toHaveCSS("text-align", "center");

  await tool(page, "Rows and Columns 2 × 2", false).click();
  const card = page.getByRole("dialog", { name: "Rows and Columns" });
  await expect(card).toBeVisible();
  await card.locator('[data-cell="2,2"]').hover();
  await expect(card.getByText("3 × 3")).toBeVisible();
  await page.screenshot({ path: "test-results/table-size.png" });
  await card.locator('[data-cell="2,2"]').click();
  await expect(card).toHaveCount(0);
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);

  // Smaller again: the cells with text it would cut are marked first.
  await tool(page, "Rows and Columns 3 × 3", false).click();
  await card.locator('[data-cell="1,0"]').hover();
  await expect(card.locator(".is-lost")).toHaveCount(2);
  await expect(card.getByText("Cells with text will be removed")).toBeVisible();
  await page.screenshot({ path: "test-results/table-size-lost.png" });
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  await tool(page, "Delete Table").click();
  await expect(page.locator(".table-wrapper")).toHaveCount(0);
});

test("a row's grip picks the row, and pulled it moves the row; a column's the same", async ({
  page,
}) => {
  const table = await open(
    page,
    "| h | k |\n| --- | --- |\n| 1 | x |\n| 2 | y |\n| 3 | z |\n",
  );
  page.on(
    "console",
    (m) => m.text().includes("GRIPDBG") && console.log(m.text()),
  );
  const cell = (text: string) => table.locator("td", { hasText: text });
  await cell("3").hover();
  const grip = page.locator(".table-grip-row");
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  const top = (await cell("1").boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top.y + 2, { steps: 8 });
  await expect(page.locator(".table-wrapper[data-dragging=row]")).toHaveCount(
    1,
  );
  await page.screenshot({ path: "test-results/table-grip-drag.png" });
  await page.mouse.up();
  const firstColumn = () =>
    table.locator("tbody tr td:first-child").allInnerTexts();
  await expect.poll(firstColumn).toEqual(["3", "1", "2"]);

  await cell("y").hover();
  const colGrip = page.locator(".table-grip-col");
  const c = (await colGrip.boundingBox())!;
  const left = (await table.locator("th").first().boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(left.x + 4, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(table.locator("th").first()).toHaveText("k");

  // Pressed without a pull: the whole row is picked.
  await cell("1").hover();
  await page.locator(".table-grip-row").click();
  await expect(table.locator(".selectedCell")).toHaveCount(2);
});

test("a click below a table that ends the document starts a paragraph there", async ({
  page,
}) => {
  const table = await open(page);
  const box = (await table.boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height + 40);
  await page.keyboard.type("after");
  await expect(page.locator(".ProseMirror:visible > p").last()).toHaveText(
    "after",
  );
  await expect(table.locator("td", { hasText: "after" })).toHaveCount(0);
});
