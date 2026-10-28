import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * A rewrite's paragraph lands as one move: its new text in the document and
 * its cards in the margin enter together.
 */

const ORIGINAL = [
  "The keeper woke before dawn. He climbed the stairs slowly.",
  "The wind had dropped in the night. The lamp was still warm.",
  "A gull cried far off. The tide was turning.",
].join("\n\n");
const REWRITE = [
  "The keeper woke before dawn. He climbed the stairs one by one.",
  "The wind had fallen in the night. The lamp was warm to the touch.",
  "A gull cried, far off. The tide was on the turn.",
].join("\n\n");

type Pair = {
  key: string;
  text: number | null;
  card: number | null;
  frame: number;
};

test("a landed paragraph's text and cards enter on one beat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "final" },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, ORIGINAL);
  // The margin has room once the AI panel is closed; the stream goes on.
  await streamRevise(
    page,
    [
      {
        id: "b1",
        args: { action: "replace", anchor: ORIGINAL, text: REWRITE },
      },
    ],
    { chunk: 6, every: 25 },
  );
  await page.evaluate(() => {
    const w = window as unknown as { __pairs: Pair[]; __on: boolean };
    w.__pairs = [];
    w.__on = true;
    const seen = new Set<string>();
    let last = performance.now();
    // How far into its entrance an element is, in ms: its effect's time
    // less the delay it was set back by (a part joining a beat late starts
    // partway in) - once it is playing, null before.
    const at = (el: Element | null) => {
      const a = el?.getAnimations().find((x) => x.playState === "running");
      const effect = a?.effect;
      const local = effect?.getComputedTiming().localTime;
      if (!effect || typeof local !== "number" || local <= 0) return null;
      return local - (effect.getTiming().delay ?? 0);
    };
    const tick = () => {
      if (!w.__on) return;
      const now = performance.now();
      const frame = now - last;
      last = now;
      for (const card of document.querySelectorAll<HTMLElement>(
        ".review-margin > .revision-note",
      )) {
        const label = card.getAttribute("aria-label") ?? "";
        // Measured the first frame both are playing.
        if (seen.has(label) || at(card) === null) continue;
        seen.add(label);
        const index = Number(label.replace(/\D+/g, "")) - 1;
        const text = document.querySelector(
          `.milkdown .pending-sentence-new[data-index="${index}"]`,
        );
        w.__pairs.push({ key: label, text: at(text), card: at(card), frame });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
  await page.keyboard.press("ControlOrMeta+Shift+L");
  await expect(page.locator(".review-bar-accept")).toBeEnabled({
    timeout: 20_000,
  });
  // Written whole, the bar no longer says it is being written.
  await expect(page.locator(".review-bar-working")).toHaveCount(0);
  await page.waitForTimeout(400);
  const pairs = await page.evaluate(() => {
    const w = window as unknown as { __pairs: Pair[]; __on: boolean };
    w.__on = false;
    return w.__pairs;
  });
  console.log("PAIRS", JSON.stringify(pairs));
  // Each card came in with its text, not after it: as far into its
  // entrance as its text, however late it was drawn - give or take a
  // couple of frames, long on a busy machine.
  const both = pairs.filter((p) => p.text !== null && p.card !== null);
  expect(both.length).toBeGreaterThan(2);
  for (const p of both)
    expect(Math.abs(p.text! - p.card!), p.key).toBeLessThan(
      Math.max(40, 2 * p.frame),
    );
});
