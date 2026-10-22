import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown, SAMPLE_DOC } from "./helpers";

test("first run asks for a language", async ({ page }) => {
  await openApp(page, { settings: { languageChosen: false } });
  await expect(page.locator(".language-welcome")).toBeVisible();
  await expect(page).toHaveScreenshot("first-run-language.png");
});

test("the tutorial's sidebar lesson highlights the sidebar's outline", async ({
  page,
}) => {
  await openApp(page, {
    storage: {
      "textus-tutorial-progress": JSON.stringify({
        active: true,
        stepId: "sidebar-export",
        tabId: null,
      }),
    },
  });
  await page.keyboard.press("Control+\\");
  await expect(page.locator(".sidebar.tutorial-spotlight")).toBeVisible();
  // The notes' outline completes the lesson.
  await page.getByRole("button", { name: "大纲" }).click();
  await expect(page.locator(".tutorial-card .tutorial-task-line")).toHaveClass(
    /is-complete/,
  );
  await expect(page).toHaveScreenshot("tutorial-sidebar-lesson.png");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`document content renders (${colorScheme})`, async ({ page }) => {
    await openApp(page, { colorScheme });
    await pasteMarkdown(page, SAMPLE_DOC);
    // Table headers never wrap one character per line (#15).
    const header = page.locator(".milkdown th").first();
    const box = await header.boundingBox();
    expect(box!.height).toBeLessThan(60);
    await expect(page).toHaveScreenshot(`document-${colorScheme}.png`);
  });
}

test("split view shows source and preview", async ({ page }) => {
  await openApp(page);
  await pasteMarkdown(page, SAMPLE_DOC);
  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator(".split-view")).toBeVisible();
  await expect(page.locator(".split-preview h1")).toHaveText(
    "老城区更新的几点思考",
  );
  await expect(page).toHaveScreenshot("split-view.png");
  // And back to the editor.
  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator(".split-view")).toHaveCount(0);
});

test("zen mode hides the chrome and dims all but the current block", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, SAMPLE_DOC);
  await page.locator(".milkdown h2").first().click();
  await page.keyboard.press("Control+Shift+J");
  await expect(page.locator("html")).toHaveClass(/zen/);
  await expect(page.locator(".zen-current")).toHaveCount(1);
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page).toHaveScreenshot("zen-mode.png");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveClass(/zen/);
});

test("the AI panel opens with its project bar and empty state", async ({
  page,
}) => {
  await openApp(page);
  await page.locator(".window-bar-toggle").click();
  await expect(page.locator(".agent-panel-view")).toBeVisible();
  await expect(page.locator(".agent-panel-empty")).toBeVisible();
  await expect(page).toHaveScreenshot("agent-panel-empty.png");
});

test("an agent reply shows a reasoned edit, a sentence picker and a comment", async ({
  page,
}) => {
  // Wide enough for the margin, where the sentences and the note go.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(page, SAMPLE_DOC);
  const anchor =
    "这项研究在三个街区进行。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。一共访谈了四十六位居民，内容涵盖了很多方面。";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "把第二段改得更简洁" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor,
          // First and last sentences change, the middle one stays: two
          // separate changes for the per-sentence picker.
          text: "这项研究覆盖三个街区。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。共访谈四十六位居民。",
          reason: "删去重复和冗余的修饰，保留时间和人数。",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "add_comment",
        arguments: JSON.stringify({
          anchor: "城市更新不只是拆旧建新。",
          comment: "开头是常见的判断句，可以直接从研究问题切入。",
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Comment added" },
      { kind: "Assistant", text: "已精简第二段，并在开头留了一条批注。" },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("把第二段改得更简洁");
  await composer.press("Enter");
  await expect(page.locator(".agent-proposal-reason")).toHaveText(
    "删去重复和冗余的修饰，保留时间和人数。",
  );
  await expect(page.locator(".agent-comment")).toBeVisible();
  // The edit previews sentence by sentence: each changed sentence marked in
  // the text, its replacement and ✓ / ✕ in the margin - and the card lists
  // the same two. The comment sits in the margin too.
  await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(2);
  await expect(page.locator(".revision-note")).toHaveCount(2);
  await expect(page.locator(".review-note:not(.revision-note)")).toHaveCount(1);
  await expect(page.locator(".agent-proposal-sentences li")).toHaveCount(2);
  await expect(page).toHaveScreenshot("agent-reply.png");
  // Keep the second sentence as written, from the text itself: the card and
  // the review bar both now take one of the two.
  await page.locator(".revision-note .pending-pick-keep").nth(1).click();
  await expect(
    page.locator(".agent-proposal-sentences li").nth(1),
  ).toHaveAttribute("data-state", "kept");
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await expect(accept).toHaveText("采纳 1/2 处");
  await expect(page.locator(".review-bar-accept")).toHaveText("采纳 1/2 处");
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(".milkdown")).toContainText(
    "这项研究覆盖三个街区。我们花了整整两个月的时间",
  );
  await expect(page.locator(".milkdown")).toContainText(
    "一共访谈了四十六位居民，内容涵盖了很多方面。",
  );
  await expect(page.locator(".review-bar")).toHaveCount(0);
});

test("the last sentence decided in the text applies the edit", async ({
  page,
}) => {
  // No room for a margin: the replacements and their ✓ / ✕ are in the text.
  await page.setViewportSize({ width: 900, height: 780 });
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(page, SAMPLE_DOC);
  const anchor =
    "这项研究在三个街区进行。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。一共访谈了四十六位居民，内容涵盖了很多方面。";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "精简" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor,
          text: "这项研究覆盖三个街区。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。共访谈四十六位居民。",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("精简");
  await composer.press("Enter");
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(2);
  await page.locator(".milkdown .pending-pick-take").first().click();
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(2);
  await page.locator(".milkdown .pending-pick-take").nth(1).click();
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(0);
  await expect(page.locator(".milkdown")).toContainText(
    "这项研究覆盖三个街区。",
  );
  await expect(page.locator(".milkdown")).toContainText("共访谈四十六位居民。");
  await expect(page.locator(".agent-proposal-status-accepted")).toBeVisible();

  // Undo puts the proposal back on offer, redo applies it again.
  await page.locator(".milkdown .ProseMirror").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(2);
  await expect(page.locator(".agent-proposal-status-accepted")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(0);
  await expect(page.locator(".agent-proposal-status-accepted")).toBeVisible();
});

test("an accepted new table row and nested item land inside the table and list", async ({
  page,
}) => {
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(
    page,
    "| Component | Owner |\n| --- | --- |\n| Search | Tom |\n\n- Transport\n  - WebSocket\n\nThe end.",
  );
  // What the model sends for "add a row" / "add a sub-item": insert_after
  // the last row / item line, quoted from the serialized markdown (which
  // pads a table's cells and writes bullets as `*`). These used to land after a blank line - the
  // row as a stray paragraph of pipes, the item un-nested.
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Add a row and a sub-item" },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "insert_after",
          anchor: "| Search    | Tom   |",
          text: "| Export | Li |",
        }),
      },
      { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "r2",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "insert_after",
          anchor: "  * WebSocket",
          text: "  * Long polling",
        }),
      },
      { kind: "ToolResult", call_id: "r2", output: "Edit proposed" },
      { kind: "Assistant", text: "Added both." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Add a row and a sub-item");
  await composer.press("Enter");
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await expect(accept).toHaveCount(2);
  // Top-down: the table grows by a row, and the list's preview below it
  // must follow - it used to keep its old position, drift off the list and
  // refuse its Accept.
  await accept.first().click();
  await expect(accept).toHaveCount(1);
  await accept.first().click();
  await expect(accept).toHaveCount(0);
  await expect(page.locator(".milkdown table tr")).toHaveCount(3);
  await expect(page.locator(".milkdown table")).toContainText("Export");
  await expect(page.locator(".milkdown li li")).toHaveCount(2);
  await expect(page.locator(".milkdown li li").nth(1)).toHaveText(
    "Long polling",
  );
  await expect(page.locator(".milkdown p", { hasText: "|" })).toHaveCount(0);
});

test("a pending replace keeps its strike on its text while the user types above it", async ({
  page,
}) => {
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(page, "Alpha one.\n\nBravo two words here.");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Use a digit" },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "two words",
          text: "2 words",
        }),
      },
      { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Use a digit");
  await composer.press("Enter");
  // Its block's sentence, changed whole: one edit per block.
  const strike = page.locator(".pending-delete");
  await expect(strike).toHaveText("Bravo two words here.");
  await page.locator(".milkdown p", { hasText: "Alpha" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("XYZ");
  // The strike range is mapped with the preview, not left three characters
  // behind.
  await expect(strike).toHaveText("Bravo two words here.");
  await page
    .locator(".agent-proposal-actions .inline-chat-action-primary")
    .click();
  await expect(page.locator(".milkdown")).toContainText("Bravo 2 words here.");
});

test("Quick Ask opens on a selection in Revise mode", async ({ page }) => {
  await openApp(page);
  await pasteMarkdown(page, SAMPLE_DOC);
  await page.locator(".milkdown p").nth(1).click({ clickCount: 3 });
  await page.keyboard.press("Control+Shift+K");
  await expect(page.locator(".inline-chat")).toBeVisible();
  await expect(page.locator(".inline-chat .inline-chat-mode")).toHaveText(
    "修订",
  );
  await expect(page).toHaveScreenshot("quick-ask.png");
});

test("settings show the typewriter toggle", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.getByRole("button", { name: "编辑与外观" }).click();
  await expect(page.getByText("打字机模式").first()).toBeVisible();
  await expect(page).toHaveScreenshot("settings-editor.png");
});

test("Ctrl+Right takes one word of a continuation and keeps the rest", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "The plan");
  await page.locator(".milkdown p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" works");
  const ghost = page.locator(".ghost-text");
  await expect(ghost).toHaveAttribute(
    "data-suggestion",
    " and this ghost text is a canned dev-shim suggestion.",
  );
  await page.keyboard.press("Control+ArrowRight");
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The plan works and",
  );
  await expect(ghost).toHaveAttribute(
    "data-suggestion",
    " this ghost text is a canned dev-shim suggestion.",
  );
  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
});

test("Quick Ask stays under its paragraph when an edit arrives", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, SAMPLE_DOC);
  const anchor =
    "这项研究在三个街区进行。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。一共访谈了四十六位居民，内容涵盖了很多方面。";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "精简" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor,
          text: "这项研究覆盖三个街区。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。共访谈四十六位居民。",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      { kind: "Assistant", text: "已精简。" },
    ],
  });
  const paragraph = page.locator(".milkdown p").nth(1);
  await paragraph.click({ clickCount: 3 });
  await page.keyboard.press("Control+Shift+K");
  await expect(page.locator(".inline-chat-input")).toBeFocused();
  await page.keyboard.type("精简");
  await page.keyboard.press("Enter");
  await expect(page.locator(".milkdown .pending-delete").first()).toBeVisible();
  // Right after the edited paragraph - it used to jump to the document's
  // end, out of sight, leaving the edit with no visible controls.
  const quoteTop = (await page.locator(".milkdown blockquote").boundingBox())!
    .y;
  const chatTop = (await page.locator(".inline-chat").boundingBox())!.y;
  expect(chatTop).toBeLessThan(quoteTop);
});

test("Quick Ask has its own conversation and hands it to the panel", async ({
  page,
}) => {
  // The panel is open: Quick Ask still opens at the caret.
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(page, SAMPLE_DOC);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "这段的主旨是什么？" },
      { kind: "Assistant", text: "主旨是调研的范围和规模。" },
    ],
  });
  await page.locator(".milkdown p").nth(1).click();
  await page.keyboard.press("Control+Shift+K");
  const quickInput = page.locator(".inline-chat .inline-chat-input");
  await expect(quickInput).toBeFocused();
  await page.keyboard.type("这段的主旨是什么？");
  await page.keyboard.press("Enter");
  // A plain answer may show as its summary line or opened out in full.
  await expect(page.locator(".inline-chat")).toContainText(
    "主旨是调研的范围和规模。",
  );
  // The panel's conversation is untouched.
  await expect(page.locator(".agent-panel-empty")).toBeVisible();

  // "Continue in the full conversation" moves the exchange over.
  await page.getByRole("button", { name: "转到大对话" }).click();
  await expect(page.locator(".inline-chat")).toHaveCount(0);
  await expect(page.locator(".agent-panel-view")).toContainText(
    "主旨是调研的范围和规模。",
  );
});

test("selects open the app's own list; notices are the app's own dialog", async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.getByRole("button", { name: "编辑与外观" }).click();
  await page.getByRole("combobox", { name: "编辑器主题" }).click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  await expect(page).toHaveScreenshot("select-open.png");
  // Escape closes the list and leaves Settings open.
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑与外观" })).toBeVisible();
});

test("a help guide opens once, however many times it is asked for at once", async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() => {
    const emit = (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent;
    for (let i = 0; i < 4; i++) emit("menu-open-help", "markdown");
  });
  await expect(
    page.locator(".tab-pill", { hasText: "Markdown 指南" }),
  ).toHaveCount(1);
});

test("an open guide switches language with the UI", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-help", "markdown"),
  );
  await expect(page.locator(".milkdown h1").first()).toContainText("Markdown");
  const zhTitle = await page.locator(".milkdown h1").first().innerText();
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.getByRole("combobox", { name: "语言", exact: true }).click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.locator(".milkdown h1").first()).not.toHaveText(zhTitle);
  await expect(page.locator(".milkdown h1").first()).toContainText("Guide");
});

test("the empty-document hint follows the language picked at first run", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", languageChosen: false, onboardingShown: true },
  });
  const hint = page.locator('[data-active-tab="true"] .empty-doc-placeholder');
  await expect(hint).toHaveAttribute(
    "data-placeholder",
    "Start writing in Markdown…",
  );
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文" }).click();
  await page.locator(".language-welcome-continue").click();
  await expect(hint).toHaveAttribute("data-placeholder", "开始输入 Markdown…");
});

test("backspace at the start of a quoted line takes it out of the quote", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "> quoted words");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("blockquote p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Backspace");
  // The text is gone; the empty quote must not be stuck there.
  await page.keyboard.press("Backspace");
  await expect(editor.locator("blockquote")).toHaveCount(0);
});

test("the phone toolbar's block buttons toggle: H steps through levels, lists and quotes come off again", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "plain words");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("p", { hasText: "plain words" }).click();
  const toggle = (kind: string) =>
    page.evaluate(
      (detail) =>
        window.dispatchEvent(
          new CustomEvent("textus:toggle-block", { detail }),
        ),
      kind,
    );
  for (const tag of ["h1", "h2", "h3"]) {
    await toggle("heading");
    await expect(editor.locator(tag, { hasText: "plain words" })).toHaveCount(
      1,
    );
  }
  await toggle("heading");
  await expect(editor.locator("p", { hasText: "plain words" })).toHaveCount(1);

  await toggle("bullet-list");
  await expect(editor.locator("ul li")).toHaveCount(1);
  await toggle("ordered-list"); // switches the list over
  await expect(editor.locator("ol li")).toHaveCount(1);
  await expect(editor.locator("ul")).toHaveCount(0);
  await toggle("ordered-list"); // and off again
  await expect(editor.locator("ol, ul")).toHaveCount(0);

  await toggle("blockquote");
  await expect(editor.locator("blockquote")).toHaveCount(1);
  await toggle("blockquote");
  await expect(editor.locator("blockquote")).toHaveCount(0);
});

test("menu events: New File opens one tab after edits, Zen and Split View respond", async ({
  page,
}) => {
  await openApp(page);
  const emit = (name: string) =>
    page.evaluate(
      (event) =>
        (
          window as unknown as {
            __devEmitTauriEvent: (name: string, payload?: unknown) => void;
          }
        ).__devEmitTauriEvent(event),
      name,
    );
  const tabs = page.locator("[data-active-tab]");
  const before = await tabs.count();
  // Edits re-render App with new handlers - the bridge used to resubscribe
  // on each, and one menu click then ran several times.
  await pasteMarkdown(page, "some words");
  await page.keyboard.type(" and more");
  await emit("menu-new-file");
  await expect(tabs).toHaveCount(before + 1);

  await emit("menu-toggle-zen-mode");
  await expect(page.locator(".zen-hint")).toBeVisible();
  await emit("menu-toggle-zen-mode");
  await expect(page.locator(".zen-hint")).toHaveCount(0);

  await emit("menu-toggle-split-view");
  await expect(page.locator(".split-view")).toBeVisible();
});

test("Enter turns a pipe row into a table, adds rows at the end and leaves from an empty one", async ({
  page,
}) => {
  await openApp(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.type("|a|b|c|");
  await page.keyboard.press("Enter");
  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator("th")).toHaveText(["a", "b", "c"]);

  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  await expect(editor.locator("tr")).toHaveCount(3);
  await page.keyboard.type("2");
  await expect(editor.locator("tr").nth(2).locator("td").first()).toHaveText(
    "2",
  );

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editor.locator("tr")).toHaveCount(3);
  await page.keyboard.type("after");
  await expect(editor.locator(":scope > p").last()).toHaveText("after");
});

test("Enter on a code block's empty last line leaves it; Ctrl+Enter leaves a quote", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "```\nlet x;\n```\n\nbelow\n\n> one\n>\n> two");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');

  await editor.locator("pre code").click();
  // Let ProseMirror read the click's caret back before keys arrive.
  await page.waitForTimeout(100);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("out");
  await expect(editor.locator("pre code")).toHaveText("let x;");
  await expect(editor.locator(":scope > p").first()).toHaveText("out");

  await editor.locator("blockquote p").first().click();
  await page.waitForTimeout(100);
  await page.keyboard.press("Control+Enter");
  await page.keyboard.type("free");
  await expect(editor.locator("blockquote p")).toHaveCount(2);
  await expect(editor.locator(":scope > p").last()).toHaveText("free");
});

test("Select Row from the right-click menu highlights the clicked row", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("td", { hasText: "a" }).click();
  await editor.locator("td", { hasText: "d" }).click({ button: "right" });
  await page.locator(".context-menu-item", { hasText: "选中整行" }).click();
  await expect(editor.locator("td.selectedCell")).toHaveText(["c", "d"]);
  const tint = await editor
    .locator("td.selectedCell")
    .first()
    .evaluate((el) => getComputedStyle(el, "::after").backgroundColor);
  expect(tint).not.toBe("rgba(0, 0, 0, 0)");
});

test("a right-click on a paragraph while editing a table shows the paragraph's menu", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "| h1 | h2 |\n|---|---|\n| a | b |\n\nbelow");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("td", { hasText: "a" }).click();
  await editor.locator(":scope > p", { hasText: "below" }).click({
    button: "right",
  });
  await expect(page.locator(".context-menu-item").first()).toBeVisible();
  await expect(
    page.locator(".context-menu-item", { hasText: "选中整行" }),
  ).toHaveCount(0);
});

test("a one-character CJK fix reads with its neighbour on the grammar card", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "黛玉必竟寄人篱下，所以步步留心。");
  await page.waitForTimeout(300);
  await mockInvoke(page, {
    ai_grammar_check: [
      {
        start: 2,
        end: 3,
        issue: "“必竟”应为“毕竟”。",
        suggestion: "毕",
        original: "必",
      },
    ],
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("textus:trigger-grammar-check")),
  );
  await page.locator(".milkdown .grammar-issue").hover();
  const card = page.locator(".grammar-popover");
  await expect(card.locator(".grammar-popover-fix")).toHaveText("必竟 → 毕竟");
  await expect(card.locator(".grammar-popover-apply")).toContainText(
    "改为“毕竟”",
  );
  await card.locator(".grammar-popover-apply").click();
  await expect(page.locator(".milkdown")).toContainText("黛玉毕竟寄人篱下");
});

test("the review bar switches how revisions show, as Word's markup views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await pasteMarkdown(page, SAMPLE_DOC);
  const anchor =
    "这项研究在三个街区进行。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。一共访谈了四十六位居民，内容涵盖了很多方面。";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "精简" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor,
          text: "这项研究覆盖三个街区。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。共访谈四十六位居民。",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("精简");
  await composer.press("Enter");
  // Default: the original in the text, the replacements in the margin.
  await expect(page.locator(".revision-note")).toHaveCount(2);
  const pick = async (name: string) => {
    await page.locator(".review-bar-view-button").click();
    await page.getByRole("menuitemradio", { name }).click();
  };
  // Changes in the text, the original in the margin.
  await pick("修改在正文，原文在页边");
  await expect(page.locator(".revision-note-original")).toHaveCount(2);
  // The originals stay in the document, out of the flow.
  await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(2);
  await expect(page.locator(".milkdown .pending-sentence:visible")).toHaveCount(
    0,
  );
  await expect(page.locator(".milkdown")).toContainText(
    "这项研究覆盖三个街区。",
  );
  // Everything in the text.
  await pick("全部在正文中");
  await expect(page.locator(".revision-note")).toHaveCount(0);
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(2);
  // Only the result: no marks, no margin cards; still decided from the bar.
  await pick("只看修改后的结果");
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(0);
  await expect(page.locator(".milkdown .ProseMirror")).toHaveAttribute(
    "data-revision-display",
    "final",
  );
  await expect(
    page.locator(".milkdown .pending-sentence-new:visible"),
  ).toHaveCount(2);
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(".milkdown")).toContainText("共访谈四十六位居民。");
  await expect(page.locator(".milkdown .pending-sentence-new")).toHaveCount(0);
});
