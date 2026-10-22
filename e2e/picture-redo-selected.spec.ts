import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Redoing a picture the writer selected (rc.6: the new picture was made and
// showed on its card, but never took the old one's place in the text). The
// reply is built from what the request carried - the picture's Markdown as
// the model was shown it - the way a model copies it.

const editor = '[data-active-tab="true"] .ProseMirror';
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const FIRST = "小满撑开伞，仔细看过伞面和竹骨，都好好的。";
const LAST = "夜里，小满拆开伞顶，在夹层里找到一枚白色纽扣。";

async function open(page: Page, picture: string) {
  await page.route("http://asset.localhost/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(PNG, "base64"),
    }),
  );
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const path = "/notes/rain.md";
  await page.evaluate(
    (files) =>
      ((window as unknown as Record<string, unknown>).__devFiles = files),
    { [path]: `${FIRST}\n\n${picture}\n\n${LAST}\n` },
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
  await expect(page.locator(`${editor} .image-view img`)).toHaveCount(1);
}

/** The model's side: generate_image `replace` naming the picture's block
 *  in the document it was sent, the picture made after `delay` ms, the call
 *  settled as the backend settles it (src/dev/settle-calls.ts). Records
 *  each request's blocks and message. */
async function replyWithRedo(page: Page, delay: number) {
  await page.evaluate(
    ({ png, delay }) => {
      const w = window as unknown as Record<string, unknown>;
      const internals = w.__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      const original = internals.invoke;
      type Block = { id: string; markdown: string; kind: string };
      const sent: { blocks: Block[]; message: string }[] = [];
      const settle = w.__devSettle as (
        b: unknown,
        name: string,
        args: string,
      ) => string;
      w.__sent = sent;
      internals.invoke = (cmd, a) => {
        if (cmd === "ai_generated_image")
          return new Promise((r) =>
            setTimeout(
              () => r({ mime: "image/png", ext: "png", dataBase64: png }),
              delay,
            ),
          );
        if (cmd === "ai_discard_generated_image") return Promise.resolve(null);
        if (cmd !== "ai_agent_message") return original(cmd, a);
        const { message, blocks } = a as {
          message: string;
          blocks: Block[];
        };
        sent.push({ blocks, message });
        const { onEvent: events } = a as {
          onEvent?: { onmessage?: (e: unknown) => void };
        };
        if (sent.length > 1) {
          // The second request: the selected paragraph tightened.
          const edit = [
            {
              kind: "ToolCall",
              call_id: "e2",
              name: "propose_edit",
              arguments: JSON.stringify({
                action: "replace_selection",
                text: "夜里，小满拆开伞顶，找到一枚白纽扣。",
              }),
            },
            { kind: "ToolResult", call_id: "e2", output: "Edit proposed" },
            { kind: "Assistant", text: "收紧了。" },
          ];
          for (const turn of edit) events?.onmessage?.({ type: "turn", turn });
          return Promise.resolve([{ kind: "User", text: message }, ...edit]);
        }
        // The picture's own block: a picture, or one given a width (HTML).
        const picture =
          blocks.find((b) => b.kind === "picture" || b.kind === "html")?.id ??
          "";
        const call = {
          kind: "ToolCall",
          call_id: "g1",
          name: "generate_image",
          arguments: settle(
            blocks,
            "generate_image",
            JSON.stringify({
              action: "replace",
              block: picture,
              alt: "夏夜",
              aspect: "16:9",
              prompt: "The same workshop on a summer night",
              image: { id: "sum1", width: 1600, height: 900, pending: true },
            }),
          ),
        };
        const turns = [
          call,
          {
            kind: "ToolResult",
            call_id: "g1",
            output: "Image proposed and being made.",
          },
          { kind: "Assistant", text: "换成了夏夜。" },
        ];
        const { onEvent } = a as {
          onEvent?: { onmessage?: (e: unknown) => void };
        };
        const send = (e: unknown) => onEvent?.onmessage?.(e);
        // As a model streams it: the call's start, its arguments in pieces
        // (without the picture, which the backend adds once it has run),
        // then the turns.
        const raw = JSON.stringify({
          action: "replace",
          block: picture,
          alt: "夏夜",
          aspect: "16:9",
          prompt: "The same workshop on a summer night, ".repeat(8),
        });
        send({ type: "toolStart", callId: "g1", name: "generate_image" });
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            if (i < raw.length) {
              send({
                type: "toolArgsDelta",
                callId: "g1",
                delta: raw.slice(i, i + 12),
              });
              i += 12;
              setTimeout(tick, 10);
              return;
            }
            // The backend says the call started once more as it runs it
            // (images.rs' execute), for a provider that didn't stream it.
            send({ type: "toolStart", callId: "g1", name: "generate_image" });
            for (const turn of turns) send({ type: "turn", turn });
            resolve([{ kind: "User", text: message }, ...turns]);
          };
          tick();
        });
      };
    },
    { png: PNG, delay },
  );
}

async function ask(page: Page, text: string) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(text);
  await composer.press("Enter");
}

for (const [name, picture] of [
  ["a plain picture", "![](assets/image-1792635901825.jpg)"],
  [
    "a picture with a width",
    '<img src="assets/image-1792635901825.jpg" width="60%">',
  ],
] as const)
  test(`${name}, selected and redone, takes the old one's place once made`, async ({
    page,
  }) => {
    await open(page, picture);
    await replyWithRedo(page, 1500);
    // Selected, as the writer did: the message box says a picture is.
    await page.locator(`${editor} .image-view img`).click();
    await ask(page, "这个图片换一个夏天的感觉");
    // Made: the new picture stands in the text, to decide on.
    await expect(page.locator(`${editor} .pending-insert img`)).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(
      page
        .locator(".agent-proposal-actions .inline-chat-action-primary")
        .first(),
    ).toBeEnabled();
  });

test("a picture being redone survives a second request about the text after it", async ({
  page,
}) => {
  await open(page, "![](assets/image-1792635901825.jpg)");
  await replyWithRedo(page, 4000);
  await page.locator(`${editor} .image-view img`).click();
  await ask(page, "这个图片换一个夏天的感觉");
  await expect(page.locator(".agent-panel-view")).toContainText("换成了夏夜。");
  // While it is still being made, the paragraph after it is selected and
  // a second request sent.
  await page.locator(`${editor} p`, { hasText: "夜里" }).selectText();
  await ask(page, "能不能整合一点");
  await expect(page.locator(".agent-panel-view")).toContainText("收紧了。");
  await expect(
    page.locator(`${editor} .pending-insert`, { hasText: "白纽扣" }),
  ).toHaveCount(1);
  // The picture still comes, in the old one's place.
  await expect(page.locator(`${editor} .pending-insert img`)).toHaveCount(1, {
    timeout: 10_000,
  });
  const cards = page.locator(".agent-panel-view .agent-proposal");
  await expect(cards.first()).not.toContainText("Writing");
});
