import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp } from "./helpers";

/**
 * A rewrite of a whole document with a block in it that isn't sentences -
 * a picture, a table, a code block, a footnote, a link's definition - is
 * still decided paragraph by paragraph, the block a change of its own or
 * kept (src/ai/revision/markdown-forms.ts). Before, one such block made the
 * whole rewrite one block and one card, or a table's rows words in the
 * next paragraph (rc.6). And a block written another way (`***` for `---`,
 * an autolink without its brackets, a table without its padding) is the
 * same block, no change.
 *
 * Each case: a paragraph, the block, a paragraph - rewritten into English
 * with the block as `rewritten`; `changes` is how many changes its card
 * lists.
 */

interface Case {
  name: string;
  block: string;
  rewritten: string;
  changes: number;
}

const CASES: Case[] = JSON.parse(
  readFileSync(new URL("./rewrite-blocks-cases.json", import.meta.url), "utf8"),
);
const BEFORE = "小满撑开伞，仔细看过伞面和竹骨，都好好的。";
const AFTER = "雨停了，她把伞挂在门后。";
const NEW_BEFORE =
  "Xiaoman opened the umbrella and checked the canopy and ribs.";
const NEW_AFTER =
  "The rain stopped, and she hung the umbrella behind the door.";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** The model's side: one replace of the whole document as the request
 *  sent it, with `text`. */
async function replyWithRewrite(page: Page, text: string) {
  await page.evaluate((text) => {
    const w = window as unknown as Record<string, unknown>;
    const internals = w.__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    };
    const original = internals.invoke;
    internals.invoke = (cmd, a) => {
      if (cmd !== "ai_agent_message") return original(cmd, a);
      const { message, document, onEvent } = a as {
        message: string;
        document: string;
        onEvent?: { onmessage?: (event: unknown) => void };
      };
      const send = (event: unknown) => onEvent?.onmessage?.(event);
      const call = {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: document.trim(),
          text,
        }),
      };
      const result = {
        kind: "ToolResult",
        call_id: "r1",
        output: "Edit proposed",
      };
      const reply = { kind: "Assistant", text: "Translated it." };
      return new Promise((resolve) =>
        setTimeout(() => {
          send({ type: "toolStart", callId: "r1", name: "propose_edit" });
          send({ type: "toolArgsDelta", callId: "r1", delta: call.arguments });
          for (const turn of [call, result, reply])
            send({ type: "turn", turn });
          resolve([{ kind: "User", text: message }, call, result, reply]);
        }, 50),
      );
    };
  }, text);
}

for (const c of CASES) {
  test(`a whole rewrite around ${c.name} is decided by its parts`, async ({
    page,
  }) => {
    await page.route("http://asset.localhost/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(PNG, "base64"),
      }),
    );
    await openApp(page, {
      settings: { language: "en" },
      storage: { "levis-agent-panel-open": "1" },
    });
    const path = "/notes/umbrella.md";
    await page.evaluate(
      (files) =>
        ((window as unknown as Record<string, unknown>).__devFiles = files),
      { [path]: `${BEFORE}\n\n${c.block}\n\n${AFTER}\n` },
    );
    await page.evaluate(
      (p) =>
        (
          window as unknown as {
            __devEmitTauriEvent: (name: string, payload?: unknown) => void;
          }
        ).__devEmitTauriEvent("tauri://drag-drop", {
          paths: [p],
          position: { x: 0, y: 0 },
        }),
      path,
    );
    await expect(
      page.locator('[data-active-tab="true"] .ProseMirror'),
    ).toContainText("小满");
    await replyWithRewrite(
      page,
      `${NEW_BEFORE}\n\n${c.rewritten}\n\n${NEW_AFTER}`,
    );
    const composer = page.locator(".agent-panel-view textarea");
    await composer.fill("Translate it into English");
    await composer.press("Enter");
    await expect(
      page.locator(".agent-panel-view .agent-proposal-sentence"),
    ).toHaveCount(c.changes);
  });
}
