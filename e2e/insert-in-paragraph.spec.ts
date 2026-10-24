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

const LONG_ADDED = [
  "Each step creaked under him.",
  "Twice he stopped to listen to the wind.",
  "The rail was cold and wet with salt.",
  "Somewhere below, a door banged in the draught.",
  "He counted the turns as his father had taught him.",
  "At the top the lamp room smelled of oil and smoke.",
  "He set the lantern down and caught his breath.",
  "The glass was fogged on the seaward side.",
].join(" ");

test("a long insertion in a paragraph lands in batches, each fading in as one", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "final" },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, DOC);
  const ids = await blockIds(page, DOC);
  await streamRevise(
    page,
    [
      {
        id: "i2",
        args: {
          action: "insert_after",
          block: ids[0],
          anchor: "He climbed the stairs slowly.",
          text: ` ${LONG_ADDED}`,
        },
      },
    ],
    // Slow enough to be held past HOLD_MS (unit-reveal.ts).
    { chunk: 4, every: 120 },
  );
  await page.evaluate(() => {
    const w = window as unknown as {
      __b: { len: number; fading: number; starts: number[] }[];
      __on: boolean;
    };
    w.__b = [];
    w.__on = true;
    const tick = () => {
      if (!w.__on) return;
      const el = document.querySelector(".milkdown .pending-insert");
      // Still being written: the caret at its end.
      if (el?.classList.contains("pending-insert-typing")) {
        // The words coming in (ui/cascade.ts), not the caret's blink.
        const running = [...el.querySelectorAll(".cascade-word")]
          .flatMap((word) => word.getAnimations())
          .filter((a) => a.playState === "running");
        w.__b.push({
          len: (el.textContent ?? "").length,
          fading: running.length,
          starts: running.map((a) => Math.round(a.startTime as number)),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Add a few sentences");
  await composer.press("Enter");
  await expect(page.locator(".review-bar-accept")).toBeEnabled({
    timeout: 40_000,
  });
  const frames = await page.evaluate(() => {
    const w = window as unknown as {
      __b: { len: number; fading: number; starts: number[] }[];
      __on: boolean;
    };
    w.__on = false;
    return w.__b;
  });
  // Some of it was in before it was all written...
  const landed = frames.filter((f) => f.len > 0);
  expect(landed.length).toBeGreaterThan(0);
  expect(landed[0].len).toBeLessThan(LONG_ADDED.length);
  // ...its words fading in together, all begun at once.
  const fading = landed.find((f) => f.fading > 1)!;
  expect(fading).toBeTruthy();
  expect(new Set(fading.starts).size).toBe(1);
  await expect(page.locator(`${editor} p`).first()).toContainText(
    "The glass was fogged on the seaward side.",
  );
});
