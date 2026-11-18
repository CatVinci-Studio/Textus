import { expect, test, type Page } from "@playwright/test";
import { MAC, openApp, pasteMarkdown } from "./helpers";

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

/** At each zoom, out and in: the caret 2 px wide on screen, on whole
 *  device pixels. */
async function caretAtZooms(page: Page) {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "A line to zoom");
  const p = page.locator(`${editor} p`);
  const dpr = await page.evaluate(() => devicePixelRatio);
  const onPixel = (v: number) => Math.abs(v * dpr - Math.round(v * dpr)) < 0.07;
  const zoom = async (by: number) => {
    const line = (await p.boundingBox())!;
    await page.mouse.move(line.x + 40, line.y + line.height / 2);
    await page.keyboard.down("Control");
    for (let i = 0; i < Math.abs(by); i++)
      await page.mouse.wheel(0, by > 0 ? -120 : 120);
    await page.keyboard.up("Control");
    // Real time: a pinch ends once the wheel has been still a moment (useZoom's 250 ms).
    await page.waitForTimeout(500);
  };
  const heights = [];
  for (const by of [0, -2, 3, 3]) {
    if (by) await zoom(by);
    await p.click();
    await page.keyboard.press(MAC ? "Meta+ArrowRight" : "End");
    const box = (await page.locator(caret).boundingBox())!;
    expect(box.width * dpr).toBeCloseTo(Math.round(2 * dpr), 1);
    expect(onPixel(box.x)).toBe(true);
    expect(onPixel(box.y)).toBe(true);
    expect(onPixel(box.height)).toBe(true);
    heights.push(box.height);
  }
  // The zoom did take: the caret grew with the text, not wider.
  expect(heights[3]).toBeGreaterThan(heights[1] * 1.3);
}

test("the drawn caret keeps its width on screen at any zoom, on whole pixels", async ({
  page,
}) => {
  await caretAtZooms(page);
});

test.describe("on a Retina screen", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the drawn caret keeps its width on screen at any zoom, on whole pixels", async ({
    page,
  }) => {
    await caretAtZooms(page);
  });
});

test("the drawn caret stays while an input method composes, where its text ends", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "input method by CDP");
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Typing in Chinese:");
  await page.locator(`${editor} p`).click();
  await page.keyboard.press("End");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "ni hao",
    selectionStart: 6,
    selectionEnd: 6,
  });
  await expect(page.locator(`${editor} p`)).toContainText("ni hao");
  const near = async () => {
    const drawn = (await page.locator(caret).boundingBox())!;
    const real = await caretAt(page);
    return Math.abs(drawn.x - real.x) < 2;
  };
  await expect(page.locator(caret)).toBeVisible();
  await expect.poll(near).toBe(true);
  await cdp.send("Input.insertText", { text: "你好" });
  await expect(page.locator(`${editor} p`)).toContainText("你好");
  await expect(page.locator(caret)).toBeVisible();
  await expect.poll(near).toBe(true);
});

test("after a formula, on an empty line and beside a picture, the drawn caret stands on its line", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Before $x^2$\n\nAfter");
  const line = page.locator(`${editor} p`).first();
  // On the words, away from the formula, then to the line's end: right
  // after the formula, where the browser may give no box.
  await line.click({ position: { x: 4, y: 8 } });
  await page.keyboard.press(MAC ? "Meta+ArrowRight" : "End");
  const p = (await line.boundingBox())!;
  const drawn = () => page.locator(caret).boundingBox();
  await expect
    .poll(async () => {
      const box = (await drawn())!;
      return (
        box.x > p.x + 40 &&
        box.y > p.y - 4 &&
        box.y + box.height < p.y + p.height + 4
      );
    })
    .toBe(true);
  // A new empty line below it.
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const box = (await drawn())!;
      return box.y > p.y + p.height - 4 && Math.abs(box.x - p.x) < 4;
    })
    .toBe(true);
  // A picture alone on the last line: the caret after it is as tall.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"/>',
  ).toString("base64");
  await page.keyboard.press(MAC ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.press("Enter");
  await pasteMarkdown(page, `![p](data:image/svg+xml;base64,${svg})`);
  const img = page.locator(`${editor} img:not(.ProseMirror-separator)`);
  await expect(img).toBeVisible();
  await page.keyboard.press(MAC ? "Meta+ArrowDown" : "Control+End");
  await expect
    .poll(async () => {
      const box = (await drawn())!;
      const pic = (await img.boundingBox())!;
      return (
        Math.abs(box.height - pic.height) < 2 && Math.abs(box.y - pic.y) < 2
      );
    })
    .toBe(true);
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
