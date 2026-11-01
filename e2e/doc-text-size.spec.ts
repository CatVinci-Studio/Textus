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
  await page.getByRole("combobox", { name: "Document text size" }).click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "16 px" })
    .click();
  await expect(text).toHaveCSS("font-size", "16px");
  await page.getByRole("combobox", { name: "Line spacing" }).click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "Theme's" })
    .click();
  // The theme's own spacing again: Textus's default 1.8.
  await expect(text).toHaveCSS("line-height", "28.8px");
});
