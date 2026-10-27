import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * Text pasted in keeps its lines - an email pasted from a mail or chat app
 * came in as one long line, Markdown reading a line break inside a
 * paragraph as a space - and a quote copied with the bars it was drawn
 * with ("▎ ") is a quote (1.2.1).
 */

const editor = '[data-active-tab="true"] .ProseMirror';

async function pasteFlavors(page: Page, flavors: Record<string, string>) {
  await page.locator(editor).click();
  await page.evaluate(
    ({ sel, flavors }) => {
      const pm = document.querySelector(sel) as HTMLElement;
      const data = new DataTransfer();
      for (const [type, value] of Object.entries(flavors))
        data.setData(type, value);
      pm.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { sel: editor, flavors },
  );
}

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

test("a quote that starts with a list stays a quote", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteText(page, "> - one\n> - two");
  const quote = page.locator(`${editor} blockquote`);
  await expect(quote).toHaveCount(1);
  await expect(quote.locator("li")).toHaveText(["one", "two"]);
});

test("a code block pasted on an empty list item stays a code block", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await page.keyboard.type("- item", { delay: 20 });
  await page.keyboard.press("Enter");
  await pasteMarkdown(page, "```js\nx\ny\n```");
  await expect(page.locator(`${editor} li pre`)).toHaveCount(1);
  await expect(page.locator(`${editor} li pre`)).toContainText("x\ny");
  await expect(page.locator(`${editor} li`).nth(1).locator("p")).toHaveText("");
});

test("a code block pasted into a table cell stays in the cell as text", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "| a | b |\n| - | - |\n| c | d |");
  await page.locator(`${editor} td`).first().click();
  await pasteMarkdown(page, "```js\nx\n```");
  await expect(page.locator(`${editor} table`)).toHaveCount(1);
  await expect(page.locator(`${editor} pre`)).toHaveCount(0);
});

test("a code block pasted in the middle of a line stays a code block between its halves", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await page.keyboard.type("beforeafter", { delay: 20 });
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  // Once ProseMirror has read the caret the arrows moved.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await pasteMarkdown(page, "```js\nx\ny\n```");
  await expect(page.locator(`${editor} pre`)).toContainText("x\ny");
  await expect(page.locator(`${editor} > p`)).toHaveText(["before", "after"]);
});

test("plain pasted lines keep their breaks", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteText(page, "Dear Sam,\nThanks for the notes.\nSee you Monday.");
  await expect(page.locator(`${editor} p`).first().locator("br")).toHaveCount(
    2,
  );
});

// 1.2.2: what the paste audit found (paste-lines.ts, paste-html.ts).

test("a paragraph a PDF wrapped at its width comes in whole", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteText(
    page,
    [
      "The results show that the proposed method significantly",
      "outperforms the baseline on all three benchmarks. In particular,",
      "the effect is strongest for long documents, where the corpus",
      "contains more than ten thousand files.",
    ].join("\n"),
  );
  const p = page.locator(`${editor} p`).first();
  await expect(p).toContainText("significantly outperforms the baseline");
  await expect(p.locator("br")).toHaveCount(0);
});

test("a terminal's output is a code block, its columns kept", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteText(
    page,
    "Filesystem      Size  Used Avail\n/dev/nvme0n1p2  468G  301G  144G\ntmpfs            16G  1.2M   16G",
  );
  await expect(page.locator(`${editor} pre`)).toContainText(
    "tmpfs            16G",
  );
});

test("a line ending in a web address keeps its link and its break", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteText(page, "Map: https://map.example.com/?q=hall\nSee you there");
  const p = page.locator(`${editor} p`).first();
  await expect(p.locator("br")).toHaveCount(1);
  await expect(p).not.toContainText("\\");
});

test("Google Docs' bold, italic and struck text stay so", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteFlavors(page, {
    "text/html":
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Friday</span><span style="font-weight:400;"> and </span><span style="font-style:italic;">mostly</span><span> </span><span style="text-decoration:line-through;">(old)</span></p></b>',
    "text/plain": "Friday and mostly (old)",
  });
  await expect(page.locator(`${editor} strong`)).toHaveText("Friday");
  await expect(page.locator(`${editor} em`)).toHaveText("mostly");
  await expect(page.locator(`${editor} del, ${editor} s`)).toHaveText("(old)");
});

test("an Outlook message comes in without its empty paragraphs", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteFlavors(page, {
    "text/html":
      '<p class=MsoNormal>Hi Chen,<o:p></o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>See the <a href="https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fq3&amp;data=05">sheet</a>.<o:p></o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>Thanks,<o:p></o:p></p>',
    "text/plain": "Hi Chen,\n\nSee the sheet.\n\nThanks,",
  });
  await expect(page.locator(`${editor} > p`)).toHaveCount(3);
  await expect(page.locator(`${editor} a`)).toHaveAttribute(
    "href",
    "https://example.com/q3",
  );
});
