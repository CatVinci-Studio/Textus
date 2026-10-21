import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// A picture Textus AI makes (generate_image, #194) is a proposal like any
// other insertion: drawn in place with Accept and Reject, and saved only
// on Accept, the way Settings › Images says for a pasted one. Reject
// leaves nothing behind; undo brings the proposal back without a second
// file. The image service itself is the backend's (mocked here).

const editor = '[data-active-tab="true"] .ProseMirror';
const pending = `${editor} .pending-insert img`;
const written = `${editor} img[data-doc-src]`;
const menuItem = (page: Page, name: string) =>
  page.locator(".context-menu-item", { hasText: name });

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const FIRST = "The harbour was quiet before the boats came in.";

function exchange(call: object, output: string) {
  return [
    { kind: "User", text: "Illustrate it" },
    {
      kind: "ToolCall",
      call_id: "g1",
      name: "generate_image",
      arguments: JSON.stringify(call),
    },
    { kind: "ToolResult", call_id: "g1", output },
    { kind: "Assistant", text: "A harbour at dusk, after the paragraph." },
  ];
}

const made = {
  prompt: "A quiet harbour at dusk",
  alt: "A quiet harbour",
  action: "insert_after",
  anchor: FIRST,
  image: { id: "abc123", width: 1, height: 1 },
};

async function open(page: Page, imageModelProvider = "openai") {
  await openApp(page, {
    settings: { language: "en", imageModelProvider },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `${FIRST}\n\nThe second paragraph.`);
}

async function send(page: Page, message = "Illustrate the first paragraph") {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");
}

const actions = (page: Page) =>
  page.locator(".agent-proposal-actions .inline-chat-action");

const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (cmd) =>
      (
        ((window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []) as { cmd: string }[]
      ).filter((c) => c.cmd === cmd),
    cmd,
  );

async function propose(page: Page) {
  await mockInvoke(page, {
    ai_agent_message: exchange(
      made,
      "Image proposed - the user now sees the picture.",
    ),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/harbour.png" },
  });
  await send(page);
  await expect(page.locator(pending)).toHaveCount(1, { timeout: 10_000 });
}

test("a proposed picture shows in place, and only Accept saves it", async ({
  page,
}) => {
  await open(page);
  await propose(page);
  await expect(page.locator(pending)).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await expect(page.locator(".agent-proposal-picture")).toHaveCount(1);
  expect(await calls(page, "save_pasted_image")).toHaveLength(0);

  await actions(page).filter({ hasText: "Accept" }).click();
  await expect(page.locator(pending)).toHaveCount(0);
  await expect(page.locator(written)).toHaveCount(1);
  await expect(page.locator(written)).toHaveAttribute(
    "data-doc-src",
    "assets/harbour.png",
  );
  const saves = await calls(page, "save_pasted_image");
  expect(saves).toHaveLength(1);
  // Its own paragraph, after the one it illustrates.
  await expect(page.locator(`${editor} > p`).first()).toHaveText(FIRST);

  // Undo brings the proposal back; accepted again, the same file.
  await page.locator(editor).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(written)).toHaveCount(0);
  await expect(page.locator(pending)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(written)).toHaveCount(1);
  expect(await calls(page, "save_pasted_image")).toHaveLength(1);
});

test("rejecting a proposed picture leaves nothing behind", async ({ page }) => {
  await open(page);
  await propose(page);
  await actions(page).filter({ hasText: "Reject" }).click();
  await expect(page.locator(`${editor} img`)).toHaveCount(0);
  await expect(page.locator(`${editor} p`)).toHaveText([
    FIRST,
    "The second paragraph.",
  ]);
  expect(await calls(page, "save_pasted_image")).toHaveLength(0);
  expect(await calls(page, "ai_discard_generated_image")).toHaveLength(1);
});

test("a picture the service refused says why, and proposes nothing", async ({
  page,
}) => {
  await open(page);
  await mockInvoke(page, {
    ai_agent_message: exchange(
      { ...made, image: undefined },
      "Not generated: The service refused this description: Your request was rejected by the safety system. Tell the user in plain words; don't change the description and call again unless they ask.",
    ),
  });
  await send(page);
  await expect(page.locator(".agent-image-failed")).toHaveText(
    "No picture made: The service refused this description: Your request was rejected by the safety system.",
  );
  await expect(page.locator(".agent-proposal")).toHaveCount(0);
  await expect(page.locator(`${editor} img`)).toHaveCount(0);
});

test("Illustrate this paragraph asks for a picture of the paragraph right-clicked", async ({
  page,
}) => {
  await open(page);
  await mockInvoke(page, {
    ai_agent_message: exchange(made, "Image proposed - shown."),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
  });
  await page.locator(`${editor} p`).first().click({ button: "right" });
  await menuItem(page, "Illustrate this paragraph").click();
  await expect(page.locator(pending)).toHaveCount(1, { timeout: 10_000 });
  const [sent] = (await calls(page, "ai_agent_message")) as unknown as {
    message: string;
    mode: string;
    imageModel: { provider: string };
  }[];
  expect(sent.mode).toBe("write");
  expect(sent.imageModel.provider).toBe("openai");
  expect(sent.message).toContain(FIRST);
  expect(sent.message).toContain("Illustrate this paragraph");
});

test("without an image model the menu offers no picture", async ({ page }) => {
  await open(page, "");
  await page.locator(`${editor} p`).first().click({ button: "right" });
  await expect(menuItem(page, "Ask AI…")).toBeVisible();
  await expect(menuItem(page, "Illustrate this paragraph")).toHaveCount(0);
});

test("a proposed picture larger than the page keeps within its column", async ({
  page,
}) => {
  await open(page);
  // A picture the size an image service makes, far wider than the column.
  const big = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#4a7";
    g.fillRect(0, 0, 1600, 900);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await mockInvoke(page, {
    ai_agent_message: exchange(
      { ...made, image: { id: "abc123", width: 1600, height: 900 } },
      "Image proposed - the user now sees the picture.",
    ),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: big },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/harbour.png" },
  });
  await send(page);
  const picture = page.locator(pending);
  await expect(picture).toHaveCount(1, { timeout: 10_000 });
  await expect(picture).toHaveJSProperty("complete", true);
  const column = await page
    .locator(`${editor} > p`)
    .first()
    .evaluate((p) => p.getBoundingClientRect().width);
  const box = await picture.evaluate((img) => {
    const { width, height } = img.getBoundingClientRect();
    return { width, height };
  });
  // The column's width, the picture's shape (as .image-view draws it once
  // accepted).
  expect(Math.abs(box.width - column)).toBeLessThan(6);
  expect(box.height / box.width).toBeCloseTo(900 / 1600, 2);
});

// generate_image returns while the picture is made (ai/images.rs): the
// call records it as pending, and ai_generated_image answers once it is.
const painting = {
  ...made,
  image: { id: "abc123", width: 1536, height: 1024, pending: true },
};

/** A reply that writes a paragraph and asks for a picture, the picture
 *  taking `ms` to come (or failing then with `refusal`). */
async function writeAndPaint(page: Page, ms: number, refusal?: string) {
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Write a paragraph and illustrate it" },
      {
        kind: "ToolCall",
        call_id: "w1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "append",
          text: "The tide went out before dawn.",
        }),
      },
      { kind: "ToolResult", call_id: "w1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "g1",
        name: "generate_image",
        arguments: JSON.stringify(painting),
      },
      {
        kind: "ToolResult",
        call_id: "g1",
        output: "Image proposed and being made (1536 x 1024 pixels).",
      },
      { kind: "Assistant", text: "A paragraph, and a harbour at dusk." },
    ],
    ai_generated_image: refusal
      ? { __delay: ms, __reject: refusal }
      : {
          __delay: ms,
          value: { mime: "image/png", ext: "png", dataBase64: PNG },
        },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/harbour.png" },
  });
  await send(page, "Write a paragraph and illustrate it");
}

test("text and a picture come together: the text at once, the picture's frame until it is made", async ({
  page,
}) => {
  await open(page);
  await writeAndPaint(page, 2500);
  const frame = page.locator(`${editor} .pending-picture`);
  // The paragraph and the reply are there while the picture is painting.
  await expect(
    page.locator(`${editor} .pending-insert`, {
      hasText: "The tide went out before dawn.",
    }),
  ).toBeVisible();
  await expect(page.locator(".agent-panel-view")).toContainText(
    "A paragraph, and a harbour at dusk.",
  );
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("aria-busy", "true");
  // In the shape asked for, as wide as the column.
  const box = (await frame.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(1536 / 1024, 1);
  // The picture takes its place once it comes.
  await expect(page.locator(pending)).toHaveAttribute(
    "src",
    /^data:image\/png/,
    { timeout: 10_000 },
  );
  await expect(frame).toHaveCount(0);
});

test("Accept while the picture is painting saves it once it comes", async ({
  page,
}) => {
  await open(page);
  await writeAndPaint(page, 2000);
  await expect(page.locator(`${editor} .pending-picture`)).toBeVisible();
  const pictureCard = page.locator(".agent-proposal", {
    has: page.locator(".agent-proposal-picture-frame"),
  });
  await pictureCard
    .locator(".agent-proposal-actions .inline-chat-action")
    .filter({ hasText: "Accept" })
    .click();
  await expect(page.locator(written)).toHaveCount(1, { timeout: 10_000 });
  expect(await calls(page, "save_pasted_image")).toHaveLength(1);
});

test("a picture that wasn't made says why in its frame", async ({ page }) => {
  await open(page);
  await writeAndPaint(
    page,
    500,
    "The service refused this description: rejected by the safety system",
  );
  const frame = page.locator(`${editor} .pending-picture`);
  await expect(frame).toHaveClass(/pending-picture-failed/);
  await expect(frame).toContainText("rejected by the safety system");
  // The paragraph is unaffected.
  await expect(
    page.locator(`${editor} .pending-insert`, {
      hasText: "The tide went out before dawn.",
    }),
  ).toBeVisible();
});
