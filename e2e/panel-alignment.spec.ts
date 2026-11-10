import { expect, test, type Page } from "@playwright/test";
import {
  changeSettings,
  emit,
  openApp,
  pasteMarkdown,
  SAMPLE_DOC,
} from "./helpers";

// With two documents the tabs take the window bar's row, ending on its line,
// clear of its controls at both ends (design-language.md 5.7), the open one
// meeting its island with nothing between; the AI island starts under the
// window bar; and a small window keeps the document its room and the
// islands draggable.

async function layout(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    return {
      tabs: rect("[data-island-row=documents] > .tab-bar").bottom,
      firstTab: rect("[data-island-row=documents] > .tab-bar .tab-pill").left,
      menu: rect(".window-menu-button").right,
      lastTab: rect("[data-island-row=documents] > .tab-bar .tab-bar-add")
        .right,
      status: rect(".window-bar-status").left,
      // The open tab's foot and its island's top.
      seam:
        rect("[data-island-row=documents] > .tab-bar .tab-pill-active").bottom -
        rect('[data-island="documents"]').top,
      // ...and the AI island's, likewise.
      aiSeam:
        rect('[data-island-row="ai"] .tab-pill-active').bottom -
        rect(".ai-island").top,
      aiEdgeTop: rect(".ai-island").top,
      bar: rect(".window-bar").bottom,
      panel: rect(".ai-island").width,
      document: rect("[data-island-row=documents]").width,
    };
  });
}

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 760 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-sidebar-open": "1", "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, SAMPLE_DOC);
  // A second tab, for the tab bar.
  await emit(page, "menu-open-help", "markdown");
  await expect(
    page.locator("[data-island-row=documents] > .tab-bar"),
  ).toBeVisible();
  await expect(page.locator('[data-island-row="ai"]')).toBeVisible();
}

// From 960: narrower, the rail and both panels at their narrowest leave the
// page less than its room at the desktop's interface size.
for (const width of [960, 1280, 1920])
  test(`header lines meet at ${width}px`, async ({ page }) => {
    await open(page, width);
    const at = await layout(page);
    expect(Math.abs(at.tabs - at.bar)).toBeLessThanOrEqual(1);
    expect(at.firstTab).toBeGreaterThan(at.menu);
    expect(at.lastTab).toBeLessThanOrEqual(at.status);
    expect(at.aiEdgeTop).toBeGreaterThanOrEqual(at.bar - 1);
    expect(Math.abs(at.seam)).toBeLessThan(0.5);
    expect(Math.abs(at.aiSeam)).toBeLessThan(0.5);
    // The document keeps at least 360 (times the scale, 1 here and up).
    expect(at.document).toBeGreaterThanOrEqual(359);
  });

// The same on screens that scale: the open tab still meets its island
// within half a physical pixel, and the rows still clear the bar.
for (const scale of [1.25, 1.5, 2])
  test.describe(`at ${scale}x`, () => {
    test.use({ deviceScaleFactor: scale });
    for (const width of [1280, 2560])
      test(`header lines meet at ${width}px`, async ({ page }) => {
        await open(page, width);
        const at = await layout(page);
        expect(Math.abs(at.tabs - at.bar)).toBeLessThanOrEqual(1);
        expect(at.firstTab).toBeGreaterThan(at.menu);
        expect(at.lastTab).toBeLessThanOrEqual(at.status);
        expect(Math.abs(at.seam)).toBeLessThan(0.5 / scale);
        expect(Math.abs(at.aiSeam)).toBeLessThan(0.5 / scale);
      });
  });

test("a squeezed AI panel can still be dragged narrower", async ({ page }) => {
  // Squeezed but above its narrowest: narrower, the rail and the sidebar
  // leave it exactly that.
  await open(page, 1060);
  const before = (await layout(page)).panel;
  // The divider before the AI island, the last.
  const edge = page.getByRole("separator", { name: /Divider/ }).last();
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await layout(page)).panel)
    .toBeLessThan(before);
});

// The bar's start (barLayout): with the rail the app menu is its first icon,
// on its centre line, and the rail's icons open the sidebar; without the
// rail the sidebar's button is back. The menu bar spelled out is a row of
// its own, the islands' tabs and the rail under it.
test("the app menu sits in the rail's column; the menu bar takes a row of its own", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-new-file");
  const centre = (selector: string) =>
    page.evaluate((s) => {
      const box = document.querySelector(s)!.getBoundingClientRect();
      return { x: box.left + box.width / 2, top: box.top, bottom: box.bottom };
    }, selector);
  const menu = await centre(".window-menu-button");
  const rail = await centre(".activity-rail-item");
  expect(Math.abs(menu.x - rail.x)).toBeLessThan(0.5);
  await expect(page.locator(".window-bar-sidebar-toggle")).toHaveCount(0);
  // The first tab whole, clear of the menu.
  const firstTab = await page
    .locator("[data-island-row=documents] .tab-pill")
    .first()
    .boundingBox();
  expect(firstTab!.x).toBeGreaterThan(menu.x);

  await changeSettings(page, { activityRail: false });
  await expect(page.locator(".window-bar-sidebar-toggle")).toBeVisible();

  await changeSettings(page, { activityRail: true, menuBarShown: true });
  await expect(page.locator(".window-menu-bar")).toBeVisible();
  const bar = await centre(".window-bar");
  const row = await centre("[data-island-row=documents]");
  const railTop = await centre(".activity-rail");
  expect(row.top).toBeGreaterThanOrEqual(bar.bottom - 0.5);
  expect(Math.abs(railTop.top - row.top)).toBeLessThan(0.5);
  // The window's buttons stay in the first row.
  const close = await centre(".window-caption");
  expect(close.bottom).toBeLessThanOrEqual(bar.bottom + 0.5);
});
