import { devices, expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// An iPad, as far as Chromium can be one: the desktop layout at a tablet's
// width, with touch and "iPad" as its platform, which keyboard shortcuts and
// the review steps' focus rule key off.
test.use({
  viewport: { width: 1024, height: 1366 },
  isMobile: true,
  hasTouch: true,
  userAgent: devices["iPad Pro 11"].userAgent,
});

const FIRST = "The survey covered three districts over two months.";
const SECOND = "Most residents did not oppose the renovation itself.";

async function openIPad(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "iPad" });
  });
  await openApp(page, { settings: { language: "en" } });
  // The iOS app's touch chrome (the phone's layout stays off: see Quick Ask
  // below, in the document rather than docked).
  await expect(page.locator("html")).toHaveAttribute(
    "data-window-chrome",
    "mobile",
  );
  await pasteMarkdown(page, `# Notes\n\n${FIRST}\n\n${SECOND}\n`);
}

const editor = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

/** Quick Ask from the iPad's hardware keyboard: Cmd+Shift+K, the default
 *  binding's Mod read as Cmd, as on a Mac. */
async function openQuickAsk(page: Page) {
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.keyboard.press("Meta+Shift+K");
  // In the document, as on the desktop - not docked, as on a phone.
  const chat = page.locator(".milkdown .inline-chat");
  await expect(chat).toBeVisible();
  await expect(page.locator(".quick-ask-dock")).toHaveCount(0);
  return chat;
}

test("an iPad keyboard's Cmd is the shortcuts' Mod", async ({ page }) => {
  await openIPad(page);
  await openQuickAsk(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-chat")).toHaveCount(0);
  // Ctrl is not: Mod follows ProseMirror's rule.
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.keyboard.press("Control+Shift+K");
  await page.waitForTimeout(300);
  await expect(page.locator(".inline-chat")).toHaveCount(0);
});

test("a review step on an iPad raises no keyboard unless the user was typing", async ({
  page,
}) => {
  await openIPad(page);
  const edit = (id: string, anchor: string, text: string) => ({
    kind: "ToolCall",
    call_id: id,
    name: "propose_edit",
    arguments: JSON.stringify({ action: "replace", anchor, text }),
  });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "shorter" },
      edit("e1", FIRST, "The survey covered three districts."),
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      edit("e2", SECOND, "Most residents did not oppose it."),
      { kind: "ToolResult", call_id: "e2", output: "Edit proposed" },
      { kind: "Assistant", text: "Shortened both." },
    ],
  });
  const chat = await openQuickAsk(page);
  await chat.locator("textarea").fill("shorter");
  await chat.locator("textarea").press("Enter");
  const next = chat.getByRole("button", { name: "Next edit" });
  await expect(next).toBeVisible();
  await expect(chat.locator(".quick-ask-pending-position")).toHaveText(/\/ 2$/);

  // Reading, not typing - the focus is in the composer, not the document:
  // stepping to the next edit must not put the caret in the document,
  // which on an iPad without a keyboard raises the software one over it.
  await next.tap();
  await expect(chat.locator(".quick-ask-pending-position")).toHaveText("2 / 2");
  await expect(editor(page)).not.toBeFocused();

  // Typing in the document: the step hands the caret back, as on a Mac.
  await editor(page).focus();
  await chat.getByRole("button", { name: "Previous edit" }).tap();
  await expect(chat.locator(".quick-ask-pending-position")).toHaveText("1 / 2");
  await expect(editor(page)).toBeFocused();
});

test("the keyboard toolbar spans the text, not the docked AI panel", async ({
  page,
}) => {
  await openIPad(page);
  await page.locator(".window-bar-toggle").tap();
  const panel = page.locator(".agent-panel");
  await expect(panel).toBeVisible();
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toBeVisible();
  const side = (await panel.boundingBox())!;
  // Its right edge stops where the panel begins: the composer's mode
  // picker, + and Send stay uncovered.
  await expect
    .poll(async () => {
      const bar = (await toolbar.boundingBox())!;
      return bar.x + bar.width;
    })
    .toBeLessThanOrEqual(side.x + 1);
});
