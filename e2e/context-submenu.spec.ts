import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

const editor = '[data-active-tab="true"] .ProseMirror';
const item = (page: import("@playwright/test").Page, name: string | RegExp) =>
  page.locator(".context-menu-item", { hasText: name });

test("a table's right-click opens its row and column actions in submenus", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |");
  await page
    .locator(`${editor} td`, { hasText: "a" })
    .click({ button: "right" });
  await expect(
    page.locator(".context-menu:not(.context-submenu)"),
  ).toBeVisible();
  await expect(item(page, "Delete Row")).toHaveCount(0);
  await item(page, /^Row$/).hover();
  await expect(item(page, "Delete Row")).toBeVisible();
  if (process.env.TEXTUS_SHOTS_DIR)
    await page.screenshot({
      path: `${process.env.TEXTUS_SHOTS_DIR}/table-menu.png`,
    });
  await item(page, "Delete Row").click();
  await expect(page.locator(`${editor} td`, { hasText: "a" })).toHaveCount(0);
  await expect(page.locator(".context-menu")).toHaveCount(0);
});

test("the keyboard goes into a submenu and back out", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Some text");
  await page.locator(`${editor} p`).click({ button: "right" });
  const insert = item(page, /^Insert$/);
  await insert.focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "Bullet List")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(insert).toBeFocused();
  await expect(item(page, "Bullet List")).toHaveCount(0);
  // Escape from the menu itself closes it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".context-menu")).toHaveCount(0);
});

test("a submenu opens at once beside its menu, and stays open while the pointer crosses other rows to it", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |");
  await page
    .locator(`${editor} td`, { hasText: "a" })
    .click({ button: "right" });
  const row = item(page, /^Row$/);
  const from = (await row.boundingBox())!;
  await page.mouse.move(from.x + from.width - 40, from.y + from.height / 2);
  // No wait: it is there with the pointer.
  await expect(item(page, "Delete Row")).toBeVisible({ timeout: 100 });
  // Beside the menu, not over it.
  const menu = (await page
    .locator(".context-menu:not(.context-submenu)")
    .boundingBox())!;
  const sub = (await page.locator(".context-submenu").boundingBox())!;
  expect(sub.x).toBeGreaterThanOrEqual(menu.x + menu.width);
  // Down and right across the rows below, into the submenu's lower part.
  await page.mouse.move(sub.x + 12, sub.y + sub.height - 12, { steps: 12 });
  await item(page, "Delete Row").click();
  await expect(page.locator(`${editor} td`, { hasText: "a" })).toHaveCount(0);
});

test("a pointer that stops on another row opens that row's own submenu", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |");
  await page
    .locator(`${editor} td`, { hasText: "a" })
    .click({ button: "right" });
  await item(page, /^Row$/).hover();
  await expect(item(page, "Delete Row")).toBeVisible();
  await item(page, /^Column$/).hover();
  await expect(item(page, "Delete Row")).toHaveCount(0, { timeout: 500 });
  await expect(item(page, "Delete Column")).toBeVisible();
});
