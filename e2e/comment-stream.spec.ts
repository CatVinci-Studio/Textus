import { expect, test } from "@playwright/test";
import { blockIds, openApp, pasteMarkdown } from "./helpers";

/**
 * A review note shows in the margin as soon as its call has said where it
 * goes and what it says - by its block, as the model names a passage now -
 * one note after another, not all of them once the reply is done (rc.6).
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const DOC =
  "# Night hours\n\nThe library opened late on Wednesdays.\n\nStudents came most.";

test("a note named by its block shows in the margin while the reply is still coming", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, DOC);
  const ids = await blockIds(page, DOC);
  const raw = JSON.stringify({
    block: ids[1],
    comment: "Say which hours.",
  });
  await page.evaluate(
    ({ raw }) => {
      const w = window as unknown as Record<string, unknown>;
      const internals = w.__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = (cmd, a) => {
        if (cmd !== "ai_agent_message") return original(cmd, a);
        const { message, onEvent, blocks } = a as {
          message: string;
          onEvent?: { onmessage?: (event: unknown) => void };
          blocks: unknown;
        };
        const send = (event: unknown) => onEvent?.onmessage?.(event);
        const settle = w.__devSettle as (
          b: unknown,
          name: string,
          args: string,
        ) => string;
        const turns = [
          {
            kind: "ToolCall",
            call_id: "n1",
            name: "add_comment",
            // As the backend hands it on (src/dev/settle-calls.ts).
            arguments: settle(blocks, "add_comment", raw),
          },
          { kind: "ToolResult", call_id: "n1", output: "Comment added" },
          { kind: "Assistant", text: "One note." },
        ];
        send({ type: "toolStart", callId: "n1", name: "add_comment" });
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            if (i < raw.length) {
              send({
                type: "toolArgsDelta",
                callId: "n1",
                delta: raw.slice(i, i + 6),
              });
              i += 6;
              setTimeout(tick, 10);
              return;
            }
            if (!w.__release) {
              setTimeout(tick, 30);
              return;
            }
            for (const turn of turns) send({ type: "turn", turn });
            resolve([{ kind: "User", text: message }, ...turns]);
          };
          tick();
        });
      };
    },
    { raw },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("What's weak here?");
  await composer.press("Enter");
  // Held: the call is still open, and its note is there, on its passage.
  const note = page.locator(".review-note:not(.revision-note)");
  await expect(note).toContainText("Say which hours.");
  await expect(page.locator(`${editor} .review-anchor`)).toHaveText(
    "The library opened late on Wednesdays.",
  );
  await expect(page.locator(".agent-panel-view .agent-thinking")).toHaveText(
    /Writing/,
  );
  // Done: the same one note.
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText("One note.");
  await expect(note).toHaveCount(1);
});
