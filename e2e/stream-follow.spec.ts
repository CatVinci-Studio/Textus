import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * While Textus AI writes into the document, the page follows the writing
 * while the reader is with it, and stays where they put it once they
 * scroll away (stream-follow-plugin.ts) - not pulled back to where the
 * writing began.
 */

const scroller = '[data-active-tab="true"] .editor-scroll';
const LONG = Array.from(
  { length: 120 },
  (_, i) => `Paragraph ${i + 1} of the harbour story. The boats came in.`,
).join("\n\n");

/** An append streamed in, a few characters every 15 ms. */
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
      for (let i = 0; i < args.length; i += 12) {
        const delta = args.slice(i, i + 12);
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
          setTimeout(next, 15);
        };
        next();
      });
    };
  }, text);
}

async function start(page: Page) {
  await page.setViewportSize({ width: 1200, height: 700 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "The tide went out before dawn.");
  await streamAppend(page, LONG);
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Go on");
  await composer.press("Enter");
}

const top = (page: Page) =>
  page.locator(scroller).evaluate((el) => el.scrollTop);

const writing = (page: Page) =>
  page.locator('[data-active-tab="true"] .pending-insert-typing');

test("the page follows the writing while the reader is with it", async ({
  page,
}) => {
  await start(page);
  await expect(writing(page)).toHaveCount(1);
  // The writing runs past the window's bottom, and the page goes with it.
  await expect.poll(() => top(page), { timeout: 15_000 }).toBeGreaterThan(400);
  const edge = await writing(page).evaluate((el) => {
    const s = el.closest(".editor-scroll")!.getBoundingClientRect();
    return { bottom: el.getBoundingClientRect().bottom, view: s.bottom };
  });
  expect(edge.bottom).toBeLessThanOrEqual(edge.view + 2);
});

test("scrolled away, the page stays where the reader put it while the writing goes on", async ({
  page,
}) => {
  await start(page);
  await expect.poll(() => top(page), { timeout: 15_000 }).toBeGreaterThan(300);
  await page.locator(scroller).hover();
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => top(page)).toBe(0);
  // The rest of the writing comes in below; the page doesn't move.
  const samples: number[] = [];
  while ((await writing(page).count()) > 0) {
    samples.push(await top(page));
    await page.waitForTimeout(100);
  }
  expect(samples.length).toBeGreaterThan(5);
  expect(Math.max(...samples)).toBe(0);
});

test("a jump the reader didn't make, while it writes, is undone", async ({
  page,
}) => {
  await start(page);
  await expect.poll(() => top(page), { timeout: 15_000 }).toBeGreaterThan(300);
  await page.locator(scroller).hover();
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => top(page)).toBe(0);
  await page.waitForTimeout(900);
  // As WebKit did: back to the caret, far below.
  await page
    .locator(scroller)
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => top(page)).toBe(0);
  await expect(writing(page)).toHaveCount(1);
});
