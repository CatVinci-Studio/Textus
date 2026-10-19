import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A Revise rewrite streaming in is laid out sentence by sentence from the
 * start (pending-edit-plugin's streamDecorations): each sentence shows in
 * place as it completes, with no phase where the whole original is struck
 * and the new text streams after it as one block, and nothing moves when
 * the stream ends.
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

/**
 * The backend streaming `calls` (propose_edit arguments) in `chunk`-sized
 * argument fragments every `every` ms, then the turns. `hold`: the stream
 * stops after this many fragments and waits for a stop (ai_cancel).
 */
export async function streamRevise(
  page: Page,
  calls: { id: string; args: object }[],
  options: { chunk?: number; every?: number; hold?: number } = {},
) {
  await page.evaluate(
    ({ calls, chunk, every, hold }) => {
      type Send = (event: unknown) => void;
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = internals.invoke;
      let cancel: (() => void) | null = null;
      internals.invoke = (cmd, args) => {
        if (cmd === "ai_cancel") {
          cancel?.();
          return Promise.resolve(null);
        }
        if (cmd !== "ai_agent_message") return original(cmd, args);
        const { message, onEvent } = args as {
          message: string;
          onEvent?: { onmessage?: Send };
        };
        const send: Send = (event) => onEvent?.onmessage?.(event);
        const steps: (() => void)[] = [];
        const turns: unknown[] = [];
        let fragments = 0;
        for (const call of calls) {
          const json = JSON.stringify(call.args);
          steps.push(() =>
            send({ type: "toolStart", callId: call.id, name: "propose_edit" }),
          );
          for (let from = 0; from < json.length; from += chunk) {
            const delta = json.slice(from, from + chunk);
            steps.push(() => {
              fragments++;
              send({ type: "toolArgsDelta", callId: call.id, delta });
            });
          }
          const turn = {
            kind: "ToolCall",
            call_id: call.id,
            name: "propose_edit",
            arguments: json,
          };
          const result = {
            kind: "ToolResult",
            call_id: call.id,
            output: "Edit proposed",
          };
          turns.push(turn, result);
          steps.push(() => send({ type: "turn", turn }));
          steps.push(() => send({ type: "turn", turn: result }));
        }
        const reply = { kind: "Assistant", text: "Tightened." };
        turns.push(reply);
        steps.push(() => send({ type: "turn", turn: reply }));
        return new Promise((resolve, reject) => {
          let timer = 0;
          cancel = () => {
            window.clearTimeout(timer);
            reject("cancelled");
          };
          const next = () => {
            if (hold !== null && fragments >= hold) return;
            const step = steps.shift();
            if (!step) {
              resolve([{ kind: "User", text: message }, ...turns]);
              return;
            }
            step();
            timer = window.setTimeout(next, every);
          };
          next();
        });
      };
    },
    {
      calls,
      chunk: options.chunk ?? 6,
      every: options.every ?? 30,
      hold: options.hold ?? null,
    },
  );
}

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
        '[data-active-tab="true"] .ProseMirror :is(.pending-delete, .pending-insert, .pending-pick, .pending-insert-mark, .pending-delete-mark)',
      ),
    ).map((e) =>
      [
        Array.from(e.classList)
          .filter((c) =>
            /^pending-(delete|insert|pick|insert-mark|delete-mark|sentence|sentence-new|whole)$/.test(
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
) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline", ...settings },
    storage: { "levis-agent-panel-open": "1" },
    animations,
  });
  await pasteMarkdown(page, ORIGINAL);
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

test("a streaming rewrite shows each sentence in place, never the whole original struck", async ({
  page,
}) => {
  await open(page);
  await streamRevise(page, [REVISE]);
  const stop = await record(page);
  await send(page);
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)"),
  ).toHaveCount(2);
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
  }
  // A completed changed sentence is in place before the stream ends: its
  // original struck, its new text beside it, while the next one is written.
  const early = streaming.find(
    (s) =>
      s.fresh.some((f) => f.text === "He climbed the stairs one by one.") &&
      s.partial !== null,
  );
  expect(early).toBeTruthy();
  expect(early!.struck[0]).toBe("He climbed the stairs slowly.");
  // The sentence the rewrite drops is struck only once the stream passes
  // it, not before.
  const beforeDrop = streaming.find((s) =>
    s.fresh.some((f) => f.text === "He climbed the stairs one by one."),
  )!;
  expect(beforeDrop.struck.join("")).not.toContain("The lamp was still warm.");
  // Nothing is drawn twice: each new text stays the same element from the
  // moment it appears - also when the stream passes the dropped sentence
  // after it and joins that to its change - and a struck original, once
  // struck, stays struck.
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
  // where it was.
  const last = streaming.at(-1)!;
  const first = settled[0];
  expect(last.fresh.map((f) => f.text)).toEqual(first.fresh.map((f) => f.text));
  last.fresh.forEach((f, i) => {
    expect(Math.abs(f.x - first.fresh[i].x)).toBeLessThan(1);
    expect(Math.abs(f.y - first.fresh[i].y)).toBeLessThan(1);
  });
  // ...and the end is the layout the finished proposal has always had.
  const streamed = await layout(page);
  await page.reload();
  await open(page, { enableEditAnimation: false });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: JSON.stringify(REVISE.args),
      },
      { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
      { kind: "Assistant", text: "Tightened." },
    ],
  });
  await send(page);
  await expect(page.locator(".milkdown .pending-pick")).toHaveCount(2);
  expect(streamed).toEqual(await layout(page));
});

test("a streaming CJK rewrite completes each sentence at 。！？ in place", async ({
  page,
}) => {
  const zh = "灯塔看守人天亮前醒来。他慢慢爬上楼梯。灯还是温的！海面很平静？";
  const rewrite =
    "灯塔看守人天亮前醒来。他一级一级走上楼梯。灯摸上去还是温的！海面很平静？";
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "levis-agent-panel-open": "1" },
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
  ).toHaveCount(2);
  const samples = await stop();
  const streaming = samples.filter((s) => s.live === 0);
  for (const s of samples) {
    expect(s.whole).toBe(0);
    expect(s.struck.join("")).not.toContain("灯塔看守人");
    expect(s.struck.join("")).not.toContain("海面很平静");
  }
  expect(
    streaming.some(
      (s) =>
        s.fresh.some((f) => f.text === "他一级一级走上楼梯。") &&
        s.partial !== null,
    ),
  ).toBe(true);
});

test("each display mode draws a streaming rewrite's completed sentences", async ({
  page,
}) => {
  for (const display of ["original", "new", "final"] as const) {
    await open(page, { revisionDisplay: display });
    await streamRevise(page, [REVISE], { every: 40 });
    await send(page);
    const fresh = page.locator(".milkdown .pending-sentence-new", {
      hasText: "He climbed the stairs one by one.",
    });
    // Visible in the text while it streams in, in every view - the
    // margin views' cards come once it settles.
    await expect(fresh).toBeVisible();
    await expect(page.locator(".milkdown .pending-whole")).toHaveCount(0);
    await expect(page.locator(".review-bar")).toBeVisible();
    if (display === "original") {
      await expect(page.locator(".revision-note")).toHaveCount(2);
      await expect(fresh).toBeHidden();
    }
    if (display === "new")
      await expect(page.locator(".revision-note-original")).toHaveCount(2);
    await page.reload();
  }
});

test("Stop mid-stream keeps what arrived, laid out by sentence", async ({
  page,
}) => {
  await open(page);
  // Stop once the first rewritten sentence and part of the next are in.
  const json = JSON.stringify(REVISE.args);
  const cut = json.indexOf("The lamp was warm") + 22;
  await streamRevise(page, [REVISE], { hold: Math.ceil(cut / 6) });
  await send(page);
  await expect(
    page.locator(".milkdown .pending-sentence-new", {
      hasText: "He climbed the stairs one by one.",
    }),
  ).toBeVisible();
  await expect(page.locator(".milkdown .pending-partial")).toBeVisible();
  await page
    .locator(".agent-panel-view")
    .getByRole("button", { name: "Stop" })
    .click();
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)").first(),
  ).toBeVisible();
  await expect(page.locator(".milkdown .pending-whole")).toHaveCount(0);
  // The half-written sentence goes and its original stays; what the stream
  // hadn't reached stays as it was, not struck.
  await expect(page.locator(".milkdown .pending-partial")).toHaveCount(0);
  await expect(page.locator(".milkdown .pending-sentence")).toHaveText([
    "He climbed the stairs slowly.",
  ]);
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(".milkdown .ProseMirror")).toHaveText(
    "The keeper woke before dawn. He climbed the stairs one by one. The wind had dropped in the night. The lamp was still warm. Outside, the sea was calm.",
  );
});

test("two rewrites in a row each stream in by sentence", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "levis-agent-panel-open": "1" },
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
