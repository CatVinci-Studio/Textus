import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

const editor = '[data-active-tab="true"] .ProseMirror';
const item = (page: import("@playwright/test").Page, name: string | RegExp) =>
  page.locator(".context-menu-item", { hasText: name });

test("the keyboard goes into a submenu and back out", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Some text");
  await page.locator(`${editor} p`).click({ button: "right" });
  const insert = item(page, /^Format$/);
  await insert.focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "Bold")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(insert).toBeFocused();
  await expect(item(page, "Bold")).toHaveCount(0);
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

test("a link's own items come first: Copy Link copies its address, Remove Link keeps its words", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "See [the site](https://example.com) here.");
  const link = page.locator(`${editor} a[data-type="link"]`);
  await link.click({ button: "right" });
  const rows = page.locator(
    ".context-menu:not(.context-submenu) .context-menu-item",
  );
  await expect(rows.nth(0)).toHaveText("Open Link");
  await expect(rows.nth(3)).toHaveText("Remove Link");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await item(page, "Copy Link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://example.com",
  );
  await link.click({ button: "right" });
  await item(page, "Remove Link").click();
  await expect(link).toHaveCount(0);
  await expect(page.locator(editor)).toHaveText("See the site here.");
});
