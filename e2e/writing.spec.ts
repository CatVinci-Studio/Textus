import { expect, test, type Page } from "@playwright/test";
import {
  PHONE,
  mockInvoke,
  openApp,
  openPhone,
  pasteMarkdown,
} from "./helpers";

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

/** The active document's Markdown, read from source mode (and back). */
async function sourceOf(page: Page): Promise<string> {
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit(page, "menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value;
}

test("typing a closing ** or ~~ by hand closes the span once, and text after *** goes into the bold-italic span", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("A **bold** and *it* end. ~~s~~ done", {
    delay: 30,
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("A ***both*** end", { delay: 30 });
  expect((await sourceOf(page)).trim()).toBe(
    "A **bold** and *it* end. ~~s~~ done\n\nA ***both*** end",
  );
});

test("** committed through an IME composition still makes bold (#134)", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  // Chromium's own IME path: each piece is a real composition (as Microsoft
  // Pinyin / Sogou send even a "*" in Chinese mode), committed by insertText.
  const cdp = await page.context().newCDPSession(page);
  const compose = async (preedit: string, committed: string) => {
    await cdp.send("Input.imeSetComposition", {
      text: preedit,
      selectionStart: preedit.length,
      selectionEnd: preedit.length,
    });
    await cdp.send("Input.insertText", { text: committed });
    // Past the post-commit check (40ms) before the next composition.
    await page.waitForTimeout(100);
  };
  await compose("*", "*");
  await compose("*", "*");
  await compose("jiacu", "加粗");
  await compose("*", "*");
  await compose("*", "*");
  await expect(editor.locator("strong")).toHaveText("加粗");
  await page.keyboard.type(" and ~~s~~", { delay: 30 });
  expect((await sourceOf(page)).trim()).toBe("**加粗** and ~~s~~");
});

test("deleting the text after bold or italic leaves the caret after the closing mark (#199)", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.type("前**3**位。", { delay: 30 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("前*3*位。", { delay: 30 });
  for (const [line, tag] of [
    [0, "strong"],
    [1, "em"],
  ] as const) {
    const paragraph = editor.locator("p").nth(line);
    // Caret after 位, then erase it: the caret is now right after the span.
    await paragraph.click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    // The caret must not sit inside the span before the revealed closing
    // mark, or typing goes bold.
    const caretInSpan = await page.evaluate(
      (t) => !!document.getSelection()?.anchorNode?.parentElement?.closest(t),
      tag,
    );
    expect(caretInSpan).toBe(false);
    await page.keyboard.type("x", { delay: 30 });
    await expect(paragraph.locator(tag)).toHaveText("3");
  }
  expect((await sourceOf(page)).trim()).toBe("前**3**x。\n\n前*3*x。");
});

test("with closing marks off, ** stays as typed and **x** still turns bold (#136)", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", autoCloseMarks: false } });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.type("**", { delay: 30 });
  await expect(editor.locator(".md-span")).toHaveCount(0);
  await expect(editor.locator("p").first()).toHaveText("**");
  await page.keyboard.type("x**", { delay: 30 });
  await expect(editor.locator("strong")).toHaveText("x");
  await page.keyboard.type(" and ~~s~~", { delay: 30 });
  expect((await sourceOf(page)).trim()).toBe("**x** and ~~s~~");
});

/** Paragraphs enough to scroll several screens. */
function longDoc(extra: { at: number; text: string }[] = []): string {
  const parts: string[] = [];
  for (let i = 0; i < 80; i++) {
    const hit = extra.find((e) => e.at === i);
    if (hit) parts.push(hit.text);
    parts.push(
      `Paragraph ${i}: the quick brown fox jumps over the lazy dog, and then it runs along the riverbank until the evening comes.`,
    );
  }
  return parts.join("\n\n");
}

test("split view: the wheel scrolls the source, and the preview doesn't pull it back", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, longDoc());
  await emit(page, "menu-toggle-split-view");
  const source = page.locator(".split-source");
  await expect(source).toBeVisible();
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(400);
  const scrolled = await source.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(1000);
  await page.waitForTimeout(800);
  expect(await source.evaluate((el) => el.scrollTop)).toBe(scrolled);
  const preview = await page
    .locator(".split-preview")
    .evaluate((el) => el.scrollTop);
  expect(preview).toBeGreaterThan(0);
});

test("find shows the match its counter names while typing", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    longDoc([{ at: 70, text: "A zebracorn appears here." }]),
  );
  await page.keyboard.press("ControlOrMeta+Home");
  await emit(page, "menu-find-replace");
  await page.locator(".find-replace-bar input").first().fill("zebracorn");
  const match = page.locator(".find-match-active");
  await expect(match).toHaveCount(1);
  await expect(match).toBeInViewport();
});

test("an outline jump lands the heading below the window bar", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    longDoc([{ at: 60, text: "## The `far` heading" }]),
  );
  await emit(page, "menu-toggle-sidebar");
  await page.locator(".sidebar-tab").nth(1).click();
  // Inline code shows as its text, not with backticks.
  const row = page.locator(".outline-row .tree-label", {
    hasText: "The far heading",
  });
  await row.click();
  const heading = page.locator(".milkdown h2", { hasText: "heading" });
  await expect(heading).toBeInViewport();
  await page.waitForTimeout(100);
  const top = (await heading.boundingBox())!.y;
  expect(top).toBeGreaterThanOrEqual(28);
  expect(top).toBeLessThan(120);
});

test("accepting one of two proposals keeps the other", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "The cat sat on the mat.\n\nThe dog ran far.");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Fix both" },
      {
        kind: "ToolCall",
        call_id: "a1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "cat sat",
          text: "cat slept",
        }),
      },
      { kind: "ToolResult", call_id: "a1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "a2",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "dog ran",
          text: "dog walked",
        }),
      },
      { kind: "ToolResult", call_id: "a2", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Fix both");
  await composer.press("Enter");
  // Two in a row are one card (ProposalGroup), a row each with its ✓.
  const accept = page.locator(".agent-proposal-group-rows .pending-pick-take");
  await expect(accept).toHaveCount(2);
  // The second first, then the first: both land.
  await accept.nth(1).click();
  await expect(accept).toHaveCount(1);
  await accept.first().click();
  await expect(accept).toHaveCount(0);
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The cat slept on the mat.",
  );
  await expect(page.locator(".milkdown p").nth(1)).toHaveText(
    "The dog walked far.",
  );
});

test("a narrow window numbers the notes as the chat lists them", async ({
  page,
}) => {
  // No room for a margin: the notes sit behind numbered badges.
  await page.setViewportSize({ width: 900, height: 780 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "First paragraph here.\n\nSecond paragraph here.");
  const comment = (id: string, anchor: string, text: string) => [
    {
      kind: "ToolCall",
      call_id: id,
      name: "add_comment",
      arguments: JSON.stringify({ anchor, comment: text }),
    },
    { kind: "ToolResult", call_id: id, output: "Comment added" },
  ];
  // Left in the opposite order to the text's.
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Review" },
      ...comment("c1", "Second paragraph", "About the second."),
      ...comment("c2", "First paragraph", "About the first."),
      { kind: "Assistant", text: "Two notes." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Review");
  await composer.press("Enter");
  const badges = page.locator(".milkdown .review-badge");
  await expect(badges).toHaveCount(2);
  // In the text's order: the first paragraph's note was left second.
  await expect(badges).toHaveText(["2", "1"]);
  await expect(page.locator(".agent-comment .agent-comment-num")).toHaveText([
    "1",
    "2",
  ]);
  await expect(page.locator(".agent-comment").first()).toContainText(
    "About the second.",
  );
});

test("a note opened from its badge stays under the Settings backdrop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 780 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "First paragraph here.");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Review" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "add_comment",
        arguments: JSON.stringify({
          anchor: "First paragraph",
          comment: "About the first.",
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Comment added" },
      { kind: "Assistant", text: "One note." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Review");
  await composer.press("Enter");
  await page.locator(".milkdown .review-badge").click();
  const popover = page.locator(".review-note-popover");
  await expect(popover).toBeVisible();
  // Settings opened from the menu leaves the note open behind it.
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await expect(page.locator(".settings-backdrop")).toBeVisible();
  const box = (await popover.boundingBox())!;
  const covered = await page.evaluate(
    ({ x, y }) =>
      !!document.elementFromPoint(x, y)?.closest(".settings-backdrop"),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(covered).toBe(true);
});

test("an undone edit's card still counts what it removes", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "The cat sat on the mat.\n\nThe end.");
  // A rewrite of the selection: the card compares it with the selection
  // the request went out with.
  await mockInvoke(page, {
    ai_agent_message: [
      {
        kind: "User",
        text: "<selected-text>\nThe cat sat on the mat.\n</selected-text>\n\nFix it",
      },
      {
        kind: "ToolCall",
        call_id: "u1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace_selection",
          text: "The cat slept on the mat.",
        }),
      },
      { kind: "ToolResult", call_id: "u1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  await page.locator(".milkdown p").first().click({ clickCount: 3 });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Fix it");
  await composer.press("Enter");
  const chips = page.locator(".agent-proposal .agent-diff-summary");
  await expect(chips).toHaveText("+1−1");
  await page
    .locator(".agent-proposal-actions .inline-chat-action-primary")
    .click();
  await expect(page.locator(".agent-proposal-status-accepted")).toBeVisible();
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The cat slept on the mat.",
  );
  // Undone, the edit is on offer again; the caret then moves on and
  // nothing is selected any more.
  await page.locator(".milkdown .ProseMirror").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".agent-proposal-status-accepted")).toHaveCount(0);
  await page.locator(".milkdown p").last().click();
  await expect(page.locator(".agent-proposal-actions")).toBeVisible();
  await expect(chips).toHaveText("+1−1");
});

test("a broken diagram leaves no mermaid node in the page", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph TD\n  A-->>>\n```\n\nEnd.",
  );
  await expect(page.locator(".mermaid-preview svg")).toHaveCount(1, {
    timeout: 10_000,
  });
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () =>
        Array.from(document.body.children).filter((el) =>
          /mermaid/.test(el.id || ""),
        ).length,
    ),
  ).toBe(0);
});

test("a diagram is redrawn in the new colours when the appearance switches", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "```mermaid\ngraph TD\n  A-->B\n```\n\nEnd.");
  const svg = page.locator(".mermaid-preview svg");
  await expect(svg).toHaveCount(1, { timeout: 10_000 });
  const firstId = await svg.getAttribute("id");
  await page.emulateMedia({ colorScheme: "dark" });
  // A fresh render, not the light one kept on screen.
  await expect
    .poll(async () => svg.getAttribute("id"), { timeout: 10_000 })
    .not.toBe(firstId);
  await expect(svg).toHaveCount(1);
});

test("the outline marks the section being read", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    longDoc([
      { at: 10, text: "## Early section" },
      { at: 60, text: "## Late section" },
    ]),
  );
  await emit(page, "menu-toggle-sidebar");
  await page.locator(".sidebar-tab").nth(1).click();
  await page
    .locator(".outline-row .tree-label", { hasText: "Late section" })
    .click();
  const current = page.locator('.outline-row[aria-current="location"]');
  await expect(current).toHaveText("Late section");
  await page
    .locator(".outline-row .tree-label", { hasText: "Early section" })
    .click();
  await expect(current).toHaveText("Early section");
});

test("an empty document doesn't scroll", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  expect(
    await scroller.evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThanOrEqual(0);
});

test("the adaptive column takes 62% of a pane past about 1100px, between 680 and 960px, and Standard stays 760px (#211)", async ({
  page,
}) => {
  const column = page.locator('[data-active-tab="true"] .editor-content');
  const width = () => column.evaluate((el) => (el as HTMLElement).offsetWidth);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "0", "textus-sidebar-open": "0" },
  });
  // A laptop window: wider than Standard.
  expect(await width()).toBe(Math.round(1280 * 0.62));
  await page.setViewportSize({ width: 1000, height: 800 });
  expect(await width()).toBe(680);
  await page.setViewportSize({ width: 1920, height: 800 });
  expect(await width()).toBe(960);
  // The AI panel narrows the pane: the column keeps its floor beside it
  // rather than crowding it.
  await page.setViewportSize({ width: 1341, height: 800 });
  await emit(page, "menu-toggle-agent-panel");
  await expect(page.locator(".agent-panel")).toBeVisible();
  await expect.poll(width).toBe(680);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-content-width", "standard");
  });
  expect(await width()).toBe(760);
});

test("zooming keeps the line being read in place", async ({ page }) => {
  await openApp(page, {
    // Full width: the column can't widen with the zoom, so the text
    // rewraps and the content doesn't grow in proportion.
    settings: { language: "en", contentWidth: "full" },
  });
  await pasteMarkdown(page, longDoc([{ at: 50, text: "## Anchor line" }]));
  const heading = page.locator(".milkdown h2", { hasText: "Anchor line" });
  await heading.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  const before = (await heading.boundingBox())!;
  await emit(page, "menu-zoom-in");
  await emit(page, "menu-zoom-in");
  await expectZoom(page, 1.1 * 1.1);
  const after = (await heading.boundingBox())!;
  // The heading at the pane's centre stays there.
  expect(
    Math.abs(after.y + after.height / 2 - (before.y + before.height / 2)),
  ).toBeLessThan(24);
});

test("the math preview follows its formula when the column moves", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Some text with $x^2 + y^2$ in it.");
  // Into the formula from the end of the line.
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.keyboard.press("End");
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowLeft");
  const preview = page.locator(".math-float-preview");
  await expect(preview).toBeVisible();
  const before = (await preview.boundingBox())!;
  // The AI panel takes its room; the column (and the formula) moves left.
  await emit(page, "menu-toggle-agent-panel");
  await expect(page.locator(".agent-panel")).toBeVisible();
  await expect
    .poll(async () => (await preview.boundingBox())!.x)
    .not.toBe(before.x);
});

/** Whether the math preview's box overlaps any document text (outside the
 *  formula's own source) in the active tab. */
function previewCoversText(page: Page) {
  return page.evaluate(() => {
    const box = document
      .querySelector(".math-float-preview")!
      .getBoundingClientRect();
    const root = document.querySelector(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      if (n.parentElement?.closest(".math-inline, .math-block")) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (
          r.left < box.right &&
          r.right > box.left &&
          r.top < box.bottom &&
          r.bottom > box.top
        )
          return true;
      }
    }
    return false;
  });
}

const PREVIEW_DOC = [
  "A line above the formula, long enough to run across the whole column and onto a second line of text.",
  "$$\ne^{ix} = \\cos x + i\\sin x\n$$",
  "A line below the formula, long enough to run across the whole column and onto a second line of text.",
  "Inline $\\frac{a}{b} + \\sqrt{c}$ math in a sentence long enough to wrap onto a second line under the formula, and a third.",
].join("\n\n");

/** Opens the block formula (caret at its end): its preview must not cover
 *  text. Then the inline one (caret inside it): its preview floats, brief,
 *  and the text around it must not move for it. */
async function expectPreviewsClear(page: Page) {
  const preview = page.locator(".math-float-preview");
  await page.locator('[data-active-tab="true"] .math-block-rendered').click();
  await page.keyboard.press("End");
  await expect(preview).toBeVisible();
  await page.waitForTimeout(400);
  expect(await previewCoversText(page), "block preview covers text").toBe(
    false,
  );
  // Its render's own mousedown handler puts the caret inside (a click's
  // centre point can land on the paragraph around the KaTeX box).
  const lastLine = page
    .locator('[data-active-tab="true"] .ProseMirror p')
    .last();
  await page.locator('[data-active-tab="true"] .ProseMirror p').first().click();
  await expect(preview).toBeHidden();
  const before = (await lastLine.boundingBox())!;
  await page
    .locator('[data-active-tab="true"] .math-inline-rendered')
    .dispatchEvent("mousedown");
  await page.keyboard.press("ArrowLeft");
  await expect(preview).toBeVisible();
  await page.waitForTimeout(400);
  // Revealing the source may rewrap its own line; nothing grows to make
  // room for the preview, so the paragraph's height stays within a line.
  const after = (await lastLine.boundingBox())!;
  expect(after.height - before.height).toBeLessThan(40);
  await expect(
    page.locator('[data-active-tab="true"] .math-preview-room:visible'),
  ).toHaveCount(0);
  // Out of the formula, its room closes again.
  await page.locator('[data-active-tab="true"] .ProseMirror p').first().click();
  await expect(preview).toBeHidden();
  await expect(
    page.locator('[data-active-tab="true"] .math-preview-room:visible'),
  ).toHaveCount(0);
}

test("a block formula's preview never covers the text below; an inline one floats", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, PREVIEW_DOC);
  await expectPreviewsClear(page);
  // A narrow window, and zoomed in.
  await page.setViewportSize({ width: 620, height: 800 });
  await expectPreviewsClear(page);
  await emit(page, "menu-zoom-in");
  await emit(page, "menu-zoom-in");
  await expectZoom(page, 1.1 * 1.1);
  await expectPreviewsClear(page);
});

test.describe("phone", () => {
  test.use(PHONE);
  test("the math preview never covers text on the phone", async ({ page }) => {
    await openPhone(page);
    await pasteMarkdown(page, PREVIEW_DOC);
    await expectPreviewsClear(page);
  });
});

test("a note's body starts flush with the lines under it", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "Intro.\n\n> [!NOTE]\n> Useful information.\n\nEnd.",
  );
  await page.locator('[data-active-tab="true"] .milkdown p').last().click();
  // The marker line's soft break is hidden with the marker, or it draws a
  // space at the start of the body.
  const shown = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-active-tab="true"] blockquote.md-alert [data-type="hardbreak"]',
      ),
    ).map((el) => getComputedStyle(el).display),
  );
  expect(shown).toEqual(["none"]);
});

test("typed dollar amounts stay text; a typed formula still forms", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("It costs $5 a month, or $50 a year.", {
    delay: 20,
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Price $4) and $19 ok.", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("The plan costs $5.", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Area $x^2$ and $2 \\times 3$ here.", {
    delay: 20,
  });
  const paragraphs = page.locator('[data-active-tab="true"] .ProseMirror p');
  await expect(paragraphs).toHaveCount(4);
  const prices = [
    "It costs $5 a month, or $50 a year.",
    "Price $4) and $19 ok.",
    "The plan costs $5.",
  ];
  for (let i = 0; i < prices.length; i++) {
    await expect(paragraphs.nth(i)).toHaveText(prices[i]);
    await expect(paragraphs.nth(i).locator(".math-inline")).toHaveCount(0);
  }
  await expect(paragraphs.nth(3).locator(".math-inline")).toHaveCount(2);
});

test("clicking a diagram opens its own source after text is added above", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "Top.\n\n```mermaid\ngraph TD\n  A1-->B1\n```\n\n```mermaid\ngraph TD\n  A2-->B2\n```\n\nEnd.",
  );
  const previews = page.locator(".mermaid-preview");
  await expect(previews).toHaveCount(2, { timeout: 10_000 });
  // Lengthen the paragraph above: the diagrams' widgets are kept, their
  // blocks move.
  await page.locator(".ProseMirror p", { hasText: "Top." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More words above both diagrams.");
  await previews.nth(1).click();
  const hidden = page.locator(".ProseMirror .mermaid-source-hidden");
  await expect(hidden.filter({ hasText: "A2-->B2" })).toHaveCount(0);
  await expect(hidden.filter({ hasText: "A1-->B1" })).toHaveCount(1);
});

test("a table's menu stays open while it scrolls on a short window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 360 });
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "| a | b |\n| --- | --- |\n| c | d |\n\nEnd.");
  await page
    .locator(".ProseMirror td", { hasText: "d" })
    .click({ button: "right" });
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  const scrollable = await menu.evaluate(
    (el) => el.scrollHeight > el.clientHeight,
  );
  expect(scrollable).toBe(true);
  await menu.hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => menu.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(menu).toBeVisible();
});

test("the wheel over a table scrolls the page, not the table", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const filler = Array.from(
    { length: 20 },
    (_, i) => `Paragraph ${i} with some words to fill the page out.`,
  ).join("\n\n");
  await pasteMarkdown(
    page,
    `${filler}\n\n| a | b |\n| --- | --- |\n| the plan | d |\n\n${filler}`,
  );
  const cell = page.locator(".ProseMirror td", { hasText: "the plan" });
  await cell.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await cell.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+Shift+Space");
  await expect(page.locator(".ghost-text")).toHaveCount(1);
  // The table's box a little shorter than the table, as a fractional cell
  // height can leave it. A stylesheet, since ProseMirror redraws a node view
  // whose attributes change.
  const box = page.locator(".table-scroll");
  const height = await box.evaluate((el) => el.getBoundingClientRect().height);
  await page.addStyleTag({
    content: `.table-scroll { height: ${height - 20}px; }`,
  });
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  const before = await scroller.evaluate((el) => el.scrollTop);
  await box.hover();
  await page.mouse.wheel(0, 40);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(before);
  expect(await box.evaluate((el) => el.scrollTop)).toBe(0);
});

/** A deliberate Shift+Enter: Shift held first, since Shift and Enter pressed
 *  together count as Enter. */
async function shiftEnter(page: Page) {
  await page.keyboard.down("Shift");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
}

test("Shift+Enter mid-line in a paragraph ending in a break adds a break", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "zh" } });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.type("1、时间");
  await shiftEnter(page);
  // Back up from the new empty line to between 时 and 间.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await shiftEnter(page);
  const shape = await editor.evaluate((el) =>
    Array.from(el.querySelectorAll(":scope > p")).map((p) =>
      Array.from(p.childNodes)
        .map((n) =>
          n.nodeName === "BR"
            ? (n as Element).classList.contains("ProseMirror-trailingBreak")
              ? ""
              : "<br>"
            : n.textContent,
        )
        .join(""),
    ),
  );
  expect(shape).toEqual(["1、时<br>间<br>"]);
});

test("Shift pressed together with Enter starts a new paragraph", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "zh" } });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.type("7、很少用agent");
  // The Pinyin 中/英 Shift tap overlapping the Enter after a Latin word.
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("8、");
  await expect(editor.locator(":scope > p")).toHaveText([
    "7、很少用agent",
    "8、",
  ]);
  await expect(editor.locator('br[data-type="hardbreak"]')).toHaveCount(0);
});

test("an IME commit into a fresh task item stays in that item", async ({
  page,
}) => {
  await openApp(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.type("- [ ] ");
  // WebKitGTK's commit, replayed: the preedit is deleted (and WebKit prunes
  // the emptied <p> and <li>, leaving a <br> in the list - done by hand
  // here, Chromium doesn't), then the committed text is inserted.
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    // Chromium blanks an inputType it doesn't implement; only WebKit has
    // deleteCompositionText.
    const deleteEvent = (type: string) =>
      Object.defineProperty(new InputEvent(type), "inputType", {
        value: "deleteCompositionText",
      });
    root.dispatchEvent(new CompositionEvent("compositionstart"));
    document.execCommand("insertText", false, "ni hao");
    const li = root.querySelector("li")!;
    root.dispatchEvent(deleteEvent("beforeinput"));
    li.replaceWith(document.createElement("br"));
    root.dispatchEvent(deleteEvent("input"));
    document.execCommand("insertText", false, "你好");
    root.dispatchEvent(
      new CompositionEvent("compositionend", { data: "你好" }),
    );
  });
  await page.keyboard.type("!");
  const items = editor.locator('li[data-item-type="task"]');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveText("你好!");
});

test("repairing a pruned IME commit leaves a real empty item alone", async ({
  page,
}) => {
  await openApp(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  // Three task items: an empty one, "a", and a fresh one to compose in.
  await pasteMarkdown(page, "- [ ] e\n- [ ] a\n- [ ] x");
  // ProseMirror reads a caret set this way on the next selectionchange; its
  // listener runs before this one.
  const caretAfter = (index: number) =>
    page.evaluate(
      (i) =>
        new Promise<void>((resolve) => {
          const p = document.querySelectorAll(
            '[data-active-tab="true"] .ProseMirror li p',
          )[i];
          document.addEventListener("selectionchange", () => resolve(), {
            once: true,
          });
          getSelection()!.collapse(p.firstChild, 1);
        }),
      index,
    );
  await caretAfter(0);
  await page.keyboard.press("Backspace");
  await caretAfter(2);
  await page.keyboard.press("Backspace");
  const items = editor.locator('li[data-item-type="task"]');
  await expect(items).toHaveText(["", "a", ""]);
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const deleteEvent = (type: string) =>
      Object.defineProperty(new InputEvent(type), "inputType", {
        value: "deleteCompositionText",
      });
    root.dispatchEvent(new CompositionEvent("compositionstart"));
    document.execCommand("insertText", false, "ni hao");
    const [, before, fresh] = Array.from(root.querySelectorAll("li"));
    root.dispatchEvent(deleteEvent("beforeinput"));
    // The pruned item's recorded neighbour goes too, so the guard can't
    // place the item by it - and must not take the empty first item for
    // the stand-in WebKit leaves.
    before.remove();
    fresh.replaceWith(document.createElement("br"));
    root.dispatchEvent(deleteEvent("input"));
    document.execCommand("insertText", false, "你好");
    root.dispatchEvent(
      new CompositionEvent("compositionend", { data: "你好" }),
    );
  });
  await page.keyboard.type("!");
  await expect(items).toHaveText(["", "你好!"]);
});

test("hovering a column border doesn't change the table's height", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "| a | b |\n|---|---|\n| 1 | 2 |\n");
  const table = page.locator(".milkdown table");
  const before = (await table.boundingBox())!.height;
  const cell = (await page.locator(".milkdown td").first().boundingBox())!;
  await page.mouse.move(cell.x + cell.width - 1, cell.y + cell.height / 2);
  await expect(page.locator(".column-resize-handle").first()).toBeAttached();
  expect((await table.boundingBox())!.height).toBe(before);
});

test("full-width 【】 turns a line into a task, the way [ ] does", async ({
  page,
}) => {
  await openApp(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  const tasks = editor.locator('li[data-item-type="task"]');
  // A whole "-【】" committed by an IME into a plain paragraph (first, before
  // the dev shim's ghost suggestion sits at the caret).
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    root.dispatchEvent(new CompositionEvent("compositionstart"));
    document.execCommand("insertText", false, "-【】");
    root.dispatchEvent(
      new CompositionEvent("compositionend", { data: "-【】" }),
    );
  });
  await expect(tasks).toHaveCount(1);
  await page.keyboard.type("买菜", { delay: 30 });
  await expect(tasks.nth(0)).toHaveText("买菜");
  // Typed: "- " makes the bullet, 【x】 then makes it a checked task.
  await page.keyboard.press("Enter", { delay: 30 });
  await page.keyboard.press("Enter", { delay: 30 });
  await page.keyboard.type("- 【x】写稿", { delay: 30 });
  await expect(tasks).toHaveCount(2);
  await expect(tasks.nth(1)).toHaveAttribute("data-checked", "true");
  await expect(tasks.nth(1)).toHaveText("写稿");
  // Pasted text stays as written.
  await page.keyboard.press("Enter", { delay: 30 });
  await page.keyboard.press("Enter", { delay: 30 });
  await pasteMarkdown(page, "- 【】");
  await expect(tasks).toHaveCount(2);
});

test("h4 to h6 are never smaller than the text, and h6 is lighter than h5 (#58)", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "#### Four\n\n##### Five\n\n###### Six\n\nBody text.",
  );
  const style = (selector: string) =>
    page
      .locator(`[data-active-tab="true"] .milkdown ${selector}`)
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { size: parseFloat(cs.fontSize), color: cs.color };
      });
  const p = await style("p");
  const h4 = await style("h4");
  const h5 = await style("h5");
  const h6 = await style("h6");
  expect(h4.size).toBeGreaterThan(p.size);
  expect(h5.size).toBe(p.size);
  expect(h6.size).toBe(p.size);
  expect(h5.color).toBe(p.color);
  expect(h6.color).not.toBe(h5.color);
});

test("source mode: body-sized text, centred on a whole pixel, unchanged by focus (#61)", async ({
  page,
}) => {
  // An odd leftover beside the adaptive column: `margin: auto` put the
  // textarea at x.5, which WebKitGTK blurs once the textarea has focus.
  await page.setViewportSize({ width: 1181, height: 780 });
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Some text.");
  const bodySize = await page
    .locator('[data-active-tab="true"] .milkdown p')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeVisible();
  const look = () =>
    textarea.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        left: el.getBoundingClientRect().left,
        size: parseFloat(cs.fontSize),
        transform: cs.transform,
        willChange: cs.willChange,
        filter: cs.filter,
        opacity: cs.opacity,
        // A focus ring composites the textarea, which blurs WebKitGTK's text.
        outline: cs.outlineStyle,
      };
    });
  const before = await look();
  expect(before.size).toBeGreaterThanOrEqual(16);
  expect(before.size).toBeGreaterThanOrEqual(bodySize - 0.5);
  expect(Number.isInteger(before.left)).toBe(true);
  await textarea.click();
  await expect(textarea).toBeFocused();
  expect(await textarea.evaluate((el) => el.matches(":focus-visible"))).toBe(
    true,
  );
  const after = await look();
  expect(after).toEqual(before);
  expect(after.transform).toBe("none");
  expect(after.willChange).toBe("auto");
});

test("Escape that closes the context menu keeps the grey suggestion", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "The plan");
  await page.locator(".milkdown p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" works");
  const ghost = page.locator(".ghost-text");
  await expect(ghost).toHaveCount(1);
  await page.locator(".milkdown p").first().click({ button: "right" });
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  // The menu listens from a tick after it opens, and Chromium runs a key
  // press ahead of a waiting timer: let that tick pass first.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(ghost).toHaveCount(1);
  // The next Escape is the editor's again.
  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
});

test("ASCII - [] and -[] make tasks too; the space after - [ ] is eaten", async ({
  page,
}) => {
  await openApp(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  const tasks = editor.locator('li[data-item-type="task"]');
  await page.keyboard.type("- [ ] milk");
  await expect(tasks.nth(0)).toHaveText("milk");
  for (const spelling of ["- []", "-[]", "-[x]"]) {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type(spelling + "eggs");
  }
  await expect(tasks).toHaveCount(4);
  await expect(tasks.nth(1)).toHaveText("eggs");
  await expect(tasks.nth(2)).toHaveText("eggs");
  await expect(tasks.nth(3)).toHaveAttribute("data-checked", "true");
});

test("list items aren't positioned, so WebKit's IME commit can't prune them", async ({
  page,
}) => {
  // WebKit removes an element emptied by deleteCompositionText only when it
  // is positioned; the markers must keep working without it.
  await openApp(page);
  await pasteMarkdown(page, "- a\n\n1. b\n\n- [x] c\n");
  const positions = await page
    .locator(".milkdown li")
    .evaluateAll((items) => items.map((li) => getComputedStyle(li).position));
  expect(positions).toEqual(["static", "static", "static"]);
});

test("Enter in a table's last row starts the new row at its first cell", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "| a | b |\n|---|---|\n| 1 | 2 |\n");
  await page.locator(".milkdown td").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await expect(
    page.locator(".milkdown tr").nth(2).locator("td").first(),
  ).toHaveText("x");
});

/** The content zoom on screen (useZoom's `--content-zoom`). */
function contentZoom(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--content-zoom",
      ) || 1,
    ),
  );
}

/** Waits for a zoom step to land: useZoom applies it on the next frame,
 *  setting the variable and holding the scroll position in one go. */
async function expectZoom(page: Page, zoom: number) {
  await expect.poll(() => contentZoom(page)).toBeCloseTo(zoom, 6);
}

/** Text-line index of a source textarea at viewport y, from its own
 *  scroll metrics (the content zoom scales screen px by 1/zoom). Assumes
 *  lines too short to wrap. */
async function sourceLineAt(page: Page, y: number): Promise<number> {
  return page.evaluate((y) => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '[data-active-tab="true"] textarea.source-view',
    )!;
    const zoom = Number(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--content-zoom",
      ) || 1,
    );
    const style = getComputedStyle(ta);
    const padTop = parseFloat(style.paddingTop);
    const lines = ta.value.split("\n").length;
    const lineHeight =
      (ta.scrollHeight - padTop - parseFloat(style.paddingBottom)) / lines;
    const top = ta.getBoundingClientRect().top;
    return Math.floor((ta.scrollTop + (y - top) / zoom - padTop) / lineHeight);
  }, y);
}

async function wheelZoom(page: Page, x: number, y: number, steps: number) {
  const zoom = Math.min(3, (await contentZoom(page)) * Math.exp(0.15 * steps));
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expectZoom(page, zoom);
}

const shortLines = Array.from({ length: 200 }, (_, i) => `Line ${i}`).join(
  "\n\n",
);

test("mod+wheel in source mode keeps the line under the pointer", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, shortLines);
  await emit(page, "menu-toggle-source-mode");
  const source = page.locator('[data-active-tab="true"] textarea.source-view');
  // Entering source mode places the caret a frame later, focusing the
  // textarea and scrolling to it: a scroll set before that is undone after
  // `before` is read.
  await expect(source).toBeFocused();
  await source.evaluate((ta) => (ta.scrollTop = ta.scrollHeight / 3));
  const box = (await source.boundingBox())!;
  const y = box.y + box.height * 0.3;
  const before = await sourceLineAt(page, y);
  await wheelZoom(page, box.x + box.width / 2, y, 5);
  expect(Math.abs((await sourceLineAt(page, y)) - before)).toBeLessThanOrEqual(
    1,
  );
});

test("split view: mod+wheel holds the pane under the pointer, the other follows", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, longDoc([{ at: 40, text: "## Anchor line" }]));
  await emit(page, "menu-toggle-split-view");
  const preview = page.locator('[data-active-tab="true"] .split-preview');
  const heading = preview.locator("h2", { hasText: "Anchor line" });
  // How far apart the two panes are, as shares of their scroll ranges.
  const gap = () =>
    page.evaluate(() => {
      const r = (el: Element) =>
        el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
      return Math.abs(
        r(document.querySelector('[data-active-tab="true"] .split-source')!) -
          r(document.querySelector('[data-active-tab="true"] .split-preview')!),
      );
    });
  // The caret lands in the source a frame after the switch and scrolls it;
  // the preview follows on the scroll event after that. A scroll set here
  // before both have happened is undone.
  await expect(
    page.locator('[data-active-tab="true"] .split-source'),
  ).toBeFocused();
  await expect.poll(gap).toBeLessThan(0.02);
  await heading.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await expect.poll(gap).toBeLessThan(0.02);
  await expect(heading).toBeInViewport();
  // Over the preview: its heading stays put.
  const before = (await heading.boundingBox())!;
  const pane = (await preview.boundingBox())!;
  await wheelZoom(
    page,
    pane.x + pane.width / 2,
    before.y + before.height / 2,
    4,
  );
  const after = (await heading.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(24);
  // ...and the source followed it in proportion, as on a scroll.
  await expect.poll(gap).toBeLessThan(0.02);
  // Over the source, the preview follows it the same way.
  const sbox = (await page
    .locator('[data-active-tab="true"] .split-source')
    .boundingBox())!;
  await wheelZoom(page, sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, 3);
  await expect.poll(gap).toBeLessThan(0.02);
});

test("in Typewriter Mode a click on a task's box ticks it without scrolling (#136)", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", typewriterMode: true },
  });
  await pasteMarkdown(
    page,
    longDoc([{ at: 30, text: "- [ ] buy milk\n- [ ] post the letter" }]),
  );
  const task = page.locator(
    '[data-active-tab="true"] li[data-item-type="task"]',
  );
  await expect(task).toHaveCount(2);
  // Off the middle, where the typewriter would want to recentre it (and
  // clear of the title bar at the very top).
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  await task.first().evaluate((el) => {
    el.scrollIntoView({ block: "start", behavior: "instant" });
    el.closest(".editor-scroll")!.scrollTop -= 150;
  });
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(100);
  const before = await scrollTop();
  const box = (await task.first().boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await expect(task.first()).toHaveAttribute("data-checked", "true");
  await expect(task.nth(1)).toHaveAttribute("data-checked", "false");
  await page.waitForTimeout(100);
  expect(Math.abs((await scrollTop()) - before)).toBeLessThanOrEqual(2);
  // And untick it again, still in place.
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await expect(task.first()).toHaveAttribute("data-checked", "false");
  await page.waitForTimeout(100);
  expect(Math.abs((await scrollTop()) - before)).toBeLessThanOrEqual(2);
  // A click on the text places the caret where it is, and the first key
  // centres it.
  await page.mouse.click(box.x + 80, box.y + box.height / 2);
  await page.waitForTimeout(100);
  expect(Math.abs((await scrollTop()) - before)).toBeLessThanOrEqual(2);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Math.abs((await scrollTop()) - before))
    .toBeGreaterThan(2);
});

/** Typewriter Mode on a long document, with "Paragraph 30" low in the pane,
 *  well below the middle the mode centres the caret on. */
async function typewriterBelowMiddle(page: Page) {
  await pasteMarkdown(page, longDoc());
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  const target = page.locator('[data-active-tab="true"] .milkdown p', {
    hasText: "Paragraph 30:",
  });
  await target.evaluate((el) => {
    const s = el.closest(".editor-scroll")!;
    const mid = s.getBoundingClientRect().top + s.clientHeight / 2;
    s.scrollTop += el.getBoundingClientRect().top - (mid + 250);
  });
  await page.waitForTimeout(100);
  return {
    target,
    scrollTop: () => scroller.evaluate((el) => el.scrollTop),
    /** How far the caret's line is from the pane's middle. */
    offMiddle: () =>
      scroller.evaluate((s) => {
        const range = window.getSelection()!.getRangeAt(0);
        const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
        const box = s.getBoundingClientRect();
        return (r.top + r.bottom) / 2 - (box.top + box.height / 2);
      }),
  };
}

/** Which paragraphs the selection's ends are in, and its length. */
function selectionInfo(page: Page) {
  return page.evaluate(() => {
    const sel = window.getSelection()!;
    const para = (node: Node | null) =>
      (node instanceof Element ? node : node?.parentElement)
        ?.closest("p")
        ?.textContent?.slice(0, 13) ?? "";
    return {
      anchor: para(sel.anchorNode),
      focus: para(sel.focusNode),
      length: sel.toString().length,
    };
  });
}

test("in Typewriter Mode a click lands where it was made, without scrolling, and keys still centre the caret (#217)", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", typewriterMode: true } });
  const { target, scrollTop, offMiddle } = await typewriterBelowMiddle(page);
  const before = await scrollTop();
  const box = (await target.boundingBox())!;
  // A click with the hand's 1-2px wobble between press and release.
  await page.mouse.move(box.x + 120, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 121, box.y + 12);
  await page.mouse.move(box.x + 122, box.y + 11);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const click = await selectionInfo(page);
  expect(click).toMatchObject({
    anchor: "Paragraph 30:",
    focus: "Paragraph 30:",
  });
  expect(click.length).toBeLessThanOrEqual(2);
  expect(Math.abs((await scrollTop()) - before)).toBeLessThanOrEqual(2);
  // The keyboard still centres the caret, as it always has.
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Math.abs(await offMiddle())).toBeLessThan(20);
  expect(await selectionInfo(page)).toMatchObject({ focus: "Paragraph 30:" });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => Math.abs(await offMiddle())).toBeLessThan(20);
  // And so does typing after a click.
  const now = (await target.boundingBox())!;
  await page.mouse.click(now.x + 40, now.y + 10);
  await page.keyboard.type("x");
  await expect.poll(async () => Math.abs(await offMiddle())).toBeLessThan(20);
});

test("in Typewriter Mode a drag selects what it passes over and the page stays still (#217)", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", typewriterMode: true } });
  const { target, scrollTop } = await typewriterBelowMiddle(page);
  const before = await scrollTop();
  const from = (await target.boundingBox())!;
  const to = (await page
    .locator('[data-active-tab="true"] .milkdown p', {
      hasText: "Paragraph 31:",
    })
    .boundingBox())!;
  await page.mouse.move(from.x + 120, from.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(
      from.x + 120,
      from.y + 10 + ((to.y - from.y) * i) / 8,
    );
  await page.mouse.up();
  await page.waitForTimeout(150);
  const drag = await selectionInfo(page);
  expect(drag).toMatchObject({
    anchor: "Paragraph 30:",
    focus: "Paragraph 31:",
  });
  // From a point to the same point a paragraph down: about a paragraph's
  // text, not the hundreds of characters a runaway scroll swept up.
  expect(drag.length).toBeGreaterThan(60);
  expect(drag.length).toBeLessThan(200);
  expect(Math.abs((await scrollTop()) - before)).toBeLessThanOrEqual(2);
});

test.describe("phone", () => {
  test.use(PHONE);
  test("in Typewriter Mode a tap puts the caret where it was tapped, and typing centres it (#217)", async ({
    page,
  }) => {
    await openPhone(page, { settings: { typewriterMode: true } });
    const { target, scrollTop, offMiddle } = await typewriterBelowMiddle(page);
    const before = await scrollTop();
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + 60, box.y + 10);
    await page.waitForTimeout(150);
    expect(await selectionInfo(page)).toMatchObject({
      anchor: "Paragraph 30:",
      focus: "Paragraph 30:",
    });
    expect(Math.abs((await scrollTop()) - before)).toBeLessThanOrEqual(2);
    await page.keyboard.type("x");
    await expect.poll(async () => Math.abs(await offMiddle())).toBeLessThan(20);
  });
});

test("Enter on an empty nested task lifts it a level as a task, not a bullet (#355)", async ({
  page,
}) => {
  await openApp(page);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await pasteMarkdown(page, "- [ ] one\n  - [ ] two\n    - [ ] three");
  await editor.locator("li p", { hasText: "three" }).click();
  await page.keyboard.press("End");
  // A new task at the third level, then Enter on it while it is empty: it
  // moves up beside "two" - and stays a task, as its new neighbours are.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("four");
  const four = editor.locator("li", { hasText: /^four$/ });
  await expect(four).toHaveAttribute("data-item-type", "task");
  await expect(editor.locator('li[data-item-type="task"]')).toHaveCount(4);
  expect(await sourceOf(page)).toContain(
    "  * [ ] two\n    * [ ] three\n  * [ ] four",
  );
});

test("the outline folds and unfolds every heading from its menu, or with Option-click", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "# One\n\n## One a\n\n### One a i\n\n# Two\n\n## Two a",
  );
  await emit(page, "menu-toggle-sidebar");
  await page.locator(".sidebar-tab").nth(1).click();
  const rows = page.locator(".outline-row .tree-label");
  await expect(rows).toHaveCount(5);
  const outline = page.getByRole("tree", { name: "Outline" });
  await outline.click({ button: "right" });
  await page.locator(".context-menu-item").getByText("Collapse All").click();
  await expect(rows).toHaveText(["One", "Two"]);
  await outline.click({ button: "right" });
  await page.locator(".context-menu-item").getByText("Expand All").click();
  await expect(rows).toHaveCount(5);
  // Option-click on one heading's arrow folds them all.
  await page
    .locator(".outline-row", { hasText: "Two" })
    .first()
    .locator(".outline-toggle")
    .click({ modifiers: ["Alt"] });
  await expect(rows).toHaveText(["One", "Two"]);
});
