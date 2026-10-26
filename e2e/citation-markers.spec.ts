import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * An OpenAI model that searched the web writes its app's citation markers
 * (`citeturn3view0`, delimiters lost or not) into the text it proposes;
 * neither the streaming nor the accepted text may show them.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const TEXT =
  "Jev 返回选项及概率。citeturn3view0 Laya 可本地部署。\ue200cite\ue202turn2search0\ue201\n\nKev 可训练。citeturn5view1turn5view2";

test("citation markers never show while a proposal streams or once it is taken", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "zh" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "开头。");
  await page.evaluate((text) => {
    const w = window as unknown as Record<string, unknown>;
    const internals = w.__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    };
    const original = internals.invoke;
    // Every frame's document, to find a marker shown while streaming.
    const seen: string[] = [];
    w.__seen = seen;
    const sample = () => {
      const el = document.querySelector(
        '[data-active-tab="true"] .ProseMirror',
      );
      if (el) seen.push(el.textContent ?? "");
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
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
      for (let i = 0; i < args.length; i += 5) {
        const delta = args.slice(i, i + 5);
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
      const reply = { kind: "Assistant", text: "补充了。" };
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
  }, TEXT);
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("补充一下");
  await composer.press("Enter");
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await accept.first().click();
  await expect(page.locator(editor)).toContainText("Kev 可训练。");
  const text = (await page.locator(editor).textContent()) ?? "";
  expect(text).not.toMatch(/cite|turn\d|[\ue200-\ue2ff]/);
  const seen = await page.evaluate(
    () => (window as unknown as { __seen: string[] }).__seen,
  );
  for (const frame of seen) expect(frame).not.toMatch(/citet|[\ue200-\ue2ff]/);
});
