import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// The immersive strip: the sidebar and the docked AI panel reach the window's
// top edge, each carrying its own header in the 28px strip, and the bar fills
// what is left between them (app/window-bar.css, app/sidebar-frame.css,
// ai/chat/panel/agent-panel.css).

/** The strip is 28px; a header in it may add its 1px bottom hairline. */
async function expectInStrip(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBeLessThanOrEqual(29);
}

test("the strip's button opens the sidebar, whose header shares the strip", async ({
  page,
}) => {
  await openApp(page);
  const toggle = page.locator(".window-bar-sidebar-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Full height: the header sits in the window's strip, not under it...
  await expectInStrip(page, ".sidebar-header");
  // ...and the bar fills what the sidebar leaves, edge to edge against it.
  const bar = (await page.locator(".window-bar").boundingBox())!;
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  expect(Math.round(bar.x)).toBe(Math.round(sidebar.width));

  await toggle.click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-collapsed/);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // With the sidebar gone the bar takes the whole strip back.
  expect((await page.locator(".window-bar").boundingBox())!.x).toBe(0);
});

test("the docked AI panel reaches the top, and the caption stays in the corner", async ({
  page,
}) => {
  await openApp(page);
  await page.locator(".window-bar-toggle").click();
  await expect(page.locator(".agent-panel")).toBeVisible();

  await expectInStrip(page, ".agent-panel-header");
  const bar = (await page.locator(".window-bar").boundingBox())!;
  const panel = (await page.locator(".agent-panel").boundingBox())!;
  expect(Math.round(bar.x + bar.width)).toBe(Math.round(panel.x));

  // Where the app draws the caption (Windows, Linux - the browser is one of
  // them here), those buttons stay pinned to the WINDOW's corner, over the
  // panel's header - macOS keeps its traffic lights instead.
  const chrome = await page.locator("html").getAttribute("data-window-chrome");
  if (chrome === "app") {
    const caption = (await page.locator(".window-caption").boundingBox())!;
    expect(caption.y).toBe(0);
    expect(Math.round(caption.x + caption.width)).toBe(page.viewportSize()!.width);
  }
});
