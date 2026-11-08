import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown, settled } from "./helpers";

// A drawn diagram's corner button opens it in a viewer over the window: the
// wheel zooms, Escape closes it, and the press doesn't put the caret into the
// diagram's source.

const FLOW =
  "Before.\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Middle] --> C[Finish]\n```\n\nEnd.";
const preview = '[data-active-tab="true"] .ProseMirror .mermaid-preview';

test("a diagram opens in the viewer, zooms with the wheel and closes with Escape", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, FLOW);
  await page.locator('[data-active-tab="true"] .ProseMirror p').last().click();
  await expect(page.locator(`${preview} > svg`)).toBeVisible();
  await page.locator(preview).hover();
  await page.getByRole("button", { name: "Enlarge diagram" }).click();

  const viewer = page.getByRole("dialog", { name: "Diagram" });
  await expect(viewer).toBeVisible();
  // Still drawn, not opened as source.
  await expect(page.locator(`${preview} > svg`)).toBeVisible();
  const drawing = viewer.locator(".diagram-viewer-drawing");
  await expect(drawing).toContainText("Middle");
  const scaleOf = () =>
    drawing.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  const before = await scaleOf();
  const box = (await viewer.locator(".diagram-viewer-stage").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(scaleOf).toBeGreaterThan(before * 1.5);
  // A pinch (ctrl-wheel), in the margin too, is the viewer's: the window
  // behind keeps its zoom.
  const windowZoom = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--content-zoom",
      ),
    );
  const zoomBefore = await windowZoom();
  await page.keyboard.down("Control");
  await page.mouse.move(box.x - 10, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await settled(page);
  expect(await windowZoom()).toBe(zoomBefore);

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("a trackpad pinch in WebKit zooms the viewer, once", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, FLOW);
  await page.locator('[data-active-tab="true"] .ProseMirror p').last().click();
  await page.locator(preview).hover();
  await page.getByRole("button", { name: "Enlarge diagram" }).click();
  const viewer = page.getByRole("dialog", { name: "Diagram" });
  const drawing = viewer.locator(".diagram-viewer-drawing");
  await expect(drawing).toBeVisible();
  const scaleOf = () =>
    drawing.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  const before = await scaleOf();
  // WebKit sends gesture events with the scale since the start, and a
  // ctrl-wheel twin alongside.
  await viewer.evaluate((layer) => {
    const box = layer.getBoundingClientRect();
    const send = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        scale,
        clientX: box.width / 2,
        clientY: box.height / 2,
      });
      layer.dispatchEvent(event);
    };
    send("gesturestart", 1);
    send("gesturechange", 1.5);
    layer.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    send("gesturechange", 2);
    send("gestureend", 2);
  });
  expect(await scaleOf()).toBeCloseTo(before * 2, 2);
});
