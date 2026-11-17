import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// On desktop the caret is drawn in place of the system's; with Smooth caret
// on it glides to where it goes.

const editor = '[data-active-tab="true"] .ProseMirror';
const caret = '[data-active-tab="true"] .drawn-caret';

/** Where the system would draw the caret, on screen. */
const caretAt = (page: Page) =>
  page.evaluate(() => {
    const range = getSelection()!.getRangeAt(0).cloneRange();
    const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });

test("the drawn caret follows the typing, and steps aside for a selection", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Some words here");
  await page.locator(`${editor} p`).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and more");
  await expect(page.locator(caret)).toBeVisible();
  // Where the caret is, once it has glided there.
  await expect
    .poll(async () => {
      const drawn = (await page.locator(caret).boundingBox())!;
      const real = await caretAt(page);
      return Math.abs(drawn.x - real.x) < 3 && Math.abs(drawn.y - real.y) < 6;
    })
    .toBe(true);
  // Not gliding unless Smooth caret is on.
  await expect(page.locator(caret)).not.toHaveClass(/drawn-caret-glide/);
  await page.keyboard.press("Shift+Home");
  await expect(page.locator(caret)).toBeHidden();
});

test("the drawn caret is one height through a paragraph, beside bold, code or Chinese", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "plain **bold** `code` 中文字 $x^2$ end");
  await expect(page.locator(`${editor} p`)).toContainText("end");
  const heights = new Set<number>();
  for (const word of ["plain", "bold", "code", "中文", "end"]) {
    const at = await page.evaluate(
      ([sel, word]) => {
        // By the paragraph's whole text: a mark drawn over a letter (the
        // grammar check's) splits the word across nodes.
        const walk = document.createTreeWalker(
          document.querySelector(sel)!,
          NodeFilter.SHOW_TEXT,
        );
        const nodes: Text[] = [];
        while (walk.nextNode()) nodes.push(walk.currentNode as Text);
        let i =
          nodes
            .map((n) => n.data)
            .join("")
            .indexOf(word) + 1;
        if (i < 1) throw new Error(word);
        const node = nodes.find((n) => (i -= n.data.length) < 0)!;
        const at = node.data.length + i;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top + r.height / 2 };
      },
      [`${editor} p`, word],
    );
    await page.mouse.click(at.x, at.y);
    await expect(page.locator(caret)).toBeVisible();
    // Placed once a frame: the next one shows where the click put it.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    heights.add(
      Math.round((await page.locator(caret).boundingBox())!.height * 10),
    );
  }
  expect(heights.size).toBe(1);
});

test("the drawn caret keeps its width on screen when the document is zoomed", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "A line to zoom");
  const line = (await page.locator(`${editor} p`).boundingBox())!;
  await page.mouse.move(line.x + 40, line.y + line.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(600);
  const zoomed = (await page.locator(`${editor} p`).boundingBox())!;
  expect(zoomed.height).toBeGreaterThan(line.height * 1.2);
  await page.locator(`${editor} p`).click();
  await page.keyboard.press("End");
  const box = (await page.locator(caret).boundingBox())!;
  expect(box.width).toBeGreaterThan(1.5);
  expect(box.width).toBeLessThan(2.5);
  // On a whole screen pixel.
  const dpr = await page.evaluate(() => devicePixelRatio);
  expect(Math.abs(box.x * dpr - Math.round(box.x * dpr))).toBeLessThan(0.02);
});

test("with Smooth caret on, the drawn caret glides", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", smoothCaret: true },
    animations: true,
  });
  await page.locator(editor).click();
  await page.keyboard.type("text");
  await expect(page.locator(caret)).toHaveClass(/drawn-caret-glide/);
  // Not on the move that shows it: it starts where the caret is.
  await page.keyboard.type("s");
  await expect
    .poll(() =>
      page
        .locator(caret)
        .evaluate((el) => getComputedStyle(el).transitionProperty),
    )
    .toBe("transform");
});
