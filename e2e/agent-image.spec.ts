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
