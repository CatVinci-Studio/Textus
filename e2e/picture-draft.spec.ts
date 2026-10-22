import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A generate_image call shows its frame - in its place, in its shape - the
 * moment the call says where it goes and how wide it is, while its long
 * description still streams in, and the picture takes the frame's place
 * when the call completes (rc.6: the redo of a picture began only once the
 * whole description had come).
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const FIRST = "The harbour was quiet before the boats came in.";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Streams `raw` as generate_image's arguments, then waits for
 *  window.__release before the call completes with `final`. */
async function streamPicture(page: Page, raw: string, final: string | null) {
  await page.evaluate(
    ({ raw, final }) => {
      const w = window as unknown as Record<string, unknown>;
      const internals = w.__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = (cmd, a) => {
        // A picture still being made, while __holdPicture is set.
        if (cmd === "ai_generated_image" && w.__holdPicture)
          return new Promise(() => {});
        if (cmd !== "ai_agent_message") return original(cmd, a);
        const { message, onEvent } = a as {
          message: string;
          onEvent?: { onmessage?: (event: unknown) => void };
        };
        const send = (event: unknown) => onEvent?.onmessage?.(event);
        send({ type: "toolStart", callId: "g1", name: "generate_image" });
        const turns = [
          {
            kind: "ToolCall",
            call_id: "g1",
            name: "generate_image",
            arguments: final ?? raw,
          },
          {
            kind: "ToolResult",
            call_id: "g1",
            output: final
              ? "Image proposed - the user now sees the picture."
              : "Not made: this request has made all the pictures it may.",
          },
          { kind: "Assistant", text: "A harbour at dusk." },
        ];
        return new Promise((resolve) => {
          let i = 0;
          const tick = () => {
            if (i < raw.length) {
              send({
                type: "toolArgsDelta",
                callId: "g1",
                delta: raw.slice(i, i + 10),
              });
              i += 10;
              setTimeout(tick, 15);
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
    { raw, final },
  );
}

const RAW = JSON.stringify({
  action: "insert_after",
  alt: "A quiet harbour",
  anchor: FIRST,
  aspect: "16:9",
  prompt: "A quiet harbour at dusk, ".repeat(30),
});

async function open(page: Page) {
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `${FIRST}\n\nThe second paragraph.`);
  await mockInvoke(page, {
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
  });
}

async function send(page: Page) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Illustrate the first paragraph");
  await composer.press("Enter");
}

test("a picture's frame shows in its shape while its description streams", async ({
  page,
}) => {
  await open(page);
  await streamPicture(
    page,
    RAW,
    JSON.stringify({
      ...JSON.parse(RAW),
      image: { id: "abc123", width: 1600, height: 900, pending: true },
    }),
  );
  await send(page);
  // The call isn't complete (held): its frame is there, 16:9, after the
  // paragraph it illustrates.
  const frame = page.locator(`${editor} .pending-picture`);
  await expect(frame).toHaveCount(1);
  const box = (await frame.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  // The picture itself takes the frame's place.
  await expect(page.locator(`${editor} .pending-insert img`)).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await expect(page.locator(`${editor} .pending-picture`)).toHaveCount(0);
});

test("a frame whose picture isn't made goes when the call completes", async ({
  page,
}) => {
  await open(page);
  await streamPicture(page, RAW, null);
  await send(page);
  await expect(page.locator(`${editor} .pending-picture`)).toHaveCount(1);
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  await expect(page.locator(".agent-panel-view")).toContainText(
    "A harbour at dusk.",
  );
  await expect(page.locator(`${editor} .pending-picture`)).toHaveCount(0);
});

test("while a picture is made, its frame on the chat's card has its shape", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__holdPicture = true;
    w.__release = true;
  });
  await streamPicture(
    page,
    RAW,
    JSON.stringify({
      ...JSON.parse(RAW),
      image: { id: "abc123", width: 1600, height: 900, pending: true },
    }),
  );
  await send(page);
  // The picture's shape, as tall as the card shows pictures - not a
  // fixed 4:3 that the picture then jumped out of.
  const card = page.locator(".agent-panel-view .agent-proposal-picture-frame");
  await expect(card).toHaveCount(1);
  const small = (await card.boundingBox())!;
  expect(small.width / small.height).toBeCloseTo(16 / 9, 1);
  expect(small.height).toBeCloseTo(120, 0);
});

test("a picture redone in place shows in the document and can be accepted", async ({
  page,
}) => {
  const OLD = "![Old harbour](images/old.png)";
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `${FIRST}\n\n${OLD}\n\nThe second paragraph.`);
  await mockInvoke(page, {
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
  });
  await page.evaluate(() => {
    (window as { __release?: boolean }).__release = true;
  });
  const raw = JSON.stringify({
    action: "replace",
    alt: "Summer harbour",
    anchor: OLD,
    aspect: "16:9",
    prompt: "The harbour on a summer night, ".repeat(20),
  });
  await streamPicture(
    page,
    raw,
    JSON.stringify({
      ...JSON.parse(raw),
      image: { id: "def456", width: 1600, height: 900, pending: true },
    }),
  );
  await send(page);
  await expect(page.locator(".agent-panel-view")).toContainText(
    "A harbour at dusk.",
  );
  await expect(page.locator(`${editor} .pending-insert img`)).toHaveAttribute(
    "src",
    /^blob:/,
  );
  const card = page.locator(".agent-panel-view .agent-proposal").last();
  await expect(card.getByRole("button", { name: "Accept" })).toBeVisible();
});
