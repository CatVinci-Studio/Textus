import { expect, test } from "@playwright/test";
import { MAC, openApp, pasteMarkdown, settled } from "./helpers";

// Formulas, diagrams, HTML and embedded notes are drawn only within a few
// screens of the view: a document holding hundreds keeps a page the size
// of a few screens.

test("formulas far from the screen are let go, keeping their size, and drawn again as they come back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  const blocks = Array.from(
    { length: 150 },
    (_, i) => `第 ${i} 段 $x^${i}$\n\n$$\n\\frac{a_{${i}}}{b} + \\sqrt{c}\n$$`,
  );
  await pasteMarkdown(page, blocks.join("\n\n"));
  const katex = page.locator(".ProseMirror .math-block-rendered .katex");
  const scroller = page.locator(".editor-scroll").first();
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(katex.first()).toBeVisible();
  // Read to the end: those at the top go, the page doesn't move.
  const height = await scroller.evaluate((s) => s.scrollHeight);
  for (let y = 0; y <= height; y += 600) {
    await scroller.evaluate((s, y) => s.scrollTo(0, y), y);
    // Real time: a frame or so a step, as a reader scrolls.
    await page.waitForTimeout(20);
  }
  await expect.poll(() => katex.count()).toBeLessThan(100);
  const first = page.locator(".ProseMirror .math-block-rendered").first();
  await expect(first).toHaveAttribute("data-draw-pending", "");
  expect(
    await first.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(10);
  expect(
    Math.abs((await scroller.evaluate((s) => s.scrollHeight)) - height),
  ).toBeLessThan(50);
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(first.locator(".katex")).toBeVisible();
});

test("jumped straight to the end, the formulas there are drawn; folded and opened again, they come back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  const blocks = Array.from(
    { length: 150 },
    (_, i) => `第 ${i} 段\n\n$$\n\\frac{a_{${i}}}{b} + \\sqrt{c}\n$$`,
  );
  await pasteMarkdown(page, `## 开头\n\n$$\nx^2\n$$\n\n${blocks.join("\n\n")}`);
  const scroller = page.locator(".editor-scroll").first();
  const formulas = page.locator(".ProseMirror .math-block-rendered");
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(formulas.first().locator(".katex")).toBeVisible();
  // One jump to the far end: what is on screen there is drawn.
  await scroller.evaluate((s) => s.scrollTo(0, s.scrollHeight));
  await expect(formulas.last().locator(".katex")).toBeVisible();
  // Back at the top, the heading's section folded and opened again.
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(formulas.first().locator(".katex")).toBeVisible();
  await page.locator(".ProseMirror h2").click();
  // The editor has the click's caret before the keys go to it.
  await expect
    .poll(() =>
      page.evaluate(
        () => !!window.getSelection()?.anchorNode?.parentElement?.closest("h2"),
      ),
    )
    .toBe(true);
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft",
  );
  await expect(formulas.first()).toBeHidden();
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketRight" : "Control+Shift+BracketRight",
  );
  await expect(formulas.first().locator(".katex")).toBeVisible();
});

test("jumped to from the outline past many formulas, a heading lands at the top and stays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  const blocks = Array.from(
    { length: 120 },
    (_, i) => `第 ${i} 段\n\n$$\n\\frac{a_{${i}}}{b} + \\sqrt{c}\n$$`,
  );
  const after = Array.from({ length: 40 }, (_, i) => `后文 ${i}`);
  await pasteMarkdown(
    page,
    `${blocks.join("\n\n")}\n\n## 结尾\n\n${after.join("\n\n")}`,
  );
  const scroller = page.locator(".editor-scroll").first();
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await settled(page);
  // The editor taking the keys doesn't scroll it away (WebKit would, to
  // where it thought the caret was).
  await page.locator('[data-rail-id="outline"]').click();
  await page.locator(".outline-row", { hasText: "结尾" }).click();
  const end = page.locator(".ProseMirror h2", { hasText: "结尾" });
  await expect(end).toBeInViewport();
  await settled(page);
  const box = (await scroller.boundingBox())!;
  const top = (await end.boundingBox())!.y - box.y;
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(box.height / 3);
});
