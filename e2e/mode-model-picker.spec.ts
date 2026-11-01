import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// The composer's mode and model in one control: its list holds the modes,
// then the models, which switch provider and model without a trip to Settings.

test("one control names the mode and the model, and its list switches either", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", aiProvider: "openai" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const picker = page
    .locator(".agent-panel-view")
    .getByRole("combobox", { name: "Mode and model" });
  await expect(picker.locator(".mode-picker-value")).toHaveText("Review");
  await expect(picker.locator(".mode-picker-model")).toHaveText("gpt-6.1-sol");

  await picker.click();
  const list = page.getByRole("listbox", { name: "Mode and model" });
  await expect(list).toBeVisible();
  // The modes first, each saying what it does; then the models.
  await expect(list.locator(".mode-picker-mode-name")).toHaveText([
    "Write",
    "Review",
    "Research",
    "Create",
  ]);
  await expect(list.getByRole("option", { name: "Write" })).toContainText(
    "Writes and changes the document",
  );
  await expect(
    list.getByRole("option", { name: "gpt-6.1-sol" }),
  ).toHaveAttribute("aria-selected", "true");
  await list.getByRole("option", { name: "gpt-6-luna" }).click();
  await expect(list).toHaveCount(0);
  await expect(picker.locator(".mode-picker-model")).toHaveText("gpt-6-luna");
  await expect(picker.locator(".mode-picker-value")).toHaveText("Review");

  // The mode from the same list, the model kept.
  await picker.click();
  await list.getByRole("option", { name: "Write", exact: true }).click();
  await expect(picker.locator(".mode-picker-value")).toHaveText("Write");
  await expect(picker.locator(".mode-picker-model")).toHaveText("gpt-6-luna");

  // By keys: down to the next mode, Enter picks it; Escape closes.
  await picker.focus();
  await page.keyboard.press("Enter");
  await expect(list).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker.locator(".mode-picker-value")).toHaveText("Review");
  await picker.click();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(picker.locator(".mode-picker-value")).toHaveText("Review");
});

test("Quick Ask's control is the mode alone", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", aiProvider: "openai" },
  });
  await page.locator(".milkdown").click();
  await page.keyboard.type("A line to ask about.");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Shift+K");
  const picker = page
    .locator(".inline-chat")
    .getByRole("combobox", { name: "Mode" });
  await expect(picker.locator(".mode-picker-model")).toHaveCount(0);
  await picker.click();
  await expect(page.locator(".mode-picker-mode-name")).toHaveText([
    "Write",
    "Review",
  ]);
  await expect(page.locator(".mode-picker-provider")).toHaveCount(0);
});
