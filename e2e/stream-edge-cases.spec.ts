import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * Rewrites streaming in, beyond one at a time in one view (1.2.1): two
 * proposals in one reply, each paragraph landing in its place with its own
 * beat and the count growing across both; and the view switched while one
 * still streams - what each view shows of what has landed, and of what is
 * still being written.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const FIRST = "The keeper woke before dawn. He climbed the stairs slowly.";
const SECOND = "A gull cried far off. The tide was turning.";
const FIRST_NEW = "The keeper woke early. He climbed the stairs one by one.";
const SECOND_NEW = "A gull cried in the distance. The tide was on the turn.";

async function open(page: Page, display: string) {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: display },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `${FIRST}\n\n${SECOND}`);
}

async function send(page: Page) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten both");
  await composer.press("Enter");
}

const CALLS = [
  { id: "a", args: { action: "replace", anchor: FIRST, text: FIRST_NEW } },
  { id: "b", args: { action: "replace", anchor: SECOND, text: SECOND_NEW } },
];

/** The proposals' parts in document order, as text. */
const layout = (page: Page) =>
  page.evaluate(
    (sel) =>
      [
        ...document.querySelectorAll(
          `${sel} :is(.pending-delete, .pending-sentence-new, .pending-pick)`,
        ),
      ].map(
        (e) =>
          `${[...e.classList].filter((c) => /^pending-(delete|sentence-new|pick)$/.test(c)).join(".")}|${(e as HTMLElement).dataset.call}|${e.textContent}`,
      ),
    editor,
  );

test("two rewrites in one reply each land in place, the count growing across both", async ({
  page,
}) => {
  await open(page, "inline");
  await streamRevise(page, CALLS);
  await page.evaluate(() => {
    const w = window as unknown as {
      __f: { count: string; fresh: string[]; ids: number[] }[];
      __on: boolean;
    };
    w.__f = [];
    w.__on = true;
    let next = 0;
    const ids = new WeakMap<Element, number>();
    const tick = () => {
      if (!w.__on) return;
      const fresh = [
        ...document.querySelectorAll(".milkdown .pending-sentence-new"),
      ];
      w.__f.push({
        count: document.querySelector(".review-bar-pos")?.textContent ?? "",
        fresh: fresh.map((e) => e.textContent ?? ""),
        ids: fresh.map((e) => {
          if (!ids.has(e)) ids.set(e, next++);
          return ids.get(e)!;
        }),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await send(page);
  await expect(
    page.locator(".milkdown .pending-pick:not(.pending-streaming)"),
  ).toHaveCount(4);
  const frames = await page.evaluate(() => {
    const w = window as unknown as {
      __f: { count: string; fresh: string[]; ids: number[] }[];
      __on: boolean;
    };
    w.__on = false;
    return w.__f;
  });
  // The first rewrite's changes were in before the second's.
  expect(
    frames.some(
      (f) =>
        f.fresh.includes("He climbed the stairs one by one.") &&
        !f.fresh.includes("The tide was on the turn."),
    ),
  ).toBe(true);
  // Each new text drawn once: the second rewrite landing didn't draw the
  // first's again.
  const byText = new Map<string, Set<number>>();
  for (const f of frames)
    f.fresh.forEach((text, i) =>
      byText.set(text, (byText.get(text) ?? new Set()).add(f.ids[i])),
    );
  for (const [text, ids] of byText) expect(ids.size, text).toBe(1);
  // The bar counts both, never fewer than before.
  const counts = frames
    .map((f) => parseInt(f.count, 10))
    .filter((n) => !Number.isNaN(n));
  for (let i = 1; i < counts.length; i++)
    expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
  expect(counts.at(-1)).toBe(4);
  // And the end is the layout the finished proposals have.
  const streamed = await layout(page);
  await page.reload();
  await open(page, "inline");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      ...CALLS.flatMap((c) => [
        {
          kind: "ToolCall",
          call_id: c.id,
          name: "propose_edit",
          arguments: JSON.stringify(c.args),
        },
        { kind: "ToolResult", call_id: c.id, output: "Edit proposed" },
      ]),
      { kind: "Assistant", text: "Tightened." },
    ],
  });
  await send(page);
  await expect(page.locator(".milkdown .pending-pick")).toHaveCount(4);
  expect(streamed).toEqual(await layout(page));
});

test("the view switched while a rewrite streams shows what has landed its own way", async ({
  page,
}) => {
  await open(page, "final");
  // Held while the second rewrite is being written: the first is in.
  const second = JSON.stringify(CALLS[1].args);
  const first = JSON.stringify(CALLS[0].args);
  const hold = Math.ceil(
    (first.length + 40 + second.indexOf("The tide was on") + 4) / 6,
  );
  await streamRevise(page, CALLS, { hold });
  await send(page);
  const fresh = page.locator(`${editor} .pending-sentence-new`, {
    hasText: "He climbed the stairs one by one.",
  });
  await expect(fresh).toBeVisible({ timeout: 15_000 });
  const cards = page.locator(".review-margin > .revision-note");
  // The card of the sentence we follow (two changes share its line).
  const card = cards.filter({ hasText: "climbed" });
  await expect(card).toContainText("climbed the stairs slowly");
  const pick = async (name: string) => {
    await page.locator(".review-bar-view-button").click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
  };
  // The original in the text, the new text on the cards.
  await pick("Original in the text, changes in the margin");
  await expect(fresh).toBeHidden();
  await expect(card).toContainText("climbed the stairs one by one");
  await expect(
    page.locator(`${editor} .pending-delete`, {
      hasText: "He climbed the stairs slowly.",
    }),
  ).toBeVisible();
  // Everything in the text: no cards.
  await pick("All in the text");
  await expect(fresh).toBeVisible();
  await expect(cards).toHaveCount(0);
  // Back to Result only, as it was - still being written, nothing half.
  await pick("Result only, originals in the margin");
  await expect(fresh).toBeVisible();
  await expect(card).toContainText("climbed the stairs slowly");
  await expect(page.locator(".review-bar-working")).toBeVisible();
  await expect(page.locator(`${editor} .pending-partial`)).toHaveCount(0);
  await expect(page.locator(`${editor} .pending-reading`)).toContainText(
    "A gull cried far off.",
  );
});
