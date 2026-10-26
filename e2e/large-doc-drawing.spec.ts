import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// In a large document a formula or a diagram off screen is drawn only once
// it comes near, and an export, which copies the page, still has all drawn.

const editor = '[data-active-tab="true"] .ProseMirror';
const COUNT = 1400;

const DIAGRAM = ["```mermaid", "flowchart LR", "  A --> B", "```"].join("\n");

// Past the large-document threshold: 1400 paragraphs of ~100 characters,
// each with a formula of its own, and a diagram at the start and the end.
const DOC = [
  "# Large",
  DIAGRAM,
  ...Array.from(
    { length: COUNT },
    (_, i) =>
      `Paragraph ${i} keeps a formula of its own, $x_{${i}} + y$, among words that fill the line.`,
  ),
  DIAGRAM.replace("A --> B", "C --> D"),
  "The end.",
].join("\n\n");

const formulaIn = (page: Page, i: number) =>
  page
    .locator(`${editor} p`, { hasText: `Paragraph ${i} keeps` })
    .locator(".math-inline-rendered");

/** File > Export as HTML, and the page it writes. */
async function exportedHtml(page: Page): Promise<string> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __devEmitTauriEvent: (name: string) => void;
      __exported?: string;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/doc.html");
      if (cmd === "write_text_file" && args?.path === "/tmp/doc.html") {
        w.__exported = String(args.contents);
        return Promise.resolve();
      }
      if (cmd === "reveal_in_dir") return Promise.resolve();
      return invoke(cmd, args);
    };
    w.__devEmitTauriEvent("menu-export-html");
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __exported?: string }).__exported ?? "",
      ),
    )
    .toContain("<html");
  return page.evaluate(
    () => (window as unknown as { __exported: string }).__exported,
  );
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { settings: { language: "en" } });
  // Opened, as a file is: a paste that makes a document large draws no
  // new diagram (large-doc mode).
  await page.evaluate((markdown) => {
    const w = window as unknown as Record<string, unknown> & {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    w.__devFiles = { "/notes/large.md": markdown };
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/notes/large.md"],
      position: { x: 0, y: 0 },
    });
  }, DOC);
  await expect(formulaIn(page, 0).locator(".katex")).toBeVisible();
  await page
    .locator('[data-active-tab="true"] > .editor-scroll')
    .evaluate((el) => (el.scrollTop = 0));
});

test("a formula and a diagram far down wait until they come near", async ({
  page,
}) => {
  const last = formulaIn(page, COUNT - 1);
  await expect(last).toHaveAttribute("data-draw-pending", "");
  await expect(last.locator(".katex")).toHaveCount(0);
  await expect(page.locator(`${editor} .mermaid-preview`)).toHaveCount(1);

  await page
    .locator(`${editor} p`, { hasText: "The end." })
    .scrollIntoViewIfNeeded();
  await expect(last.locator(".katex")).toHaveCount(1);
  await expect(last).not.toHaveAttribute("data-draw-pending");
  await expect(page.locator(`${editor} .mermaid-preview`)).toHaveCount(2);
});

test("an export draws every formula and diagram first", async ({ page }) => {
  const html = await exportedHtml(page);
  expect(html.match(/class="math-inline-rendered\b/g)).toHaveLength(COUNT);
  expect(html.match(/class="katex"/g)).toHaveLength(COUNT);
  expect(html).not.toContain("data-draw-pending=");
  expect(html.match(/class="mermaid-preview\b/g)).toHaveLength(2);
});
