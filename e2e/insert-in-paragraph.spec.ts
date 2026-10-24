import { expect, test } from "@playwright/test";
import { blockIds, openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * New text a proposal adds next to a sentence inside a paragraph shows
 * there, in the paragraph, where Accept writes it - in every view. Drawn
 * at the paragraph's edge, it stood as a paragraph of its own and moved
 * into the text when taken (1.2.1).
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const DOC =
  "The keeper woke before dawn. He climbed the stairs slowly. The lamp was still warm.\n\nOutside, the sea was calm.";
const ADDED =
  "Each step creaked under him, and twice he stopped to listen to the wind.";
const RESULT = `The keeper woke before dawn. He climbed the stairs slowly. ${ADDED} The lamp was still warm.`;

for (const display of ["final", "original", "inline"] as const)
  test(`an insertion inside a paragraph shows where it lands (${display})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openApp(page, {
      settings: { language: "en", revisionDisplay: display },
      storage: { "textus-agent-panel-open": "1" },
    });
    await pasteMarkdown(page, DOC);
    const ids = await blockIds(page, DOC);
    await streamRevise(page, [
      {
        id: "i1",
        args: {
          action: "insert_after",
          block: ids[0],
          anchor: "He climbed the stairs slowly.",
          text: ` ${ADDED}`,
        },
      },
    ]);
    const composer = page.locator(".agent-panel-view textarea");
    await composer.fill("Add a sentence");
    await composer.press("Enter");
    await expect(page.locator(".review-bar-accept")).toBeEnabled();
    // In the paragraph, right after its sentence - the text reads as it
    // will once taken - and no paragraph of its own.
    const first = page.locator(`${editor} p`).first();
    await expect(first).toHaveText(RESULT);
    await expect(page.locator(`${editor} > p`)).toHaveCount(2);
    await page.locator(".review-bar-accept").click();
    await expect(first).toHaveText(RESULT);
    await expect(page.locator(`${editor} .pending-insert`)).toHaveCount(0);
  });
