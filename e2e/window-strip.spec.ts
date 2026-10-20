import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// The window's top strip with the sidebar in it (#262): the sidebar reaches
// the window's top edge with its tabs in the 28px strip, and the bar's own
// controls and title make room beside it (app/window-bar.css,
// app/sidebar-frame.css).

async function box(page: Page, selector: string) {
  return (await page.locator(selector).boundingBox())!;
}

test("the bar's toggle opens the sidebar, whose tabs share the strip", async ({
  page,
}) => {
  await openApp(page);
  const toggle = page.locator(".window-bar-sidebar-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const shut = await box(page, ".window-bar-left");

  await toggle.click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Full height: the header is the strip's left segment, not under it.
  const sidebar = await box(page, ".sidebar");
  const header = await box(page, ".sidebar-header");
  expect(sidebar.y).toBe(0);
  expect(header.y).toBe(0);
  expect(header.height).toBe(28);
  // It lies over the bar's left end, so its tabs take the clicks there.
  const tab = await box(page, ".sidebar-tab >> nth=0");
  expect(
    await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest(".sidebar-tab"),
      [tab.x + tab.width / 2, tab.y + tab.height / 2],
    ),
  ).toBe(true);

  // The bar's controls ride just past the sidebar's edge, toggle first.
  const open = await box(page, ".window-bar-left");
  expect(Math.round(open.x)).toBe(Math.round(sidebar.width) + 12);
  const toggleBox = await box(page, ".window-bar-sidebar-toggle");
  const menuBox = await box(page, ".window-menu-button");
  expect(menuBox.x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width);
  // The title stays clear of them.
  expect((await box(page, ".window-bar-title")).x).toBeGreaterThan(
    open.x + open.width,
  );

  await toggle.click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-collapsed/);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect((await box(page, ".window-bar-left")).x).toBe(shut.x);
});

test("an AI panel over the sidebar in a small window starts below the strip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 620 });
  await openApp(page, {
    storage: { "textus-sidebar-open": "1", "levis-agent-panel-open": "1" },
  });
  const panel = page.locator(".agent-panel.agent-panel-overlay");
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y).toBe(28);
  // Where the two meet, the panel is on top...
  const sidebar = await box(page, ".sidebar");
  expect(panelBox.x).toBeLessThan(sidebar.x + sidebar.width);
  expect(
    await page.evaluate(
      ([x]) => !!document.elementFromPoint(x, 200)?.closest(".agent-panel"),
      [panelBox.x + 4],
    ),
  ).toBe(true);
  // ...and the strip above it stays the bar's: the caption buttons and
  // the AI toggle are not covered.
  const toggle = await box(page, ".window-bar-toggle");
  expect(
    await page.evaluate(
      ([x, y]) =>
        !!document.elementFromPoint(x, y)?.closest(".window-bar-toggle"),
      [toggle.x + toggle.width / 2, toggle.y + toggle.height / 2],
    ),
  ).toBe(true);
});

test("zen gives the bar's controls back the window's corner", async ({
  page,
}) => {
  await openApp(page, { storage: { "textus-sidebar-open": "1" } });
  const open = await box(page, ".window-bar-left");
  await page.locator("html").evaluate((el) => el.classList.add("zen"));
  expect((await box(page, ".window-bar-left")).x).toBeLessThan(open.x);
});
