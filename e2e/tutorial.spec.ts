import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, openPhone, PHONE } from "./helpers";

// The first-run tour end to end: Markdown typed for real on reading notes
// about a classic, the window around the editor, the connect lesson, then
// the Textus AI lessons - watched when no AI is connected, done for real
// (against canned answers from the dev shim) when one is. The AI only ever
// works on the learner's notes, never on the quoted classic.

/** The copy the tour shows, as the learner reads it (src/i18n/locales). */
const UI = {
  en: {
    appMenu: "Menu",
    menuView: "View",
    menuToggleSidebar: "Sidebar",
    tutorialStart: "Start",
    tutorialNext: "Continue",
    tutorialSkipStep: "Skip this step",
    tutorialConnectSkip: "Skip for now",
    tutorialConnected: "Connected.",
    tutorialConnectTitle: "Connect your AI",
    tutorialWysiwygTitle: "What you see is what you get",
    tutorialMarksTitle: "Bold, quotes, code and links",
    tutorialTableTitle: "Tables",
    tutorialBlocksTitle: "Formulas and diagrams",
    tutorialSidebarTitle: "Sidebar and export",
    tutorialWriteTitle: "AI writing",
    tutorialReviewTitle: "Review",
    tutorialRevisionTitle: "Revision",
    tutorialGrammarTitle: "Grammar check",
    tutorialContinuationTitle: "Continuation",
    tutorialSkillsTitle: "Built-in skills",
    tutorialDoneTitle: "All done",
    tutorialWatchNote: "Connect an AI later in",
    tutorialDoneMemory:
      "Textus AI remembers your requirements and style over time; see the Memory tab in the AI panel.",
  },
  zh: {
    appMenu: "菜单",
    menuView: "视图",
    menuToggleSidebar: "侧边栏",
    tutorialStart: "开始",
    tutorialNext: "继续",
    tutorialSkipStep: "跳过此步",
    tutorialConnectSkip: "暂时跳过",
    tutorialConnected: "已连接。",
    tutorialConnectTitle: "连接你的 AI",
    tutorialWysiwygTitle: "所见即所得",
    tutorialMarksTitle: "加粗、引用、代码和链接",
    tutorialTableTitle: "表格",
    tutorialBlocksTitle: "公式与图表",
    tutorialSidebarTitle: "侧边栏与导出",
    tutorialWriteTitle: "AI 写作",
    tutorialReviewTitle: "审阅",
    tutorialRevisionTitle: "修订",
    tutorialGrammarTitle: "语法检查",
    tutorialContinuationTitle: "续写",
    tutorialSkillsTitle: "内置技能",
    tutorialDoneTitle: "完成",
    tutorialWatchNote: "之后在",
    tutorialDoneMemory:
      "Textus AI 会慢慢记住你的要求和风格，可以在 AI 面板的“记忆”里查看。",
  },
};

/** The practice notes as the tour writes them (src/onboarding/practice-notes.ts). */
const NOTES = {
  en: {
    excerpt: "To be, or not to be, that is the question:",
    firstNote:
      "Hamlet's question is not really only about whether to live or to die, if you think about it.",
    secondNote:
      "In the end, it seems to be the fear of what might come after death that is the thing that keeps him from acting.",
    slip: "Hamlet and Horatio was friends at Wittenberg.",
  },
  zh: {
    excerpt: "黛玉一见，便吃一大惊",
    firstNote:
      "这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。",
    secondNote:
      "宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。",
    slip: "宝玉说这话时笑的很开心。",
  },
};

type Lang = keyof typeof UI;

const PROGRESS = "levis-tutorial-progress";

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
  const notes = NOTES.en;
  await openApp(page, { settings: { language: "en" }, storage: at("welcome") });

  await expect(lesson(page, "Welcome to Textus")).toContainText(
    "reading notes on Hamlet",
  );
  await page.getByRole("button", { name: "Start" }).click();

  // Headings and lists, each line ticked as it is typed.
  const wysiwyg = lesson(page, t.tutorialWysiwygTitle);
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

  // The notes arrive under what was typed; the marks go in at the end.
  const marks = lesson(page, t.tutorialMarksTitle);
  await expect(editor(page)).toContainText("My notes");
  await expect(editor(page).locator("blockquote").first()).toContainText(
    "To be, or not to be",
  );
  await expect(editor(page).locator("h1")).toHaveCount(1);
  // The classic's own quote doesn't count as the learner's.
  await expect(ticked(marks)).toHaveCount(0);
  await newLineAtEnd(page);
  await typeLines(page, [
    "Horatio is **loyal** and *calm*.",
    "> Something is rotten in the state of Denmark.",
    "",
    "Read `Act I` again.",
  ]);
  await page.keyboard.type("[Gutenberg](https://gutenberg.org)");
  await expect(editor(page).locator("a", { hasText: "Gutenberg" })).toHaveCount(
    1,
  );
  await expect(ticked(marks)).toHaveCount(4);
  await marks.getByRole("button", { name: "Continue" }).click();

  // A table from one typed line.
  const table = lesson(page, t.tutorialTableTitle);
  await newLineAtEnd(page);
  await page.keyboard.type("| Character | Impression |");
  await page.keyboard.press("Enter");
  await expect(ticked(table)).toHaveCount(1);
  await page.keyboard.type("Hamlet");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Torn");
  await expect(editor(page).locator("table")).toContainText("Torn");
  await expect(ticked(table)).toHaveCount(2);
  await table.getByRole("button", { name: "Continue" }).click();

  // Formulas and diagrams are optional.
  const blocks = lesson(page, t.tutorialBlocksTitle);
  await expect(blocks).toContainText("```mermaid");
  await blocks.getByRole("button", { name: "Continue" }).click();

  // A writing mode and a theme, from the card's own controls.
  const modes = lesson(page, "Writing modes and themes");
  await modes.getByRole("button", { name: "Zen Mode" }).click();
  await expect(modes.getByRole("button", { name: "Zen Mode" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await modes.getByRole("button", { name: "Zen Mode" }).click();
  await modes.getByRole("combobox", { name: "Editor theme" }).click();
  await page.getByRole("option", { name: "Paper" }).click();
  await modes.getByRole("button", { name: "Continue" }).click();

  // The sidebar, found through the menu the card names.
  const sidebar = lesson(page, t.tutorialSidebarTitle);
  await expect(sidebar).toContainText(
    "Click the menu ☰ at the top left, choose View › Sidebar (Ctrl+\\)",
  );
  await page.getByRole("button", { name: t.appMenu, exact: true }).click();
  await page.getByRole("menuitem", { name: t.menuView }).click();
  await expect(
    page.getByRole("menuitemcheckbox", {
      name: new RegExp(t.menuToggleSidebar),
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // The item goes through Rust, which sends the window this event back.
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-toggle-sidebar"),
  );
  await page.getByRole("button", { name: "Outline" }).click();
  await expect(page.locator(".sidebar")).toContainText("My notes");
  await sidebar.getByRole("button", { name: "Continue" }).click();

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
    [t.tutorialReviewTitle, "review", "Review", "Comment on my notes"],
    [t.tutorialRevisionTitle, "revision", "Revise", "Make it more concise"],
    [t.tutorialGrammarTitle, "grammar", null, notes.slip],
    [t.tutorialContinuationTitle, "continuation", null, "What really stops"],
    [t.tutorialSkillsTitle, "skills", "Revise", "/tighten"],
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
    if (modeName) await expect(mode).toHaveText(modeName);
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
  await openApp(page, { storage: at("marks") });
  const marks = lesson(page, zh.tutorialMarksTitle);
  await expect(marks).toContainText("下面是你的第三回笔记");
  await expect(marks).toContainText("`第三回` 值得重读。");
  await expect(editor(page).locator("h1")).toContainText("《红楼梦》读书笔记");
  await expect(editor(page).locator("blockquote").first()).toContainText(
    "倒象在那里见过一般",
  );
  await expect(editor(page)).toContainText("我的笔记");
  await marks.getByRole("button", { name: /观看动画/ }).click();
  await expect
    .poll(async () => (await opened(page)).at(-1))
    .toEqual({ cmd: "open_tutorials_page", language: "zh", clip: "wysiwyg" });
});

test("a tour from the first guide resumes at the nearest lesson", async ({
  page,
}) => {
  // The first guide's document-editing lesson was in its AI chapter, which
  // ran on scripted replies: this one starts that chapter by asking.
  await openApp(page, {
    settings: { language: "en" },
    storage: at("agentEdit"),
  });
  await expect(lesson(page, "Connect your AI")).toBeVisible();
});

test("the last tour's AI panel lesson resumes at AI writing", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: at("ai-panel", { aiMode: "watch" }),
  });
  await expect(lesson(page, "AI writing")).toBeVisible();
});

test("an AI lesson resumes in the mode it was left in", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: at("review", { aiMode: "watch" }),
  });
  const review = lesson(page, "Review");
  await expect(review).toContainText("Connect an AI later");
  // The notes are back in the new practice tab.
  await expect(editor(page)).toContainText("My notes");
});

/** What one language's live run types and what the canned AI answers. */
interface LiveRun {
  lang: Lang;
  mode: { label: string; write: string; review: string; revise: string };
  write: { prompt: string; text: string };
  review: { prompt: string; comment: string };
  revise: { prompt: string; text: string };
  grammar: { wrong: string; right: string; issue: string };
  continuation: { typed: string; text: string };
  skill: string;
}

const LIVE: LiveRun[] = [
  {
    lang: "en",
    mode: { label: "Mode", write: "Write", review: "Review", revise: "Revise" },
    write: {
      prompt: "Continue my notes with one more paragraph",
      text: "Hamlet thinks where others would act; the question itself becomes his way of waiting.",
    },
    review: {
      prompt: "Comment on my notes",
      comment:
        "Say which reading you take: life and death, or acting and not acting.",
    },
    revise: {
      prompt: "Make it more concise",
      text: "Hamlet's question is not only whether to live or die.",
    },
    grammar: {
      wrong: "was",
      right: "were",
      issue: "“Hamlet and Horatio” takes “were”.",
    },
    continuation: {
      typed: "What really stops Hamlet is",
      text: " the fear of what comes after.",
    },
    skill: "/tighten",
  },
  {
    lang: "zh",
    mode: { label: "模式", write: "写作", review: "审阅", revise: "修订" },
    write: {
      prompt: "接着我的笔记再写一段",
      text: "黛玉觉得眼熟，宝玉说曾见过，两人一见如故，正是木石前盟在今生的回响。",
    },
    review: {
      prompt: "评一评我的笔记",
      comment: "可以点明“前世姻缘”具体指第一回的哪段情节。",
    },
    revise: {
      prompt: "改得更简洁",
      text: "这一句呼应第一回的前世姻缘，是全书爱情线的起点。",
    },
    grammar: { wrong: "的", right: "得", issue: "补语前应用“得”。" },
    continuation: { typed: "宝玉和黛玉的缘分", text: "，早在第一回就已写定。" },
    skill: "/精简",
  },
];

test.describe("connected", () => {
  for (const run of LIVE) {
    test(`every AI lesson done for real, in ${run.lang}`, async ({ page }) => {
      test.setTimeout(90_000);
      const t = UI[run.lang];
      const notes = NOTES[run.lang];
      const { firstNote, secondNote, excerpt } = notes;
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
      await expect(mode).toHaveText(run.mode.write);
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

      // Review: a note in the margin, on the learner's notes.
      const review = lesson(page, t.tutorialReviewTitle);
      await expect(mode).toHaveText(run.mode.review);
      await answer(page, {
        ai_agent_message: agentReply(
          run.review.prompt,
          "add_comment",
          { anchor: firstNote, comment: run.review.comment },
          "OK",
        ),
      });
      await composer(page).fill(run.review.prompt);
      await composer(page).press("Enter");
      await expect(page.locator(".review-anchor").first()).toBeVisible();
      await expectCardClearOf(page, ".review-note");
      await next(review).click();

      // Revision: the notes' first sentence reworked, then decided.
      const revision = lesson(page, t.tutorialRevisionTitle);
      await expect(mode).toHaveText(run.mode.revise);
      await answer(page, {
        ai_agent_message: agentReply(
          run.revise.prompt,
          "propose_edit",
          { action: "replace", anchor: firstNote, text: run.revise.text },
          "OK",
        ),
      });
      await editor(page)
        .locator("p", { hasText: firstNote.slice(0, 12) })
        .click({ clickCount: 3 });
      await composer(page).fill(run.revise.prompt);
      await composer(page).press("Enter");
      await expect(next(revision)).toBeDisabled();
      await expectCardClearOf(
        page,
        ".pending-edit, .pending-delete, .review-note, .review-bar",
      );
      await page.locator(".review-bar-accept").click();
      await expect(editor(page)).toContainText(run.revise.text);
      await next(revision).click();

      // Grammar: the learner types the sentence with the slip.
      const grammar = lesson(page, t.tutorialGrammarTitle);
      await expect(grammar).toContainText(notes.slip);
      // Offsets count Unicode scalars.
      const slipAt = Array.from(
        notes.slip.slice(0, notes.slip.indexOf(run.grammar.wrong)),
      ).length;
      await answer(page, {
        ai_grammar_check: [
          {
            start: slipAt,
            end: slipAt + Array.from(run.grammar.wrong).length,
            issue: run.grammar.issue,
            suggestion: run.grammar.right,
            original: run.grammar.wrong,
          },
        ],
      });
      await newLineAtEnd(page);
      await page.keyboard.type(notes.slip);
      await expect(ticked(grammar)).toHaveCount(1);
      const underline = editor(page).locator(".grammar-issue");
      await expect(underline).toHaveText(run.grammar.wrong);
      await expectCardClearOf(page, ".grammar-issue");
      await underline.hover();
      await page.locator(".grammar-popover-apply").click();
      await expect(editor(page)).toContainText(
        notes.slip.replace(run.grammar.wrong, run.grammar.right),
      );
      await next(grammar).click();

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

      // Skills: a note selected, a message sent through the skill.
      const skills = lesson(page, t.tutorialSkillsTitle);
      await expect(mode).toHaveText(run.mode.revise);
      await answer(page, {
        ai_agent_message: [
          { kind: "User", text: run.skill },
          { kind: "Assistant", text: "OK" },
        ],
      });
      await editor(page)
        .locator("p", { hasText: secondNote.slice(0, 12) })
        .click({ clickCount: 3 });
      await composer(page).fill(run.skill);
      await expect(page.locator(".composer-picker")).toBeVisible();
      await composer(page).press("Enter");
      await composer(page).press("Enter");
      await expect(next(skills)).toBeEnabled();
      await next(skills).click();

      await expect(lesson(page, t.tutorialDoneTitle)).toContainText(
        t.tutorialDoneMemory,
      );
      // Each lesson's request went out in its own mode.
      expect(await sentModes(page)).toEqual([
        "write",
        "review",
        "revise",
        "revise",
      ]);
      // And the classic is as it was quoted.
      await expect(editor(page).locator("blockquote").first()).toContainText(
        excerpt,
      );
    });
  }

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
    const next = grammar.getByRole("button", { name: "Continue" });
    await expect(next).toBeDisabled();
    await newLineAtEnd(page);
    await page.keyboard.type(NOTES.en.slip);
    await expect(ticked(grammar)).toHaveCount(1);
    await page.clock.runFor(20_000);
    await expect(grammar).toContainText(
      "The AI found nothing to fix this time.",
    );
    await expect(next).toBeEnabled();
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
    await composer(page).fill("Comment on my notes");
    await composer(page).press("Enter");
    await expect(page.locator(".agent-panel")).toContainText(
      "The provider is unavailable.",
    );
    const review = lesson(page, "Review");
    await review.getByRole("button", { name: "Skip this step" }).click();
    await expect(lesson(page, "Revision")).toBeVisible();
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
    await openPhone(page, { storage: at("sidebar-export") });
    const sidebar = lesson(page, "Sidebar and export");
    await expect(sidebar).toContainText("Tap the menu ☰ at the top left");
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

    const write = lesson(page, "AI writing");
    await expect(write).toContainText("tap the quill icon at the top");
    for (const title of ["AI writing", "Review", "Revision"])
      await lesson(page, title).getByRole("button", { name: "Continue" }).tap();
    await expect(lesson(page, "Grammar check")).toContainText(
      "tap it, and tap Apply",
    );
    await lesson(page, "Grammar check")
      .getByRole("button", { name: "Continue" })
      .tap();
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
