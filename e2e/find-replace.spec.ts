import { expect, test, type Page } from "@playwright/test";
import { pasteMarkdown, HOME, emit, openApp, selectionRead } from "./helpers";

// Find and replace as other editors have it: the selected words become the
// query, Find again goes back to the box, closing leaves the match
// selected, and Replace All is one undo.

const DOC = "zebra one\n\nzebra two\n\nzebra three";

async function openDoc(page: Page) {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  return page.locator('[data-active-tab="true"] .ProseMirror');
}

test("Find takes the selected word, comes back to the box, and leaves the match selected", async ({
  page,
}) => {
  const editor = await openDoc(page);
  await editor.getByText("zebra two").click();
  await page.keyboard.press(HOME);
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await selectionRead(page);
  await page.keyboard.press("ControlOrMeta+f");
  const input = page.locator(".find-replace-input").first();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("zebra");
  await expect(page.locator(".find-replace-count")).toContainText("/ 3");

  // Back in the text, Find again selects the query to type over.
  await editor.getByText("zebra one").click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(input).toBeFocused();
  expect(
    await input.evaluate(
      (el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!,
    ),
  ).toBe(5);

  await input.fill("three");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator(".find-replace-bar")).toHaveCount(0);
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => String(window.getSelection()))).toBe(
    "three",
  );
});

test("Replace All is taken back by one undo", async ({ page }) => {
  const editor = await openDoc(page);
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

test("Find Next steps through the matches from the text, and Replace opens with its box", async ({
  page,
}) => {
  const editor = await openDoc(page);
  await page.keyboard.press("ControlOrMeta+f");
  const input = page.locator(".find-replace-input").first();
  await input.fill("zebra");
  await expect(page.locator(".find-replace-count")).toContainText("1 / 3");
  await page.keyboard.press("Escape");
  await expect(editor).toBeFocused();

  // Closed, it opens the bar again on what was looked for; open, it steps.
  const count = page.locator(".find-replace-count");
  await emit(page, "menu-find-next");
  await expect(count).toContainText("/ 3");
  const at = Number((await count.textContent())!.split("/")[0].trim());
  await emit(page, "menu-find-next");
  await expect(count).toContainText(`${(at % 3) + 1} / 3`);

  await page.keyboard.press("Escape");
  await emit(page, "menu-replace");
  await expect(page.locator(".find-replace-input").nth(1)).toBeVisible();
});
