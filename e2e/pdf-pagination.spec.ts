import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Scrollbars shown, as WebView2 shows them on Windows: headless Chromium
// hides them by default.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const PAGE = { width: 793, height: 1056, margin: 76 };

/** A long page of prose: paragraphs of many lengths, so a change in the
 *  text's width changes how many lines some of them take. */
function proseHtml(): string {
  const words =
    "the city keeps its old streets while people write about memory and time".split(
      " ",
    );
  const paragraphs = Array.from({ length: 80 }, (_, i) => {
    const count = 20 + ((i * 37) % 90);
    const text = Array.from(
      { length: count },
      (_, k) => words[(i + k * 7) % words.length],
    );
    return `<p>${text.join(" ")}.</p>`;
  });
  return `<!doctype html><html><head><style>
::-webkit-scrollbar { width: 17px; background: #eee; }
html, body { margin: 0; height: 100%; }
.editor-content { padding: ${PAGE.margin}px ${PAGE.margin}px 0; }
p { margin: 0 0 12px; font: 16px/24px sans-serif; }
</style></head><body><div class="editor-content"><div class="milkdown"><div class="ProseMirror">${paragraphs.join("")}</div></div></div></body></html>`;
}

/** `source` paginated for PAGE, as the export does before printing. */
async function paginated(page: Page, source: string): Promise<string> {
  await openApp(page);
  return page.evaluate(
    async ([html, sheet]) => {
      const path = "/src/export/paginate.ts";
      const { paginateHtml } = await import(/* @vite-ignore */ path);
      return (await paginateHtml(html, sheet)) as string;
    },
    [source, PAGE] as const,
  );
}

/** The printed sheet: exactly the page's width, nothing beside the text. */
async function sheetOf(page: Page, html: string): Promise<Page> {
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: PAGE.width, height: PAGE.height });
  await sheet.setContent(html);
  await sheet.addStyleTag({ content: "html { overflow: hidden; }" });
  return sheet;
}

test("PDF pages are laid out at the sheet's width, not narrowed by a scrollbar (#736)", async ({
  page,
}) => {
  const sheet = await sheetOf(page, await paginated(page, proseHtml()));
  const outside = await sheet.evaluate(({ height, margin }) => {
    const blocks = document.querySelectorAll(
      ".ProseMirror > :not(.textus-page-spacer)",
    );
    return Array.from(blocks).flatMap((block, i) => {
      const { top, bottom } = block.getBoundingClientRect();
      const pageTop = Math.floor(top / height) * height;
      return top < pageTop + margin - 0.5 ||
        bottom > pageTop + height - margin + 0.5
        ? [`block ${i}: ${Math.round(top)}-${Math.round(bottom)}`]
        : [];
    });
  }, PAGE);
  expect(outside).toEqual([]);
});

test("a document ending a fraction of a pixel into its last page prints no blank page after it (#736)", async ({
  page,
  browserName,
}) => {
  // Playwright prints to PDF in Chromium only (WebView2's engine).
  test.skip(browserName !== "chromium", "page.pdf is Chromium's");
  // A page's worth, then a block ending 0.4 px past a whole pixel on the
  // second page.
  const source = proseHtml().replace(
    /<div class="ProseMirror">.*<\/div><\/div><\/div>/,
    '<div class="ProseMirror"><p style="height:880px"></p><p style="height:608.4px"></p></div></div></div>',
  );
  const sheet = await sheetOf(page, await paginated(page, source));
  const pdf = await sheet.pdf({
    width: `${PAGE.width}px`,
    height: `${PAGE.height}px`,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
  expect(pages).toHaveLength(2);
});
