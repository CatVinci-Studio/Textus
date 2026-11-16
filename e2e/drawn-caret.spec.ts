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
        const walk = document.createTreeWalker(
          document.querySelector(sel)!,
          NodeFilter.SHOW_TEXT,
        );
        while (walk.nextNode()) {
          const i = walk.currentNode.textContent!.indexOf(word);
          if (i < 0) continue;
          const range = document.createRange();
          range.setStart(walk.currentNode, i + 1);
          range.setEnd(walk.currentNode, i + 2);
          const r = range.getBoundingClientRect();
          return { x: r.left, y: r.top + r.height / 2 };
        }
        throw new Error(word);
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
