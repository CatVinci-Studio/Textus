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

// A rewrite that keeps a card per paragraph (sentence-diff.ts merges a run
// of short ones only when both sides are short): the story's lines but its
// dialogue, each rewritten at length - short passages, tall cards.
const TAIL_CLASSICAL =
  "窗外雨犹未止，室中唯闻螺丝刀触壳之声，一下复一下，若有人于极远之处，耐心叩一扇不复开启之门，久久不绝。灯影摇于壁上，旧物无言，人亦无言，唯夜色渐深。";
const pick = (text: string, keep: number[], tail: string) =>
  keep.map((i) => `${text.split("\n\n")[i]}${tail}`);
const LINES = pick(STORY, [0, 1, 2, 3, 4, 8, 9], "");
const LINES_CLASSICAL = pick(
  STORY_CLASSICAL,
  [0, 1, 2, 3, 4, 6, 7],
  TAIL_CLASSICAL,
);
const LONG = [...LINES, ...LINES, ...LINES].join("\n\n");
const LONG_CLASSICAL = [
  ...LINES_CLASSICAL,
  ...LINES_CLASSICAL,
  ...LINES_CLASSICAL,
].join("\n\n");

async function open(
  page: Page,
  markdown: string,
  display: "final" | "original",
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
    // A block of new text (several paragraphs rewritten as one change)
    // counts as the paragraphs it holds, as they will stand once taken.
    const rects = Array.from(root.children)
      .filter((e) => getComputedStyle(e).position !== "absolute")
      .flatMap((e) =>
        e.matches(".pending-insert.pending-blocks, .pending-sentence-new")
          ? Array.from(e.children)
          : [e],
      )
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.height > 0);
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

for (const display of ["final"] as const)
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
      // Two of the ten paragraphs are joined to the one before them, and
      // runs of the short ones are rewritten as changes of paragraphs: what
      // shows is the eight paragraphs it will be, where they will be.
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
  await open(page, LONG, "original", 1100);
  await propose(page, LONG, LONG_CLASSICAL);
  await expect(page.locator(".revision-note")).toHaveCount(21);
  await expect(page.locator(".review-bar-pos")).toHaveText("21 changes");
  const withCards = await blocks(page);
  // No card overlaps the one above it, once their heights are measured.
  await expect
    .poll(async () => {
      const stacked = await cards(page);
      return stacked.filter((c, i) => i > 0 && c.top < stacked[i - 1].bottom)
        .length;
    })
    .toBe(0);
  // A card opened whole moves the ones below it, never the text.
  await page
    .locator(".revision-note")
    .nth(3)
    .click({ position: { x: 40, y: 12 } });
  await expect(page.locator(".revision-note-focus")).toHaveCount(1);
  expect(await blocks(page)).toEqual(withCards);
});

test("a crowded rewrite's cards are cut to stand by their passages, and open whole", async ({
  page,
}) => {
  await open(page, LONG, "original", 1100);
  await propose(page, LONG, LONG_CLASSICAL);
  await expect(page.locator(".revision-note")).toHaveCount(21);
  // A line for every card from the start, not only once pointed at.
  await expect(page.locator(".review-links path")).toHaveCount(21);
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
  // Clicked, one opens whole over the ones below, which stay put.
  const first = await page
    .locator(".revision-note")
    .evaluateAll((els) =>
      els.findIndex((e) => e.matches(".review-note-cut, .review-note-chip")),
    );
  expect(first).toBeGreaterThan(-1);
  const card = page.locator(".revision-note").nth(first);
  await card.click({ position: { x: 40, y: 12 } });
  await expect(card).toHaveClass(/review-note-cut-open/);
  await expect(page.locator(".review-links path.hot")).toHaveCount(1);
  expect(
    await page
      .locator(".revision-note")
      .evaluateAll((els: HTMLElement[]) => els.map((e) => e.offsetTop)),
  ).toEqual(tops);
  // Escape closes it; the review bar's pointer opens one too.
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".review-note-cut-open:not(.revision-note-focus)"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Previous edit" }).click();
  await expect(page.locator(".revision-note-focus")).toContainText("21");
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
  const story = LINES.join("\n\n");
  await open(page, story, "original");
  await streamRevise(
    page,
    [
      {
        id: "s1",
        args: {
          action: "replace",
          anchor: story,
          text: LINES_CLASSICAL.join("\n\n"),
        },
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
  expect(settled.cards).toBe(7);
  expect(last.cards).toBeGreaterThanOrEqual(6);
  last.tops.forEach((top, i) =>
    expect(Math.abs(top - settled.tops[i])).toBeLessThan(1),
  );
});

test("mid-stream, ‹ › step through the changes so far; Accept and Reject wait", async ({
  page,
}) => {
  const story = LINES.join("\n\n");
  await open(page, story, "original");
  const args = {
    action: "replace",
    anchor: story,
    text: LINES_CLASSICAL.join("\n\n"),
  };
  const json = JSON.stringify(args);
  // Held while the sixth paragraph is being written.
  const hold = Math.ceil((json.indexOf("儿子说完，") + 4) / 4);
  await streamRevise(page, [{ id: "s1", args }], { chunk: 4, hold });
  await send(page);
  // One landing at a time (unit-reveal.ts): slower on a loaded machine.
  await expect(page.locator(".revision-note")).toHaveCount(5, {
    timeout: 15_000,
  });
  // The new text is only ever in the margin: none of it in the text.
  await expect(page.locator(".milkdown .pending-partial")).toBeHidden();
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
  // The paragraphs keep their spacing while it streams: one line each,
  // evenly apart.
  const shown = await blocks(page);
  expect(shown).toHaveLength(7);
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

test("a sentence the rewrite adds has a card that says Added, not an empty entry", async ({
  page,
}) => {
  const original = "The keeper woke before dawn. Outside, the sea was calm.";
  await open(page, original, "original");
  await propose(
    page,
    original,
    "The keeper woke before dawn. He lit the lamp. Outside, the sea was calm.",
  );
  const card = page.locator(".revision-note");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".revision-note-was")).toHaveText("Added");
  await expect(card.locator(".revision-note-text")).toContainText(
    "He lit the lamp.",
  );
  // In the text, only the mark where it goes.
  await expect(page.locator(".milkdown .pending-insert-mark")).toBeVisible();
});

test("a change's number fits its badge past two digits", async ({ page }) => {
  await open(page, STORY, "original");
  const fits = await page.evaluate(() =>
    ["revision-note-num", "agent-proposal-num", "review-badge"].map((name) => {
      const el = document.createElement("span");
      el.className = name;
      el.textContent = "128";
      document.body.append(el);
      const ok = el.scrollWidth <= el.clientWidth + 0.5;
      el.remove();
      return ok;
    }),
  );
  expect(fits).toEqual([true, true, true]);
});
