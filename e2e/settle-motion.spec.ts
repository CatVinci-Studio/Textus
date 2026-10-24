import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A proposal decided leaves as one move (revision/settle-motion.ts): the
 * paragraph it was drawn in cross-fades from how it looked to how it now
 * reads, the text after it glides to its new place, and its cards fade out
 * in the margin - from copies laid beside the editor, never in it.
 * Decided at once, the text jumped and the cards were gone between two
 * frames (1.2.1).
 */

const FIRST =
  "The keeper woke before dawn, long before the light came up over the water, and lay a while listening to the house settle around him. He climbed the stairs slowly, one hand on the cold rail, counting them as his father had taught him to.";
const ORIGINAL = [
  FIRST,
  "The wind had dropped in the night. The lamp was still warm.",
  "A gull cried far off. The tide was turning.",
].join("\n\n");
const REWRITE = "The keeper woke early. He climbed the stairs.";

async function propose(page: Page, display: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: display },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, ORIGINAL);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "m1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: FIRST,
          text: REWRITE,
        }),
      },
      { kind: "ToolResult", call_id: "m1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("go");
  await composer.press("Enter");
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  await page.keyboard.press("Control+Shift+L");
  if (display !== "inline")
    await expect(
      page.locator(".review-margin > .revision-note").first(),
    ).toBeVisible();
  await page.waitForTimeout(600);
}

/** What the frames after a decision showed, sampled every frame. */
async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __frames: { ghosts: number; inEditor: number; gliding: number }[];
      __on: boolean;
    };
    w.__frames = [];
    w.__on = true;
    const tick = () => {
      if (!w.__on) return;
      const third = document.querySelectorAll(
        '[data-active-tab="true"] .ProseMirror > p',
      )[2];
      w.__frames.push({
        ghosts: document.querySelectorAll(".motion-ghost").length,
        inEditor: document.querySelectorAll(".ProseMirror .motion-ghost")
          .length,
        gliding:
          third?.getAnimations().filter((a) => a.playState === "running")
            .length ?? 0,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __frames: { ghosts: number; inEditor: number; gliding: number }[];
        __on: boolean;
      };
      w.__on = false;
      return w.__frames;
    });
}

for (const display of ["inline", "final"] as const)
  test(`Accept cross-fades the paragraph and glides the text after it (${display})`, async ({
    page,
  }) => {
    await propose(page, display);
    const stop = await watch(page);
    await page.locator(".review-bar-accept").click();
    await expect(page.locator(".milkdown .ProseMirror p").first()).toHaveText(
      REWRITE,
    );
    await page.waitForTimeout(700);
    const frames = await stop();
    // The old look fades out over the new, beside the editor - never in
    // its own DOM - and is gone once it has.
    expect(frames.some((f) => f.ghosts > 0)).toBe(true);
    expect(frames.every((f) => f.inEditor === 0)).toBe(true);
    expect(frames.at(-1)!.ghosts).toBe(0);
    // The text below glides to where the paragraph now ends - in the text
    // with both sides, the original's lines gone; Result only reads as it
    // did, and nothing moves.
    expect(frames.some((f) => f.gliding > 0)).toBe(display === "inline");
  });

test("Reject fades the proposal and its cards out, and leaves the text as it was", async ({
  page,
}) => {
  await propose(page, "final");
  const stop = await watch(page);
  await page
    .locator(".review-bar")
    .getByRole("button", { name: "Reject" })
    .click();
  await expect(page.locator(".milkdown .ProseMirror p").first()).toHaveText(
    FIRST,
  );
  await expect(page.locator(".review-margin > .revision-note")).toHaveCount(0);
  await page.waitForTimeout(700);
  const frames = await stop();
  expect(frames.some((f) => f.ghosts > 0)).toBe(true);
  expect(frames.every((f) => f.inEditor === 0)).toBe(true);
  expect(frames.at(-1)!.ghosts).toBe(0);
});
