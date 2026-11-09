import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown, settled } from "./helpers";

/**
 * A grammar fix applied with the caret far away keeps the page where it
 * is: WebKit scrolled back to the caret as the editor took the focus.
 */

test("applying a fix scrolled up to, the caret far below, keeps the page there", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const filler = Array.from({ length: 60 }, (_, i) => `Line ${i}.`).join(
    "\n\n",
  );
  await pasteMarkdown(page, `Teh first line.\n\n${filler}`);
  await page.locator(".milkdown p").first().click();
  await settled(page);
  await mockInvoke(page, {
    ai_grammar_check: [
      {
        start: 0,
        end: 3,
        issue: "Spelling.",
        suggestion: "The",
        original: "Teh",
      },
    ],
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("textus:trigger-grammar-check")),
  );
  const issue = page.locator(".milkdown .grammar-issue");
  await expect(issue).toBeVisible();
  await page.keyboard.press("ControlOrMeta+End");
  await settled(page);
  await issue.scrollIntoViewIfNeeded();
  await settled(page);
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  const before = await scroller.evaluate((el) => el.scrollTop);
  await issue.hover();
  await page.locator(".grammar-popover .grammar-popover-apply").click();
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The first line.",
  );
  await settled(page);
  expect(
    Math.abs((await scroller.evaluate((el) => el.scrollTop)) - before),
  ).toBeLessThan(40);
});
