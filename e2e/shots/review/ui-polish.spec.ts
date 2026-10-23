import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown, PHONE } from "../../helpers";

// Screenshots of the AI panel (empty, a reply with an edit, a comment and a
// sentence picker, a reply streaming in, the / menu) and of the app's
// surfaces (menus, selects, dialogs, settings) in English and Chinese, light
// and dark, desktop, a narrow panel and phone - for review, not a baseline.
// Runs only with TEXTUS_SHOTS_DIR set to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/ui-polish/after npm run screenshots:review -- ui-polish

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const DOC = {
  en: {
    doc: `# Notes on renewing the old town

Urban renewal is not just tearing down the old and building the new.

The study ran in three neighbourhoods. We spent two whole months talking one to one with the people who live there. In all we interviewed forty-six residents, about many different things.

- Listen to residents first
- Then draw up the plan
`,
    anchor:
      "The study ran in three neighbourhoods. We spent two whole months talking one to one with the people who live there. In all we interviewed forty-six residents, about many different things.",
    text: "The study covered three neighbourhoods. We spent two whole months talking one to one with the people who live there. We interviewed forty-six residents.",
    ask: "Make the second paragraph tighter",
    reason: "Cut the repetition, kept the time span and the head count.",
    commentAnchor:
      "Urban renewal is not just tearing down the old and building the new.",
    comment:
      "A familiar opening line - consider starting from the research question.",
    reply:
      "I tightened the second paragraph and left a note on the opening.\n\n- **Shorter**: two clauses gone\n- **Kept**: the time span and the count",
    streaming: "Reading the paragraph and weighing which clauses carry",
  },
  zh: {
    doc: `# 老城区更新的几点思考

城市更新不只是拆旧建新。

这项研究在三个街区进行。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。一共访谈了四十六位居民，内容涵盖了很多方面。

- 先听取居民意见
- 再制定方案
`,
    anchor:
      "这项研究在三个街区进行。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。一共访谈了四十六位居民，内容涵盖了很多方面。",
    text: "这项研究覆盖三个街区。我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈。共访谈四十六位居民。",
    ask: "把第二段改得更简洁",
    reason: "删去重复和冗余的修饰，保留时间和人数。",
    commentAnchor: "城市更新不只是拆旧建新。",
    comment: "开头是常见的判断句，可以直接从研究问题切入。",
    reply:
      "已精简第二段，并在开头留了一条批注。\n\n- **更短**：删去两处修饰\n- **保留**：时间和人数",
    streaming: "正在阅读这一段，判断哪些修饰可以删去",
  },
} as const;

type Lang = keyof typeof DOC;
type Form = "desktop" | "narrow" | "phone";

async function open(
  page: Page,
  language: Lang,
  form: Form,
  scheme: "light" | "dark",
) {
  if (form === "phone")
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
    });
  await openApp(page, {
    colorScheme: scheme,
    settings: { language },
    storage:
      form === "phone"
        ? {}
        : {
            "textus-agent-panel-open": "1",
            "textus-agent-panel-width": form === "narrow" ? "300" : "400",
          },
  });
  await pasteMarkdown(page, DOC[language].doc);
  if (form === "phone") await page.locator(".window-bar-toggle").tap();
  const input = page.locator(".agent-panel .inline-chat-input");
  await expect(input).toBeVisible();
  await page.waitForTimeout(300);
  return input;
}

async function converse(page: Page, language: Lang) {
  const d = DOC[language];
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: d.ask },
      {
        kind: "ToolCall",
        call_id: "r1",
        name: "read_document",
        arguments: "{}",
      },
      { kind: "ToolResult", call_id: "r1", output: "…" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: d.anchor,
          text: d.text,
          reason: d.reason,
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "add_comment",
        arguments: JSON.stringify({
          anchor: d.commentAnchor,
          comment: d.comment,
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Comment added" },
      { kind: "Assistant", text: d.reply },
    ],
  });
}

for (const form of ["desktop", "narrow", "phone"] as Form[]) {
  test.describe(form, () => {
    if (form === "phone") test.use(PHONE);
    for (const language of ["en", "zh"] as Lang[]) {
      for (const scheme of ["light", "dark"] as const) {
        const shot = (page: Page, name: string) =>
          page.screenshot({
            path: `${DIR}/chat-${form}-${language}-${scheme}-${name}.png`,
          });

        test(`${language} ${scheme}: the AI panel`, async ({ page }) => {
          const input = await open(page, language, form, scheme);
          await shot(page, "1-empty");

          await input.click();
          await input.fill("/");
          await expect(page.locator(".composer-picker")).toBeVisible();
          await page.waitForTimeout(200);
          await shot(page, "2-slash");
          await input.fill("");

          await converse(page, language);
          await input.fill(DOC[language].ask);
          await input.press("Enter");
          // A phone folds the sheet away when edits arrive; back into it.
          if (form === "phone") {
            await page.locator(".review-bar-chat").click();
            await page.waitForTimeout(400);
          }
          await expect(page.locator(".agent-proposal-reason")).toBeVisible();
          await expect(page.locator(".agent-comment")).toBeVisible();
          await page.waitForTimeout(1500);
          await shot(page, "3-reply");
          await page
            .locator(
              ".revision-note .pending-pick-keep, .agent-proposal-pick .pending-pick-keep",
            )
            .last()
            .click();
          await page.waitForTimeout(300);
          await shot(page, "4-picker");
          const diff = page.locator(".agent-diff-summary");
          if (await diff.count()) {
            await diff.first().click();
            await page.waitForTimeout(300);
            await shot(page, "5-diff");
          }
        });

        test(`${language} ${scheme}: a reply streaming in`, async ({
          page,
        }) => {
          const input = await open(page, language, form, scheme);
          const text = DOC[language].streaming;
          await page.evaluate((partial) => {
            const internals = (
              window as unknown as {
                __TAURI_INTERNALS__: {
                  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
                };
              }
            ).__TAURI_INTERNALS__;
            const original = internals.invoke;
            internals.invoke = (cmd, args) => {
              if (cmd !== "ai_agent_message") return original(cmd, args);
              const { onEvent } = args as {
                onEvent?: { onmessage?: (e: unknown) => void };
              };
              onEvent?.onmessage?.({
                type: "toolStart",
                callId: "r1",
                name: "read_document",
              });
              setTimeout(
                () => onEvent?.onmessage?.({ type: "delta", text: partial }),
                50,
              );
              return new Promise(() => {});
            };
          }, text);
          await input.fill(DOC[language].ask);
          await input.press("Enter");
          await page.waitForTimeout(600);
          await shot(page, "6-streaming");
        });
      }
    }
  });
}

// The app's other surfaces, for the corner-radius pass and the View menu:
// the menu with View open, the context menu, a select, the find bar, a
// dialog, settings, the sidebar, and the phone's menu.
for (const language of ["en", "zh"] as Lang[]) {
  for (const scheme of ["light", "dark"] as const) {
    const shot = (page: Page, name: string) =>
      page.screenshot({
        path: `${DIR}/surfaces-${language}-${scheme}-${name}.png`,
      });
    const emit = (page: Page, name: string, payload?: unknown) =>
      page.evaluate(
        ([n, p]) =>
          (
            window as unknown as {
              __devEmitTauriEvent: (e: string, p?: unknown) => void;
            }
          ).__devEmitTauriEvent(n as string, p),
        [name, payload] as const,
      );

    test(`${language} ${scheme}: desktop surfaces`, async ({ page }) => {
      await openApp(page, {
        colorScheme: scheme,
        settings: { language, typewriterMode: true },
        storage: { "textus-agent-panel-open": "1" },
      });
      await pasteMarkdown(
        page,
        DOC[language].doc +
          "\n```js\nconst x = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
      );
      await page.locator(".window-menu-button").click();
      const view = page
        .locator(".app-menu-item")
        .filter({ hasText: language === "en" ? "View" : "视图" });
      await view.hover();
      await page.waitForTimeout(300);
      await shot(page, "1-view-menu");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await page.locator(".ProseMirror p").first().click({ button: "right" });
      await page.waitForTimeout(200);
      await shot(page, "2-context-menu");
      await page.keyboard.press("Escape");

      await page.locator(".inline-chat-mode").first().click();
      await page.waitForTimeout(200);
      await shot(page, "3-select");
      await page.keyboard.press("Escape");

      await emit(page, "menu-find-replace");
      await page.waitForTimeout(200);
      await shot(page, "4-find");
      await page.keyboard.press("Escape");

      await page.locator(".ProseMirror p").first().click();
      await emit(page, "menu-insert-block", "table");
      await page.waitForTimeout(300);
      await shot(page, "5-dialog");
      await page.keyboard.press("Escape");

      await emit(page, "menu-toggle-sidebar");
      await page.waitForTimeout(300);
      await shot(page, "6-sidebar");

      await emit(page, "menu-open-settings");
      await page.waitForTimeout(300);
      await shot(page, "7-settings");
    });
  }
}

test.describe("phone surfaces", () => {
  test.use(PHONE);
  for (const language of ["en", "zh"] as Lang[]) {
    test(`${language}: the phone menu`, async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
      });
      await openApp(page, { settings: { language } });
      await pasteMarkdown(page, DOC[language].doc);
      await page.locator(".window-menu-button").tap();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${DIR}/surfaces-phone-${language}-menu.png`,
      });
    });
  }
});

// Quick Ask, in the document: the card it shares with the panel's styles.
for (const language of ["en", "zh"] as Lang[]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${language} ${scheme}: Quick Ask`, async ({ page }) => {
      await openApp(page, { colorScheme: scheme, settings: { language } });
      await pasteMarkdown(page, DOC[language].doc);
      await converse(page, language);
      await page.locator(".milkdown p").nth(1).click();
      await page.keyboard.press("Control+Shift+K");
      const input = page.locator(".inline-chat .inline-chat-input");
      await expect(input).toBeFocused();
      await page.waitForTimeout(200);
      await page.screenshot({
        path: `${DIR}/quick-${language}-${scheme}-1-open.png`,
      });
      await input.fill(DOC[language].ask);
      await input.press("Enter");
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: `${DIR}/quick-${language}-${scheme}-2-reply.png`,
      });
    });
  }
}
