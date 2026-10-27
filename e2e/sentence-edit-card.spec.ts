import { expect, test } from "@playwright/test";
import { blockIds, openApp, pasteMarkdown } from "./helpers";

/**
 * An edit of one sentence inside a paragraph: its margin card shows that
 * sentence from its first frame, whatever order the model's fields come in.
 */
const DOC =
  "The keeper woke before dawn. He climbed the stairs slowly. The lamp was still warm.\n\nA gull cried far off.";

for (const order of ["schema", "reason-first"])
  test(`a sentence edit's card shows that sentence from the start (${order})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1700, height: 900 });
    await openApp(page, {
      settings: { language: "en", revisionDisplay: "final" },
      storage: { "textus-agent-panel-open": "0" },
      animations: true,
    });
    await pasteMarkdown(page, DOC);
    const ids = await blockIds(page, DOC);
    const fields: [string, string][] =
      order === "schema"
        ? [
            ["action", "replace"],
            ["block", ids[0]],
            ["anchor", "He climbed the stairs slowly."],
            ["text", "He took the stairs one at a time."],
            ["reason", "Slower, more concrete."],
          ]
        : [
            ["action", "replace"],
            ["block", ids[0]],
            ["reason", "Slower, more concrete."],
            ["anchor", "He climbed the stairs slowly."],
            ["text", "He took the stairs one at a time."],
          ];
    const raw = `{${fields.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",")}}`;
    await page.evaluate(
      ({ raw }) => {
        const w = window as unknown as Record<string, unknown>;
        w.__log = [];
        const t0 = performance.now();
        const tick = () => {
          const cards = [
            ...document.querySelectorAll(".review-margin .review-note"),
          ].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").slice(0, 80));
          (w.__log as unknown[]).push([
            Math.round(performance.now() - t0),
            cards,
          ]);
          if ((w.__log as unknown[]).length < 600) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
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
          const settle = w.__devSettle as (
            b: unknown,
            n: string,
            a: string,
          ) => string;
          const turns = [
            {
              kind: "ToolCall",
              call_id: "e1#0",
              name: "propose_edit",
              arguments: settle(blocks, "propose_edit", raw),
            },
            { kind: "ToolResult", call_id: "e1#0", output: "Edit proposed" },
            { kind: "Assistant", text: "Done." },
          ];
          send({ type: "toolStart", callId: "e1#0", name: "propose_edit" });
          return new Promise((resolve) => {
            let i = 0;
            const step = () => {
              if (i < raw.length) {
                send({
                  type: "toolArgsDelta",
                  callId: "e1#0",
                  delta: raw.slice(i, i + 4),
                });
                i += 4;
                setTimeout(step, 40);
                return;
              }
              setTimeout(() => {
                for (const turn of turns) send({ type: "turn", turn });
                resolve([{ kind: "User", text: message }, ...turns]);
              }, 600);
            };
            step();
          });
        };
      },
      { raw },
    );
    await page.keyboard.press("Control+Shift+L");
    const composer = page.locator(".agent-panel-view textarea");
    await composer.fill("Tighten it");
    await composer.press("Enter");
    await page.waitForTimeout(5000);
    const log = (await page.evaluate(
      () => (window as unknown as { __log: [number, string[]][] }).__log,
    )) as [number, string[]][];
    const shown = log.flatMap(([, cards]) => cards);
    expect(shown.length).toBeGreaterThan(0);
    for (const card of shown) expect(card).not.toContain("The keeper woke");
  });
