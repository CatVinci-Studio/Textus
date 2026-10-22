import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * An edit that names its block (src/ai/doc-blocks.ts) instead of quoting
 * it shows the moment the block is named - the new text typing into the
 * document while the call still streams - rather than after a quote of the
 * whole passage (rc.6: ten seconds of nothing for a rewrite of a whole
 * document on a ChatGPT subscription).
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const DOC =
  "# Night hours\n\nThe library opened late on Wednesdays.\n\nStudents came most.\n\nThe end.";

/** The blocks' ids, as the app splits them - its own module, from the dev
 *  server (the e2e project can't import src/). */
async function blockIds(page: Page, doc: string): Promise<string[]> {
  return page.evaluate(
    async ({ doc, path }) => {
      const mod = (await import(/* @vite-ignore */ path)) as {
        splitBlocks: (d: string) => { id: string }[];
      };
      return mod.splitBlocks(doc).map((b) => b.id);
    },
    { doc, path: "/src/ai/doc-blocks.ts" },
  );
}

/** A reply that streams `raw` (the model's arguments, by block) and then,
 *  once window.__release is set, completes with `resolved` (the backend's:
 *  by anchor, doc_blocks::resolve_edit_arguments). */
async function streamEdit(page: Page, raw: string, resolved: string) {
  await page.evaluate(
    ({ raw, resolved }) => {
      const w = window as unknown as Record<string, unknown>;
      const internals = w.__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = (cmd, a) => {
        if (cmd !== "ai_agent_message") return original(cmd, a);
        const { message, onEvent } = a as {
          message: string;
          onEvent?: { onmessage?: (event: unknown) => void };
        };
        const send = (event: unknown) => onEvent?.onmessage?.(event);
        send({ type: "toolStart", callId: "b1", name: "propose_edit" });
        const call = {
          kind: "ToolCall",
          call_id: "b1",
          name: "propose_edit",
          arguments: resolved,
        };
        const result = {
          kind: "ToolResult",
          call_id: "b1",
          output: "Edit proposed",
        };
        const reply = { kind: "Assistant", text: "Tightened it." };
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            if (i < raw.length) {
              send({
                type: "toolArgsDelta",
                callId: "b1",
                delta: raw.slice(i, i + 6),
              });
              i += 6;
              setTimeout(tick, 15);
              return;
            }
            if (!w.__release) {
              setTimeout(tick, 30);
              return;
            }
            for (const turn of [call, result, reply])
              send({ type: "turn", turn });
            resolve([{ kind: "User", text: message }, call, result, reply]);
          };
          tick();
        });
      };
    },
    { raw, resolved },
  );
}

async function ask(page: Page) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten the second paragraph");
  await composer.press("Enter");
}

test("an edit by block shows while it streams, before the call completes", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, DOC);
  const ids = await blockIds(page, DOC);
  const text = "The library now opens until ten on Wednesdays.";
  await streamEdit(
    page,
    JSON.stringify({ action: "replace", block: ids[1], text }),
    JSON.stringify({
      action: "replace",
      anchor: "The library opened late on Wednesdays.",
      text,
    }),
  );
  await ask(page);
  // Not complete yet (held), and already in the document - and the panel
  // says what is coming, rather than going still.
  await expect(page.locator(editor)).toContainText("until ten");
  await expect(page.locator(".agent-panel-view .agent-thinking")).toHaveText(
    /Writing the edit/,
  );
  expect(
    await page.evaluate(() => !(window as { __release?: boolean }).__release),
  ).toBe(true);
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Tightened it.",
  );
  await expect(page.locator(editor)).toContainText("until ten");
});

test("a few words named inside a block change in it as they stream", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, DOC);
  const ids = await blockIds(page, DOC);
  await streamEdit(
    page,
    JSON.stringify({
      action: "replace",
      anchor: "Students",
      block: ids[2],
      text: "Pupils",
    }),
    JSON.stringify({
      action: "replace",
      anchor: "Students came most.",
      text: "Pupils came most.",
    }),
  );
  await ask(page);
  await expect(page.locator(editor)).toContainText("Pupils");
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Tightened it.",
  );
});
