import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FIRST_LOAD, openApp } from "./helpers";

/**
 * A whole-document rewrite around a non-sentence block is still decided
 * paragraph by paragraph; a block written another way is no change.
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
// Long enough on both sides not to be merged as short paragraphs.
const BEFORE =
  "小满撑开伞，仔细看过伞面和竹骨，都好好的。她又把伞收起来，在手里掂了掂，伞柄上的漆早就磨掉了，露出底下发黑的木头，摸上去却还是光滑的，像被很多只手握过很多年，一直没有换过。";
const AFTER =
  "雨停了，她把伞挂在门后。门后的钉子上原本挂着一件旧雨衣，她把雨衣取下来叠好放进柜子，让伞单独挂在那里，伞尖还在往下滴水，一滴一滴落在门口那块褪了色的旧地垫上，过了很久很久才终于停下来。";
const NEW_BEFORE =
  "Xiaoman opened the umbrella and checked the canopy and ribs.";
const NEW_AFTER =
  "The rain stopped, and she hung the umbrella behind the door.";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** The model's side: one replace of the whole document with `text`. */
async function replyWithRewrite(page: Page, text: string) {
  await page.evaluate((text) => {
    const w = window as unknown as Record<string, unknown>;
    const internals = w.__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    };
    const original = internals.invoke;
    internals.invoke = (cmd, a) => {
      if (cmd !== "ai_agent_message") return original(cmd, a);
      const { message, blocks, onEvent } = a as {
        message: string;
        blocks: { id: string }[];
        onEvent?: { onmessage?: (event: unknown) => void };
      };
      const send = (event: unknown) => onEvent?.onmessage?.(event);
      const written = JSON.stringify({
        action: "replace",
        block: blocks[0].id,
        last_block: blocks[blocks.length - 1].id,
        text,
      });
      const settle = w.__devSettle as (
        blocks: unknown,
        name: string,
        args: string,
      ) => string;
      const call = {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: settle(blocks, "propose_edit", written),
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
          send({ type: "toolArgsDelta", callId: "r1", delta: written });
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
      storage: { "textus-agent-panel-open": "1" },
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
    // Its block may be maths, which waits for KaTeX's first load.
    await expect(
      page.locator('[data-active-tab="true"] .ProseMirror'),
    ).toContainText("小满", FIRST_LOAD);
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
