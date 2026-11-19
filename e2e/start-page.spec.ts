import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("with the + chosen to show the start page, New File there makes it the document", async ({
  page,
}) => {
  await openApp(page, { settings: { addTabShowsStartPage: true } });
  const tabs = page.locator(".tab-pill");
  await expect(tabs).toHaveCount(1);
  await page.locator(".tab-bar-add").first().click();
  await expect(tabs).toHaveCount(2);
  const start = page.locator(".start-page");
  await expect(start).toBeVisible();
  await start.getByRole("button", { name: /新建文件/ }).click();
  await expect(start).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toBeVisible();
});
