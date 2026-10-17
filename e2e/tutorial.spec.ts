import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, openPhone, PHONE } from "./helpers";

// The first-run tour end to end: the four writing lessons on the travel
// diary, the connect lesson, then the Textus AI lessons - watched when no
// AI is connected, done for real (against canned answers from the dev
// shim) when one is.

const PROGRESS = "levis-tutorial-progress";

const at = (stepId: string, extra: Record<string, unknown> = {}) => ({
  [PROGRESS]: JSON.stringify({ active: true, stepId, tabId: null, ...extra }),
});

/** The lesson on screen, by its title. */
const lesson = (page: Page, title: string) =>
  page.getByRole("dialog", { name: title });

const editor = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

/** What the tour opened in the browser (the dev shim's record). */
const opened = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __devLinks?: unknown[] }).__devLinks ?? [],
  );

/** Canned backend answers from the first command on (before the page's
 *  first check of the provider's connection). */
async function answerFromStart(page: Page, results: Record<string, unknown>) {
  await page.addInitScript((r) => {
    (window as unknown as { __devInvokeResults: object }).__devInvokeResults =
      r;
  }, results);
}

/** Adds canned backend answers to those already set. */
async function answer(page: Page, results: Record<string, unknown>) {
  await page.evaluate((r) => {
    const w = window as unknown as { __devInvokeResults?: object };
    w.__devInvokeResults = { ...w.__devInvokeResults, ...r };
  }, results);
}

const savedProgress = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    PROGRESS,
  );

const DIARY_TABLE = `| Day | Where |
| --- | --- |
| 1 | Fushimi Inari |
| 2 | Arashiyama |
`;

async function pasteAtEnd(page: Page, markdown: string) {
  // The caret at the very end, as the editor sees it, before pasting.
  await editor(page).locator("p").last().click();
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(150);
  await page.evaluate((md) => {
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const data = new DataTransfer();
    data.setData("text/plain", md);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, markdown);
}

const AI_LESSONS: [string, string][] = [
  ["The AI panel", "ai-panel"],
  ["Continuation", "continuation"],
  ["Grammar check", "grammar"],
  ["Revision", "revision"],
  ["Review", "review"],
  ["Built-in skills", "skills"],
  ["Grows over time", "memory"],
];

test("the whole tour, watching the AI lessons", async ({ page }) => {
  await openApp(page, { settings: { language: "en" }, storage: at("welcome") });

  await expect(lesson(page, "Welcome to Textus")).toContainText(
    "We'll show you around with a travel diary.",
  );
  await page.getByRole("button", { name: "Start" }).click();

  // What you see is what you get: a heading and a list, typed.
  const wysiwyg = lesson(page, "What you see is what you get");
  await expect(wysiwyg).toContainText("Type # Three days in Kyoto");
  const next = wysiwyg.getByRole("button", { name: "Continue" });
  await expect(next).toBeDisabled();
  await wysiwyg.getByRole("button", { name: /Watch the animation/ }).click();
  await editor(page).click();
  await page.keyboard.type("# Three days in Kyoto");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Passport");
  await expect(next).toBeEnabled();
  await next.click();

  // The diary arrives under what was typed; a table finishes the lesson.
  const blocks = lesson(page, "Formulas, tables, diagrams");
  await expect(editor(page)).toContainText("Day one: Fushimi Inari");
  await expect(editor(page).locator("h1")).toContainText("Three days in Kyoto");
  await expect(editor(page).locator("h1")).toHaveCount(1);
  await expect(blocks.getByRole("button", { name: "Continue" })).toBeDisabled();
  await pasteAtEnd(page, DIARY_TABLE);
  await expect(editor(page).locator("table")).toContainText("Arashiyama");
  await blocks.getByRole("button", { name: "Continue" }).click();

  // A writing mode and a theme, from the card's own controls.
  const modes = lesson(page, "Writing modes and themes");
  await modes.getByRole("button", { name: "Zen Mode" }).click();
  await expect(modes.getByRole("button", { name: "Zen Mode" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await modes.getByRole("button", { name: "Zen Mode" }).click();
  await modes.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name: "Paper" }).click();
  await modes.getByRole("button", { name: "Continue" }).click();

  // The sidebar's outline.
  const sidebar = lesson(page, "Sidebar and export");
  await expect(sidebar).toContainText("Open the sidebar (Ctrl+\\)");
  await page.keyboard.press("Control+\\");
  await page.getByRole("button", { name: "Outline" }).click();
  await expect(page.locator(".sidebar")).toContainText("Day two: Arashiyama");
  await sidebar.getByRole("button", { name: "Continue" }).click();

  // No AI: skip, and the AI lessons are watched.
  const connect = lesson(page, "Connect your AI");
  await expect(
    connect.getByRole("button", { name: "Sign in with OpenAI" }),
  ).toBeVisible();
  await connect.getByRole("button", { name: "Skip for now" }).click();
  expect(await savedProgress(page)).toMatchObject({
    stepId: "ai-panel",
    aiMode: "watch",
  });

  for (const [title, clip] of AI_LESSONS) {
    const card = lesson(page, title);
    await expect(card).toContainText(
      "Connect an AI later in Settings › Textus AI to try it yourself.",
    );
    // Watching is the main action; moving on is always there.
    await card.getByRole("button", { name: "Watch the animation" }).click();
    await expect
      .poll(async () => (await opened(page)).at(-1))
      .toEqual({
        cmd: "open_tutorials_page",
        language: "en",
        clip,
      });
    if (clip === "ai-panel") {
      // The panel itself still opens, connected or not.
      await page.keyboard.press("Control+Shift+L");
      await expect(page.locator(".agent-panel")).toBeVisible();
    }
    await card.getByRole("button", { name: "Continue" }).click();
  }

  const done = lesson(page, "All done");
  await done.getByRole("button", { name: "Video Tutorials" }).click();
  await done.getByRole("button", { name: "Join the Community" }).click();
  const links = await opened(page);
  expect(links.slice(-2)).toEqual([
    { cmd: "open_tutorials_page", language: "en", clip: null },
    { cmd: "open_community_page", language: "en" },
  ]);
  // Every clip the tour links to, once each, in order.
  expect(
    links
      .filter((l) => (l as { clip?: string }).clip)
      .map((l) => (l as { clip: string }).clip),
  ).toEqual([
    "wysiwyg",
    "ai-panel",
    "continuation",
    "grammar",
    "revision",
    "review",
    "skills",
    "memory",
  ]);
  await done.getByRole("button", { name: "Start writing" }).click();
  await expect(page.locator(".tutorial-surface")).toHaveCount(0);
  expect(await savedProgress(page)).toMatchObject({ active: false });
});

test("in Chinese: the diary, the copy and the links follow the language", async ({
  page,
}) => {
  await openApp(page, { storage: at("blocks") });
  const blocks = lesson(page, "公式、表格、图表");
  await expect(blocks).toContainText("几行文字就能画出来。");
  await expect(editor(page).locator("h1")).toContainText("京都三日");
  await expect(editor(page)).toContainText("已经走的很累了");
  await blocks.getByRole("button", { name: /观看动画/ }).click();
  await expect
    .poll(async () => (await opened(page)).at(-1))
    .toEqual({
      cmd: "open_tutorials_page",
      language: "zh",
      clip: "blocks",
    });
});

test("a tour from the old guide resumes at the nearest lesson", async ({
  page,
}) => {
  // The old guide's document-editing lesson was in its AI chapter, which
  // ran on scripted replies: the new one starts that chapter by asking.
  await openApp(page, {
    settings: { language: "en" },
    storage: at("agentEdit"),
  });
  await expect(lesson(page, "Connect your AI")).toBeVisible();
});

test("an AI lesson resumes in the mode it was left in", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: at("review", { aiMode: "watch" }),
  });
  const review = lesson(page, "Review");
  await expect(
    review.getByRole("button", { name: "Watch the animation" }),
  ).toBeVisible();
  // The diary is back in the new practice tab.
  await expect(editor(page)).toContainText("Day three: Gion");
});

test.describe("connected", () => {
  const SLIP_PARAGRAPH =
    "The wind was loud in the bamboo grove. We rented bikes and rode along the river to the Togetsukyo Bridge. By the afternoon we was too tired to go any further, so we sat by the water for an hour.";
  const DAY_THREE =
    "It rained a little today. I walked down Hanamikoji Street. Then I went to a small café. The café was quiet. The coffee was good. I sat there for a long time. Then I went back to the hotel.";
  const VIVID =
    "A soft rain fell over Gion. I wandered down Hanamikoji Street and ducked into a tiny café, so quiet I could hear the cups. The coffee was rich and slow, and I stayed until the light went grey.";
  // Offsets count Unicode scalars; the paragraph is plain ASCII.
  const slipAt = SLIP_PARAGRAPH.indexOf("we was");

  test("every AI lesson done for real", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await answerFromStart(page, { claude_auth_status: { configured: true } });
    await openApp(page, {
      settings: { language: "en", aiProvider: "anthropic" },
      storage: at("connect"),
    });

    const connect = lesson(page, "Connect your AI");
    await expect(connect).toContainText("Connected.");
    await connect.getByRole("button", { name: "Continue" }).click();
    expect(await savedProgress(page)).toMatchObject({ aiMode: "live" });

    // The AI panel, opened with its shortcut.
    const panel = lesson(page, "The AI panel");
    await expect(panel).toContainText("Press Ctrl+Shift+L to open the panel.");
    await expect(panel).not.toContainText("Connect an AI later");
    await expect(
      panel.getByRole("button", { name: "Continue" }),
    ).toBeDisabled();
    await page.keyboard.press("Control+Shift+L");
    await panel.getByRole("button", { name: "Continue" }).click();

    // Continuation: write at the end, pause, Tab.
    await answer(page, {
      ai_complete: " Tomorrow we take the early train to Nara.",
      // Ready for the next lesson, which checks as soon as it opens.
      ai_grammar_check: [
        {
          start: slipAt + 3,
          end: slipAt + 6,
          issue: "“We” takes “were”.",
          suggestion: "were",
          original: "was",
        },
      ],
    });
    const continuation = lesson(page, "Continuation");
    await editor(page).locator("p", { hasText: "Then I went back" }).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" I was happy.");
    await expect(editor(page).locator(".ghost-text")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(editor(page)).toContainText("early train to Nara");
    await continuation.getByRole("button", { name: "Continue" }).click();

    // Grammar: the slip's paragraph is checked on arrival.
    const grammar = lesson(page, "Grammar check");
    const underline = editor(page).locator(".grammar-issue");
    await expect(underline).toHaveText("was");
    await underline.hover();
    await page.locator(".grammar-popover-apply").click();
    await expect(editor(page)).toContainText("we were too tired");
    await grammar.getByRole("button", { name: "Continue" }).click();

    // Revision: a paragraph reworked, then decided.
    await answer(page, {
      ai_agent_message: [
        { kind: "User", text: "Make it more vivid" },
        {
          kind: "ToolCall",
          call_id: "r1",
          name: "propose_edit",
          arguments: JSON.stringify({
            action: "replace",
            anchor: DAY_THREE,
            text: VIVID,
          }),
        },
        { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
        { kind: "Assistant", text: "Here's a livelier version." },
      ],
    });
    const revision = lesson(page, "Revision");
    const composer = page.locator(".agent-panel .inline-chat-input");
    await editor(page).locator("p", { hasText: "It rained" }).click({
      clickCount: 3,
    });
    await composer.fill("Make it more vivid");
    await composer.press("Enter");
    await expect(
      revision.getByRole("button", { name: "Continue" }),
    ).toBeDisabled();
    await page.locator(".review-bar-accept").click();
    await expect(editor(page)).toContainText("ducked into a tiny café");
    await revision.getByRole("button", { name: "Continue" }).click();

    // Review: a note in the margin.
    await answer(page, {
      ai_agent_message: [
        { kind: "User", text: "Any suggestions?" },
        {
          kind: "ToolCall",
          call_id: "n1",
          name: "add_comment",
          arguments: JSON.stringify({
            anchor: "The wind was loud in the bamboo grove.",
            comment: "Say what the wind sounded like.",
          }),
        },
        { kind: "ToolResult", call_id: "n1", output: "Comment added" },
        { kind: "Assistant", text: "One idea in the margin." },
      ],
    });
    const review = lesson(page, "Review");
    await composer.fill("Any suggestions for this diary?");
    await composer.press("Enter");
    await expect(page.locator(".review-anchor").first()).toBeVisible();
    await review.getByRole("button", { name: "Continue" }).click();

    // Skills: a message sent through /tighten.
    await answer(page, {
      ai_agent_message: [
        { kind: "User", text: "/tighten" },
        { kind: "Assistant", text: "Nothing to cut." },
      ],
    });
    const skills = lesson(page, "Built-in skills");
    await composer.fill("/tighten");
    await expect(page.locator(".composer-picker")).toBeVisible();
    await composer.press("Enter");
    await composer.press("Enter");
    await expect(
      skills.getByRole("button", { name: "Continue" }),
    ).toBeEnabled();
    await skills.getByRole("button", { name: "Continue" }).click();

    // Memory: its tab.
    await answer(page, {
      load_agent_workspace: {
        instructions: ["- Keep the diary in the first person"],
        project_instructions: "",
        skills: [],
        root: "/notes",
        style: "---\nconventions: en\n---\n# Style\n\n- Short sentences\n",
        library: [],
      },
    });
    const memory = lesson(page, "Grows over time");
    await page.locator("#agent-tab-memory").click();
    await expect(page.locator(".agent-panel-memory")).toBeVisible();
    await memory.getByRole("button", { name: "Continue" }).click();

    await expect(lesson(page, "All done")).toBeVisible();
  });

  test("grammar lets the learner on when the AI finds nothing", async ({
    page,
  }) => {
    await page.clock.install();
    await openApp(page, {
      settings: { language: "en", aiProvider: "anthropic" },
      storage: at("grammar", { aiMode: "live" }),
    });
    await answer(page, { ai_grammar_check: [] });
    const grammar = lesson(page, "Grammar check");
    await expect(
      grammar.getByRole("button", { name: "Continue" }),
    ).toBeDisabled();
    await page.clock.runFor(20_000);
    await expect(grammar).toContainText(
      "The AI found nothing to fix this time.",
    );
    await expect(
      grammar.getByRole("button", { name: "Continue" }),
    ).toBeEnabled();
  });

  test("a provider error shows as usual and the lesson can be skipped", async ({
    page,
  }) => {
    await openApp(page, {
      settings: { language: "en", aiProvider: "anthropic" },
      storage: at("review", { aiMode: "live" }),
    });
    await answer(page, {
      ai_agent_message: { __reject: "The provider is unavailable." },
    });
    await page.keyboard.press("Control+Shift+L");
    const composer = page.locator(".agent-panel .inline-chat-input");
    await composer.fill("Any suggestions?");
    await composer.press("Enter");
    await expect(page.locator(".agent-panel")).toContainText(
      "The provider is unavailable.",
    );
    const review = lesson(page, "Review");
    await review.getByRole("button", { name: "Skip this step" }).click();
    await expect(lesson(page, "Built-in skills")).toBeVisible();
  });
});

test("Help › Video Tutorials opens the page in the UI's language", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "ja" } });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-tutorials"),
  );
  await expect
    .poll(async () => (await opened(page)).at(-1))
    .toEqual({
      cmd: "open_tutorials_page",
      language: "ja",
      clip: null,
    });
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("lessons fit the screen; the connect lesson can be skipped", async ({
    page,
  }) => {
    await openPhone(page, { storage: at("sidebar-export") });
    const sidebar = lesson(page, "Sidebar and export");
    await expect(sidebar).toContainText("Open Sidebar from the menu");
    const box = (await sidebar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.viewport.width);
    await sidebar.getByRole("button", { name: "Skip this step" }).tap();

    const connect = lesson(page, "Connect your AI");
    const connectBox = (await connect.boundingBox())!;
    expect(connectBox.x + connectBox.width).toBeLessThanOrEqual(
      PHONE.viewport.width,
    );
    await connect.getByRole("button", { name: "Skip for now" }).tap();

    const panel = lesson(page, "The AI panel");
    await expect(panel).toContainText("Tap the AI panel button at the top");
    await panel.getByRole("button", { name: "Continue" }).tap();
    await expect(lesson(page, "Continuation")).toContainText(
      "tap the gray text to accept",
    );
  });
});

test("a key pasted into the connect lesson connects the provider", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", aiProvider: "openai" },
    storage: at("connect"),
  });
  const connect = lesson(page, "Connect your AI");
  await connect.getByRole("button", { name: "API Key" }).click();
  await connect.getByPlaceholder("sk-…").fill("sk-test");
  // As the backend answers once the key is stored.
  await mockInvoke(page, {
    codex_auth_status: { configured: false },
    provider_api_key_status: true,
  });
  await connect.getByRole("button", { name: "Save" }).click();
  await expect(connect).toContainText("Connected.");
  await connect.getByRole("button", { name: "Continue" }).click();
  // Connected, the AI lessons are done rather than watched.
  await expect(
    lesson(page, "The AI panel").getByRole("button", { name: "Continue" }),
  ).toBeDisabled();
});
