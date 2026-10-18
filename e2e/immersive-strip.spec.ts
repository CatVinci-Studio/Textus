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
  // ...the bar fills what the sidebar leaves, edge to edge against it...
  const bar = (await page.locator(".window-bar").boundingBox())!;
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  expect(Math.round(bar.x)).toBe(Math.round(sidebar.width));

  // ...and the strip's own controls (sidebar toggle first, then the menu)
  // ride the bar's left end rather than the window's corner, so the
  // sidebar's tabs get their whole segment back (sidebar-frame.css).
  const cluster = (await page.locator(".window-bar-left").boundingBox())!;
  expect(cluster.x).toBeGreaterThanOrEqual(bar.x);
  expect(
    await page.evaluate(
      () =>
        !!(
          document
            .querySelector(".window-bar-sidebar-toggle")!
            .compareDocumentPosition(
              document.querySelector(".window-menu-button")!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
  ).toBe(true);
  // The pair sits edge to edge, without the menu button's old flush
  // margin reaching into the toggle's box now that it leads.
  const toggleBox = (await page
    .locator(".window-bar-sidebar-toggle")
    .boundingBox())!;
  const menuBox = (await page.locator(".window-menu-button").boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width);
  const tabs = (await page.locator(".sidebar-tabs").boundingBox())!;
  expect(tabs.x).toBeLessThan(40);

  await toggle.click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-collapsed/);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // With the sidebar gone the bar takes the whole strip back, and its
  // controls lead it from the window's corner again.
  expect((await page.locator(".window-bar").boundingBox())!.x).toBe(0);
  const clusterClosed = (await page.locator(".window-bar-left").boundingBox())!;
  expect(clusterClosed.x).toBeLessThan(cluster.x);
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
    expect(Math.round(caption.x + caption.width)).toBe(
      page.viewportSize()!.width,
    );
  }
});
