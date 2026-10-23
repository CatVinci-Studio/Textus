import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// The composer's model button (ai/chat/ModelSwitcher.tsx): it names the
// model the next message goes to, and its list switches the chat provider
// and model without a trip to Settings.

test("the composer names its model and switches it from its list", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", aiProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const trigger = page.locator(".agent-panel-view .model-switcher-trigger");
  await expect(trigger).toHaveText("gpt-6.1-sol");

  await trigger.click();
  const list = page.getByRole("listbox", { name: "Model" });
  await expect(list).toBeVisible();
  await expect(
    list.getByRole("option", { name: "gpt-6.1-sol" }),
  ).toHaveAttribute("aria-selected", "true");
  await list.getByRole("option", { name: "gpt-6-luna" }).click();

  await expect(list).toHaveCount(0);
  await expect(trigger).toHaveText("gpt-6-luna");

  // Escape closes the list without choosing.
  await trigger.click();
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(trigger).toHaveText("gpt-6-luna");
});
