import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * Text written on at a document's end, frame by frame with motion on: the
 * page follows the writing down in soft strokes, not a jump the height of
 * each block that lands; and nothing at the window's bottom - the review
 * bar - pops in or out.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const scroller = '[data-active-tab="true"] > .editor-scroll';

const DOC = Array.from(
  { length: 30 },
  (_, i) => `Paragraph ${i + 1} of the harbour story, as it was written.`,
).join("\n\n");
const MORE = Array.from(
  { length: 8 },
  (_, i) =>
    `The boats came in at dusk, one after another, ${i + 1}. The nets were wet and heavy with the day.`,
).join("\n\n");

/** An append streamed in, a few characters every 20 ms. */
async function streamAppend(page: Page, text: string) {
  await page.evaluate((text) => {
    const w = window as unknown as Record<string, unknown>;
    const internals = w.__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    };
    const original = internals.invoke;
    const args = JSON.stringify({ action: "append", text });
    internals.invoke = (cmd, a) => {
      if (cmd !== "ai_agent_message") return original(cmd, a);
      const { message, onEvent } = a as {
        message: string;
        onEvent?: { onmessage?: (event: unknown) => void };
      };
      const send = (event: unknown) => onEvent?.onmessage?.(event);
      const steps: (() => void)[] = [
        () => send({ type: "toolStart", callId: "w1", name: "propose_edit" }),
      ];
      for (let i = 0; i < args.length; i += 6) {
        const delta = args.slice(i, i + 6);
        steps.push(() => send({ type: "toolArgsDelta", callId: "w1", delta }));
      }
      const call = {
        kind: "ToolCall",
        call_id: "w1",
        name: "propose_edit",
        arguments: args,
      };
      const result = {
        kind: "ToolResult",
        call_id: "w1",
        output: "Edit proposed",
      };
      const reply = { kind: "Assistant", text: "Added." };
      for (const turn of [call, result, reply])
        steps.push(() => send({ type: "turn", turn }));
      return new Promise((resolve) => {
        const next = () => {
          const step = steps.shift();
          if (!step) {
            resolve([{ kind: "User", text: message }, call, result, reply]);
            return;
          }
          step();
          setTimeout(next, 20);
        };
        next();
      });
    };
  }, text);
}

type Frame = {
  t: number;
  top: number;
  bar: { y: number; opacity: number } | null;
};

test("writing on at the end: the page glides after it, the review bar fades in", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1200, height: 700 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, DOC);
  await page
    .locator(scroller)
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(300);
  await streamAppend(page, MORE);
  await page.evaluate((scroller) => {
    const w = window as unknown as { __frames: Frame[]; __on: boolean };
    w.__frames = [];
    w.__on = true;
    const s = document.querySelector<HTMLElement>(scroller)!;
    const tick = (t: number) => {
      if (!w.__on) return;
      const bar = document.querySelector<HTMLElement>(".review-bar");
      const r = bar?.getBoundingClientRect();
      w.__frames.push({
        t,
        top: s.scrollTop,
        bar:
          bar && r
            ? { y: r.top, opacity: Number(getComputedStyle(bar).opacity) }
            : null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, scroller);
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Go on");
  await composer.press("Enter");
  await expect(page.locator(`${editor} .pending-insert`)).toContainText(
    "heavy with the day.",
    { timeout: 30_000 },
  );
  await expect(
    page.locator(".agent-proposal-actions .inline-chat-action-primary"),
  ).toBeEnabled();
  await page.waitForTimeout(800);
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __on: boolean };
    w.__on = false;
    return w.__frames;
  });
  const steps = frames.slice(1).map((f, i) => f.top - frames[i].top);
  const bars = frames.filter((f) => f.bar);
  // The page went down with the writing.
  expect(frames.at(-1)!.top - frames[0].top).toBeGreaterThan(200);
  // ...gliding: picking up speed and losing it a little each frame, never
  // a block's height at once, nor a stroke that starts at full speed.
  const kicks = steps
    .slice(1)
    .map((d, i) => Math.abs(d - steps[i]))
    .filter((change) => change > 8);
  expect(kicks).toEqual([]);
  // The review bar came in faded, not at once.
  expect(bars[0].bar!.opacity).toBeLessThan(0.9);
});
