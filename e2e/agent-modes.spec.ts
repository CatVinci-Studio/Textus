import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * The AI panel's three modes - Write adds, Review reads, Revise changes -
 * and the selection the composer's chip refers to staying highlighted in
 * the document while the composer has the focus. What each mode may
 * propose is enforced in Rust (tools.rs); here the AI is mocked, so these
 * check what the app sends and how it shows what comes back.
 */

const composer = (page: Page) => page.locator(".agent-panel-view textarea");

async function openPanel(page: Page, language = "en") {
  await openApp(page, {
    settings: { language },
    storage: { "levis-agent-panel-open": "1" },
  });
}

async function pickMode(page: Page, name: string) {
  await page
    .locator(".agent-panel-view")
    .getByRole("combobox", { name: "Mode" })
    .click();
  await page.getByRole("option", { name }).click();
}

async function send(page: Page, message: string) {
  await composer(page).fill(message);
  await composer(page).press("Enter");
}

/** The ai_agent_message requests made so far. */
async function agentCalls(page: Page) {
  type Call = { cmd: string; mode: string; message: string };
  return page.evaluate(() =>
    (
      (window as unknown as { __devInvokeCalls?: Call[] }).__devInvokeCalls ??
      []
    ).filter((c) => c.cmd === "ai_agent_message"),
  );
}

/** The document's own text: the pending previews are drawn in it, but
 *  aren't part of it until accepted. */
async function documentText(page: Page) {
  return page.evaluate(() => {
    const root = document
      .querySelector('[data-active-tab="true"] .ProseMirror')!
      .cloneNode(true) as HTMLElement;
    root.querySelectorAll(".pending-insert").forEach((el) => el.remove());
    return root.textContent ?? "";
  });
}

function proposal(args: object) {
  return [
    { kind: "User", text: "go" },
    {
      kind: "ToolCall",
      call_id: "p1",
      name: "propose_edit",
      arguments: JSON.stringify(args),
    },
    { kind: "ToolResult", call_id: "p1", output: "Edit proposed" },
    { kind: "Assistant", text: "Proposed it." },
  ];
}

const accept = (page: Page) =>
  page.locator(".agent-proposal-actions .inline-chat-action-primary").click();

test("the composer offers Write, Review and Revise, in that order", async ({
  page,
}) => {
  await openPanel(page);
  const picker = page
    .locator(".agent-panel-view")
    .getByRole("combobox", { name: "Mode" });
  // Review is the panel's default.
  await expect(picker).toHaveText("Review");
  await picker.click();
  await expect(page.getByRole("option")).toHaveText([
    "Write",
    "Review",
    "Revise",
  ]);
});

test("Quick Ask offers Revise and Review only, on Revise, even after Write was picked in the panel", async ({
  page,
}) => {
  await openPanel(page, "zh");
  // The panel's last pick carries over to its next conversation - not into
  // Quick Ask, which has no Write.
  const panelPicker = page
    .locator(".agent-panel-view")
    .getByRole("combobox", { name: "模式" });
  await panelPicker.click();
  await page.getByRole("option", { name: "写作" }).click();
  await pasteMarkdown(page, "A short note to ask about.");
  await page.locator(".milkdown p").first().click({ clickCount: 3 });
  await page.keyboard.press("Control+Shift+K");
  const picker = page
    .locator(".inline-chat")
    .getByRole("combobox", { name: "模式" });
  await expect(picker).toHaveText("修订");
  await picker.click();
  await expect(page.getByRole("option")).toHaveText(["修订", "审阅"]);
  expect(
    await page
      .getByRole("option")
      .locator(".chat-mode-icon")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-mode"))),
  ).toEqual(["revise", "review"]);
});

/** Each mode: its name in the picker, and what the empty panel says. */
const MODE_LINES: Record<
  "en" | "zh",
  { mode: string; name: string; line: string }[]
> = {
  en: [
    {
      mode: "write",
      name: "Write",
      line: "The AI drafts new text into your document and doesn't change what's already there.",
    },
    {
      mode: "review",
      name: "Review",
      line: "The AI answers and leaves notes in the margin, and doesn't change your text.",
    },
    {
      mode: "revise",
      name: "Revise",
      line: "The AI suggests changes to your text; each one waits for you to accept or reject it.",
    },
  ],
  zh: [
    {
      mode: "write",
      name: "写作",
      line: "AI 帮你起草新的文字加进文档，不改动已有的内容。",
    },
    {
      mode: "review",
      name: "审阅",
      line: "AI 只回答问题、在页边留批注，不会改动你的文字。",
    },
    {
      mode: "revise",
      name: "修订",
      line: "AI 会提出修改建议，每一处都由你决定接受还是拒绝。",
    },
  ],
};

for (const language of ["en", "zh"] as const)
  test(`${language}: the mode's icon is on the picker and its options, and the empty panel says what the mode does`, async ({
    page,
  }) => {
    await openPanel(page, language);
    const modes = MODE_LINES[language];
    const picker = page
      .locator(".agent-panel-view")
      .getByRole("combobox", { name: language === "zh" ? "模式" : "Mode" });
    const mark = page.locator(".agent-panel-empty-mark .chat-mode-icon");
    const hint = page.locator(".agent-panel-empty-text");
    // Review is the default.
    await expect(picker.locator(".chat-mode-icon")).toHaveAttribute(
      "data-mode",
      "review",
    );
    await expect(mark).toHaveAttribute("data-mode", "review");
    await expect(hint).toHaveText(modes[1].line);
    for (const { mode, name, line } of modes) {
      await picker.click();
      expect(
        await page
          .getByRole("option")
          .locator(".chat-mode-icon")
          .evaluateAll((els) => els.map((el) => el.getAttribute("data-mode"))),
      ).toEqual(modes.map((m) => m.mode));
      await page.getByRole("option", { name }).click();
      await expect(picker.locator(".chat-mode-icon")).toHaveAttribute(
        "data-mode",
        mode,
      );
      await expect(mark).toHaveAttribute("data-mode", mode);
      await expect(hint).toHaveText(line);
    }
  });

test("the modes in Chinese: 写作, 审阅, 修订", async ({ page }) => {
  await openPanel(page, "zh");
  const picker = page
    .locator(".agent-panel-view")
    .getByRole("combobox", { name: "模式" });
  await expect(picker).toHaveText("审阅");
  await picker.click();
  await expect(page.getByRole("option")).toHaveText(["写作", "审阅", "修订"]);
});

test("Write in an empty document proposes a green block that waits for Accept", async ({
  page,
}) => {
  await openPanel(page);
  await mockInvoke(page, {
    ai_agent_message: proposal({
      action: "append",
      text: "The lighthouse keeper woke before dawn.",
    }),
  });
  await pickMode(page, "Write");
  await send(page, "Start a story about a lighthouse");

  const insert = page.locator(".milkdown .pending-insert");
  await expect(insert).toContainText("The lighthouse keeper woke before dawn.");
  expect((await agentCalls(page)).at(-1)?.mode).toBe("write");
  // Shown, not written: the document is still empty.
  expect((await documentText(page)).trim()).toBe("");

  await accept(page);
  await expect(insert).toHaveCount(0);
  expect(await documentText(page)).toContain(
    "The lighthouse keeper woke before dawn.",
  );
});

test("Write with a selection adds after it and leaves it as it is", async ({
  page,
}) => {
  await openPanel(page);
  await pasteMarkdown(page, "The first paragraph.\n\nThe second paragraph.");
  await page.locator(".milkdown p").first().click({ clickCount: 3 });
  await mockInvoke(page, {
    ai_agent_message: proposal({
      action: "insert_after",
      anchor: "The first paragraph.",
      text: "A new paragraph in between.",
    }),
  });
  await pickMode(page, "Write");
  await send(page, "Continue from here");

  const sent = (await agentCalls(page)).at(-1);
  expect(sent?.mode).toBe("write");
  expect(sent?.message).toContain(
    "<selected-text>\nThe first paragraph.\n</selected-text>",
  );
  await expect(page.locator(".milkdown .pending-delete")).toHaveCount(0);
  await accept(page);
  await expect(page.locator(".milkdown p")).toHaveText([
    "The first paragraph.",
    "A new paragraph in between.",
    "The second paragraph.",
  ]);
});

test("Review answers without proposing anything", async ({ page }) => {
  await openPanel(page);
  await pasteMarkdown(page, "A short note.");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Is this clear?" },
      { kind: "Assistant", text: "Yes, it reads clearly." },
    ],
  });
  await send(page, "Is this clear?");
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Yes, it reads clearly.",
  );
  expect((await agentCalls(page)).at(-1)?.mode).toBe("review");
  await expect(page.locator(".milkdown .pending-insert")).toHaveCount(0);
  await expect(page.locator(".review-bar")).toHaveCount(0);
});

test("Revise still replaces text, after Accept", async ({ page }) => {
  await openPanel(page);
  await pasteMarkdown(page, "The meeting was very long and quite boring.");
  await mockInvoke(page, {
    ai_agent_message: proposal({
      action: "replace",
      anchor: "The meeting was very long and quite boring.",
      text: "The meeting dragged.",
    }),
  });
  await pickMode(page, "Revise");
  await send(page, "Tighten it");
  expect((await agentCalls(page)).at(-1)?.mode).toBe("revise");
  await expect(page.locator(".milkdown .pending-delete")).toBeVisible();
  await accept(page);
  await expect(page.locator(".milkdown p")).toHaveText("The meeting dragged.");
});

test.describe("the selection the chip refers to", () => {
  const layer = (page: Page) =>
    page.locator('[data-active-tab="true"] .chat-selection-layer');

  test("stays highlighted while the composer has the focus, until ✕", async ({
    page,
  }) => {
    await openPanel(page);
    await pasteMarkdown(page, "Alpha beta gamma.\n\nDelta epsilon.");
    await page.locator(".milkdown p").first().click({ clickCount: 3 });
    // While the editor has the focus its own selection shows.
    await expect(layer(page).locator(".chat-selection")).toHaveCount(0);

    await composer(page).click();
    const chip = page.locator(".agent-panel-view .inline-chat-selection-chip");
    await expect(chip).toContainText("17 chars selected");
    await expect(layer(page).locator(".chat-selection")).toHaveCount(1);
    const box = await layer(page).locator(".chat-selection").boundingBox();
    const text = await page.locator(".milkdown p").first().boundingBox();
    expect(box!.y).toBeLessThanOrEqual(text!.y + text!.height);
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(text!.y);

    // Pointing at the chip strengthens it.
    await chip.hover();
    await expect(layer(page)).toHaveClass(/is-hot/);
    await composer(page).hover();
    await expect(layer(page)).not.toHaveClass(/is-hot/);

    await chip
      .getByRole("button", { name: "Don't send the selection" })
      .click();
    await expect(chip).toHaveCount(0);
    await expect(layer(page).locator(".chat-selection")).toHaveCount(0);
  });

  test("is one continuous shape across paragraphs, and a send uses it up", async ({
    page,
  }) => {
    await openPanel(page);
    await pasteMarkdown(
      page,
      "First paragraph with **bold** and `code` in it, long enough to wrap onto a second line in the editor column at this width.\n\n- a list item\n\nLast paragraph.",
    );
    await page.locator(".milkdown p").first().click();
    await page.keyboard.press("Control+a");
    await composer(page).click();

    const boxes = await layer(page)
      .locator(".chat-selection")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        }),
      );
    expect(boxes.length).toBeGreaterThan(2);
    for (let i = 1; i < boxes.length; i++)
      expect(Math.abs(boxes[i].top - boxes[i - 1].bottom)).toBeLessThan(1);

    await mockInvoke(page, {
      ai_agent_message: [
        { kind: "User", text: "What is this?" },
        { kind: "Assistant", text: "Notes." },
      ],
    });
    await send(page, "What is this?");
    await expect(
      page.locator(".agent-panel-view .inline-chat-selection-chip"),
    ).toHaveCount(0);
    await expect(layer(page).locator(".chat-selection")).toHaveCount(0);
  });
});
