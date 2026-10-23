import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A drawn diagram's corner button opens it in a viewer over the window
// (editor/diagram-zoom.ts): the wheel zooms, Escape closes it, and the
// press on the button doesn't put the caret into the diagram's source.

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

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
