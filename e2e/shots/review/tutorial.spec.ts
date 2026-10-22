import { expect, test, type Page } from "@playwright/test";
import { openApp, openPhone, PHONE } from "../../helpers";

// Screenshots of the first-run tour, for review rather than as a baseline:
// every step in Chinese on the desktop (light), the AI lessons both watched
// and done for real (against canned answers), and a few in English, dark
// and on a phone. Runs only with TEXTUS_SHOTS_DIR set to where they go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/tutorial-v3 npm run screenshots:review -- tutorial

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");
test.setTimeout(240_000);

const at = (stepId: string, extra: Record<string, unknown> = {}) => ({
  "textus-tutorial-progress": JSON.stringify({
    active: true,
    stepId,
    tabId: null,
    ...extra,
  }),
});

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

const zh = UI.zh;
const zhNotes = NOTES.zh;

const editor = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');
const card = (page: Page) => page.locator(".tutorial-surface");
const composer = (page: Page) =>
  page.locator(".agent-panel .inline-chat-input");

async function shot(page: Page, name: string) {
  await page.mouse.move(2, 400);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

async function answer(page: Page, results: Record<string, unknown>) {
  await page.evaluate((r) => {
    const w = window as unknown as { __devInvokeResults?: object };
    w.__devInvokeResults = { ...w.__devInvokeResults, ...r };
  }, results);
}

async function next(page: Page, label = zh.tutorialNext) {
  await card(page).getByRole("button", { name: label, exact: true }).click();
}

/** A new paragraph at the very end of the document, the caret in it. */
async function newLineAtEnd(page: Page) {
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
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
}

async function typeLines(page: Page, lines: string[]) {
  for (const line of lines) {
    if (line) await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
}

function agentReply(prompt: string, tool: string, args: object) {
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
    { kind: "Assistant", text: "好的。" },
  ];
}

test("zh desktop light: every step, AI watched", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { storage: at("welcome") });
  await shot(page, "zh-01-welcome");
  await next(page, zh.tutorialStart);

  await editor(page).click();
  await typeLines(page, ["# 《红楼梦》读书笔记", "- 林黛玉", "贾宝玉", ""]);
  await typeLines(page, ["1. 第三回", ""]);
  await page.keyboard.type("- [ ] 读完第五回");
  await shot(page, "zh-02-wysiwyg");
  await next(page);

  await expect(editor(page)).toContainText("我的笔记");
  await shot(page, "zh-03a-marks-start");
  await newLineAtEnd(page);
  await typeLines(page, [
    "黛玉**心思细腻**，宝玉*率真*。",
    "> 满纸荒唐言，一把辛酸泪",
    "",
    "`第三回` 值得重读。",
  ]);
  await page.keyboard.type("[维基文库](https://zh.wikisource.org)");
  await shot(page, "zh-03b-marks-done");
  await next(page);

  await newLineAtEnd(page);
  await page.keyboard.type("| 人物 | 印象 |");
  await page.keyboard.press("Enter");
  await page.keyboard.type("林黛玉");
  await page.keyboard.press("Tab");
  await page.keyboard.type("敏感");
  await shot(page, "zh-04-table");
  await next(page);

  await shot(page, "zh-05-blocks");
  await next(page);

  await card(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "纸张" }).click();
  await card(page).getByRole("button", { name: "禅模式" }).click();
  await shot(page, "zh-06-modes-themes");
  await card(page).getByRole("button", { name: "禅模式" }).click();
  await card(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "默认" }).click();
  await next(page);

  await shot(page, "zh-07a-sidebar-start");
  await page.getByRole("button", { name: zh.appMenu, exact: true }).click();
  await page.getByRole("menuitem", { name: zh.menuView }).click();
  await shot(page, "zh-07b-sidebar-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+\\");
  await page.getByRole("button", { name: "大纲" }).click();
  await shot(page, "zh-07c-sidebar-done");
  await page.keyboard.press("Control+\\");
  await next(page);

  await shot(page, "zh-08-connect");
  await next(page, zh.tutorialConnectSkip);

  await page.keyboard.press("Control+Shift+L");
  for (const name of [
    "09-write",
    "10-review",
    "11-revision",
    "12-grammar",
    "13-continuation",
    "14-skills",
  ]) {
    await shot(page, `zh-${name}-watch`);
    await next(page);
  }
  await shot(page, "zh-15-done");
});

test("zh desktop light: the AI lessons done for real", async ({ page }) => {
  const { firstNote, secondNote } = zhNotes;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    (window as unknown as { __devInvokeResults: object }).__devInvokeResults = {
      claude_auth_status: { configured: true },
    };
  });
  await openApp(page, {
    settings: { aiProvider: "anthropic" },
    storage: at("connect"),
  });
  await expect(card(page)).toContainText(zh.tutorialConnected);
  await shot(page, "zh-08-connect-connected");
  await next(page);

  await shot(page, "zh-09a-write-live");
  await page.keyboard.press("Control+Shift+L");
  await answer(page, {
    ai_agent_message: agentReply("接着我的笔记再写一段", "propose_edit", {
      action: "append",
      text: "黛玉觉得眼熟，宝玉说曾见过，两人一见如故，正是木石前盟在今生的回响。",
    }),
  });
  await composer(page).fill("接着我的笔记再写一段");
  await composer(page).press("Enter");
  await expect(editor(page).locator(".pending-insert")).toBeVisible();
  await shot(page, "zh-09b-write-live-proposal");
  await page.locator(".review-bar-accept").click();
  await shot(page, "zh-09c-write-live-done");
  await next(page);

  await answer(page, {
    ai_agent_message: agentReply("评一评我的笔记", "add_comment", {
      anchor: firstNote,
      comment: "可以点明“前世姻缘”具体指第一回的哪段情节。",
    }),
  });
  await composer(page).fill("评一评我的笔记");
  await composer(page).press("Enter");
  await expect(page.locator(".review-anchor").first()).toBeVisible();
  await shot(page, "zh-10-review-live");
  await next(page);

  await answer(page, {
    ai_agent_message: agentReply("改得更简洁", "propose_edit", {
      action: "replace",
      anchor: firstNote,
      text: "这一句呼应第一回的前世姻缘，是全书爱情线的起点。",
    }),
  });
  await editor(page)
    .locator("p", { hasText: firstNote.slice(0, 12) })
    .click({ clickCount: 3 });
  await composer(page).fill("改得更简洁");
  await composer(page).press("Enter");
  await expect(page.locator(".review-bar-accept")).toBeVisible();
  await shot(page, "zh-11-revision-live");
  await page.locator(".review-bar-accept").click();
  await next(page);

  const slipAt = zhNotes.slip.indexOf("的");
  await answer(page, {
    ai_grammar_check: [
      {
        start: slipAt,
        end: slipAt + 1,
        issue: "补语前应用“得”。",
        suggestion: "得",
        original: "的",
      },
    ],
  });
  await newLineAtEnd(page);
  await page.keyboard.type(zhNotes.slip);
  const underline = editor(page).locator(".grammar-issue");
  await expect(underline).toBeVisible();
  await underline.hover();
  await expect(page.locator(".grammar-popover")).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${DIR}/zh-12-grammar-live.png` });
  await page.locator(".grammar-popover-apply").click();
  await next(page);

  await answer(page, { ai_complete: "，早在第一回就已写定。" });
  await newLineAtEnd(page);
  await page.keyboard.type("宝玉和黛玉的缘分");
  await expect(editor(page).locator(".ghost-text")).toBeVisible();
  await shot(page, "zh-13-continuation-live");
  await page.keyboard.press("Tab");
  await next(page);

  await editor(page)
    .locator("p", { hasText: secondNote.slice(0, 12) })
    .click({ clickCount: 3 });
  await composer(page).fill("/精简");
  await expect(page.locator(".composer-picker")).toBeVisible();
  await shot(page, "zh-14-skills-live");
  await composer(page).fill("");
  await next(page, zh.tutorialSkipStep);
  await shot(page, "zh-15-done-live");
});

test("en desktop light and dark", async ({ page }) => {
  const en = UI.en;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    settings: { language: "en" },
    storage: at("wysiwyg"),
  });
  await shot(page, "en-02-wysiwyg");
  await next(page, en.tutorialSkipStep);
  await shot(page, "en-03-marks");
  await next(page, en.tutorialSkipStep);
  await shot(page, "en-04-table");

  await openApp(page, {
    settings: { language: "en" },
    storage: at("connect"),
    colorScheme: "dark",
  });
  await shot(page, "en-dark-08-connect");
  await next(page, en.tutorialConnectSkip);
  await page.keyboard.press("Control+Shift+L");
  await shot(page, "en-dark-09-write-watch");
  await next(page, en.tutorialNext);
  await next(page, en.tutorialNext);
  await next(page, en.tutorialNext);
  await shot(page, "en-dark-12-grammar-watch");
});

test.describe("phone", () => {
  test.use(PHONE);

  test("en on a phone", async ({ page }) => {
    const en = UI.en;
    await openPhone(page, { storage: at("welcome") });
    await shot(page, "phone-en-01-welcome");
    await next(page, en.tutorialStart);
    await shot(page, "phone-en-02-wysiwyg");
    await next(page, en.tutorialSkipStep);
    await shot(page, "phone-en-03-marks");

    await openPhone(page, { storage: at("sidebar-export") });
    await shot(page, "phone-en-07-sidebar");
    await openPhone(page, { storage: at("connect") });
    await shot(page, "phone-en-08-connect");
    await next(page, en.tutorialConnectSkip);
    await shot(page, "phone-en-09-write-watch");
  });

  test("zh on a phone: AI writing done for real", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __devInvokeResults: object }).__devInvokeResults =
        { claude_auth_status: { configured: true } };
    });
    await openPhone(page, {
      settings: { language: "zh", aiProvider: "anthropic" },
      storage: at("write", { aiMode: "live" }),
    });
    await shot(page, "phone-zh-09a-write-live");
    await page.locator(".window-bar-toggle").tap();
    await answer(page, {
      ai_agent_message: agentReply("接着我的笔记再写一段", "propose_edit", {
        action: "append",
        text: "黛玉觉得眼熟，宝玉说曾见过，两人一见如故，正是木石前盟在今生的回响。",
      }),
    });
    await composer(page).fill("接着我的笔记再写一段");
    await composer(page).press("Enter");
    await expect(editor(page).locator(".pending-insert")).toBeVisible();
    await shot(page, "phone-zh-09b-write-live-proposal");
  });

  test("zh on a phone", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
    });
    await openApp(page, { storage: at("grammar", { aiMode: "watch" }) });
    await expect(page.locator("html")).toHaveAttribute(
      "data-window-chrome",
      "mobile",
    );
    await shot(page, "phone-zh-12-grammar-watch");
    await next(page);
    await shot(page, "phone-zh-13-continuation-watch");
    await next(page);
    await next(page);
    await shot(page, "phone-zh-15-done");
  });
});
