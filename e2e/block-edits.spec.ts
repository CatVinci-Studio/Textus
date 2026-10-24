import { expect, test, type Page } from "@playwright/test";
import { blockIds, openApp, pasteMarkdown } from "./helpers";

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

/** A reply that streams `raw` (the model's arguments, by block) and then,
 *  once window.__release is set, completes with them settled as the
 *  backend settles them (src/dev/settle-calls.ts). */
async function streamEdit(page: Page, raw: string) {
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
        send({ type: "toolStart", callId: "b1", name: "propose_edit" });
        const settle = w.__devSettle as (
          blocks: unknown,
          name: string,
          args: string,
        ) => string;
        const call = {
          kind: "ToolCall",
          call_id: "b1",
          name: "propose_edit",
          arguments: settle(blocks, "propose_edit", raw),
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
    { raw },
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
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, DOC);
  const ids = await blockIds(page, DOC);
  const text = "The library now opens until ten on Wednesdays.";
  await streamEdit(
    page,
    JSON.stringify({ action: "replace", block: ids[1], text }),
  );
  await ask(page);
  // Not complete yet (held): the paragraph it rewrites is marked where it
  // stands, and the panel and the review bar say what is coming, rather
  // than going still - the paragraph lands once it is written whole.
  await expect(page.locator(`${editor} .pending-reading`)).toContainText(
    "opened late",
  );
  await expect(page.locator(".agent-panel-view .agent-thinking")).toHaveText(
    /Writing the edit/,
  );
  await expect(page.locator(".review-bar-working")).toHaveText(
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
    storage: { "textus-agent-panel-open": "1" },
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
  );
  await ask(page);
  // Held after its text is whole, before the step ends: already in.
  await expect(
    page.locator(`${editor} .pending-sentence-new`, { hasText: "Pupils" }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Tightened it.",
  );
  await expect(page.locator(editor)).toContainText("Pupils");
});

// Edit animation off, or the system's Reduce motion: no typewriter, but
// the edit still shows while it streams - it used to wait for the whole
// call (rc.6: "Thinking…", then every edit at once).
for (const [name, setup] of [
  ["edit animation off", { enableEditAnimation: false }],
  ["Reduce motion", null],
] as const)
  test(`with ${name} an edit still shows while it streams, then can be accepted`, async ({
    page,
  }) => {
    if (!setup) await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page, {
      settings: { language: "en", ...setup },
      storage: { "textus-agent-panel-open": "1" },
    });
    await pasteMarkdown(page, DOC);
    const ids = await blockIds(page, DOC);
    const text = "The library now opens until ten on Wednesdays.";
    await streamEdit(
      page,
      JSON.stringify({ action: "replace", block: ids[1], text }),
    );
    await ask(page);
    // Held: the call hasn't completed, and the whole new text is there.
    await expect(page.locator(editor)).toContainText(text);
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
    await page
      .locator(".review-bar")
      .getByRole("button", { name: "Accept" })
      .click();
    await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(0);
    await expect(page.locator(editor)).toContainText(text);
    await expect(page.locator(editor)).not.toContainText("opened late");
  });

test("a light polish shows where it is: the paragraph it is rewriting is marked until it lands", async ({
  page,
}) => {
  const doc =
    "# Night hours\n\nThe library opened late on Wednesdays. Students came most. Some stayed until ten.";
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, doc);
  const ids = await blockIds(page, doc);
  const text =
    "The library opened late on Wednesdays. Pupils came most. Some stayed until ten.";
  await streamEdit(
    page,
    JSON.stringify({ action: "replace", block: ids[1], text }),
  );
  await ask(page);
  // Held on its last sentence: nothing of the paragraph shows until it is
  // written whole, but the cursor stands on it, all of it.
  const reading = page.locator(`${editor} .pending-reading`);
  await expect(reading).toHaveText(
    "The library opened late on Wednesdays. Students came most. Some stayed until ten.",
  );
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Tightened it.",
  );
  await expect(page.locator(editor)).toContainText("Pupils");
  await expect(reading).toHaveCount(0);
});
