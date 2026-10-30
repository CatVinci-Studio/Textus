import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// How inline code inside bold looks. What typing, Mod+B and pasting make
// of it is tested in vitest (src/editor/marks/code-in-spans.test.ts).

const editor = '[data-active-tab="true"] .ProseMirror';

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
});

test("code inside bold is bold, with its own background", async ({ page }) => {
  await pasteMarkdown(page, "**bold `code` bold**");
  const styles = await page
    .locator(`${editor} strong code`)
    .evaluate((code) => {
      const own = getComputedStyle(code);
      const bold = getComputedStyle(code.parentElement!);
      return {
        weight: own.fontWeight,
        boldWeight: bold.fontWeight,
        background: own.backgroundColor,
        padding: own.paddingLeft,
      };
    });
  expect(styles.weight).toBe(styles.boldWeight);
  expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(parseFloat(styles.padding)).toBeGreaterThan(0);
});
