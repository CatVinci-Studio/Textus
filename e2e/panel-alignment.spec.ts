import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown, SAMPLE_DOC } from "./helpers";

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
      toggle: rect(".window-bar-sidebar-toggle").right,
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
    expect(at.firstTab).toBeGreaterThan(at.toggle);
    expect(at.lastTab).toBeLessThanOrEqual(at.status);
    expect(at.aiEdgeTop).toBeGreaterThanOrEqual(at.bar - 1);
    expect(Math.abs(at.seam)).toBeLessThan(0.5);
    expect(Math.abs(at.aiSeam)).toBeLessThan(0.5);
    // The document keeps at least 360 (times the scale, 1 here and up).
    expect(at.document).toBeGreaterThanOrEqual(359);
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
