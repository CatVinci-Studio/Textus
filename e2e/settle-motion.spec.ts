import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A decided proposal leaves as one move: the paragraph cross-fades, the
 * text after it glides, and its cards fade out, all from copies beside the
 * editor.
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
  await page.keyboard.press("ControlOrMeta+Shift+L");
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
      __frames: {
        ghosts: number;
        inEditor: number;
        gliding: number;
        top: number;
      }[];
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
        top: third?.getBoundingClientRect().top ?? 0,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __frames: {
          ghosts: number;
          inEditor: number;
          gliding: number;
          top: number;
        }[];
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
    // did, and nothing moves (a glide of a fraction of a pixel aside).
    const tops = frames.map((f) => f.top);
    const moved = Math.max(...tops) - Math.min(...tops);
    if (display === "inline") {
      expect(frames.some((f) => f.gliding > 0)).toBe(true);
      expect(moved).toBeGreaterThan(10);
    } else expect(moved).toBeLessThan(1);
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

test("Accept all with many proposals leaves no copies behind, and undo brings one back coming in", async ({
  page,
}) => {
  const paras = Array.from(
    { length: 8 },
    (_, i) => `Paragraph ${i + 1} opens here. It ends.`,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, paras.join("\n\n"));
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      ...paras.flatMap((p, i) => [
        {
          kind: "ToolCall",
          call_id: `c${i}`,
          name: "propose_edit",
          arguments: JSON.stringify({
            action: "replace",
            anchor: p,
            text: p.replace("opens here", "begins"),
          }),
        },
        { kind: "ToolResult", call_id: `c${i}`, output: "Edit proposed" },
      ]),
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("go");
  await composer.press("Enter");
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  await page.waitForTimeout(600);
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(".milkdown .ProseMirror p").first()).toHaveText(
    "Paragraph 1 begins. It ends.",
  );
  // Every copy faded out is gone.
  await expect(page.locator(".motion-ghost")).toHaveCount(0, {
    timeout: 2000,
  });
  // Undone, the proposal comes back coming in, not standing there at once.
  await page.locator(".milkdown .ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+z");
  const parts = page.locator(
    ".milkdown :is(.pending-delete, .pending-sentence-new)",
  );
  await expect(parts.first()).toBeVisible();
  const moving = await parts.evaluateAll(
    (els) =>
      els.filter((e) =>
        e.getAnimations().some((a) => a.playState === "running"),
      ).length,
  );
  expect(moving).toBeGreaterThan(0);
});

for (const zoom of [1.5, 0.8])
  test(`under the text's zoom (${zoom}) the copy fades out where the paragraph stood`, async ({
    page,
  }) => {
    const first =
      "The keeper woke before dawn, long before the light came up over the water. He climbed the stairs slowly, one hand on the cold rail.";
    await page.setViewportSize({ width: 1500, height: 900 });
    await openApp(page, {
      settings: { language: "en", revisionDisplay: "inline" },
      storage: { "textus-agent-panel-open": "1" },
      animations: true,
    });
    await page.evaluate(
      (z) =>
        document.documentElement.style.setProperty("--content-zoom", String(z)),
      zoom,
    );
    await pasteMarkdown(page, `${first}\n\nA gull cried far off.`);
    await mockInvoke(page, {
      ai_agent_message: [
        { kind: "User", text: "go" },
        {
          kind: "ToolCall",
          call_id: "z1",
          name: "propose_edit",
          arguments: JSON.stringify({
            action: "replace",
            anchor: first,
            text: "The keeper woke early. He climbed the stairs.",
          }),
        },
        { kind: "ToolResult", call_id: "z1", output: "Edit proposed" },
        { kind: "Assistant", text: "Done." },
      ],
    });
    const composer = page.locator(".agent-panel-view textarea");
    await composer.fill("go");
    await composer.press("Enter");
    await expect(page.locator(".review-bar-accept")).toBeEnabled();
    await page.waitForTimeout(700);
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height];
    };
    const before = await page
      .locator(".milkdown .ProseMirror > p")
      .first()
      .evaluate(box);
    // The copy, the moment it is laid down (the click's own handlers run
    // first, then this).
    await page.evaluate(() => {
      const w = window as unknown as { __ghost: number[] | null };
      w.__ghost = null;
      document.addEventListener(
        "click",
        () =>
          queueMicrotask(() => {
            const g = document.querySelector(".motion-ghost p");
            if (!g) return;
            const r = g.getBoundingClientRect();
            w.__ghost = [r.left, r.top, r.width, r.height];
          }),
        { once: true },
      );
    });
    await page.locator(".review-bar-accept").click();
    const ghost = await page.evaluate(
      () => (window as unknown as { __ghost: number[] | null }).__ghost,
    );
    expect(ghost).not.toBeNull();
    ghost!.forEach((v, i) => expect(Math.abs(v - before[i])).toBeLessThan(2));
  });
