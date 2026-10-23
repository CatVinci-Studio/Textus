import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";
import { STORY, STORY_CLASSICAL, streamRevise } from "./revise-mock";

/**
 * A rewrite in the margin views (1.2.0-rc.1 feedback): the text reads as it
 * will once accepted - a paragraph the rewrite joins to the one before it
 * left a blank gap - the cards stack and move instead of the text, and a
 * rewrite streaming in brings its changes one at a time: the text, the
 * card and the review bar's count together.
 */

const LONG = [STORY, STORY, STORY].join("\n\n");
const LONG_CLASSICAL = [STORY_CLASSICAL, STORY_CLASSICAL, STORY_CLASSICAL].join(
  "\n\n",
);

async function open(
  page: Page,
  markdown: string,
  display: "new" | "final" | "original",
  width = 1440,
) {
  await page.setViewportSize({ width, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: display },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, markdown);
}

async function send(page: Page) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Classical Chinese, please");
  await composer.press("Enter");
}

/** The rewrite of `anchor`, proposed whole at once. */
async function propose(page: Page, anchor: string, text: string) {
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({ action: "replace", anchor, text }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  await send(page);
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  // A narrow window has room for the margin once the AI panel is closed.
  if (page.viewportSize()!.width < 1300)
    await page.keyboard.press("Control+Shift+L");
}

/** The blocks of the document that take up room, as they stand: top
 *  (from the first one's) and height. */
function blocks(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const rects = Array.from(root.children)
      .filter((e) => getComputedStyle(e).position !== "absolute")
      .map((e) => e.getBoundingClientRect());
    return rects.map((r) => ({
      top: Math.round(r.top - rects[0].top),
      height: Math.round(r.height),
    }));
  });
}

function cards(page: Page) {
  return page.locator(".revision-note").evaluateAll((els: HTMLElement[]) =>
    els.map((e) => ({
      top: e.offsetTop,
      bottom: e.offsetTop + e.offsetHeight,
    })),
  );
}

for (const display of ["new", "final"] as const)
  for (const width of [1440, 1100])
    test(`"${display}" leaves no blank gaps where a rewrite joins paragraphs, ${width}px`, async ({
      page,
    }) => {
      await open(page, STORY, display, width);
      await propose(page, STORY, STORY_CLASSICAL);
      await expect(page.locator(".milkdown .ProseMirror")).toHaveAttribute(
        "data-revision-display",
        display,
      );
      // Two of the ten paragraphs are joined to the one before them.
      await expect(page.locator(".milkdown .pending-struck-block")).toHaveCount(
        2,
      );
      const shown = await blocks(page);
      expect(shown).toHaveLength(8);
      await page.locator(".review-bar-accept").click();
      await expect(page.locator(".review-bar")).toHaveCount(0);
      // The text stood exactly where it does once accepted.
      const accepted = await blocks(page);
      expect(accepted).toHaveLength(8);
      shown.forEach((b, i) => {
        expect(Math.abs(b.top - accepted[i].top), `block ${i}`).toBeLessThan(2);
        expect(Math.abs(b.height - accepted[i].height)).toBeLessThan(2);
      });
    });

test("with many revisions the cards stack and move, the text doesn't", async ({
  page,
}) => {
  await open(page, LONG, "new", 1100);
  await propose(page, LONG, LONG_CLASSICAL);
  await expect(page.locator(".revision-note")).toHaveCount(24);
  await expect(page.locator(".review-bar-pos")).toHaveText("24 changes");
  const withCards = await blocks(page);
  // No card overlaps the one above it, once their heights are measured.
  await expect
    .poll(async () => {
      const stacked = await cards(page);
      return stacked.filter((c, i) => i > 0 && c.top < stacked[i - 1].bottom)
        .length;
    })
    .toBe(0);
  // The text is laid out as in the view without cards.
  await page.locator(".review-bar-view-button").click();
  await page
    .getByRole("menuitemradio", { name: "Result only, no markup" })
    .click();
  await expect(page.locator(".revision-note")).toHaveCount(0);
  expect(await blocks(page)).toEqual(withCards);
});

test("a crowded rewrite's cards are cut to stand by their passages, and open whole", async ({
  page,
}) => {
  await open(page, LONG, "new", 1100);
  await propose(page, LONG, LONG_CLASSICAL);
  await expect(page.locator(".revision-note")).toHaveCount(24);
  // A line for every card from the start, not only once pointed at.
  await expect(page.locator(".review-links path")).toHaveCount(24);
  // Whole, the cards ran ever further below their sentences; cut to the
  // room beside each, none is pushed far from its own.
  await expect(page.locator(".review-links path.far")).toHaveCount(0);
  const cut = page.locator(
    ".revision-note:is(.review-note-chip, .review-note-cut)",
  );
  expect(await cut.count()).toBeGreaterThan(16);
  const tops = await page
    .locator(".revision-note")
    .evaluateAll((els: HTMLElement[]) => els.map((e) => e.offsetTop));
  // In order, and never overlapping one another.
  for (let i = 1; i < tops.length; i++)
    expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  // Pointed at, one opens whole over the ones below, which stay put.
  const card = page.locator(".revision-note").nth(5);
  await card.hover();
  await expect(card).toHaveClass(/review-note-cut-open/);
  await expect(page.locator(".review-links path.hot")).toHaveCount(1);
  expect(
    await page
      .locator(".revision-note")
      .evaluateAll((els: HTMLElement[]) => els.map((e) => e.offsetTop)),
  ).toEqual(tops);
  // The review bar's pointer opens it too.
  // Left, it closes again - unless it is the one the review bar points at.
  await page.mouse.move(10, 10);
  await expect(
    page.locator(".review-note-cut-open:not(.revision-note-focus)"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Previous edit" }).click();
  await expect(page.locator(".revision-note-focus")).toContainText("24");
  // Not a chip: opened, or whole.
  await expect(page.locator(".revision-note-focus")).not.toHaveClass(
    /review-note-chip\b/,
  );
  await expect(page.locator(".review-links path.hot")).toHaveCount(1);
});

type Sample = {
  streaming: boolean;
  count: number | null;
  cards: number;
  fresh: number;
  tops: number[];
};

test("a streaming rewrite brings its changes one at a time: text, card and count", async ({
  page,
}) => {
  await open(page, STORY, "new");
  await streamRevise(
    page,
    [
      {
        id: "s1",
        args: { action: "replace", anchor: STORY, text: STORY_CLASSICAL },
      },
    ],
    { chunk: 4, every: 20 },
  );
  await page.evaluate(() => {
    const w = window as unknown as { __samples: Sample[]; __on: boolean };
    w.__samples = [];
    w.__on = true;
    const tick = () => {
      if (!w.__on) return;
      const pos = document.querySelector(".review-bar-pos")?.textContent;
      w.__samples.push({
        streaming:
          document.querySelector(
            ".milkdown .pending-partial, .pending-pick.pending-streaming",
          ) !== null,
        count: pos ? parseInt(pos, 10) : null,
        cards: document.querySelectorAll(".revision-note").length,
        fresh: document.querySelectorAll(".milkdown .pending-sentence-new")
          .length,
        tops: Array.from(
          document.querySelectorAll<HTMLElement>(".revision-note"),
        ).map((e) => e.offsetTop),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await send(page);
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  await page.waitForTimeout(300);
  const samples = await page.evaluate(() => {
    const w = window as unknown as { __samples: Sample[]; __on: boolean };
    w.__on = false;
    return w.__samples;
  });
  const streaming = samples.filter((s) => s.streaming);
  // The bar is there from the start, counting from nothing.
  const counted = streaming.filter((s) => s.count !== null);
  expect(counted.length).toBeGreaterThan(10);
  expect(counted[0].count).toBeLessThanOrEqual(1);
  // One more card and count as each change completes, never fewer.
  const seen = new Set<number>();
  for (let i = 0; i < counted.length; i++) {
    const s = counted[i];
    expect(s.count).toBe(s.cards);
    expect(s.cards).toBeLessThanOrEqual(s.fresh);
    if (i > 0) expect(s.cards).toBeGreaterThanOrEqual(counted[i - 1].cards);
    seen.add(s.cards);
  }
  for (const n of [1, 2, 3, 4, 5, 6]) expect(seen.has(n), `${n}`).toBe(true);
  // Nothing moves when it settles: the last sentence, complete only once
  // the stream ends, brings the last card, and the others stay put.
  const last = streaming.at(-1)!;
  const settled = samples.at(-1)!;
  expect(settled.cards).toBe(8);
  expect(last.cards).toBeGreaterThanOrEqual(7);
  last.tops.forEach((top, i) =>
    expect(Math.abs(top - settled.tops[i])).toBeLessThan(1),
  );
});

test("mid-stream, ‹ › step through the changes so far; Accept and Reject wait", async ({
  page,
}) => {
  await open(page, STORY, "new");
  const args = { action: "replace", anchor: STORY, text: STORY_CLASSICAL };
  const json = JSON.stringify(args);
  // Held while the folded dialogue is being written.
  const hold = Math.ceil((json.indexOf("里面全是灰，") + 4) / 4);
  await streamRevise(page, [{ id: "s1", args }], { chunk: 4, hold });
  await send(page);
  await expect(page.locator(".revision-note")).toHaveCount(5);
  await expect(page.locator(".milkdown .pending-partial")).toBeVisible();
  await expect(page.locator(".review-bar-pos")).toHaveText("5 changes");
  await expect(page.locator(".review-bar-accept")).toBeDisabled();
  await expect(
    page.locator(".review-bar").getByRole("button", { name: "Reject" }),
  ).toBeDisabled();
  await expect(
    page.locator(".revision-note").first().getByRole("button").first(),
  ).toBeDisabled();
  const next = page.getByRole("button", { name: "Next edit" });
  await next.click();
  await next.click();
  await expect(page.locator(".review-bar-pos")).toHaveText("2 / 5");
  await expect(page.locator(".revision-note-focus")).toContainText(
    "林阿姨把那台旧收音机搬到窗边",
  );
  await expect(
    page.locator(".milkdown .pending-sentence-new.pending-sentence-focus"),
  ).toHaveText("林阿姨移旧收音机至窗边，启工具盒。");
  // The paragraphs keep their spacing while it streams: one line each,
  // evenly apart.
  const shown = await blocks(page);
  expect(shown).toHaveLength(10);
  const gaps = shown.slice(1).map((b, i) => b.top - shown[i].top);
  for (const gap of gaps) expect(Math.abs(gap - gaps[0])).toBeLessThan(2);
  // Stopped, what arrived can be decided on.
  await page
    .locator(".agent-panel-view")
    .getByRole("button", { name: "Stop" })
    .click();
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  await expect(page.locator(".review-bar-pos")).toHaveText(/5/);
});
