import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * A streaming rewrite lands a paragraph at a time, each paragraph's changes
 * together, and nothing moves when the stream ends.
 */

export const ORIGINAL =
  "The keeper woke before dawn. He climbed the stairs slowly. The wind had dropped in the night. The lamp was still warm. Outside, the sea was calm.";
export const REWRITE =
  "The keeper woke before dawn. He climbed the stairs one by one. The lamp was warm to the touch. Outside, the sea was calm.";

type Sample = {
  whole: number;
  struck: string[];
  fresh: { index: string; text: string; x: number; y: number }[];
  partial: string | null;
  live: number;
  /** Every struck original and new text on screen, with the identity of
   *  its element: one drawn again shows up with a new id. */
  drawn: { text: string; id: number }[];
};

/** Records the proposal's parts every frame until `stop()`. */
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __samples: Sample[];
      __recording: boolean;
    };
    w.__samples = [];
    w.__recording = true;
    const root = document.querySelector(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    let next = 0;
    const ids = new WeakMap<Element, number>();
    const id = (e: Element) => {
      if (!ids.has(e)) ids.set(e, next++);
      return ids.get(e)!;
    };
    const tick = () => {
      if (!w.__recording) return;
      w.__samples.push({
        drawn: Array.from(
          root.querySelectorAll(".pending-sentence, .pending-sentence-new"),
        ).map((e) => ({ text: e.textContent ?? "", id: id(e) })),
        whole: root.querySelectorAll(".pending-whole").length,
        struck: Array.from(root.querySelectorAll(".pending-sentence")).map(
          (e) => e.textContent ?? "",
        ),
        fresh: Array.from(
          root.querySelectorAll<HTMLElement>(".pending-sentence-new"),
        ).map((e) => {
          const r = e.getBoundingClientRect();
          return {
            index: e.dataset.index ?? "",
            text: e.textContent ?? "",
            x: r.x,
            y: r.y,
          };
        }),
        partial: root.querySelector(".pending-partial")?.textContent ?? null,
        live: root.querySelectorAll(".pending-pick:not(.pending-streaming)")
          .length,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return async () => {
    return page.evaluate(() => {
      const w = window as unknown as {
        __samples: Sample[];
        __recording: boolean;
      };
      w.__recording = false;
      return w.__samples;
    });
  };
}

/** The proposal's parts in document order, as text: what the final layout
 *  is compared by. */
async function layout(page: Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-active-tab="true"] .ProseMirror :is(.pending-delete, .pending-insert, .pending-pick, .pending-insert-mark)',
      ),
    ).map((e) =>
      [
        Array.from(e.classList)
          .filter((c) =>
            /^pending-(delete|insert|pick|insert-mark|sentence|sentence-new|whole)$/.test(
              c,
            ),
          )
          .sort()
          .join("."),
        (e as HTMLElement).dataset.index,
        e.textContent,
      ].join("|"),
    ),
  );
}

async function open(
  page: Page,
  settings: Record<string, unknown> = {},
  animations = false,
  markdown = ORIGINAL,
) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline", ...settings },
    storage: { "textus-agent-panel-open": "1" },
    animations,
  });
  await pasteMarkdown(page, markdown);
}

async function send(page: Page) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
}

const REVISE = {
  id: "r1",
  args: { action: "replace", anchor: ORIGINAL, text: REWRITE },
};

// Two paragraphs, the first landing while the second is still written.
const TAIL = "A gull cried. It was far off. The tide was turning.";
const TAIL_REWRITE = "A gull cried. It was very far off. The tide was turning.";
const STORY = `${ORIGINAL}\n\n${TAIL}`;
const REVISE_STORY = {
  id: "r1",
  args: {
    action: "replace",
    anchor: STORY,
    text: `${REWRITE}\n\n${TAIL_REWRITE}`,
  },
};

/** Where the first paragraph's rewrite is done and the second's begun:
 *  as many fragments of `chunk` characters into the call's arguments. */
function intoSecond(chunk = 6) {
  const json = JSON.stringify(REVISE_STORY.args);
  return Math.ceil((json.indexOf("It was very") + 4) / chunk);
}

const hasFirst = (s: Sample) =>
  s.fresh.some((f) => f.text === "He climbed the stairs one by one.");
const hasSecond = (s: Sample) =>
  s.fresh.some((f) => f.text === "The lamp was warm to the touch.");
const hasTail = (s: Sample) =>
  s.fresh.some((f) => f.text === "It was very far off.");

test("a streaming rewrite lands each paragraph in place, never the whole original struck", async ({
  page,
}) => {
  await open(page, {}, false, STORY);
  await streamRevise(page, [REVISE_STORY]);
  const stop = await record(page);
  await send(page);
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)"),
  ).toHaveCount(3);
  await page.waitForTimeout(300);
  const samples = await stop();
  const streaming = samples.filter((s) => s.live === 0);
  const settled = samples.filter((s) => s.live > 0);
  expect(streaming.length).toBeGreaterThan(10);
  for (const s of samples) {
    // Never one struck block, never the sentences it keeps.
    expect(s.whole).toBe(0);
    expect(s.struck.join("")).not.toContain("The keeper woke");
    expect(s.struck.join("")).not.toContain("Outside, the sea");
    expect(s.struck.join("")).not.toContain("The tide was turning");
  }
  // A paragraph rewritten whole lands at once, before the stream ends: its
  // changes together, never one before the other, the next paragraph's
  // after them - and nothing half written.
  for (const s of samples) expect(hasFirst(s)).toBe(hasSecond(s));
  const early = streaming.find((s) => hasFirst(s) && !hasTail(s));
  expect(early).toBeTruthy();
  expect(early!.struck[0]).toBe("He climbed the stairs slowly.");
  for (const s of samples) expect(s.partial).toBeNull();
  // Nothing is drawn twice: each new text stays the same element from the
  // moment it appears, and a struck original stays struck.
  for (const text of [
    "He climbed the stairs one by one.",
    "The lamp was warm to the touch.",
  ]) {
    const seen = new Set(
      samples.flatMap((s) =>
        s.drawn.filter((d) => d.text === text).map((d) => d.id),
      ),
    );
    expect(seen.size, text).toBe(1);
  }
  for (const text of [
    "He climbed the stairs slowly.",
    "The wind had dropped in the night.",
    "The lamp was still warm.",
  ]) {
    const from = samples.findIndex((s) => s.struck.includes(text));
    expect(from, text).toBeGreaterThan(-1);
    for (const s of samples.slice(from)) expect(s.struck, text).toContain(text);
  }
  // Nothing moves when it settles: every new text the stream drew stays
  // where it was (the last paragraph lands as the stream ends).
  const last = streaming.at(-1)!;
  const first = settled[0];
  expect(last.fresh.length).toBeGreaterThan(0);
  for (const f of last.fresh) {
    const after = first.fresh.find((g) => g.text === f.text)!;
    expect(after, f.text).toBeTruthy();
    expect(Math.abs(f.x - after.x)).toBeLessThan(1);
    expect(Math.abs(f.y - after.y)).toBeLessThan(1);
  }
  // ...and the end is the finished proposal's layout.
  const streamed = await layout(page);
  await page.reload();
  await open(page, { enableEditAnimation: false }, false, STORY);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: JSON.stringify(REVISE_STORY.args),
      },
      { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
      { kind: "Assistant", text: "Tightened." },
    ],
  });
  await send(page);
  await expect(page.locator(".milkdown .pending-pick")).toHaveCount(3);
  expect(streamed).toEqual(await layout(page));
});

test("a streaming CJK rewrite lands each paragraph in place, its sentences split at 。！？", async ({
  page,
}) => {
  const zh =
    "灯塔看守人天亮前醒来。他慢慢爬上楼梯。灯还是温的！\n\n海面很平静？远处有一只海鸥。";
  const rewrite =
    "灯塔看守人天亮前醒来。他一级一级走上楼梯。灯摸上去还是温的！\n\n海面很平静？远处飞过一只海鸥。";
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, zh);
  await streamRevise(
    page,
    [{ id: "z", args: { action: "replace", anchor: zh, text: rewrite } }],
    { chunk: 4 },
  );
  const stop = await record(page);
  await send(page);
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)"),
  ).toHaveCount(3);
  const samples = await stop();
  const streaming = samples.filter((s) => s.live === 0);
  const has = (s: Sample, text: string) => s.fresh.some((f) => f.text === text);
  for (const s of samples) {
    expect(s.whole).toBe(0);
    expect(s.struck.join("")).not.toContain("灯塔看守人");
    expect(s.struck.join("")).not.toContain("海面很平静");
    // Each sentence its own change, the paragraph's two landing together.
    expect(has(s, "他一级一级走上楼梯。")).toBe(has(s, "灯摸上去还是温的！"));
  }
  expect(
    streaming.some(
      (s) => has(s, "他一级一级走上楼梯。") && !has(s, "远处飞过一只海鸥。"),
    ),
  ).toBe(true);
  for (const s of samples) expect(s.partial).toBeNull();
});

test("each display mode draws a streaming rewrite's landed paragraphs, with their cards", async ({
  page,
}) => {
  // Held while the second paragraph is being written: the first is done.
  const hold = intoSecond();
  for (const display of ["original", "final"] as const) {
    await open(page, { revisionDisplay: display }, false, STORY);
    await streamRevise(page, [REVISE_STORY], { hold });
    await send(page);
    const fresh = page.locator(".milkdown .pending-sentence-new", {
      hasText: "He climbed the stairs one by one.",
    });
    await expect(fresh).toBeAttached();
    await expect(page.locator(".milkdown .pending-whole")).toHaveCount(0);
    await expect(page.locator(".review-bar")).toBeVisible();
    // The landed paragraph's changes have cards; the one being written has
    // none yet, and is only marked in the text.
    await expect(page.locator(".revision-note")).toHaveCount(2);
    await expect(page.locator(".milkdown .pending-partial")).toHaveCount(0);
    await expect(page.locator(".milkdown .pending-reading")).toContainText(
      "It was far off.",
    );
    // ...and the review bar says it is being written.
    await expect(page.locator(".review-bar-working")).toHaveText(
      /Writing the edit/,
    );
    const card = page.locator(".revision-note").first();
    if (display === "original") {
      // The new text is the card's; the text keeps the original.
      await expect(card).toContainText("He climbed the stairs one by one.");
      await expect(fresh).toBeHidden();
    } else {
      // Result only: the new text in the text, the original in the card.
      await expect(fresh).toBeVisible();
      await expect(card).toContainText("He climbed the stairs slowly.");
    }
    await page.reload();
  }
});

test("Stop mid-stream keeps what arrived, laid out by sentence", async ({
  page,
}) => {
  await open(page, {}, false, STORY);
  // Stop once the first paragraph and part of the second are in.
  await streamRevise(page, [REVISE_STORY], { hold: intoSecond() });
  await send(page);
  await expect(
    page.locator(".milkdown .pending-sentence-new", {
      hasText: "He climbed the stairs one by one.",
    }),
  ).toBeVisible();
  // The half-written paragraph isn't on screen: only whole ones are.
  await expect(page.locator(".milkdown .pending-partial")).toHaveCount(0);
  await page
    .locator(".agent-panel-view")
    .getByRole("button", { name: "Stop" })
    .click();
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)").first(),
  ).toBeVisible();
  await expect(page.locator(".milkdown .pending-whole")).toHaveCount(0);
  // The half-written sentence never comes and its original stays; what
  // the stream hadn't reached stays as it was, not struck.
  await expect(page.locator(".milkdown .pending-partial")).toHaveCount(0);
  const struck = (
    await page.locator(".milkdown .pending-sentence").allTextContents()
  ).join("");
  for (const sentence of [
    "He climbed the stairs slowly.",
    "The wind had dropped in the night.",
    "The lamp was still warm.",
  ])
    expect(struck).toContain(sentence);
  expect(struck).not.toContain("It was far off.");
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(".milkdown .ProseMirror")).toHaveText(
    `${REWRITE}${TAIL}`,
  );
});

test("two rewrites in a row each stream in by sentence", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const second = "A gull cried. It was far off. The tide was turning.";
  await pasteMarkdown(page, `${ORIGINAL}\n\n${second}`);
  await streamRevise(page, [
    REVISE,
    {
      id: "r2",
      args: {
        action: "replace",
        anchor: second,
        text: "A gull cried. It was very far off. The tide was turning.",
      },
    },
  ]);
  const stop = await record(page);
  await send(page);
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)"),
  ).toHaveCount(3);
  const samples = await stop();
  for (const s of samples) {
    expect(s.whole).toBe(0);
    expect(s.struck.join("")).not.toContain("The tide was turning.");
  }
});

test("asked again before deciding, an edit of the rewrite's new text shows in it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, ORIGINAL);
  await streamRevise(page, [REVISE]);
  await send(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("one by one");
  // Anchored in text only the undecided rewrite holds.
  await streamRevise(page, [
    {
      id: "r2",
      args: {
        action: "replace",
        anchor: "He climbed the stairs one by one.",
        text: "He climbed the stairs two at a time.",
      },
    },
  ]);
  await send(page);
  await expect(editor).toContainText("two at a time");
  await expect(editor).not.toContainText("one by one");
});

test("with motion on, each strike draws in once and each new text comes in once", async ({
  page,
}) => {
  await open(page, {}, true);
  await streamRevise(page, [REVISE]);
  // Every element that ever ran an entrance, by its text.
  await page.evaluate(() => {
    const w = window as unknown as {
      __entrances: Record<string, number>;
      __watching: boolean;
    };
    w.__entrances = {};
    w.__watching = true;
    const counted = new WeakMap<Element, string>();
    const root = document.querySelector(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const tick = () => {
      if (!w.__watching) return;
      for (const el of Array.from(
        root.querySelectorAll(".pending-sentence, .pending-sentence-new"),
      )) {
        const text = el.textContent ?? "";
        if (counted.get(el) === text) continue;
        if (!el.getAnimations().some((a) => a.playState === "running"))
          continue;
        counted.set(el, text);
        w.__entrances[text] = (w.__entrances[text] ?? 0) + 1;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await send(page);
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)"),
  ).toHaveCount(2);
  await page.waitForTimeout(400);
  const entrances = await page.evaluate(() => {
    const w = window as unknown as {
      __entrances: Record<string, number>;
      __watching: boolean;
    };
    w.__watching = false;
    return w.__entrances;
  });
  for (const [text, count] of Object.entries(entrances))
    expect(count, text).toBeLessThanOrEqual(1);
  // The strikes did draw in.
  expect(entrances["He climbed the stairs slowly."]).toBe(1);
  expect(entrances["The wind had dropped in the night."]).toBe(1);
});

test("a rewrite whose arguments arrive in one piece still lands paragraph by paragraph", async ({
  page,
}) => {
  // MiniMax sends a tool call's arguments whole: the reveal spreads them
  // out instead of the whole rewrite appearing in one frame.
  await open(page, {}, false, STORY);
  await streamRevise(page, [REVISE_STORY], { chunk: 100_000 });
  const stop = await record(page);
  await send(page);
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)"),
  ).toHaveCount(3);
  const samples = await stop();
  const streaming = samples.filter((s) => s.live === 0);
  // The first paragraph is in before the next.
  expect(streaming.some((s) => hasFirst(s) && !hasTail(s))).toBe(true);
  for (const s of samples) expect(s.partial).toBeNull();
});
