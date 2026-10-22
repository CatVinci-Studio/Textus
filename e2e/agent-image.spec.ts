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
    storage: { "textus-agent-panel-open": "1" },
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
  await expect(page.locator(pending)).toHaveAttribute("src", /^blob:/);
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
  await expect(page.locator(pending)).toHaveAttribute("src", /^blob:/, {
    timeout: 10_000,
  });
  await expect(frame).toHaveCount(0);
});

test("Accept waits for a picture being made, and saves it once it has come", async ({
  page,
}) => {
  await open(page);
  await writeAndPaint(page, 2000);
  await expect(page.locator(`${editor} .pending-picture`)).toBeVisible();
  const pictureCard = page.locator(".agent-proposal", {
    hasText: "Picture",
  });
  const accept = pictureCard.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  // Nothing to accept yet: the button says the picture is coming.
  await expect(accept).toBeDisabled();
  await expect(accept).toHaveText("Picture coming…");
  await expect(page.locator(".review-bar-accept")).toBeDisabled();
  await expect(accept).toHaveText("Accept", { timeout: 10_000 });
  await accept.click();
  await expect(page.locator(written)).toHaveCount(1, { timeout: 10_000 });
  expect(await calls(page, "save_pasted_image")).toHaveLength(1);
});

/** A reply that writes text with a picture in it (ai/images/inline.rs
 *  placed its line), the picture taking `ms` to come (or failing then
 *  with `refusal`). */
async function writeWithPictureInside(
  page: Page,
  ms: number,
  refusal?: string,
) {
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Write about the harbour, with a picture" },
      {
        kind: "ToolCall",
        call_id: "w1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "append",
          text: "The tide went out before dawn.\n\n![A harbour at dusk](textus-generated:abc123)\n\nThe boats came back at dusk.",
        }),
      },
      { kind: "ToolResult", call_id: "w1", output: "Edit proposed" },
      { kind: "Assistant", text: "Two paragraphs, a harbour between them." },
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
  await send(page, "Write about the harbour, with a picture");
}

test("a picture written into its text is one proposal with it, its frame until the picture comes", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await writeWithPictureInside(page, 1500);
  const proposal = page.locator(`${editor} .pending-insert`);
  await expect(proposal).toHaveCount(1);
  // The frame between the two paragraphs.
  await expect(proposal.locator(".pending-picture")).toBeVisible();
  await expect(page.locator(".agent-proposal")).toHaveCount(1);
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await expect(accept).toBeDisabled();
  // The picture comes in place, and only then can the text be accepted.
  await expect(proposal.locator("img")).toHaveAttribute("src", /^blob:/, {
    timeout: 10_000,
  });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.locator(written)).toHaveCount(1, { timeout: 10_000 });
  await expect(
    page.locator(`${editor} p`, { hasText: "The boats came back at dusk." }),
  ).toBeVisible();
  expect(await calls(page, "save_pasted_image")).toHaveLength(1);
});

test("a picture in the text that wasn't made is left out when the text is accepted", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await writeWithPictureInside(
    page,
    300,
    "The service refused this description: rejected by the safety system",
  );
  const proposal = page.locator(`${editor} .pending-insert`);
  await expect(proposal.locator(".pending-picture-failed")).toContainText(
    "rejected by the safety system",
  );
  await page
    .locator(".agent-proposal-actions .inline-chat-action-primary")
    .click();
  await expect(
    page.locator(`${editor} p`, { hasText: "The boats came back at dusk." }),
  ).toBeVisible();
  await expect(page.locator(`${editor} img`)).toHaveCount(0);
  expect(await calls(page, "save_pasted_image")).toHaveLength(0);
});

test("a picture asked for next to text not accepted yet joins that text, which stays", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const draft =
    "The tide went out before dawn.\n\nThe boats came back at dusk.";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Write about the harbour" },
      {
        kind: "ToolCall",
        call_id: "w1",
        name: "propose_edit",
        arguments: JSON.stringify({ action: "append", text: draft }),
      },
      { kind: "ToolResult", call_id: "w1", output: "Edit proposed" },
      { kind: "Assistant", text: "Two paragraphs." },
    ],
  });
  await send(page, "Write about the harbour");
  await expect(page.locator(`${editor} .pending-insert`)).toHaveCount(1);
  // Not accepted: a picture is asked for after its first paragraph.
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Add a picture after the first paragraph" },
      {
        kind: "ToolCall",
        call_id: "g2",
        name: "generate_image",
        arguments: JSON.stringify({
          prompt: "A harbour at dawn",
          alt: "A harbour at dawn",
          action: "insert_after",
          anchor: "The tide went out before dawn.",
          image: { id: "def456", width: 1024, height: 1024, pending: true },
        }),
      },
      {
        kind: "ToolResult",
        call_id: "g2",
        output: "Image proposed and being made (1024 x 1024 pixels).",
      },
      {
        kind: "Assistant",
        text: "A harbour at dawn, after the first paragraph.",
      },
    ],
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/dawn.png" },
  });
  await send(page, "Add a picture after the first paragraph");
  // Still one proposal: the text, now with the picture after its first
  // paragraph - nothing it had was taken away.
  const proposal = page.locator(`${editor} .pending-insert`);
  await expect(proposal).toHaveCount(1);
  await expect(proposal.locator("img")).toHaveCount(1, { timeout: 10_000 });
  await expect(proposal).toContainText("The boats came back at dusk.");
  await expect(page.locator(".agent-proposal-status").last()).toHaveText(
    "In the proposed text above",
  );
  await page
    .locator(".agent-proposal-actions .inline-chat-action-primary")
    .click();
  await expect(page.locator(written)).toHaveCount(1, { timeout: 10_000 });
  const order = await page
    .locator(`${editor} > *`)
    .evaluateAll((els) =>
      els.map(
        (el) =>
          el.textContent ||
          el.querySelector("img")?.getAttribute("alt") ||
          el.tagName,
      ),
    );
  expect(order.indexOf("The tide went out before dawn.")).toBeLessThan(
    order.indexOf("The boats came back at dusk."),
  );
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

test("a picture that wasn't made is asked for again by itself with Retry", async ({
  page,
}) => {
  await open(page);
  await writeAndPaint(page, 100, "The image service didn't answer in time.");
  const frame = page.locator(`${editor} .pending-picture`);
  await expect(frame).toHaveClass(/pending-picture-failed/);
  // This time the service answers.
  await page.evaluate((png) => {
    const w = window as unknown as {
      __devInvokeResults: Record<string, unknown>;
    };
    w.__devInvokeResults.ai_retry_generated_image = null;
    w.__devInvokeResults.ai_generated_image = {
      __delay: 300,
      value: { mime: "image/png", ext: "png", dataBase64: png },
    };
  }, PNG);
  await frame.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(`${editor} .pending-picture-failed`)).toHaveCount(
    0,
  );
  await expect(page.locator(`${editor} img[alt]`).first()).toBeVisible();
  const retried = await page.evaluate(
    () =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((c) => c.cmd === "ai_retry_generated_image").length,
  );
  expect(retried).toBe(1);
});

// A picture already in a saved document, to redo (generate_image's
// `replace`): it goes where the old one was, and the old file is offered
// the Trash - never moved unasked.
const OLD = "![Boats](assets/boats.png)";

async function openSaved(page: Page, settings: Record<string, unknown> = {}) {
  // The old picture is on disk, served as the asset protocol would.
  await page.route("http://asset.localhost/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(PNG, "base64"),
    }),
  );
  await openApp(page, {
    settings: { language: "en", ...settings },
    storage: { "textus-agent-panel-open": "1" },
  });
  const path = "/notes/harbour.md";
  await page.evaluate(
    (files) =>
      ((window as unknown as Record<string, unknown>).__devFiles = files),
    { [path]: `${FIRST}\n\n${OLD}\n` },
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
  await expect(page.locator(`${editor} p`).first()).toHaveText(FIRST);
}

async function redo(page: Page) {
  await mockInvoke(page, {
    ai_agent_message: exchange(
      {
        prompt: "The same harbour at dawn",
        alt: "The harbour at dawn",
        action: "replace",
        anchor: OLD,
        image: { id: "abc9", width: 1, height: 1 },
      },
      "Image proposed - the user now sees the picture.",
    ),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/harbour-dawn.png" },
    move_picture_to_trash: null,
  });
  await send(page, "Make the picture dawn instead");
  await expect(page.locator(pending)).toHaveCount(1, { timeout: 10_000 });
  await actions(page).filter({ hasText: "Accept" }).click();
  await expect(
    page.locator(`${editor} img[data-doc-src="assets/harbour-dawn.png"]`),
  ).toHaveCount(1);
  await expect(
    page.locator(`${editor} img[data-doc-src="assets/boats.png"]`),
  ).toHaveCount(0);
}

test("a redone picture takes the old one's place, and the old file goes to the Trash when asked", async ({
  page,
}) => {
  await openSaved(page);
  await redo(page);
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText(
    "Move the old one, “boats.png”, to the Trash?",
  );
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect
    .poll(() => calls(page, "move_picture_to_trash"))
    .toEqual([
      {
        cmd: "move_picture_to_trash",
        docPath: "/notes/harbour.md",
        path: "/notes/assets/boats.png",
      },
    ]);
});

test("a picture being redone keeps the old one, veiled, until the new one comes", async ({
  page,
}) => {
  await openSaved(page);
  await mockInvoke(page, {
    ai_agent_message: exchange(
      {
        prompt: "The same harbour at dawn",
        alt: "The harbour at dawn",
        action: "replace",
        anchor: OLD,
        image: { id: "abc10", width: 1024, height: 1024, pending: true },
      },
      "Image proposed and being made (1024 x 1024 pixels).",
    ),
    ai_generated_image: {
      __delay: 1500,
      value: { mime: "image/png", ext: "png", dataBase64: PNG },
    },
    ai_discard_generated_image: null,
  });
  await send(page, "Make the picture dawn instead");
  // The old picture, as it was, under the veil: nothing struck, nothing
  // new beside it, nothing to accept yet.
  const veiled = page.locator(`${editor} .pending-redraw`);
  await expect(veiled).toHaveCount(1);
  await expect(
    veiled.locator('img[data-doc-src="assets/boats.png"]'),
  ).toHaveCount(1);
  await expect(page.locator(`${editor} .pending-delete`)).toHaveCount(0);
  await expect(page.locator(pending)).toHaveCount(0);
  await expect(
    page.locator(".agent-proposal-actions .inline-chat-action-primary"),
  ).toBeDisabled();
  // The new one has come: the old struck, the new beside it, to decide on.
  await expect(page.locator(pending)).toHaveCount(1, { timeout: 10_000 });
  await expect(veiled).toHaveCount(0);
  await expect(page.locator(`${editor} .pending-delete`)).toHaveCount(1);
  await expect(
    page.locator(".agent-proposal-actions .inline-chat-action-primary"),
  ).toBeEnabled();
});

test("kept, the old picture's file stays where it is", async ({ page }) => {
  await openSaved(page);
  await redo(page);
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await calls(page, "move_picture_to_trash")).toHaveLength(0);
});

test("a picture's own menu asks Textus AI to change it, about that picture", async ({
  page,
}) => {
  await openSaved(page);
  await page.locator(`${editor} .image-view img`).click({ button: "right" });
  await menuItem(page, "Change this picture with Textus AI…").click();
  // Quick Ask, at the picture, with the picture as what it is about: the
  // request carries its Markdown, for generate_image's `replace`.
  const quick = page.locator(".inline-chat");
  await expect(quick).toBeVisible();
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "make it dawn" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  await quick.locator("textarea").fill("make it dawn");
  await quick.locator("textarea").press("Enter");
  await expect
    .poll(async () => {
      const [first] = (await calls(page, "ai_agent_message")) as {
        message?: string;
      }[];
      return first?.message ?? "";
    })
    .toContain(OLD);
});

test("pictures per request is a setting, sent with each request", async ({
  page,
}) => {
  await open(page);
  // The backend's image catalog (ai/images.rs), which Settings lists.
  await mockInvoke(page, {
    list_image_providers: [
      {
        id: "openai",
        label: "OpenAI",
        api: "open-ai",
        baseUrl: "https://api.openai.com/v1",
        keyId: "openai",
        models: ["gpt-image-2"],
      },
    ],
    provider_api_key_status: true,
  });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .getByRole("button", { name: "Textus AI", exact: true })
    .click();
  await settings
    .getByRole("combobox", { name: "Pictures per request" })
    .click();
  await page.getByRole("option", { name: "4" }).click();
  await settings.getByRole("button", { name: "Close" }).first().click();
  await mockInvoke(page, {
    ai_agent_message: exchange(
      made,
      "Image proposed - the user now sees the picture.",
    ),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
  });
  await send(page);
  await expect
    .poll(async () => {
      const [first] = (await calls(page, "ai_agent_message")) as {
        imageModel?: { limit?: number };
      }[];
      return first?.imageModel?.limit;
    })
    .toBe(4);
});

/** A reply as a model streams it: text with a picture line in it, a
 *  line at a time - the next when the test calls `__nextLine()` - and the
 *  backend saying the picture is begun (the `picture` event) once its
 *  line is complete, as ai/images/inline.rs does. */
async function streamTextWithPicture(page: Page, lines: string[]) {
  await page.evaluate((lines) => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __nextLine?: () => void;
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const streamed = JSON.stringify({
        action: "append",
        text: lines.join(""),
      });
      // What the backend placed: the line as its picture's Markdown.
      const placed = JSON.stringify({
        action: "append",
        text: lines
          .join("")
          .replace(
            /!\[(.*?)\]\(textus-picture:[^\n]*\)/,
            "![$1](textus-generated:pic1)",
          ),
      });
      let at = streamed.indexOf('"text":"') + '"text":"'.length;
      let sent = 0;
      send({ type: "toolStart", callId: "s1", name: "propose_edit" });
      send({
        type: "toolArgsDelta",
        callId: "s1",
        delta: streamed.slice(0, at),
      });
      return new Promise((resolve) => {
        w.__nextLine = () => {
          const line = lines[sent++];
          if (line === undefined) {
            send({
              type: "toolArgsDelta",
              callId: "s1",
              delta: streamed.slice(at),
            });
            const turns = [
              {
                kind: "ToolCall",
                call_id: "s1",
                name: "propose_edit",
                arguments: placed,
              },
              { kind: "ToolResult", call_id: "s1", output: "Edit proposed" },
              {
                kind: "Assistant",
                text: "Two paragraphs, a harbour between them.",
              },
            ];
            for (const turn of turns) send({ type: "turn", turn });
            resolve([{ kind: "User", text: message }, ...turns]);
            return;
          }
          const encoded = JSON.stringify(line).slice(1, -1);
          const picture = line.match(/^(!\[.*?\]\(textus-picture:.*\))\n/);
          if (picture) {
            // Most of the line, then the event, then its end.
            const cut = encoded.length - 4;
            send({
              type: "toolArgsDelta",
              callId: "s1",
              delta: encoded.slice(0, cut),
            });
            send({
              type: "picture",
              callId: "s1",
              line: picture[1],
              id: "pic1",
              width: 1536,
              height: 1024,
            });
            send({
              type: "toolArgsDelta",
              callId: "s1",
              delta: encoded.slice(cut),
            });
          } else {
            send({ type: "toolArgsDelta", callId: "s1", delta: encoded });
          }
          at += encoded.length;
        };
      });
    };
  }, lines);
}

const nextLine = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __nextLine: () => void }).__nextLine(),
  );

test("a picture written into streaming text shows as its frame from the moment its line is written, never as the line", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await mockInvoke(page, {
    ai_generated_image: {
      __delay: 4000,
      value: { mime: "image/png", ext: "png", dataBase64: PNG },
    },
    ai_discard_generated_image: null,
    save_pasted_image: { src: "assets/harbour.png" },
  });
  await streamTextWithPicture(page, [
    "The tide went out before dawn.\n\n",
    "![A harbour](textus-picture:16:9 A harbour at dusk, boats coming in)\n\n",
    "The boats came back at dusk.",
  ]);
  await send(page, "Write about the harbour, with a picture");
  const insert = page.locator(`${editor} .pending-insert`);
  const frames = page.locator(`${editor} .pending-picture`);
  await nextLine(page);
  await expect(insert).toContainText("The tide went out before dawn.");
  await expect(frames).toHaveCount(0);
  // The picture's line: its frame, in the shape asked for - the line
  // itself never shows.
  await nextLine(page);
  await expect(frames).toHaveCount(1);
  await expect
    .poll(async () => {
      const box = await frames.first().boundingBox();
      return box ? Math.round((box.width / box.height) * 10) / 10 : 0;
    })
    .toBeCloseTo(1536 / 1024, 1);
  await expect(page.locator(editor)).not.toContainText("textus-picture");
  await nextLine(page);
  await nextLine(page);
  await expect(insert).toContainText("The boats came back at dusk.");
  await expect(frames).toHaveCount(1);
  await expect(page.locator(editor)).not.toContainText("](");
  // Once the picture has come, the text and the picture are accepted.
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await expect(accept).toBeDisabled();
  await expect(accept).toBeEnabled({ timeout: 10_000 });
  await accept.click();
  await expect(page.locator(written)).toHaveCount(1, { timeout: 10_000 });
});

test("a selected picture says so in the message box, and in the message once sent", async ({
  page,
}) => {
  await openSaved(page);
  await page.locator(`${editor} img[data-doc-src="assets/boats.png"]`).click();
  const chip = page.locator(".inline-chat-chip-label");
  await expect(chip).toHaveText("Picture selected");
  await mockInvoke(page, {
    ai_agent_message: [
      {
        kind: "User",
        text: `<selected-text>\n${OLD}\n</selected-text>\n\nWhat is in it?`,
      },
      { kind: "Assistant", text: "Boats." },
    ],
  });
  await send(page, "What is in it?");
  await expect(
    page.locator(".agent-message-user .agent-context-chip"),
  ).toHaveText("Picture selected");
  const sent = (await calls(page, "ai_agent_message")) as unknown as {
    message: string;
  }[];
  expect(sent.at(-1)!.message).toContain(OLD);
});

test("a revision card shows a redone picture's pictures, not their Markdown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openSaved(page, { revisionDisplay: "original" });
  await mockInvoke(page, {
    ai_agent_message: exchange(
      {
        prompt: "The same harbour at dawn",
        alt: "The harbour at dawn",
        action: "replace",
        anchor: OLD,
        image: { id: "card1", width: 1024, height: 1024 },
      },
      "Image proposed - the user now sees the picture.",
    ),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_discard_generated_image: null,
  });
  await send(page, "Make the picture dawn instead");
  const card = page.locator(".revision-note-text").first();
  await expect(card.locator("> img.revision-note-picture")).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(card).not.toContainText("](");
  await expect(card.locator("> img.revision-note-picture")).toHaveAttribute(
    "src",
    /^blob:/,
  );
});

/** A rewrite of the paragraph an undecided picture stands after, as a
 *  second request sends it: `text` with the picture or without. */
function rewrite(text: string) {
  return [
    { kind: "User", text: "Rewrite the first paragraph" },
    {
      kind: "ToolCall",
      call_id: "r1",
      name: "propose_edit",
      arguments: JSON.stringify({ action: "replace", anchor: FIRST, text }),
    },
    { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
    { kind: "Assistant", text: "A quieter first paragraph." },
  ];
}

/** The document's blocks in order, a picture as "picture". */
const blocks = (page: Page) =>
  page
    .locator(`${editor} > *`)
    .evaluateAll((els) =>
      els
        .map((el) =>
          el.querySelector("img") ? "picture" : (el.textContent ?? "").trim(),
        )
        .filter(Boolean),
    );

async function pictureThenRewrite(page: Page, rewritten: string) {
  await open(page);
  await mockInvoke(page, {
    ai_agent_message: exchange(
      made,
      "Image proposed - the user now sees the picture.",
    ),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    save_pasted_image: { src: "assets/harbour.png" },
  });
  await send(page);
  await expect(page.locator(pending)).toHaveCount(1);
  await mockInvoke(page, {
    ai_agent_message: rewrite(rewritten),
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    save_pasted_image: { src: "assets/harbour.png" },
  });
  await send(page, "Rewrite the first paragraph");
  await expect(
    page.locator(`${editor} .pending-insert`, { hasText: "lay still" }),
  ).toBeVisible();
}

test("a picture not accepted yet stays after its paragraph when the rewrite leaves it out", async ({
  page,
}) => {
  await pictureThenRewrite(page, "The harbour lay still before dawn.");
  // The rewrite first, from its own card; the picture's stays.
  const card = (text: string) =>
    page
      .locator(".agent-proposal", { hasText: text })
      .locator(".agent-proposal-actions .inline-chat-action-primary");
  await card("Replace").click();
  await expect(page.locator(pending)).toHaveCount(1);
  await card("Picture").click();
  await expect(page.locator(written)).toHaveCount(1, { timeout: 10_000 });
  expect(await blocks(page)).toEqual([
    "The harbour lay still before dawn.",
    "picture",
    "The second paragraph.",
  ]);
});

test("a rewrite that carries the picture not accepted yet takes it in: one proposal", async ({
  page,
}) => {
  await pictureThenRewrite(
    page,
    "The harbour lay still before dawn.\n\n![A quiet harbour](textus-generated:abc123)",
  );
  // The picture's own proposal gave way to the text that carries it.
  await expect(page.locator(pending)).toHaveCount(1);
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(written)).toHaveCount(1, { timeout: 10_000 });
  expect(await blocks(page)).toEqual([
    "The harbour lay still before dawn.",
    "picture",
    "The second paragraph.",
  ]);
});
