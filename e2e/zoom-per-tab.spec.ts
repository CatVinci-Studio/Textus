import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

// Each tab keeps its own zoom: zooming the document on the right leaves
// the one on the left as it was - unless documents zoom together; over
// Settings a zoom does nothing.

const zoomOf = (page: Page, i: number) =>
  page
    .locator("[data-tab-id]")
    .nth(i)
    .evaluate((tab) =>
      parseFloat(
        getComputedStyle(tab).getPropertyValue("--content-zoom") || "1",
      ),
    );

async function zoomIn(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(600);
}

test("a zoom changes only the tab it is over", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await emit(page, "menu-split-right");
  const sheets = page.locator("section.island");
  await expect(sheets).toHaveCount(2);
  const right = (await sheets.nth(1).boundingBox())!;
  await zoomIn(page, right.x + right.width / 2, right.y + right.height / 2);
  expect(await zoomOf(page, 1)).toBeGreaterThan(1.1);
  expect(await zoomOf(page, 0)).toBe(1);
});

test("zoomed together, a zoom over one document sizes them all", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: { menuBarShown: false, zoomTogether: true },
  });
  await emit(page, "menu-split-right");
  const sheets = page.locator("section.island");
  await expect(sheets).toHaveCount(2);
  const right = (await sheets.nth(1).boundingBox())!;
  await zoomIn(page, right.x + right.width / 2, right.y + right.height / 2);
  expect(await zoomOf(page, 1)).toBeGreaterThan(1.1);
  expect(await zoomOf(page, 0)).toBe(await zoomOf(page, 1));
});

test("over Settings, a zoom does nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await emit(page, "menu-open-settings");
  const page_ = (await page.locator(".settings-tab").boundingBox())!;
  await zoomIn(page, page_.x + page_.width / 2, page_.y + 200);
  const zooms = await page
    .locator("[data-tab-id]")
    .evaluateAll((tabs) =>
      tabs.map((t) =>
        parseFloat(
          getComputedStyle(t).getPropertyValue("--content-zoom") || "1",
        ),
      ),
    );
  expect(zooms.every((z) => z === 1)).toBe(true);
});
