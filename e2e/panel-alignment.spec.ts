import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown, SAMPLE_DOC } from "./helpers";

// Every column's top row ends on one line - the sidebar's, the tab bar's and
// the AI panel's - and the panels' edges run up through the window bar, at
// any window width and so any interface scale.

async function lines(page: Page) {
  return page.evaluate(() => {
    const bottom = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().bottom;
    const bar = document.querySelector(".window-bar")!;
    const after = getComputedStyle(bar, "::after");
    const panel = document
      .querySelector(".agent-panel")!
      .getBoundingClientRect();
    return {
      sidebar: bottom(".sidebar-header"),
      tabs: bottom(".tab-bar"),
      ai: bottom(".agent-panel-header"),
      // The bar's fill over the AI panel: as wide as the panel, to the right.
      barFill: parseFloat(after.width),
      panel: panel.width,
      barFillShown: after.display !== "none" && after.content !== "none",
    };
  });
}

for (const width of [900, 1280, 1920])
  test(`header lines meet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, {
      settings: { language: "en" },
      storage: { "textus-sidebar-open": "1", "textus-agent-panel-open": "1" },
    });
    await pasteMarkdown(page, SAMPLE_DOC);
    // A second tab, for the tab bar.
    await emit(page, "menu-open-help", "markdown");
    await expect(page.locator(".tab-bar")).toBeVisible();
    await expect(page.locator(".agent-panel-header")).toBeVisible();
    const at = await lines(page);
    expect(Math.abs(at.sidebar - at.tabs)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.ai - at.tabs)).toBeLessThanOrEqual(1);
    expect(at.barFillShown).toBe(true);
    expect(Math.abs(at.barFill - at.panel)).toBeLessThanOrEqual(1);
  });
