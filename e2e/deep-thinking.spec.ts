import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The composer's Deep thinking button: offered only where the capability
 * table says the model can think deeper, kept on until pressed again, sent
 * as `thinking: "deep"`, and the reply's "Thinking · n seconds" line that
 * counts while the model thinks and opens to its reasoning afterwards.
 */

const composer = (page: Page) => page.locator(".agent-panel-view textarea");
const button = (page: Page) =>
  page.getByRole("button", { name: "深度思考", exact: true });

/** Answers ai_can_think_deeper before the app asks it. */
async function canThinkDeeper(page: Page, can: boolean) {
  await page.addInitScript((value) => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      { ai_can_think_deeper: value };
  }, can);
}

/** Stands in for ai_agent_message: thinks for `ms`, streaming reasoning,
 *  then replies - and records the `thinking` level each send asked for. */
async function scriptAgent(page: Page, ms: number) {
  await page.evaluate((thinkMs) => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      __thinkingAsked: unknown[];
    };
    w.__thinkingAsked = [];
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, thinking, onEvent } = args as {
        message: string;
        thinking?: string;
        onEvent?: { onmessage?: Send };
      };
      w.__thinkingAsked.push(thinking);
      const send: Send = (event) => onEvent?.onmessage?.(event);
      send({ type: "thinking", text: "" });
      send({ type: "thinking", text: "Weighing the two readings." });
      return new Promise((resolve) =>
        setTimeout(() => {
          send({ type: "delta", text: "The second." });
          resolve([
            { kind: "User", text: message },
            { kind: "Assistant", text: "The second." },
          ]);
        }, thinkMs),
      );
    };
  }, ms);
}

test("Deep thinking is offered, sent, and stays on", async ({ page }) => {
  await canThinkDeeper(page, true);
  await openApp(page, { storage: { "levis-agent-panel-open": "1" } });
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");

  await pasteMarkdown(page, "One line.");
  await scriptAgent(page, 300);
  await composer(page).fill("Which reading is right?");
  await composer(page).press("Enter");
  await expect(page.locator(".agent-thought")).toContainText("已思考");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __thinkingAsked: unknown[] }).__thinkingAsked,
    ),
  ).toEqual(["deep"]);

  // Still on after a reload - another session, another document.
  await page.reload();
  await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
});

test("no Deep thinking button for a model that can't think deeper", async ({
  page,
}) => {
  await canThinkDeeper(page, false);
  await openApp(page, {
    storage: {
      "levis-agent-panel-open": "1",
      "textus-agent-deep-thinking": "1",
    },
  });
  await expect(page.locator(".inline-chat-web-search")).toBeVisible();
  await expect(button(page)).toHaveCount(0);
  // The question went with the model in use.
  const asked = await page.evaluate(
    () =>
      (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? [],
  );
  expect(asked.some((call) => call.cmd === "ai_can_think_deeper")).toBe(true);

  await pasteMarkdown(page, "One line.");
  await scriptAgent(page, 100);
  await composer(page).fill("Hi");
  await composer(page).press("Enter");
  await expect(page.locator(".agent-panel-view")).toContainText("The second.");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __thinkingAsked: unknown[] }).__thinkingAsked,
    ),
  ).toEqual(["auto"]);
});

test("the thinking line counts seconds, then opens to the reasoning", async ({
  page,
}) => {
  await canThinkDeeper(page, true);
  await openApp(page, { storage: { "levis-agent-panel-open": "1" } });
  await pasteMarkdown(page, "One line.");
  await scriptAgent(page, 2_600);
  await composer(page).fill("Which reading is right?");
  await composer(page).press("Enter");

  const thought = page.locator(".agent-thought");
  await expect(thought).toContainText("思考中 · 1 秒");
  await expect(thought).toContainText("思考中 · 2 秒");
  await expect(thought).toContainText(/已思考 [23] 秒/);
  await expect(page.locator(".agent-thought-text")).toHaveCount(0);
  await thought.getByRole("button").click();
  await expect(page.locator(".agent-thought-text")).toHaveText(
    "Weighing the two readings.",
  );
  await expect(page.locator(".agent-panel-view")).toContainText("The second.");
});
