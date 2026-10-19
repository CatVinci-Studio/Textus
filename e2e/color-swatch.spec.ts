import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// #146: inline code that is a colour gets a small swatch of it, with
// Settings › Editor & Appearance › Show a swatch before colour codes on (off
// by default). The code itself is unchanged, and so is the way the caret
// moves through it.

const editor = '[data-active-tab="true"] .ProseMirror';
const swatch = `${editor} .color-swatch`;

const DOC = "White `#fff`, blue `rgb(0 128 255)` and plain `red`.";

async function open(page: Page, on: boolean) {
  await openApp(page, {
    settings: { language: "en", inlineColorSwatches: on },
  });
  await pasteMarkdown(page, DOC);
  await expect(page.locator(`${editor} code`)).toHaveCount(3);
}

test("there are no swatches by default", async ({ page }) => {
  await open(page, false);
  await expect(page.locator(swatch)).toHaveCount(0);
});

test("a hex or rgb() code gets a swatch of its colour, a colour name doesn't", async ({
  page,
}) => {
  await open(page, true);
  await expect(page.locator(swatch)).toHaveCount(2);
  const colours = await page
    .locator(swatch)
    .evaluateAll((els) =>
      els.map((el) => [
        el.closest("code")?.textContent,
        (el as HTMLElement).style.getPropertyValue("--color-swatch"),
      ]),
    );
  expect(colours).toEqual([
    ["#fff", "#fff"],
    ["rgb(0 128 255)", "rgb(0 128 255)"],
  ]);
  // The code keeps its own look: no colour of its own.
  const [plain, coded] = await page
    .locator(`${editor} code`)
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))
    .then((bgs) => [bgs[2], bgs[0]]);
  expect(coded).toBe(plain);
});

test("swatches stay out of a printout", async ({ page }) => {
  await open(page, true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(swatch).first()).toBeHidden();
});

/** The paragraph's content as the editor holds it. */
const paragraph = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector(
      '[data-active-tab="true"] .ProseMirror',
    ) as unknown as {
      pmViewDesc: { node: { firstChild: { toJSON(): unknown } } };
    };
    return JSON.stringify(view.pmViewDesc.node.firstChild.toJSON());
  });

async function keys(page: Page, ...presses: string[]) {
  for (const key of presses) {
    await page.keyboard.press(key);
    // Where the editor reads the moved caret (selectionchange).
    await page.waitForTimeout(30);
  }
}

/** Runs the same keys with swatches off and on; the text must come out
 *  the same - the swatch is no stop on the caret's way. */
async function sameWithAndWithout(
  page: Page,
  run: (page: Page) => Promise<void>,
) {
  const results: string[] = [];
  for (const on of [false, true]) {
    await open(page, on);
    await page.locator(`${editor} p`).click();
    await run(page);
    results.push(await paragraph(page));
  }
  expect(results[1]).toBe(results[0]);
  return JSON.parse(results[1]) as {
    content: { type: string; text?: string; content?: { text: string }[] }[];
  };
}

test("the caret steps into a colour code from the left as it does without the swatch", async ({
  page,
}) => {
  const result = await sameWithAndWithout(page, async (p) => {
    // "White " then the span: six steps to its edge, one more inside.
    await keys(p, "Home", ...Array(7).fill("ArrowRight"));
    await p.keyboard.type("X");
  });
  expect(result.content[1].content?.[0].text).toBe("X#fff");
});

test("the caret steps out of a colour code to the left as it does without the swatch", async ({
  page,
}) => {
  const result = await sameWithAndWithout(page, async (p) => {
    // To the end of "#fff", then back across it and out of the span.
    await keys(p, "Home", ...Array(11).fill("ArrowRight"));
    await keys(p, ...Array(5).fill("ArrowLeft"));
    await p.keyboard.type("Y");
  });
  expect(result.content[0].text).toBe("White Y");
  expect(result.content[1].content?.[0].text).toBe("#fff");
});
