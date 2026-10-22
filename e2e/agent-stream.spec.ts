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
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(page, "Alpha line one.\n\nBeta line two.\n\nGamma.");
  await page.evaluate(() => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      __devNameCall: (blocks: unknown, args: object) => object;
    };
    const internals = w.__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent, blocks } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
        blocks: unknown;
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      // Each call by the block it names, as a model writes it.
      const written = (edit: object) =>
        JSON.stringify(w.__devNameCall(blocks, edit));
      const edit = (anchor: string, text: string) =>
        written({ action: "replace", anchor, text });
      // Right after the opening quote of `text`.
      const textStart = (json: string) => json.indexOf('"text":"') + 8;
      // The first call's fragments split right after the opening quote of
      // `text`: the draft is placed while its text is still "" - what an
      // Anthropic-style partial-JSON stream can do at any boundary.
      const s1 = edit("Alpha line one.", "ALPHA LINE ONE (edited).");
      const s2 = edit("Beta line two.", "BETA LINE TWO (edited).");
      const calls = [
        { id: "s1", args: s1, cut: [20, 40, textStart(s1)] },
        { id: "s2", args: s2, cut: [20, 40, textStart(s2) + 1] },
        // No text at all, ever: must still become decidable.
        {
          id: "s3",
          args: written({ action: "delete", anchor: "Gamma." }),
          cut: [20],
        },
      ];
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
    ".agent-proposal-actions .inline-chat-action-primary",
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
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(page, "Alpha line one.\n\nBeta line two.");
  await page.evaluate(() => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      __devNameCall: (blocks: unknown, args: object) => object;
    };
    const internals = w.__TAURI_INTERNALS__;
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
      const { message, onEvent, blocks } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
        blocks: unknown;
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const turns: unknown[] = [];
      const steps: (() => void)[] = [];
      // Each call by the block it names, as a model writes it.
      for (const call of calls)
        call.args = JSON.stringify(
          w.__devNameCall(blocks, JSON.parse(call.args)),
        );
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
    ".agent-proposal-actions .inline-chat-action-primary",
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

test("a reply that arrives in a few large chunks still flows in, and ends as received", async ({
  page,
}) => {
  // Animations on: the reveal is motion, and the helpers' switch-off
  // stylesheet would show each chunk whole.
  await openApp(page, {
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  const reply =
    "流式回复应该平稳地出现，而不是一块一块地跳出来。👨‍👩‍👧 ".repeat(6) +
    "The text keeps flowing while the provider sends big pieces. ".repeat(6);
  await page.evaluate((reply) => {
    const w = window as unknown as Record<string, unknown>;
    const internals = w.__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    };
    const original = internals.invoke;
    // What the reply looked like on every frame while it streamed.
    const seen: string[] = [];
    w.__seen = seen;
    const sample = () => {
      const el = document.querySelector(".agent-streaming .agent-markdown");
      // trimEnd: the rendered paragraph ends in a newline of its own.
      if (el) seen.push((el.textContent ?? "").trimEnd());
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    internals.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: (event: unknown) => void };
      };
      const third = Math.ceil(reply.length / 3);
      const chunks = [0, 1, 2].map((i) =>
        reply.slice(i * third, (i + 1) * third),
      );
      return new Promise((resolve) => {
        const next = () => {
          const text = chunks.shift();
          if (text === undefined) {
            resolve([
              { kind: "User", text: message },
              { kind: "Assistant", text: reply },
            ]);
            return;
          }
          onEvent?.onmessage?.({ type: "delta", text });
          setTimeout(next, 400);
        };
        next();
      });
    };
  }, reply);

  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tell me something");
  await composer.press("Enter");
  const answer = page.locator(".agent-message-assistant .agent-markdown");
  await expect(answer).toHaveText(reply.trim());
  await expect(page.locator(".agent-streaming")).toHaveCount(0);

  const seen = await page.evaluate(
    () => (window as unknown as { __seen: string[] }).__seen,
  );
  // Three chunks, many steps: the text grew over a run of frames.
  expect(new Set(seen).size).toBeGreaterThan(20);
  // Each step showed the start of the reply, never anything else.
  for (const text of seen) expect(reply.startsWith(text)).toBe(true);
});

test("the empty-document hint gives way to text the AI is writing", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  const hint = page.locator('[data-active-tab="true"] .empty-doc-placeholder');
  await expect(hint).toHaveCount(1);

  // One append into the empty document, streamed until `__finishStream`.
  await page.evaluate(() => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __finishStream?: () => void;
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const callArgs = JSON.stringify({
        action: "append",
        text: "A first paragraph the AI wrote into the empty page.",
      });
      send({ type: "toolStart", callId: "e1", name: "propose_edit" });
      send({
        type: "toolArgsDelta",
        callId: "e1",
        delta: callArgs.slice(0, 40),
      });
      return new Promise((resolve) => {
        w.__finishStream = () => {
          send({
            type: "toolArgsDelta",
            callId: "e1",
            delta: callArgs.slice(40),
          });
          const turns = [
            {
              kind: "ToolCall",
              call_id: "e1",
              name: "propose_edit",
              arguments: callArgs,
            },
            { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
            { kind: "Assistant", text: "Started it for you." },
          ];
          for (const turn of turns) send({ type: "turn", turn });
          resolve([{ kind: "User", text: message }, ...turns]);
        };
      });
    };
  });

  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Start this document");
  await composer.press("Enter");
  // While it streams...
  await expect(page.locator(".milkdown .pending-insert")).toBeVisible();
  await expect(hint).toHaveCount(0);
  // ...while it waits for a decision...
  await page.evaluate(() =>
    (window as unknown as { __finishStream: () => void }).__finishStream(),
  );
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await expect(accept).toHaveCount(1);
  await expect(page.locator(".milkdown .pending-insert")).toContainText(
    "into the empty page.",
  );
  await expect(hint).toHaveCount(0);
  // ...and once it is the document's own text.
  await accept.click();
  await expect(page.locator(".milkdown")).toContainText(
    "A first paragraph the AI wrote into the empty page.",
  );
  await expect(hint).toHaveCount(0);
});
