import { expect, test } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

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

  await emit(page, "menu-open-settings");
  await page
    .locator(".settings-nav-item", { hasText: "Editor & Appearance" })
    .click();
  // Folded under one row that says the theme's are overridden.
  const fold = page.locator("summary", { hasText: "Body text" });
  await expect(fold).toContainText("Custom");
  const size = page.getByRole("combobox", { name: "Document text size" });
  await expect(size).toBeHidden();
  await fold.click();
  // Font, size, character spacing, then line spacing.
  await expect(
    page.locator(".settings-fold-body .settings-row-label"),
  ).toHaveText([
    "Text font",
    "Document text size",
    "Character spacing",
    "Line spacing",
  ]);
  await size.click();
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
