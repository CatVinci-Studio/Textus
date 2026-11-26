import { expect, test } from "@playwright/test";
import { openApp, PHONE } from "./helpers";

// A phone's menus hang from their buttons, as iOS's and Material's do; a
// tap outside one only closes it.

test.use(PHONE);

test("a tap outside an open menu closes it and reaches nothing under it", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const tabs = page.locator(".tab-pill[data-tab]");
  const count = await tabs.count();
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  // Hung from ☰: under it.
  const button = (await page.locator(".window-menu-button").boundingBox())!;
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(
    button.y + button.height - 1,
  );
  await page.locator(".tab-bar-add").tap();
  await expect(menu).toHaveCount(0);
  await expect(tabs).toHaveCount(count);
  // The next tap is its own again.
  await page.locator(".tab-bar-add").tap();
  await expect(tabs).toHaveCount(count + 1);
});
