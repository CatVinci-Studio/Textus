import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * A reply's edits come in one call the backend streams on as a call per edit,
 * the step's turns after the last: each edit lands once its text is whole.
 */
const DOC = "First line here.\n\nSecond line here.\n\nThird line here.";

for (const display of ["final", "inline"])
  test(`edits land one by one before the step ends (${display})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await openApp(page, {
      settings: { language: "en", revisionDisplay: display },
      storage: { "textus-agent-panel-open": "1" },
      animations: true,
    });
    await pasteMarkdown(page, DOC);
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const internals = w.__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = (cmd, a) => {
        if (cmd !== "ai_agent_message") return original(cmd, a);
        const { onEvent, blocks, message } = a as {
          onEvent?: { onmessage?: (e: unknown) => void };
          blocks: unknown;
          message: string;
        };
        const send = (e: unknown) => onEvent?.onmessage?.(e);
        const name = w.__devNameCall as (b: unknown, a: object) => object;
        const settle = w.__devSettle as (
          b: unknown,
          n: string,
          a: string,
        ) => string;
        const lines = ["First", "Second", "Third"];
        const calls = lines.map((l, i) => ({
          id: `c1#${i}`,
          json: JSON.stringify(
            name(blocks, {
              action: "replace",
              anchor: `${l} line here.`,
              text: `${l} line, rewritten.`,
            }),
          ),
        }));
        const events: unknown[] = calls.flatMap((c) => [
          { type: "toolStart", callId: c.id, name: "propose_edit" },
          ...Array.from({ length: Math.ceil(c.json.length / 8) }, (_, k) => ({
            type: "toolArgsDelta",
            callId: c.id,
            delta: c.json.slice(k * 8, k * 8 + 8),
          })),
        ]);
        const turns = [
          ...calls.map((c) => ({
            kind: "ToolCall",
            call_id: c.id,
            name: "propose_edit",
            arguments: settle(blocks, "propose_edit", c.json),
          })),
          ...calls.map((c) => ({
            kind: "ToolResult",
            call_id: c.id,
            output: "Edit proposed",
          })),
          { kind: "Assistant", text: "Done." },
        ];
        // Hold before the third call starts.
        const cut = events.findIndex(
          (e) => (e as { callId?: string }).callId === "c1#2",
        );
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            if (i < events.length && (i < cut || w.__release)) {
              send(events[i++]);
              setTimeout(tick, 20);
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
    });
    const composer = page.locator(".agent-panel-view textarea");
    await composer.fill("Rewrite each line");
    await composer.press("Enter");
    const editor = '[data-active-tab="true"] .ProseMirror:not(.motion-ghost)';
    // Held before the third: the first two are in.
    await expect(page.locator(editor)).toContainText("First line, rewritten.");
    await expect(page.locator(editor)).toContainText("Second line, rewritten.");
    await expect(page.locator(editor)).not.toContainText(
      "Third line, rewritten.",
    );
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__release = true;
    });
    await expect(page.locator(editor)).toContainText("Third line, rewritten.");
  });
