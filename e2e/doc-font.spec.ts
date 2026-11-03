import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The document's text font, picked in Settings from the installed fonts:
 * found by a name in the UI's language, and set on the text under the
 * Default theme, which defines no font of its own to fall back on.
 */

const paragraph = '[data-active-tab="true"] .ProseMirror p';

test("a font found by its Chinese name sets the document's text in it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFonts: unknown }).__devFonts = [
      { name: "Georgia", local: {} },
      { name: "Songti SC", local: { zh: "宋体-简" } },
    ];
  });
  await openApp(page, { settings: { language: "zh" } });
  await pasteMarkdown(page, "红楼梦是中国古典四大名著之一。");

  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.locator(".settings-nav-item", { hasText: "编辑与外观" }).click();
  await page.getByRole("combobox", { name: "正文字体" }).click();
  await page.getByRole("textbox", { name: "搜索字体" }).fill("宋体");
  await expect(page.getByRole("option")).toHaveText(["宋体-简Songti SC"]);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("combobox", { name: "正文字体" })).toHaveText(
    "宋体-简",
  );
  const family = await page
    .locator(paragraph)
    .first()
    .evaluate((p) => getComputedStyle(p).fontFamily);
  expect(family.startsWith('"Songti SC", ')).toBe(true);
});
