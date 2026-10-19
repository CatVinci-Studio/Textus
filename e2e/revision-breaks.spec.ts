import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// A proposal's tint is on its text, not on the line breaks in it: the hard
// breaks the AI writes (`\`, two trailing spaces, `<br>`) and the blank
// line between two paragraphs used to get a stub of green at every line end
// and on the empty line, more so under the darker hover tint, and a strike
// after a hard break ended a character late.

const DOC = "First line here.\\\nSecond line here.\n\nAnother paragraph.";

async function propose(page: Page, args: object[]) {
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      ...args.flatMap((a, i) => [
        {
          kind: "ToolCall",
          call_id: `b${i}`,
          name: "propose_edit",
          arguments: JSON.stringify(a),
        },
        { kind: "ToolResult", call_id: `b${i}`, output: "Edit proposed" },
      ]),
      { kind: "Assistant", text: "Done." },
    ],
  });
  await page
    .locator(".agent-panel-view")
    .getByRole("combobox", { name: "Mode" })
    .click();
  await page.getByRole("option", { name: "Revise" }).click();
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("go");
  await composer.press("Enter");
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "inline" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, DOC);
}

const transparent = "rgba(0, 0, 0, 0)";

test("new text over several lines is tinted line by line, its breaks not at all", async ({
  page,
}) => {
  await open(page);
  await propose(page, [
    {
      action: "append",
      text: "New one.\\\nNew two.  \nNew three.<br>New four.\n\nNew paragraph.",
    },
  ]);
  const insert = page.locator(".milkdown .pending-insert");
  await expect(insert).toHaveCount(1);
  await expect(insert.locator(".pending-line")).toHaveText([
    "New one.",
    "New two.",
    "New three.",
    "New four.",
    "New paragraph.",
  ]);
  // Breaks stand between the lines, outside every tinted box.
  await expect(insert.locator(".pending-line br")).toHaveCount(0);
  await expect(insert.locator(":scope > br")).toHaveCount(5);
  const tints = await insert.evaluate((el) => ({
    outer: getComputedStyle(el).backgroundColor,
    line: getComputedStyle(el.querySelector(".pending-line")!).backgroundColor,
  }));
  expect(tints.outer).toBe(transparent);
  expect(tints.line).not.toBe(transparent);
  // Hovered, the lines darken - still only the lines.
  await insert.locator(".pending-line").first().hover();
  await expect(insert).toHaveClass(/pending-sentence-hot/);
  const hot = await insert.evaluate((el) => ({
    outer: getComputedStyle(el).backgroundColor,
    line: getComputedStyle(el.querySelector(".pending-line")!).backgroundColor,
  }));
  expect(hot.outer).toBe(transparent);
  expect(hot.line).not.toBe(tints.line);
});

test("a rewrite across a hard break is struck sentence by sentence, the break untouched", async ({
  page,
}) => {
  await open(page);
  await propose(page, [
    {
      action: "replace",
      anchor: "First line here.\\\nSecond line here.",
      text: "First line, rewritten.\\\nSecond line, rewritten.",
    },
  ]);
  const struck = page.locator(".milkdown .pending-sentence");
  await expect(struck).toHaveText(["First line here.", "Second line here."]);
  await expect(page.locator(".milkdown .pending-sentence-new")).toHaveText([
    "First line, rewritten.",
    "Second line, rewritten.",
  ]);
  // The new text shows no literal backslash, and no break is tinted.
  await expect(page.locator(".milkdown")).not.toContainText("\\");
  await struck.first().hover();
  await expect(
    page.locator(".milkdown .pending-sentence-hot").first(),
  ).toBeVisible();
  await expect(page.locator(".milkdown br.pending-sentence-hot")).toHaveCount(
    0,
  );
  await expect(page.locator(".milkdown br.pending-delete")).toHaveCount(0);
});

test("a strike after a hard break covers exactly the text it replaces", async ({
  page,
}) => {
  await open(page);
  await propose(page, [
    {
      action: "replace",
      anchor: "Second line here.",
      text: "Second line, shorter.",
    },
  ]);
  await expect(page.locator(".milkdown .pending-delete")).toHaveText([
    "Second line here.",
  ]);
});
