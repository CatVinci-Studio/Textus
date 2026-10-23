import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * Text Textus AI writes after the document's last block is shown as the
 * blocks it will be - paragraphs, a list, a footnote - while it streams in
 * and before it is taken, not as its Markdown with line breaks (rc.5).
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const TEXT =
  "Further, **bold** findings suggest more.[^2] A list:\n\n- one\n- two\n\nA second paragraph.\n\n[^2]: The second note.";

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
      for (let i = 0; i < args.length; i += 8) {
        const delta = args.slice(i, i + 8);
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

test("appended text is shown as its blocks while it streams and before it is taken", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "Prior work found this.");
  await streamAppend(page, TEXT);
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Go on");
  await composer.press("Enter");
  const preview = page.locator(`${editor} .pending-insert.pending-blocks`);
  // While it is still coming in: the list is a list already.
  await expect(preview.locator("li")).toHaveCount(2);
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await expect(accept).toHaveCount(1);
  // Taken, nothing of it shows as Markdown.
  await expect(
    preview.locator("p", { hasText: "A second paragraph." }),
  ).toHaveCount(1);
  await expect(preview.locator("strong")).toHaveText("bold");
  await expect(preview).not.toContainText("- one");
  await expect(preview).not.toContainText("[^2]:");
  await accept.click();
  await expect(page.locator(`${editor} li`)).toHaveCount(2);
  await expect(page.locator(`${editor} .pending-insert`)).toHaveCount(0);
});
