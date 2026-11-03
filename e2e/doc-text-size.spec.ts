import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The reader's own document text size and line spacing, over the theme's,
 * set in Settings and kept from the first paint.
 */

const paragraph = '[data-active-tab="true"] .ProseMirror p';

test("the document takes the reader's text size and line spacing, and follows a change in Settings", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", docTextSize: 20, docLineSpacing: "relaxed" },
  });
  await pasteMarkdown(page, "A line of the reader's own size.");
  const text = page.locator(paragraph).first();
  await expect(text).toHaveCSS("font-size", "20px");
  await expect(text).toHaveCSS("line-height", "41px");

  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page
    .locator(".settings-nav-item", { hasText: "Editor & Appearance" })
    .click();
  await page.getByRole("button", { name: "Increase" }).first().click();
  await expect(text).toHaveCSS("font-size", "21px");
  const size = page.getByRole("spinbutton", { name: "Document text size" });
  await size.fill("16");
  await size.press("Enter");
  await expect(text).toHaveCSS("font-size", "16px");
  const spacing = page.getByRole("spinbutton", { name: "Line spacing" });
  await spacing.fill("1,5");
  await spacing.press("Enter");
  await expect(text).toHaveCSS("line-height", "24px");
  await page
    .locator(".settings-row", { has: spacing })
    .getByRole("button", { name: "Use the theme's" })
    .click();
  // The theme's own spacing again: Textus's default 1.8.
  await expect(text).toHaveCSS("line-height", "28.8px");
});

test("View › Text Style… sets the text beside the document, which stays in view", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", docTextSize: 18 } });
  await pasteMarkdown(page, "A line to read while the size changes.");
  const text = page.locator(paragraph).first();
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-text-style"),
  );
  const panel = page.getByRole("dialog", { name: "Text Style" });
  await panel.getByRole("button", { name: "Increase" }).first().click();
  await expect(text).toHaveCSS("font-size", "19px");
  // Nothing dims the document or takes it from view.
  await expect(page.locator(".settings-backdrop")).toHaveCount(0);
  await expect(text).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(text).toHaveCSS("font-size", "19px");

  // The rest of the page is a click away.
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-text-style"),
  );
  await panel.getByRole("button", { name: "More in Settings" }).click();
  await expect(page.locator(".settings-category-title")).toHaveText(
    "Editor & Appearance",
  );
});
