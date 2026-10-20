import { expect, test, type Page } from "@playwright/test";
import { PHONE, openApp, openPhone, pasteMarkdown } from "./helpers";

/**
 * Textus AI's switch (#196): the window bar's switch, lit while it is on,
 * turns it off in one click and back on in another. Off, nothing of it
 * runs - no completion, no grammar check, no conversation - and not one
 * request reaches an AI service, from the moment the app starts; each
 * feature's own setting is kept and applies again once it is back on.
 */

/** The commands that send something to an AI service (ipc.ts's aiCall). */
const PROVIDER_COMMANDS = [
  "ai_complete",
  "ai_grammar_check",
  "ai_agent_message",
  "fetch_agent_models",
  "learn_style",
  "fetch_custom_models",
  "test_custom_endpoint",
];

/** The provider requests the app has made since it started. */
const providerRequests = (page: Page) =>
  page.evaluate(
    (commands) =>
      (
        window as unknown as { __devStorage: { log: string[] } }
      ).__devStorage.log.filter((cmd) => commands.includes(cmd)),
    PROVIDER_COMMANDS,
  );

const aiSwitch = (page: Page) =>
  page.locator(".window-bar").getByRole("button", { name: "开启 Textus AI" });
const panelButton = (page: Page) =>
  page.locator('.window-bar-toggle[aria-label="Textus AI"]');

async function typeAtEnd(page: Page, text: string, typed: string) {
  await pasteMarkdown(page, text);
  await page.locator(".milkdown p", { hasText: text }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(typed);
}

test("the window bar's switch turns Textus AI off and on, and says which", async ({
  page,
}) => {
  await openApp(page);
  const toggle = aiSwitch(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAccessibleDescription(
    "Textus AI 已开启 · 点击关闭",
  );
  await expect(panelButton(page)).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAccessibleDescription(
    "Textus AI 已关闭 · 点击开启",
  );
  // No conversation to open while it is off.
  await expect(panelButton(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}").textusAi,
    ),
  ).toBe(false);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(panelButton(page)).toBeVisible();
});

test("while Textus AI is off, no request reaches an AI service, from launch on", async ({
  page,
}) => {
  // Grammar check off by its own switch: it has to stay off when Textus AI
  // comes back on.
  await openApp(page, {
    settings: { textusAi: false, enableGrammarCheck: false },
  });
  await expect(aiSwitch(page)).toHaveAttribute("aria-pressed", "false");

  // Typing, which would ask for a completion and a grammar check.
  await typeAtEnd(page, "The keeper woke before dawn", " and the sea");
  // Every AI shortcut: completion, grammar check, Quick Ask, the panel.
  await page.keyboard.press("ControlOrMeta+Shift+Space");
  await page.keyboard.press("ControlOrMeta+Shift+G");
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await page.keyboard.press("ControlOrMeta+Shift+L");
  // The right-click menu offers none of Textus AI's items.
  await page.locator(".milkdown p", { hasText: "The keeper" }).click({
    button: "right",
  });
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("立即触发续写")).toHaveCount(0);
  await expect(menu.getByText("立即检查语法")).toHaveCount(0);
  await expect(menu.getByText("询问 AI…")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Settings › Textus AI shows only the switch, so nothing there asks for
  // a model list either.
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (e: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.locator(".settings-nav-item", { hasText: "Textus AI" }).click();
  await expect(
    page.getByRole("checkbox", { name: "开启 Textus AI" }),
  ).not.toBeChecked();
  await expect(
    page.getByText("已关闭：不会向任何 AI 服务发送内容。"),
  ).toBeVisible();
  await expect(page.getByText("连接", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Past both debounces (completion 450 ms, grammar check 1.5 s).
  await page.waitForTimeout(2000);
  expect(await providerRequests(page)).toEqual([]);
  await expect(page.locator(".ghost-text")).toHaveCount(0);
  await expect(page.locator(".agent-panel-view")).toHaveCount(0);
  await expect(page.locator(".inline-chat")).toHaveCount(0);

  // Back on: completion works again, and the grammar check keeps its own
  // "off".
  await aiSwitch(page).click();
  await page.locator(".milkdown p", { hasText: "The keeper" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" was calm");
  await expect(page.locator(".ghost-text")).toBeVisible();
  await page.waitForTimeout(2000);
  const requests = await providerRequests(page);
  expect(requests).toContain("ai_complete");
  expect(requests).not.toContain("ai_grammar_check");
});

test("turning Textus AI off clears what it showed and stops a running reply", async ({
  page,
}) => {
  await openApp(page, { storage: { "levis-agent-panel-open": "1" } });
  // A reply that starts and then never ends until it is cancelled, as
  // Rust's ai_cancel ends the request.
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      __cancelled: string[];
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    const pending = new Map<string, (reason: unknown) => void>();
    w.__cancelled = [];
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      const { requestId, onEvent } = (args ?? {}) as {
        requestId?: string;
        onEvent?: { onmessage?: (event: unknown) => void };
      };
      if (cmd === "ai_agent_message" && requestId) {
        onEvent?.onmessage?.({ type: "delta", text: "A first sentence." });
        return new Promise((_, reject) => pending.set(requestId, reject));
      }
      if (cmd === "ai_cancel" && requestId) {
        w.__cancelled.push(requestId);
        pending.get(requestId)?.("cancelled");
      }
      return original(cmd, args);
    };
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten the opening.");
  await composer.press("Enter");
  await expect(page.locator(".agent-panel-view")).toContainText(
    "A first sentence.",
  );

  // The completion on offer goes too.
  await typeAtEnd(page, "The plan", " works");
  await expect(page.locator(".ghost-text")).toBeVisible();

  await aiSwitch(page).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __cancelled: string[] }).__cancelled,
      ),
    )
    .toHaveLength(1);
  await expect(page.locator(".ghost-text")).toHaveCount(0);
  await expect(page.locator(".agent-panel-view")).toHaveCount(0);

  // On again, the conversation is where it stopped, as Stop leaves it.
  await aiSwitch(page).click();
  await panelButton(page).click();
  await expect(page.locator(".agent-panel-view")).toContainText(
    "Tighten the opening.",
  );
  await expect(page.locator(".agent-panel-view")).toContainText(
    "A first sentence.",
  );
});

test("the menu and the shortcut turn it off and on too", async ({ page }) => {
  await openApp(page, {
    settings: {
      shortcuts: { toggleTextusAi: "mod+alt+a" },
      shortcutsRevision: 1,
    },
  });
  await page.locator(".milkdown").click();
  await page.keyboard.press("ControlOrMeta+Alt+A");
  await expect(aiSwitch(page)).toHaveAttribute("aria-pressed", "false");
  // View › Textus AI, as menu.rs's dispatch sends it.
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (e: string) => void }
    ).__devEmitTauriEvent("menu-toggle-textus-ai"),
  );
  await expect(aiSwitch(page)).toHaveAttribute("aria-pressed", "true");
});

test("the popped-out AI window says it is off and turns it back on", async ({
  page,
}) => {
  await openApp(page);
  const chat = await page.context().newPage();
  await chat.addInitScript(() => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      {
        take_chat_handoff: {
          editorLabel: "main",
          state: {
            context: {
              document: "",
              selectedText: "",
              selectionMarkdown: "",
              docPath: null,
              docTitle: "Untitled",
              editorLabel: "main",
            },
            conversationId: "c1",
            turns: [],
            statuses: {},
          },
        },
      };
  });
  await chat.goto("/?view=chat");
  await expect(chat.locator(".chat-window-body textarea")).toBeVisible();

  // Turned off in the main window: the chat window follows.
  await aiSwitch(page).click();
  await expect(chat.locator(".chat-window-ai-off")).toContainText(
    "Textus AI 已关闭",
  );
  await expect(chat.locator(".chat-window-body")).toHaveCount(0);
  const windowSwitch = chat
    .locator(".chat-window-header")
    .getByRole("button", { name: "开启 Textus AI" });
  await expect(windowSwitch).toHaveAttribute("aria-pressed", "false");

  await chat.locator(".chat-window-ai-off button").click();
  await expect(chat.locator(".chat-window-body textarea")).toBeVisible();
  await expect(aiSwitch(page)).toHaveAttribute("aria-pressed", "true");
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the title row carries the switch, and off takes the AI buttons away", async ({
    page,
  }) => {
    await openPhone(page);
    const toggle = page
      .locator(".window-bar")
      .getByRole("button", { name: "Enable Textus AI" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(panelButton(page)).toBeVisible();
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(panelButton(page)).toHaveCount(0);
  });
});
