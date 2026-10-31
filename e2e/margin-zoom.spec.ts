import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * The margin's cards at the document's zoom and beside an open sidebar:
 * beside the text when there is room, never over it, and their lines from
 * the text's edge; with no room, the review bar alone.
 */

const editor = '[data-active-tab="true"] .ProseMirror';

async function trackedChange(page: Page) {
  await page.setViewportSize({ width: 1600, height: 800 });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFiles = { "/n/a.md": "# Notes\n\nA paragraph to change.\n" };
    w.__devFs = w.__devFiles;
    w.__devInvokeResults = { take_pending_window_paths: ["/n/a.md"] };
  });
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await emit(page, "menu-track-changes");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" and more");
  await expect(page.locator(".revision-note")).toHaveCount(1);
}

const emit = (page: Page, name: string) =>
  page.evaluate(
    (name) =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent(name),
    name,
  );

const zoom = (page: Page, factor: number) =>
  page.evaluate(
    (factor) =>
      document.documentElement.style.setProperty(
        "--content-zoom",
        String(factor),
      ),
    factor,
  );

test("a zoomed page with no room beside its text reviews from the bar, no card over the text", async ({
  page,
}) => {
  await trackedChange(page);
  await zoom(page, 1.8);
  await expect(page.locator(".revision-note")).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Revision" })).toBeVisible();
});

test("beside an open sidebar, a zoomed page's card stands clear of the text, its line from the text's edge", async ({
  page,
}) => {
  await trackedChange(page);
  await zoom(page, 1.15);
  await emit(page, "menu-toggle-sidebar");
  const card = page.locator(".revision-note");
  await expect(card).toHaveCount(1);
  // Settled: the column has glided over and the card has followed.
  await page.waitForTimeout(800);
  const [text, cardBox, sidebar, line] = await page.evaluate(() => {
    const box = (s: string) =>
      document.querySelector(s)!.getBoundingClientRect();
    const layer = box(".review-links");
    const d = document.querySelector(".review-links path")!.getAttribute("d")!;
    return [
      box(".editor-content .ProseMirror").right,
      box(".revision-note").left,
      box(".sidebar").right,
      layer.left + parseFloat(d.slice(1)),
    ];
  });
  expect(cardBox).toBeGreaterThanOrEqual(text);
  expect(Math.abs(line - text)).toBeLessThan(12);
  const column = await page.locator(".editor-content").boundingBox();
  expect(column!.x).toBeGreaterThanOrEqual(sidebar - 1);
});
