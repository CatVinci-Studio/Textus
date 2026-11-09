import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown, SAMPLE_DOC } from "./helpers";

// Every column's top row ends on one line - the sidebar's, the tab bar's and
// the AI panel's - at any window width; the AI panel starts under the window
// bar, whose right end (word count, window buttons) is the page's; and a
// small window keeps the document its room and the panels draggable.

async function layout(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    return {
      sidebar: rect(".sidebar-header").bottom,
      tabs: rect(".tab-bar").bottom,
      ai: rect(".agent-panel-header").bottom,
      // Where the panel's edge starts: its ::before line.
      aiEdgeTop:
        rect(".agent-panel").top +
        parseFloat(
          getComputedStyle(document.querySelector(".agent-panel")!, "::before")
            .top,
        ),
      bar: rect(".window-bar").bottom,
      panel: rect(".agent-panel").width,
      document: rect(".tab-bar").width,
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
  await expect(page.locator(".tab-bar")).toBeVisible();
  await expect(page.locator(".agent-panel-header")).toBeVisible();
}

for (const width of [820, 1280, 1920])
  test(`header lines meet at ${width}px`, async ({ page }) => {
    await open(page, width);
    const at = await layout(page);
    expect(Math.abs(at.sidebar - at.tabs)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.ai - at.tabs)).toBeLessThanOrEqual(1);
    expect(at.aiEdgeTop).toBeGreaterThanOrEqual(at.bar - 1);
    // The document keeps at least 360 (times the scale, 1 here and up).
    expect(at.document).toBeGreaterThanOrEqual(359);
  });

test("a squeezed AI panel can still be dragged narrower", async ({ page }) => {
  // Squeezed but above its narrowest: at 820 the rail and the sidebar leave
  // it exactly that.
  await open(page, 900);
  const before = (await layout(page)).panel;
  const edge = page.getByRole("separator", { name: /AI panel/i });
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await layout(page)).panel)
    .toBeLessThan(before);
});
