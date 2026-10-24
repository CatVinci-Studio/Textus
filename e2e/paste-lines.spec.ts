import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Text pasted in keeps its lines - an email pasted from a mail or chat app
 * came in as one long line, Markdown reading a line break inside a
 * paragraph as a space - and a quote copied with the bars it was drawn
 * with ("▎ ") is a quote (1.2.1).
 */

const editor = '[data-active-tab="true"] .ProseMirror';

async function pasteText(page: Page, text: string) {
  await page.locator(editor).click();
  await page.evaluate(
    ({ sel, text }) => {
      const pm = document.querySelector(sel) as HTMLElement;
      const data = new DataTransfer();
      data.setData("text/plain", text);
      pm.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { sel: editor, text },
  );
}

test("pasted lines stay lines, and a quote with bars is a quote", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteText(
    page,
    [
      "▎ Hi Denisse,",
      "▎",
      "▎ I went through your grading again.",
      "▎ The points were taken from the written analysis.",
      "▎",
      "▎ - T1, T2, T7: brief points.",
      "▎ - T3, T4: missing statistics.",
      "▎",
      "▎ Best,",
      "▎ Youzhe",
    ].join("\n"),
  );
  const quote = page.locator(`${editor} blockquote`);
  await expect(quote).toHaveCount(1);
  await expect(quote).not.toContainText("▎");
  await expect(quote.locator("li")).toHaveCount(2);
  // "Best," and "Youzhe" on lines of their own, as in the email.
  await expect(
    quote.locator("p", { hasText: "Best," }).locator("br"),
  ).toHaveCount(1);
  await expect(
    quote.locator("p", { hasText: "I went through" }).locator("br"),
  ).toHaveCount(1);
});

test("plain pasted lines keep their breaks", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteText(page, "Dear Sam,\nThanks for the notes.\nSee you Monday.");
  await expect(page.locator(`${editor} p`).first().locator("br")).toHaveCount(
    2,
  );
});
