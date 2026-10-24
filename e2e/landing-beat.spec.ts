import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * A rewrite's paragraph lands as one move (ui/moves.ts's beats): its new
 * text in the document and its cards in the margin enter together - drawn
 * a frame or two apart, the card came in after its text, as a second
 * event (1.2.1).
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

type Pair = { key: string; text: number | null; card: number | null };

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
    // The entrance's progress, in ms, of an element's running animation.
    const at = (el: Element | null) => {
      const a = el
        ?.getAnimations()
        .find((x) => x.playState === "running" || x.playState === "pending");
      const t = a?.currentTime;
      return typeof t === "number" ? t : null;
    };
    const tick = () => {
      if (!w.__on) return;
      for (const card of document.querySelectorAll<HTMLElement>(
        ".review-margin > .revision-note",
      )) {
        const label = card.getAttribute("aria-label") ?? "";
        if (seen.has(label)) continue;
        seen.add(label);
        const index = Number(label.replace(/\D+/g, "")) - 1;
        const text = document.querySelector(
          `.milkdown .pending-sentence-new[data-index="${index}"]`,
        );
        w.__pairs.push({ key: label, text: at(text), card: at(card) });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
  await page.keyboard.press("Control+Shift+L");
  await expect(page.locator(".review-bar-accept")).toBeEnabled({
    timeout: 20_000,
  });
  // Written whole, nothing is being written any more.
  await expect(page.locator(".review-note-working")).toHaveCount(0);
  await page.waitForTimeout(400);
  const pairs = await page.evaluate(() => {
    const w = window as unknown as { __pairs: Pair[]; __on: boolean };
    w.__on = false;
    return w.__pairs;
  });
  console.log("PAIRS", JSON.stringify(pairs));
  // Each card came in with its text, not after it: both mid-entrance at
  // the frame the card first shows, as far into it as one another.
  const both = pairs.filter((p) => p.text !== null && p.card !== null);
  expect(both.length).toBeGreaterThan(2);
  for (const p of both)
    expect(Math.abs(p.text! - p.card!), p.key).toBeLessThan(40);
});
