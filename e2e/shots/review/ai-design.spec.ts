import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, openPhone, PHONE } from "../../helpers";

// Screenshots of the AI surfaces in the text - a rewrite decided sentence by
// sentence, the review bar, margin notes, the grammar card, the Memory view
// - on desktop and phone, light and dark, for review rather than as a
// baseline. The sample is a reader's own notes on a classic: the AI edits
// the notes, and the quoted original is never touched. Runs only with
// TEXTUS_SHOTS_DIR set to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/ai-design/shots npm run screenshots:review -- ai-design

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const QUOTE =
  "宝玉看罢，因笑道：“这个妹妹我曾见过的。”贾母笑道：“可又是胡说，你又何曾见过他？”";
const NOTE =
  "这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。";
const REWRITE =
  "这一句呼应第一回的前世姻缘，是全书爱情线的起点。宝玉初见黛玉便觉似曾相识，作者借这句话点明了木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。";
const DOC = `# 读《红楼梦》第三回

> ${QUOTE}

## 我的笔记

${NOTE}

黛玉必竟寄人篱下，所以步步留心，时时在意，这份小心在初见宝玉时也没有放下。

下一回读到“护官符”，再回来补这一段。
`;

const REPLY = [
  { kind: "User", text: "把我的笔记改得精简一些，再帮我看看哪里还能写深。" },
  {
    kind: "ToolCall",
    call_id: "e1",
    name: "propose_edit",
    arguments: JSON.stringify({
      action: "replace",
      anchor: NOTE,
      text: REWRITE,
      reason: "删去“其实”“可以说”“就某种意义而言”，意思不变。",
    }),
  },
  { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
  {
    kind: "ToolCall",
    call_id: "c1",
    name: "add_comment",
    arguments: JSON.stringify({
      anchor: "贾母一句“胡说”，却把这层深意轻轻带过。",
      comment: "可以补一句贾母为何要打断：她护着黛玉，也护着宝玉。",
    }),
  },
  { kind: "ToolResult", call_id: "c1", output: "Comment added" },
  {
    kind: "Assistant",
    text: "精简了你笔记里的两句，并在“胡说”那句旁留了一条批注。",
  },
];

async function paste(page: Page) {
  await page.evaluate((md) => {
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    target.focus();
    const data = new DataTransfer();
    data.setData("text/plain", md);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, DOC);
  await page.waitForTimeout(300);
}

/** The checker's finding in the notes, without a backend (the tutorial's
 *  canned-issue event). */
async function grammar(page: Page) {
  const target =
    "黛玉必竟寄人篱下，所以步步留心，时时在意，这份小心在初见宝玉时也没有放下。";
  // The event underlines the caret's paragraph.
  await page.locator(".milkdown p", { hasText: "寄人篱下" }).click();
  await page.waitForTimeout(300);
  await page.evaluate(
    (target) =>
      window.dispatchEvent(
        new CustomEvent("textus:tutorial-mock-grammar", {
          detail: {
            target,
            issues: [
              {
                start: 2,
                end: 4,
                issue: "“毕竟”是固定写法。",
                suggestion: "毕竟",
                original: "必竟",
              },
              {
                start: 21,
                end: 25,
                issue: "“这份小心”与上文重复，可省略。",
                suggestion: "这份心",
                original: "这份小心",
              },
            ],
          },
        }),
      ),
    target,
  );
}

async function ask(page: Page) {
  await mockInvoke(page, { ai_agent_message: REPLY });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("把我的笔记改得精简一些，再帮我看看哪里还能写深。");
  await composer.press("Enter");
  await expect(page.locator(".milkdown .pending-sentence")).toHaveCount(2);
}

for (const scheme of ["light", "dark"] as const) {
  test(`desktop ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, {
      storage: { "levis-agent-panel-open": "1" },
      colorScheme: scheme,
    });
    await paste(page);
    await ask(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-1.png` });
    // Keep the second sentence as written, from its card in the margin.
    await page.locator(".revision-note .pending-pick-keep").nth(1).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-2.png` });
    // Hover the note's passage: it and its card light up together.
    await page.locator(".milkdown .review-anchor").first().hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-3-note.png` });
    await grammar(page);
    await page.locator(".milkdown .grammar-issue").first().hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-5-grammar.png` });
    await page.mouse.move(5, 5);
    // A narrow window: no room for a margin, the note sits behind a badge.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(500);
    await page.locator(".review-badge").first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-4-narrow.png` });
    // The Memory tab.
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockInvoke(page, {
      ai_agent_message: REPLY,
      load_agent_workspace: {
        instructions: ["- 人名第一次出现时写全名"],
        project_instructions: "- 引用原文时一字不改\n- 笔记用短句",
        skills: [
          { name: "tighten", description: "", prompt: "", source: "builtin" },
          { name: "proofread", description: "", prompt: "", source: "builtin" },
          { name: "translate", description: "", prompt: "", source: "builtin" },
        ],
        root: "/notes/红楼梦笔记",
        style:
          "---\nconventions: zh\n---\n# 文风\n\n- 短句为主，少用“其实”“可以说”\n- 引文保持原文用字\n- 每段先下判断，再给依据\n",
        library: [
          {
            name: "林黛玉",
            aliases: ["颦儿", "潇湘妃子"],
            include: "detected",
            file: ".textus/library/林黛玉.md",
            body: "林如海之女，寄居荣国府。",
          },
          {
            name: "贾宝玉",
            aliases: ["宝二爷"],
            include: "detected",
            file: ".textus/library/贾宝玉.md",
            body: "衔玉而生，贾母最疼爱的孙子。",
          },
          {
            name: "木石前盟",
            aliases: ["绛珠草"],
            include: "detected",
            file: ".textus/library/木石前盟.md",
            body: "绛珠仙草与神瑛侍者的前世因缘。",
          },
        ],
      },
    });
    await page.locator("#agent-tab-memory").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-6-memory.png` });
  });
}

test.describe("phone", () => {
  test.use(PHONE);
  test("phone light", async ({ page }) => {
    await openPhone(page, {});
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}");
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({ ...s, language: "zh" }),
      );
    });
    await page.reload();
    await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
    await paste(page);
    await page.locator(".window-bar-toggle, .phone-ai-button").first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/phone-1-sheet.png` });
    await ask(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DIR}/phone-2-review.png` });
    await page.locator(".review-bar-reject, .review-bar-button").last().click();
    await page.waitForTimeout(400);
    await page.locator(".review-badge").first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/phone-3-note.png` });
    await page.locator(".bottom-card-primary").click();
    await page.waitForTimeout(400);
    await grammar(page);
    await page.locator(".milkdown .grammar-issue").first().tap();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/phone-4-grammar.png` });
  });
});

// The same surfaces under other themes: a built-in one in each appearance,
// and an imported Typora theme - the margin, the bar and the panel take the
// theme's colours with the document.
for (const [themeId, scheme] of [
  ["parchment", "light"],
  ["slate", "dark"],
] as const) {
  test(`theme ${themeId} ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, {
      storage: { "levis-agent-panel-open": "1" },
      settings: { themeId },
      colorScheme: scheme,
    });
    await paste(page);
    await ask(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/theme-${themeId}-${scheme}.png` });
  });
}

test("theme imported typora", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(
    new URL("../../fixtures/themes/newsprint-like.css", import.meta.url),
    "utf8",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { storage: { "levis-agent-panel-open": "1" } });
  // Apply the theme's derived chrome the way an import does.
  await page.evaluate(async (css) => {
    // The dev server's own module, as the app loads it.
    const url = "/src/theme/theme-chrome.ts";
    const mod = (await import(/* @vite-ignore */ url)) as {
      applyThemeChrome: (css: string, dark: boolean) => void;
    };
    const style = document.createElement("style");
    style.id = "test-typora";
    style.textContent = css;
    document.head.appendChild(style);
    document.documentElement.setAttribute("data-user-theme", "");
    mod.applyThemeChrome(css, false);
  }, css);
  await paste(page);
  await ask(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/theme-typora-newsprint.png` });
});

// The four revision displays (Settings > revision display), as Word's
// markup views, each with the second sentence kept.
for (const revisionDisplay of ["inline", "original", "new", "final"]) {
  test(`revision display ${revisionDisplay}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, {
      storage: { "levis-agent-panel-open": "1" },
      settings: { revisionDisplay },
    });
    await paste(page);
    await mockInvoke(page, { ai_agent_message: REPLY.slice(0, 3) });
    const composer = page.locator(".agent-panel-view textarea");
    await composer.fill("精简");
    await composer.press("Enter");
    await expect(page.locator(".agent-proposal")).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/display-${revisionDisplay}-1.png` });
    await page
      .locator(".agent-proposal-pick .pending-pick-keep")
      .nth(1)
      .click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/display-${revisionDisplay}-2.png` });
  });
}
