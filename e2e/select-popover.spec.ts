import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// The app's own select (ui/Select.tsx) opens its list inside the window
// even when the list is wider than its button: Settings' image models,
// "OpenAI · gpt-image-…" under a "None" button near the right edge, ran
// past the window's edge.

test("a list wider than its button stays inside the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 640 });
  await page.addInitScript(() => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      {
        list_image_providers: [
          {
            id: "openai",
            label: "OpenAI",
            api: "openai",
            baseUrl: "https://api.openai.com/v1",
            keyId: "openai",
            models: ["gpt-image-1.5-long-model-name", "gpt-image-1-mini"],
          },
        ],
      };
  });
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (e: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Textus AI" }).click();
  const trigger = settings.getByRole("combobox", { name: "Image model" });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const list = page.getByRole("listbox", { name: "Image model" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option")).not.toHaveCount(1);
  // Settled, past its entrance.
  await page.waitForTimeout(400);
  const box = (await list.boundingBox())!;
  const button = (await trigger.boundingBox())!;
  expect(box.width).toBeGreaterThan(button.width);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(820);
});
