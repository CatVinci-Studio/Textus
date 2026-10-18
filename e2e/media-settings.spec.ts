import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

for (const scheme of ["light", "dark"] as const) {
  for (const narrow of [false, true]) {
    test(`media preferences ${scheme} ${narrow ? "narrow" : "desktop"}`, async ({
      page,
    }) => {
      await page.setViewportSize(
        narrow ? { width: 430, height: 932 } : { width: 1180, height: 900 },
      );
      await openApp(page, {
        settings: { language: "en", theme: scheme },
        colorScheme: scheme,
      });
      await mockInvoke(page, {
        media_provider_status: {
          tts: {
            provider: "openai",
            endpoint: "https://api.openai.com/v1",
            model: "gpt-4o-mini-tts",
            voice: "alloy",
            language: "en-US",
            playbackRate: 1.25,
          },
        },
        provider_api_key_status: true,
        media_configure_provider: null,
      });
      await page.evaluate(() =>
        (
          window as unknown as { __devEmitTauriEvent: (event: string) => void }
        ).__devEmitTauriEvent("menu-open-settings"),
      );
      await page
        .locator(".settings-nav")
        .getByRole("button", { name: "Textus AI", exact: true })
        .click();
      const media = page.locator(".media-settings");
      const panel = media.getByRole("tabpanel");
      await expect(media.getByRole("tab")).toHaveCount(3);
      await expect(media.getByRole("tab", { name: /Listen/ })).toContainText(
        "System · default",
      );
      await expect(
        panel.getByRole("combobox", { name: "Service" }),
      ).toContainText("System");
      await expect(panel.getByRole("textbox", { name: "Model" })).toHaveCount(
        0,
      );
      await expect(panel.locator('input[type="password"]')).toHaveCount(0);
      mkdirSync("output/playwright", { recursive: true });
      const prefix = `output/playwright/media-settings-${scheme}-${narrow ? "narrow" : "desktop"}`;
      await page.screenshot({ path: `${prefix}-listen.png` });
      await media.getByRole("tab", { name: /Read/ }).click();
      await expect(
        panel.getByRole("combobox", { name: "Speed" }),
      ).toContainText("1.25×");
      await expect(panel.getByLabel("API key", { exact: true })).toHaveValue(
        "",
      );
      await expect(
        panel.getByLabel("API key", { exact: true }),
      ).toHaveAttribute("placeholder", "•••••••• · Stored");
      await expect(
        panel.getByRole("textbox", { name: "API base URL" }),
      ).not.toBeVisible();
      await page.screenshot({ path: `${prefix}-read.png` });
      const overflow = await media.evaluate((element) => {
        const outer = element.getBoundingClientRect();
        return Array.from(
          element.querySelectorAll<HTMLElement>(
            'input, [role="combobox"], [role="tab"]',
          ),
        )
          .filter((node) => node.getClientRects().length > 0)
          .some((node) => {
            const box = node.getBoundingClientRect();
            return box.left < outer.left - 1 || box.right > outer.right + 1;
          });
      });
      expect(overflow).toBe(false);
      await panel.getByRole("textbox", { name: "Voice" }).fill("nova");
      await expect(panel.getByRole("status")).toHaveText("Unsaved changes");
      await panel.getByRole("button", { name: "Save", exact: true }).click();
      await expect(panel.getByRole("status")).toHaveText("Saved");
      await panel.getByRole("status").scrollIntoViewIfNeeded();
      await expect(
        panel.getByRole("textbox", { name: "Language" }),
      ).toHaveValue("en-US");
      await page.screenshot({ path: `${prefix}-read-saved.png` });
      await media.getByRole("tab", { name: /Illustrations/ }).click();
      await panel.getByRole("combobox", { name: "Service" }).click();
      await expect(
        page.getByRole("option", { name: "ElevenLabs", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("option", { name: "MiniMax", exact: true }).click();
      await expect(panel.getByRole("textbox", { name: "Model" })).toHaveValue(
        "image-01",
      );
      await expect(
        panel.getByRole("checkbox", { name: "Reuse MiniMax text key" }),
      ).toBeVisible();
      await page.screenshot({ path: `${prefix}-illustrations.png` });
    });
  }
}
