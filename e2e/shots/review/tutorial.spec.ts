import { expect, test, type Page } from "@playwright/test";
import { openApp, openPhone, PHONE } from "../../helpers";

// Screenshots of the first-run tour, for review rather than as a baseline:
// every step in Chinese on the desktop (light), the AI lessons both watched
// and done for real (against canned answers), and a few in English, dark
// and on a phone. Runs only with TEXTUS_SHOTS_DIR set to where they go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/tutorial-v2 npm run screenshots:review -- tutorial

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");
test.setTimeout(240_000);

const at = (stepId: string, extra: Record<string, unknown> = {}) => ({
  "levis-tutorial-progress": JSON.stringify({
    active: true,
    stepId,
    tabId: null,
    ...extra,
  }),
});

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

async function next(page: Page, label = "继续") {
  await card(page).getByRole("button", { name: label, exact: true }).click();
}

const TABLE = `| 日期 | 去处 | 交通 |
| --- | --- | --- |
| 第一天 | 伏见稻荷 | 电车 |
| 第二天 | 岚山 | 自行车 |
| 第三天 | 祇园 | 步行 |
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

test("zh desktop light: every step, AI watched", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { storage: at("welcome") });
  await shot(page, "zh-01-welcome");
  await next(page, "开始");

  await editor(page).click();
  await page.keyboard.type("# 京都三日");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- 护照");
  await page.keyboard.press("Enter");
  await page.keyboard.type("相机");
  await shot(page, "zh-02-wysiwyg");
  await next(page);

  // The diary arrives (the editor reloads with it) before the table goes in.
  await expect(editor(page)).toContainText("第一天：伏见稻荷");
  await page.waitForTimeout(300);
  await pasteAtEnd(page, TABLE);
  await shot(page, "zh-03-blocks");
  await next(page);

  await card(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "纸张" }).click();
  await card(page).getByRole("button", { name: "禅模式" }).click();
  await shot(page, "zh-04-modes-themes");
  await card(page).getByRole("button", { name: "禅模式" }).click();
  await card(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "默认" }).click();
  await next(page);

  await page.keyboard.press("Control+\\");
  await page.getByRole("button", { name: "大纲" }).click();
  await shot(page, "zh-05-sidebar-export");
  await page.keyboard.press("Control+\\");
  await next(page);

  await shot(page, "zh-06-connect");
  await next(page, "暂时跳过");

  await page.keyboard.press("Control+Shift+L");
  await shot(page, "zh-07-ai-panel-watch");
  await next(page);
  for (const name of [
    "08-continuation",
    "09-grammar",
    "10-revision",
    "11-review",
    "12-skills",
    "13-memory",
  ]) {
    await shot(page, `zh-${name}-watch`);
    await next(page);
  }
  await shot(page, "zh-14-done");
});

test("zh desktop light: the AI lessons done for real", async ({ page }) => {
  const slip =
    "竹林里的风很大。我们租了自行车，沿着河一路骑到渡月桥。到了下午，我们已经走的很累了，就在河边坐了一个小时。";
  const dayThree =
    "今天下了一点雨。我在花见小路走了走。然后去了一家小咖啡店。咖啡店很安静。咖啡很好喝。我在那里坐了很久。然后我就回酒店了。";
  const vivid =
    "细雨落在祇园的石板路上。我沿着花见小路慢慢走，拐进一家小小的咖啡店，安静得能听见杯子轻碰。咖啡醇厚，我一直坐到天色暗下来，才回了酒店。";
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
  await expect(card(page)).toContainText("已连接。");
  await shot(page, "zh-06-connect-connected");
  await next(page);

  await page.keyboard.press("Control+Shift+L");
  await shot(page, "zh-07-ai-panel-live");
  await next(page);

  const slipAt = slip.indexOf("走的很累") + 1;
  await answer(page, {
    ai_complete: "明天一早，我们去奈良看鹿。",
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
  await editor(page).locator("p", { hasText: "然后我就回酒店了" }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("晚上吃了拉面。");
  await expect(editor(page).locator(".ghost-text")).toBeVisible();
  await shot(page, "zh-08-continuation-live");
  await page.keyboard.press("Tab");
  await next(page);

  const slipMark = editor(page)
    .locator("p", { hasText: "走的很累" })
    .locator(".grammar-issue");
  await slipMark.hover();
  await expect(page.locator(".grammar-popover")).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${DIR}/zh-09-grammar-live.png` });
  await page.locator(".grammar-popover-apply").click();
  await next(page);

  await answer(page, {
    ai_agent_message: [
      { kind: "User", text: "改得更生动一些" },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: dayThree,
          text: vivid,
        }),
      },
      { kind: "ToolResult", call_id: "r1", output: "Edit proposed" },
      { kind: "Assistant", text: "把第三天这段改得更有画面感了。" },
    ],
  });
  await composer(page).fill("把第三天这段改得更生动一些");
  await composer(page).press("Enter");
  await expect(page.locator(".review-bar-accept")).toBeVisible();
  await shot(page, "zh-10-revision-live");
  await page.locator(".review-bar-accept").click();
  await next(page);

  await answer(page, {
    ai_agent_message: [
      { kind: "User", text: "给这篇日记提几条建议" },
      {
        kind: "ToolCall",
        call_id: "n1",
        name: "add_comment",
        arguments: JSON.stringify({
          anchor: "竹林里的风很大。",
          comment: "可以写写风声像什么，让读者也听见竹林。",
        }),
      },
      { kind: "ToolResult", call_id: "n1", output: "Comment added" },
      { kind: "Assistant", text: "在第二天留了一条建议。" },
    ],
  });
  await composer(page).fill("给这篇日记提几条建议");
  await composer(page).press("Enter");
  await expect(page.locator(".review-anchor").first()).toBeVisible();
  await shot(page, "zh-11-review-live");
  await next(page);

  await composer(page).fill("/精简");
  await expect(page.locator(".composer-picker")).toBeVisible();
  await shot(page, "zh-12-skills-live");
  await composer(page).fill("");
  await next(page, "跳过此步");

  await answer(page, {
    load_agent_workspace: {
      instructions: ["- 日记用第一人称"],
      project_instructions: "- 地名第一次出现时写全称",
      skills: [],
      root: "/notes/京都",
      style:
        "---\nconventions: zh\n---\n# 文风\n\n- 短句为主\n- 多写看到和听到的\n",
      library: [],
    },
  });
  await page.locator("#agent-tab-memory").click();
  await shot(page, "zh-13-memory-live");
});

test("en desktop light and dark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    settings: { language: "en" },
    storage: at("wysiwyg"),
  });
  await shot(page, "en-02-wysiwyg");
  await next(page, "Skip this step");
  await shot(page, "en-03-blocks");

  await openApp(page, {
    settings: { language: "en" },
    storage: at("connect"),
    colorScheme: "dark",
  });
  await shot(page, "en-dark-06-connect");
  await next(page, "Skip for now");
  await shot(page, "en-dark-07-ai-panel-watch");
  await next(page, "Continue");
  await next(page, "Continue");
  await shot(page, "en-dark-09-grammar-watch");
});

test.describe("phone", () => {
  test.use(PHONE);

  test("en and zh on a phone", async ({ page }) => {
    await openPhone(page, { storage: at("welcome") });
    await shot(page, "phone-en-01-welcome");
    await next(page, "Start");
    await shot(page, "phone-en-02-wysiwyg");
    await next(page, "Skip this step");
    await shot(page, "phone-en-03-blocks");

    await openPhone(page, { storage: at("connect") });
    await shot(page, "phone-en-06-connect");
    await next(page, "Skip for now");
    await shot(page, "phone-en-07-ai-panel-watch");
  });

  test("zh on a phone", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
    });
    await openApp(page, { storage: at("continuation", { aiMode: "watch" }) });
    await expect(page.locator("html")).toHaveAttribute(
      "data-window-chrome",
      "mobile",
    );
    await shot(page, "phone-zh-08-continuation-watch");
    await next(page);
    await next(page);
    await next(page);
    await next(page);
    await next(page);
    await next(page);
    await shot(page, "phone-zh-14-done");
  });
});
