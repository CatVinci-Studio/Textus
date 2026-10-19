import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * Textus AI's edits as they really arrive: streamed over the onEvent channel
 * (toolStart, argument fragments, then each completed turn), not only as
 * the final turn list the other tests hand back.
 */

test("a streamed edit whose text starts empty still becomes decidable", async ({
  page,
}) => {
  await openApp(page, { storage: { "levis-agent-panel-open": "1" } });
  await pasteMarkdown(page, "Alpha line one.\n\nBeta line two.\n\nGamma.");
  await page.evaluate(() => {
    type Send = (event: unknown) => void;
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const edit = (anchor: string, text: string) =>
      JSON.stringify({ action: "replace", anchor, text });
    // The first call's fragments split right after the opening quote of
    // `text`: the draft is placed while its text is still "" - what an
    // Anthropic-style partial-JSON stream can do at any boundary.
    const calls = [
      {
        id: "s1",
        args: edit("Alpha line one.", "ALPHA LINE ONE (edited)."),
        cut: [20, 40, 55],
      },
      {
        id: "s2",
        args: edit("Beta line two.", "BETA LINE TWO (edited)."),
        cut: [20, 40, 56],
      },
      // No text at all, ever: must still become decidable.
      {
        id: "s3",
        args: JSON.stringify({ action: "delete", anchor: "Gamma." }),
        cut: [20],
      },
    ];
    internals.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const turns: unknown[] = [];
      const steps: (() => void)[] = [];
      for (const call of calls) {
        steps.push(() =>
          send({ type: "toolStart", callId: call.id, name: "propose_edit" }),
        );
        let from = 0;
        for (const to of [...call.cut, call.args.length]) {
          const delta = call.args.slice(from, to);
          from = to;
          steps.push(() =>
            send({ type: "toolArgsDelta", callId: call.id, delta }),
          );
        }
      }
      for (const call of calls) {
        const turn = {
          kind: "ToolCall",
          call_id: call.id,
          name: "propose_edit",
          arguments: call.args,
        };
        turns.push(turn);
        steps.push(() => send({ type: "turn", turn }));
      }
      for (const call of calls) {
        const turn = {
          kind: "ToolResult",
          call_id: call.id,
          output: "Edit proposed",
        };
        turns.push(turn);
        steps.push(() => send({ type: "turn", turn }));
      }
      const reply = { kind: "Assistant", text: "Both lines in capitals." };
      turns.push(reply);
      steps.push(() => send({ type: "turn", turn: reply }));
      return new Promise((resolve) => {
        const next = () => {
          const step = steps.shift();
          if (!step) {
            resolve([{ kind: "User", text: message }, ...turns]);
            return;
          }
          step();
          setTimeout(next, 15);
        };
        next();
      });
    };
  });

  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Capitalise the first two lines");
  await composer.press("Enter");
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary:visible",
  );
  // Every preview finishes typing and gets its Accept - the first one used
  // to settle while its text was still empty, then stay "Writing…" for good.
  await expect(accept).toHaveCount(3);
  for (const left of [2, 1, 0]) {
    await accept.first().click();
    await expect(accept).toHaveCount(left);
  }
  const doc = page.locator(".milkdown");
  await expect(doc).toContainText("ALPHA LINE ONE (edited).");
  await expect(doc).toContainText("BETA LINE TWO (edited).");
  await expect(doc).not.toContainText("Gamma.");
});

test("an edit the backend refused never stays on screen", async ({ page }) => {
  await openApp(page, { storage: { "levis-agent-panel-open": "1" } });
  await pasteMarkdown(page, "Alpha line one.\n\nBeta line two.");
  await page.evaluate(() => {
    type Send = (event: unknown) => void;
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const edit = (anchor: string, text: string) =>
      JSON.stringify({ action: "replace", anchor, text });
    // tools.rs refuses a clause replaced by one cut-off token; the model
    // is told and resends - the refused call must leave no preview.
    const calls = [
      {
        id: "cut",
        args: edit("Alpha line one.", "due"),
        output: 'Not proposed: `text` is only "due".',
      },
      {
        id: "ok",
        args: edit("Beta line two.", "BETA LINE TWO (edited)."),
        output: "Edit proposed - the user now sees it with an Apply button.",
      },
    ];
    internals.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const turns: unknown[] = [];
      const steps: (() => void)[] = [];
      for (const call of calls) {
        const toolCall = {
          kind: "ToolCall",
          call_id: call.id,
          name: "propose_edit",
          arguments: call.args,
        };
        const result = {
          kind: "ToolResult",
          call_id: call.id,
          output: call.output,
        };
        turns.push(toolCall, result);
        steps.push(() =>
          send({ type: "toolStart", callId: call.id, name: "propose_edit" }),
        );
        steps.push(() =>
          send({ type: "toolArgsDelta", callId: call.id, delta: call.args }),
        );
        steps.push(() => send({ type: "turn", turn: toolCall }));
        steps.push(() => send({ type: "turn", turn: result }));
      }
      const reply = { kind: "Assistant", text: "Second line in capitals." };
      turns.push(reply);
      steps.push(() => send({ type: "turn", turn: reply }));
      return new Promise((resolve) => {
        const next = () => {
          const step = steps.shift();
          if (!step) {
            resolve([{ kind: "User", text: message }, ...turns]);
            return;
          }
          step();
          setTimeout(next, 15);
        };
        next();
      });
    };
  });

  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Capitalise the lines");
  await composer.press("Enter");
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary:visible",
  );
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Second line in capitals.",
  );
  await expect(accept).toHaveCount(1);
  const doc = page.locator(".milkdown");
  await expect(doc).not.toContainText("due");
  await accept.first().click();
  await expect(doc).toContainText("BETA LINE TWO (edited).");
  await expect(doc).toContainText("Alpha line one.");
});
