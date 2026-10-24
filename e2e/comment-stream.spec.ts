import { expect, test } from "@playwright/test";
import { blockIds, mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A review note shows in the margin as soon as it has said where it goes
 * and what it says - by its block, as the model names a passage now - one
 * note after another, not all of them once the reply is done (rc.6). All of
 * a reply's notes come in one call (1.2.1): a service that holds a step's
 * calls back until it ends still streams one call's arguments.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const DOC =
  "# Night hours\n\nThe library opened late on Wednesdays.\n\nStudents came most.";

test("each note of a reply shows in the margin as soon as it is written, and the chat lists them as one card", async ({
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
    comments: [
      { block: ids[1], comment: "Say which hours." },
      { block: ids[2], comment: "Which students?" },
    ],
  });
  // Held here: the first note whole, the second's words half in.
  const cut = raw.indexOf("Which stu");
  await page.evaluate(
    ({ raw, cut }) => {
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
          { kind: "Assistant", text: "Two notes." },
        ];
        send({ type: "toolStart", callId: "n1", name: "add_comment" });
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            if (i < raw.length && (i < cut || w.__release)) {
              send({
                type: "toolArgsDelta",
                callId: "n1",
                delta: raw.slice(i, i + 6),
              });
              i += 6;
              setTimeout(tick, 10);
              return;
            }
            if (!w.__release || i < raw.length) {
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
    { raw, cut },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("What's weak here?");
  await composer.press("Enter");
  // Held: the call is still open, and its first note is there, on its
  // passage - the second, half written, not yet.
  const note = page.locator(".review-note:not(.revision-note)");
  await expect(note).toContainText("Say which hours.");
  await expect(note).toHaveCount(1);
  await expect(page.locator(`${editor} .review-anchor`)).toHaveText(
    "The library opened late on Wednesdays.",
  );
  await expect(page.locator(".agent-panel-view .agent-thinking")).toHaveText(
    /Writing/,
  );
  // Done: both notes, in the margin and as one card in the chat.
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText("Two notes.");
  await expect(page.locator(".review-margin")).toContainText("Which students?");
  const card = page.locator(".agent-panel-view .agent-comment");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".agent-comment-row")).toHaveCount(2);
  await expect(card).toContainText("2 notes");
});

test("a reply's many notes fold in the chat to their first three", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const doc = Array.from({ length: 6 }, (_, i) => `Line ${i + 1} here.`).join(
    "\n\n",
  );
  await pasteMarkdown(page, doc);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "add_comment",
        arguments: JSON.stringify({
          comments: Array.from({ length: 6 }, (_, i) => ({
            anchor: `Line ${i + 1} here.`,
            comment: `Note ${i + 1}`,
          })),
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Comment added (6)" },
      { kind: "Assistant", text: "Six notes." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Check it");
  await composer.press("Enter");
  const card = page.locator(".agent-panel-view .agent-comment");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".agent-comment-row")).toHaveCount(3);
  await card.getByRole("button", { name: "Show 3 more" }).click();
  await expect(card.locator(".agent-comment-row")).toHaveCount(6);
  // A row takes you to its words.
  await card.locator(".agent-comment-row-quote").nth(4).click();
  await expect(
    page.locator(`${editor} .review-anchor`, { hasText: "Line 5 here." }),
  ).toBeVisible();
  await expect(page.locator(".review-note:not(.revision-note)")).toHaveCount(6);
});
