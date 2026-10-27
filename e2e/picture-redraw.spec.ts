import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// A proposed picture drawn again from the writer's own change to its
// description: Redraw… over the picture, the description to change, and
// the picture alone is asked for again.

const editor = '[data-active-tab="true"] .ProseMirror';
const pending = `${editor} .pending-insert img`;

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const FIRST = "The harbour was quiet before the boats came in.";
const PROMPT = "A quiet harbour at dusk";

const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (cmd) =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((c) => c.cmd === cmd),
    cmd,
  );

async function propose(page: Page) {
  await openApp(page, {
    settings: { language: "en", imageModelProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `${FIRST}\n\nThe second paragraph.`);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Illustrate it" },
      {
        kind: "ToolCall",
        call_id: "g1",
        name: "generate_image",
        arguments: JSON.stringify({
          prompt: PROMPT,
          alt: "A quiet harbour",
          action: "insert_after",
          anchor: FIRST,
          image: { id: "abc123", width: 1, height: 1 },
        }),
      },
      {
        kind: "ToolResult",
        call_id: "g1",
        output: "Image proposed - the user now sees the picture.",
      },
      { kind: "Assistant", text: "A harbour at dusk." },
    ],
    ai_generated_image: { mime: "image/png", ext: "png", dataBase64: PNG },
    ai_generated_image_prompt: PROMPT,
    ai_redraw_generated_image: null,
    ai_discard_generated_image: null,
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Illustrate the first paragraph");
  await composer.press("Enter");
  await expect(page.locator(pending)).toHaveAttribute("src", /^blob:/, {
    timeout: 10_000,
  });
}

test("a proposed picture is drawn again from the description the writer changed", async ({
  page,
}) => {
  await propose(page);
  const before = await page.locator(pending).getAttribute("src");
  // The new picture takes a moment: its frame paints meanwhile.
  await page.evaluate((png) => {
    (
      window as unknown as { __devInvokeResults: Record<string, unknown> }
    ).__devInvokeResults.ai_generated_image = {
      __delay: 400,
      value: { mime: "image/png", ext: "png", dataBase64: png },
    };
  }, PNG);
  await page.locator(pending).hover();
  await page.getByRole("button", { name: "Redraw…" }).click();
  const field = page.getByRole("dialog").getByRole("textbox");
  await expect(field).toHaveValue(PROMPT);
  await field.fill("A quiet harbour at dawn, one red boat");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Redraw" })
    .click();

  await expect(page.locator(`${editor} .pending-picture`)).toHaveCount(1);
  await expect(page.locator(pending)).toHaveAttribute("src", /^blob:/);
  expect(await page.locator(pending).getAttribute("src")).not.toBe(before);
  const redrawn = await calls(page, "ai_redraw_generated_image");
  expect(redrawn).toHaveLength(1);
  expect(JSON.stringify(redrawn[0])).toContain("one red boat");
  // The chat's card shows the new one too.
  await expect(page.locator(".agent-proposal-picture")).toHaveAttribute(
    "src",
    /^blob:/,
  );
});

test("a description left as it was draws nothing again", async ({ page }) => {
  await propose(page);
  await page.locator(pending).hover();
  await page.getByRole("button", { name: "Redraw…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Redraw" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await calls(page, "ai_redraw_generated_image")).toHaveLength(0);
  await expect(page.locator(pending)).toHaveAttribute("src", /^blob:/);
});
