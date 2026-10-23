import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * After a reply, what the writer will probably say next shows grey in the
 * empty message box (ai/chat/next-message.ts); Tab takes it, and with
 * Settings › Textus AI › Suggest your next message off nothing is asked.
 */

const composer = (page: Page) => page.locator(".agent-panel-view textarea");

const asked = (page: Page) =>
  page.evaluate(
    () =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((c) => c.cmd === "suggest_next_message").length,
  );

async function open(page: Page, suggestNextMessage = true) {
  await openApp(page, {
    settings: { language: "zh", suggestNextMessage },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "第一章写完了。");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "…" },
      { kind: "Assistant", text: "第一章已经润色好了。" },
    ],
    suggest_next_message: "接着润色第二章",
  });
  await composer(page).fill("润色第一章");
  await composer(page).press("Enter");
  await expect(page.locator(".agent-panel-view")).toContainText(
    "第一章已经润色好了。",
  );
}

test("after a reply, the next message shows grey and Tab takes it", async ({
  page,
}) => {
  await open(page);
  await expect(composer(page)).toHaveAttribute(
    "placeholder",
    "接着润色第二章  (Tab 采用)",
  );
  // Fainter than a hint, never like typed text: the theme's muted ink at
  // part strength.
  await expect(composer(page)).toHaveClass(/inline-chat-input-suggested/);
  const ink = await composer(page).evaluate((el) => ({
    text: getComputedStyle(el).color,
    hint: getComputedStyle(el, "::placeholder").color,
  }));
  expect(ink.hint).not.toBe(ink.text);
  expect(ink.hint).toMatch(/srgb|rgba/);
  await composer(page).press("Tab");
  await expect(composer(page)).toHaveValue("接着润色第二章");
});

test("with Suggest your next message off, nothing is asked", async ({
  page,
}) => {
  await open(page, false);
  await expect(composer(page)).not.toHaveAttribute(
    "placeholder",
    /接着润色第二章/,
  );
  expect(await asked(page)).toBe(0);
});
