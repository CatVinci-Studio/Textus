import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// Replace All is one undo step, even right after another edit.

test("Replace All is taken back by one undo", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "zebra one\n\nzebra two\n\nzebra three");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(".find-replace-input").first().fill("zebra");
  await page.locator(".find-replace-chevron").click();
  await page.locator(".find-replace-input").nth(1).fill("horse");
  await page.getByRole("button", { name: "Replace All" }).click();
  await expect(editor).not.toContainText("zebra");
  await editor.getByText("horse two").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("p")).toHaveText([
    "zebra one",
    "zebra two",
    "zebra three",
  ]);
});
