import { expect, test } from "@playwright/test";
import { PHONE, openApp, openPhone } from "./helpers";

// The window bar's button for the AI panel (app/WindowBar.tsx) is Textus
// AI's own, a small robot (AssistantIcon in ui/icons.tsx) - a chat bubble
// read as one more chat, not as the assistant. The phone's title row draws
// the same button.

const button = '.window-bar-toggle[aria-label="Textus AI"]';

test("the AI panel's button is Textus AI, untranslated, with its shortcut in the tooltip", async ({
  page,
}) => {
  // In Chinese: the product's name is not translated.
  await openApp(page, { settings: { language: "zh" } });
  const toggle = page.locator(button);
  await expect(toggle).toHaveAttribute("title", /^Textus AI \(.+L\)$/);
  // The robot: a head, and an antenna and two eyes.
  await expect(toggle.locator("svg rect")).toHaveCount(1);
  await expect(toggle.locator("svg circle")).toHaveCount(3);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".agent-panel-view")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the title row's AI button is the same robot", async ({ page }) => {
    await openPhone(page);
    const toggle = page.locator(button);
    await expect(toggle.locator("svg circle")).toHaveCount(3);
    await toggle.tap();
    await expect(page.locator(".agent-panel-view")).toBeVisible();
  });
});
