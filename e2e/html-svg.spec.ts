import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * HTML in a document (<details>, tables, a few inline styles, inline SVG)
 * renders in the editor, the split preview and an HTML export, an SVG always
 * as a picture, never as live markup.
 */

const DOC = [
  // Not HTML first: a paste puts its first block into the empty line as
  // plain text.
  "# Notes",
  "",
  "<details>",
  "<summary>Folded notes</summary>",
  "",
  "Hidden **markdown** inside.",
  "",
  "</details>",
  "",
  "<details><summary>One block</summary><p>Written in one piece.</p></details>",
  "",
  "<table>",
  '  <tr><th colspan="2" align="center">Plan</th></tr>',
  '  <tr><td>Draft</td><td style="color: rgb(200, 0, 0)">late</td></tr>',
  "</table>",
  "",
  'A <span style="color: rgb(0, 128, 0); font-weight: bold">green</span> word and an icon <svg width="14" height="14" viewBox="0 0 14 14" onload="window.__svgRan = true"><circle cx="7" cy="7" r="6" fill="teal"/><script>window.__svgRan = true</script></svg> inline.',
  "",
  "The end.",
].join("\n");

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n),
    name,
  );
}

async function openDoc(page: Page) {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  // The caret ends on the last line, away from every snippet.
  await expect(editor.locator(".raw-html-details-head summary")).toBeVisible();
  return editor;
}

test("a <details> folds and opens from its summary in the editor", async ({
  page,
}) => {
  const editor = await openDoc(page);
  const hidden = editor.getByText("Hidden markdown inside.");
  await expect(hidden).toBeHidden();
  await editor.locator(".raw-html-details-head summary").click();
  await expect(hidden).toBeVisible();
  // The click opened it; it didn't put the caret on the source.
  await expect(editor).not.toContainText("<summary>", { useInnerText: true });
  await editor.locator(".raw-html-details-head summary").click();
  await expect(hidden).toBeHidden();
  // Beside the summary, a click gives the caret the source to edit.
  const head = editor.locator(".raw-html-details-head");
  const box = (await head.boundingBox())!;
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await expect(editor).toContainText("<summary>Folded notes</summary>", {
    useInnerText: true,
  });
  await expect(hidden).toBeVisible();
  await editor.getByText("The end.").click();

  // Written as one HTML block, it opens the same way, natively.
  const oneBlock = editor.locator(
    ".raw-html-rendered:not(.raw-html-details-head) details",
  );
  const inner = oneBlock.getByText("Written in one piece.");
  await expect(inner).toBeHidden();
  await oneBlock.locator("summary").click();
  await expect(inner).toBeVisible();
  await expect(editor).not.toContainText("<summary>", { useInnerText: true });
  // Elsewhere in the widget, a click gives the caret the source.
  await inner.click();
  await expect(editor).toContainText("<details><summary>One block", {
    useInnerText: true,
  });
});

test("a table, styled text and an inline SVG render in the editor", async ({
  page,
}) => {
  const editor = await openDoc(page);
  const table = editor.locator(".raw-html-rendered table");
  await expect(table.locator("th")).toHaveText("Plan");
  await expect(table.locator("th")).toHaveAttribute("colspan", "2");
  await expect(table.getByText("late")).toHaveCSS("color", "rgb(200, 0, 0)");
  await expect(editor.getByText("green", { exact: true })).toHaveCSS(
    "color",
    "rgb(0, 128, 0)",
  );
  const svg = editor.locator(".raw-html-rendered-inline img.html-svg");
  await expect(svg).toHaveCount(1);
  await expect(svg).toHaveAttribute("src", /^data:image\/svg\+xml/);
  // Drawn, and as a picture nothing inside it ran.
  await expect
    .poll(() => svg.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => "__svgRan" in window)).toBe(false);
  await expect(editor.locator("svg circle")).toHaveCount(0);
  // The caret on it brings the source back.
  await svg.click();
  await expect(editor).toContainText("<svg", { useInnerText: true });
});

test("the split view renders the same HTML the same way", async ({ page }) => {
  await openDoc(page);
  await emit(page, "menu-toggle-split-view");
  const preview = page.locator('[data-active-tab="true"] .split-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator("details summary").first()).toHaveText(
    "Folded notes",
  );
  await expect(preview.getByText("Hidden markdown inside.")).toBeHidden();
  await preview.locator("details summary").first().click();
  await expect(preview.getByText("Hidden markdown inside.")).toBeVisible();
  await expect(preview.locator("th")).toHaveAttribute("colspan", "2");
  await expect(preview.getByText("late")).toHaveCSS("color", "rgb(200, 0, 0)");
  await expect(preview.getByText("green", { exact: true })).toHaveCSS(
    "color",
    "rgb(0, 128, 0)",
  );
  const svg = preview.locator("img.html-svg");
  await expect(svg).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await expect(preview.locator("svg circle")).toHaveCount(0);
  expect(await page.evaluate(() => "__svgRan" in window)).toBe(false);
});

test("an HTML export carries the SVG as a picture and the folded markdown inside its <details>", async ({
  page,
}) => {
  await openDoc(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __written?: string;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/doc.html");
      if (cmd === "write_text_file") {
        w.__written = String(args?.contents ?? "");
        return Promise.resolve();
      }
      return invoke(cmd, args);
    };
  });
  await emit(page, "menu-export-html");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __written?: string }).__written ?? "",
      ),
    )
    .toContain("data:image/svg+xml");
  const html = await page.evaluate(
    () => (window as unknown as { __written: string }).__written,
  );
  const exported = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const details = doc.querySelector("details");
    return {
      svgImages: doc.querySelectorAll('img.html-svg[src^="data:image/svg+xml"]')
        .length,
      liveSvg: doc.querySelectorAll("svg circle").length,
      summary: details?.querySelector("summary")?.textContent,
      folded: details?.textContent?.includes("Hidden markdown inside."),
      table: doc.querySelector("th[colspan='2']")?.textContent,
      // The source's onload is text in the page, never an attribute.
      handlers: Array.from(doc.querySelectorAll("*")).filter((el) =>
        el.getAttributeNames().some((name) => name.startsWith("on")),
      ).length,
      scripts: doc.querySelectorAll("script").length,
      // "</details>" lines go with the editor that hid them.
      endLines: doc.querySelectorAll(".raw-html-details-end").length,
    };
  }, html);
  expect(exported).toEqual({
    svgImages: 1,
    liveSvg: 0,
    summary: "Folded notes",
    folded: true,
    table: "Plan",
    handlers: 0,
    scripts: 0,
    endLines: 0,
  });
});
