import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, openPhone, PHONE } from "./helpers";

// The first-run tour end to end. The AI lessons are watched with no AI and
// done for real against canned answers with one; the AI only ever works on
// the learner's notes, never on the quoted classic.

/** The copy the tour shows, as the learner reads it. */
const UI = {
  en: {
    tutorialStart: "Start",
    tutorialNext: "Continue",
    tutorialSkipStep: "Skip this step",
    tutorialConnectSkip: "Skip for now",
    tutorialConnected: "Connected.",
    tutorialConnectTitle: "Connect your AI",
    tutorialWysiwygTitle: "What you see is what you get",
    tutorialWriteTitle: "AI writing",
    tutorialContinuationTitle: "Continuation",
    tutorialDoneTitle: "All done",
    tutorialWatchNote: "Connect an AI later in",
    tutorialDoneMemory:
      "Textus AI remembers your requirements and style over time; see the Project tab in the AI panel.",
  },
  zh: {
    tutorialStart: "开始",
    tutorialNext: "继续",
    tutorialSkipStep: "跳过此步",
    tutorialConnectSkip: "暂时跳过",
    tutorialConnected: "已连接。",
    tutorialConnectTitle: "连接你的 AI",
    tutorialWysiwygTitle: "所见即所得",
    tutorialWriteTitle: "AI 写作",
    tutorialContinuationTitle: "续写",
    tutorialDoneTitle: "完成",
    tutorialWatchNote: "之后在",
    tutorialDoneMemory:
      "Textus AI 会慢慢记住你的要求和风格，可以在 AI 面板的“项目”里查看。",
  },
};

/** The practice notes as the tour writes them. */
const NOTES = {
  en: {
    excerpt: "To be, or not to be, that is the question:",
  },
  zh: {
    excerpt: "黛玉一见，便吃一大惊",
  },
};

type Lang = keyof typeof UI;

const PROGRESS = "textus-tutorial-progress";

const at = (stepId: string, extra: Record<string, unknown> = {}) => ({
  [PROGRESS]: JSON.stringify({ active: true, stepId, tabId: null, ...extra }),
});

/** The lesson on screen, by its title. */
const lesson = (page: Page, title: string) =>
  page.getByRole("dialog", { name: title });

const editor = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

const composer = (page: Page) =>
  page.locator(".agent-panel .inline-chat-input");

/** The ticked lines of a lesson's card. */
const ticked = (card: ReturnType<typeof lesson>) =>
  card.locator(".tutorial-task-line.is-complete");

/** What the tour opened in the browser (the dev shim's record). */
const opened = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __devLinks?: unknown[] }).__devLinks ?? [],
  );

/** The modes the AI panel's messages went out in. */
const sentModes = (page: Page) =>
  page.evaluate(() =>
    (
      (
        window as unknown as {
          __devInvokeCalls?: { cmd: string; mode?: string }[];
        }
      ).__devInvokeCalls ?? []
    )
      .filter((call) => call.cmd === "ai_agent_message")
      .map((call) => call.mode),
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

/** A new paragraph at the very end of the document, the caret in it. */
async function newLineAtEnd(page: Page) {
  // The caret put there directly: a click can land on the card or a margin
  // note, and Ctrl+End then moves nothing.
  await editor(page).focus();
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const paragraphs = root.querySelectorAll(":scope > p");
    const last = paragraphs[paragraphs.length - 1];
    const range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
}

/** Types each line, Enter after each; an empty one is Enter on its own
 *  (leaving a list or a quote). */
async function typeLines(page: Page, lines: string[]) {
  for (const line of lines) {
    if (line) await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
}

/** Whether the lesson card leaves every `selector` on screen uncovered: it
 *  moves off what the lesson is about once the pointer is off it. */
async function expectCardClearOf(page: Page, selector: string) {
  await page.mouse.move(4, 300);
  await expect
    .poll(() =>
      page.evaluate((sel) => {
        const card = document
          .querySelector(".tutorial-card")!
          .getBoundingClientRect();
        return Array.from(document.querySelectorAll(sel)).flatMap((el) =>
          Array.from(el.getClientRects()).filter(
            (r) =>
              r.width > 0 &&
              r.right > card.left &&
              r.left < card.right &&
              r.bottom > card.top &&
              r.top < card.bottom,
          ),
        ).length;
      }, selector),
    )
    .toBe(0);
}

function agentReply(prompt: string, tool: string, args: object, said: string) {
  return [
    { kind: "User", text: prompt },
    {
      kind: "ToolCall",
      call_id: "c1",
      name: tool,
      arguments: JSON.stringify(args),
    },
    {
      kind: "ToolResult",
      call_id: "c1",
      output: tool === "add_comment" ? "Comment added" : "Edit proposed",
    },
    { kind: "Assistant", text: said },
  ];
}

test("the whole tour, typed, with the AI lessons watched", async ({ page }) => {
  const t = UI.en;
  await openApp(page, { settings: { language: "en" }, storage: at("welcome") });

  await expect(lesson(page, "Welcome to Textus")).toContainText(
    "reading notes on Hamlet",
  );
  await page.getByRole("button", { name: "Start" }).click();

  // Headings and lists, each line ticked as it is typed.
  const wysiwyg = lesson(page, t.tutorialWysiwygTitle);
  // The tour is short: eight steps.
  await expect(wysiwyg).toContainText("Step 2 of 8");
  await expect(wysiwyg).toContainText("A heading: # Notes on Hamlet");
  const next = wysiwyg.getByRole("button", { name: "Continue" });
  await expect(next).toBeDisabled();
  await wysiwyg.getByRole("button", { name: /Watch the animation/ }).click();
  await editor(page).click();
  await typeLines(page, ["# Notes on Hamlet", "- Hamlet", "Horatio", ""]);
  await expect(ticked(wysiwyg)).toHaveCount(2);
  await typeLines(page, ["1. Act I", ""]);
  await page.keyboard.type("- [ ] Finish Act V");
  await expect(ticked(wysiwyg)).toHaveCount(4);
  await next.click();

  // The notes arrive under what was typed.
  await expect(editor(page)).toContainText("My notes");
  await expect(editor(page).locator("blockquote").first()).toContainText(
    "To be, or not to be",
  );
  await expect(editor(page).locator("h1")).toHaveCount(1);

  // The command palette: any command run from it ticks the line.
  const palette = lesson(page, "Command palette");
  await expect(palette).toContainText("Press Ctrl+Shift+P");
  await page.keyboard.press("Control+Shift+P");
  await expect(
    page.getByRole("dialog", { name: "Type a command…" }).getByRole("combobox"),
  ).toBeFocused();
  await page.keyboard.type("Zen Mode");
  await page.keyboard.press("Enter");
  await expect(ticked(palette)).toHaveCount(1);
  await palette.getByRole("button", { name: "Continue" }).click();

  // Plugins: a pointer to the store, Continue without going there.
  const plugins = lesson(page, "Plugins");
  await expect(plugins).toContainText("Settings › Extensions");
  await plugins.getByRole("button", { name: "Continue" }).click();

  // No AI: skip, and the AI lessons are watched.
  const connect = lesson(page, "Connect your AI");
  await expect(
    connect.getByRole("button", { name: "Sign in with OpenAI" }),
  ).toBeVisible();
  await connect.getByRole("button", { name: "Skip for now" }).click();
  expect(await savedProgress(page)).toMatchObject({
    stepId: "write",
    aiMode: "watch",
  });

  const mode = page
    .locator(".agent-panel")
    .getByRole("combobox", { name: "Mode" });
  const aiLessons: [string, string, string | null, string][] = [
    [t.tutorialWriteTitle, "ai-panel", "Write", "Continue my notes"],
    [t.tutorialContinuationTitle, "continuation", null, "What really stops"],
  ];
  for (const [title, clip, modeName, says] of aiLessons) {
    const card = lesson(page, title);
    // What to do is still spelled out; watching is an extra.
    await expect(card).toContainText(says);
    await expect(card).toContainText(
      "Connect an AI later in Settings › Textus AI to try it yourself.",
    );
    await card.getByRole("button", { name: /Watch the animation/ }).click();
    await expect
      .poll(async () => (await opened(page)).at(-1))
      .toEqual({ cmd: "open_tutorials_page", language: "en", clip });
    if (clip === "ai-panel") {
      // The panel itself still opens, connected or not.
      await page.keyboard.press("Control+Shift+L");
      await expect(page.locator(".agent-panel")).toBeVisible();
    }
    // Each lesson puts the panel in the mode it needs.
    if (modeName)
      await expect(mode.locator(".mode-picker-value")).toHaveText(modeName);
    await card.getByRole("button", { name: "Continue" }).click();
  }

  const done = lesson(page, "All done");
  await expect(done).toContainText(
    "Textus AI remembers your requirements and style over time",
  );
  await done.getByRole("button", { name: "Video Tutorials" }).click();
  await done.getByRole("button", { name: "Join the Community" }).click();
  const links = await opened(page);
  expect(links.slice(-2)).toEqual([
    { cmd: "open_tutorials_page", language: "en", clip: null },
    { cmd: "open_community_page", language: "en" },
  ]);
  await done.getByRole("button", { name: "Start writing" }).click();
  await expect(page.locator(".tutorial-surface")).toHaveCount(0);
  expect(await savedProgress(page)).toMatchObject({ active: false });
});

test("in Chinese: the notes, the copy and the links follow the language", async ({
  page,
}) => {
  const zh = UI.zh;
  await openApp(page, { storage: at("wysiwyg") });
  const wysiwyg = lesson(page, zh.tutorialWysiwygTitle);
  await expect(wysiwyg).toContainText("# 《红楼梦》读书笔记");
  await wysiwyg.getByRole("button", { name: /观看动画/ }).click();
  await expect
    .poll(async () => (await opened(page)).at(-1))
    .toEqual({ cmd: "open_tutorials_page", language: "zh", clip: "wysiwyg" });
  await wysiwyg.getByRole("button", { name: zh.tutorialSkipStep }).click();
  await expect(editor(page)).toContainText("我的笔记");
  await expect(editor(page).locator("blockquote").first()).toContainText(
    "倒象在那里见过一般",
  );
});

test("an AI lesson resumes in the mode it was left in", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: at("continuation", { aiMode: "watch" }),
  });
  const continuation = lesson(page, "Continuation");
  await expect(continuation).toContainText("Connect an AI later");
  // The notes are back in the new practice tab.
  await expect(editor(page)).toContainText("My notes");
});

/** What one language's live run types and what the canned AI answers. */
interface LiveRun {
  lang: Lang;
  mode: { label: string; write: string; review: string };
  write: { prompt: string; text: string };
  continuation: { typed: string; text: string };
}

const LIVE: LiveRun[] = [
  {
    lang: "en",
    mode: { label: "Mode", write: "Write", review: "Review" },
    write: {
      prompt: "Continue my notes with one more paragraph",
      text: "Hamlet thinks where others would act; the question itself becomes his way of waiting.",
    },
    continuation: {
      typed: "What really stops Hamlet is",
      text: " the fear of what comes after.",
    },
  },
  {
    lang: "zh",
    mode: { label: "模式", write: "写作", review: "审阅" },
    write: {
      prompt: "接着我的笔记再写一段",
      text: "黛玉觉得眼熟，宝玉说曾见过，两人一见如故，正是木石前盟在今生的回响。",
    },
    continuation: { typed: "宝玉和黛玉的缘分", text: "，早在第一回就已写定。" },
  },
];

test.describe("connected", () => {
  for (const run of LIVE) {
    test(`every AI lesson done for real, in ${run.lang}`, async ({ page }) => {
      test.setTimeout(90_000);
      const t = UI[run.lang];
      const notes = NOTES[run.lang];
      const { excerpt } = notes;
      const next = (card: ReturnType<typeof lesson>) =>
        card.getByRole("button", { name: t.tutorialNext });
      const mode = page
        .locator(".agent-panel")
        .getByRole("combobox", { name: run.mode.label });

      await page.setViewportSize({ width: 1440, height: 900 });
      await answerFromStart(page, { claude_auth_status: { configured: true } });
      await openApp(page, {
        settings: { language: run.lang, aiProvider: "anthropic" },
        storage: at("connect"),
      });

      const connect = lesson(page, t.tutorialConnectTitle);
      await expect(connect).toContainText(t.tutorialConnected);
      await next(connect).click();
      expect(await savedProgress(page)).toMatchObject({ aiMode: "live" });

      // AI writing: the panel opened, in Write mode; the new text accepted.
      const write = lesson(page, t.tutorialWriteTitle);
      await expect(write).not.toContainText(t.tutorialWatchNote);
      await expect(next(write)).toBeDisabled();
      await page.keyboard.press("Control+Shift+L");
      await expect(ticked(write)).toHaveCount(1);
      await expect(mode.locator(".mode-picker-value")).toHaveText(
        run.mode.write,
      );
      await answer(page, {
        ai_agent_message: agentReply(
          run.write.prompt,
          "propose_edit",
          { action: "append", text: run.write.text },
          "OK",
        ),
      });
      await composer(page).fill(run.write.prompt);
      await composer(page).press("Enter");
      await expect(editor(page).locator(".pending-insert")).toContainText(
        run.write.text,
      );
      // The card never hides the new text or the bar that takes it.
      await expectCardClearOf(page, ".pending-insert, .review-bar");
      await page.locator(".review-bar-accept").click();
      await expect(editor(page)).toContainText(run.write.text);
      await next(write).click();

      // Continuation: type at the end, pause, Tab.
      const continuation = lesson(page, t.tutorialContinuationTitle);
      await answer(page, { ai_complete: run.continuation.text });
      await newLineAtEnd(page);
      await page.keyboard.type(run.continuation.typed);
      await expect(editor(page).locator(".ghost-text")).toBeVisible();
      await expectCardClearOf(page, ".ghost-text");
      await page.keyboard.press("Tab");
      await expect(editor(page)).toContainText(
        run.continuation.typed + run.continuation.text,
      );
      await next(continuation).click();

      await expect(lesson(page, t.tutorialDoneTitle)).toContainText(
        t.tutorialDoneMemory,
      );
      // The request went out in Write mode.
      expect(await sentModes(page)).toEqual(["write"]);
      // And the classic is as it was quoted.
      await expect(editor(page).locator("blockquote").first()).toContainText(
        excerpt,
      );
    });
  }

  test("a provider error shows as usual and the lesson can be skipped", async ({
    page,
  }) => {
    await openApp(page, {
      settings: { language: "en", aiProvider: "anthropic" },
      storage: at("write", { aiMode: "live" }),
    });
    await answer(page, {
      ai_agent_message: { __reject: "The provider is unavailable." },
    });
    await page.keyboard.press("Control+Shift+L");
    await composer(page).fill("Continue my notes");
    await composer(page).press("Enter");
    await expect(page.locator(".agent-panel")).toContainText(
      "The provider is unavailable.",
    );
    const write = lesson(page, "AI writing");
    await write.getByRole("button", { name: "Skip this step" }).click();
    await expect(lesson(page, "Continuation")).toBeVisible();
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

  test("lessons fit the screen and speak of taps", async ({ page }) => {
    await openPhone(page, { storage: at("palette") });
    // No shortcut on a phone: the palette is a tip there.
    const palette = lesson(page, "Command palette");
    await expect(palette).toContainText("On a computer");
    const box = (await palette.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.viewport.width);
    await palette.getByRole("button", { name: "Continue" }).tap();
    await lesson(page, "Plugins")
      .getByRole("button", { name: "Continue" })
      .tap();

    const connect = lesson(page, "Connect your AI");
    const connectBox = (await connect.boundingBox())!;
    expect(connectBox.x + connectBox.width).toBeLessThanOrEqual(
      PHONE.viewport.width,
    );
    await connect.getByRole("button", { name: "Skip for now" }).tap();

    const write = lesson(page, "AI writing");
    await expect(write).toContainText("tap the quill icon at the top");
    await write.getByRole("button", { name: "Continue" }).tap();
    await expect(lesson(page, "Continuation")).toContainText(
      "tap the gray text",
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
    lesson(page, "AI writing").getByRole("button", { name: "Continue" }),
  ).toBeDisabled();
});
