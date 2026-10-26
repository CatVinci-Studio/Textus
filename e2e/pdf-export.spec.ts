import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * PDF export on Windows: the export lays out the page margins itself, so a
 * block taller than a page is cut into one piece per page. Chromium stands
 * in for WebView2.
 */

// Keep in step with WINDOWS_PAGE.
const PAGE = { width: 794, height: 1122, margin: 76 };

const DOC = [
  "# Tall blocks",
  "",
  "```js",
  ...Array.from(
    { length: 150 },
    (_, i) => `const line${i} = "value ${i}"; // comment ${i}`,
  ),
  "```",
  "",
  "| # | Name | Note |",
  "|---|---|---|",
  ...Array.from({ length: 80 }, (_, i) => `| ${i} | row ${i} | note ${i} |`),
  "",
  Array.from({ length: 40 }, (_, i) => `> Quoted paragraph ${i}.`).join(
    "\n>\n",
  ),
  "",
  ...Array.from({ length: 60 }, (_, i) => `${i + 1}. item ${i}`),
  "",
  Array.from({ length: 400 }, (_, i) => `word${i}`).join(" "),
  "",
  "The end.",
].join("\n");

/** Exports the document as Windows does and returns the paginated HTML
 *  the native renderer would get. */
async function exportedHtml(page: Page): Promise<string> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
  });
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __devEmitTauriEvent: (name: string) => void;
      __pdfHtml?: string;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/doc.pdf");
      if (cmd === "export_pdf_native") {
        w.__pdfHtml = String(args?.html);
        return Promise.resolve();
      }
      if (cmd === "reveal_in_dir") return Promise.resolve();
      return invoke(cmd, args);
    };
    w.__devEmitTauriEvent("menu-export-pdf");
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __pdfHtml?: string }).__pdfHtml ?? "",
      ),
    )
    .toContain("<html");
  return page.evaluate(
    () => (window as unknown as { __pdfHtml: string }).__pdfHtml,
  );
}

test("no block taller than a page runs into a page's top or bottom margin", async ({
  page,
}) => {
  const html = await exportedHtml(page);
  await page.setViewportSize({ width: PAGE.width, height: PAGE.height });
  await page.setContent(html);
  const result = await page.evaluate(({ height, margin }) => {
    const root = document.querySelector(".ProseMirror")!;
    const inMargin: string[] = [];
    // Every box in the document - each piece of a cut block, its lines,
    // rows and highlighted spans - must sit inside one page's text area.
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.closest(".textus-page-spacer")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) continue;
      const top = rect.top + scrollY;
      const bottom = rect.bottom + scrollY;
      const pageTop = Math.floor(top / height) * height;
      if (
        top < pageTop + margin - 0.5 ||
        bottom > pageTop + height - margin + 0.5
      )
        inMargin.push(
          `${el.tagName} ${Math.round(top)}-${Math.round(bottom)}: ${el.textContent?.slice(0, 30)}`,
        );
    }
    return {
      inMargin,
      codePieces: root.querySelectorAll("pre").length,
      tablePieces: root.querySelectorAll("table").length,
      headers: root.querySelectorAll("tr[data-is-header]").length,
      quotePieces: root.querySelectorAll("blockquote").length,
      listStarts: Array.from(root.querySelectorAll("ol")).map((ol) => ol.start),
      codeText: Array.from(root.querySelectorAll("pre"))
        .map((pre) => pre.textContent)
        .join(""),
      highlighted: root.querySelectorAll("pre .token.comment").length,
    };
  }, PAGE);
  expect(result.inMargin).toEqual([]);
  expect(result.codePieces).toBeGreaterThan(1);
  expect(result.tablePieces).toBeGreaterThan(1);
  // Each piece of the table starts with its header row.
  expect(result.headers).toBe(result.tablePieces);
  expect(result.quotePieces).toBeGreaterThan(1);
  expect(result.listStarts.length).toBeGreaterThan(1);
  expect(result.listStarts[0]).toBe(1);
  // Cut between lines: every line once, each still highlighted.
  expect(result.codeText.split("\n")).toHaveLength(150);
  expect(result.highlighted).toBe(150);
});
