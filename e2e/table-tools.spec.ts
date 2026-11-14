import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A table's own tools at its top right: they show on hover and while the
// caret is in it, and change what the file says.

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false, language: "en" } });
  await page.locator(".ProseMirror:visible").first().click();
  await pasteMarkdown(page, TABLE);
  return page.locator(".table-wrapper").first();
}

const tool = (page: Page, name: string) =>
  page.locator(".table-toolbar").getByRole("button", { name, exact: true });

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

  await tool(page, "Rows and Columns").click();
  const card = page.getByRole("dialog", { name: "Rows and Columns" });
  await expect(card).toBeVisible();
  await page.screenshot({ path: "test-results/table-size.png" });
  await card.getByRole("button", { name: "More Rows" }).click();
  await card.getByRole("button", { name: "More Columns" }).click();
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  await tool(page, "Delete Table").click();
  await expect(page.locator(".table-wrapper")).toHaveCount(0);
});
