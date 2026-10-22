import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// KaTeX loads on a document's first formula (src/editor/math/katex-loader.ts)
// instead of with the app. A document that has maths waits for it before
// it opens (KatexFirst), so its formulas are drawn from the first frame.

const editor = '[data-active-tab="true"] .ProseMirror';

function openRecent(page: Page, path: string) {
  return page.evaluate(
    (p) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-open-recent", p),
    path,
  );
}

test("the app opens without loading KaTeX", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openApp(page, { settings: { language: "en" } });
  await page.waitForTimeout(500);
  // The library, its stylesheet and fonts - not the small loader.
  const katex = /katex-bundle|deps\/katex|katex(\.min)?\.css|KaTeX_/;
  expect(requests.filter((url) => katex.test(url))).toEqual([]);
});

test("a document with maths opens with its formulas already drawn", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    read_text_file: "# Maths\n\nEnergy $E=mc^2$ and $a+b$.\n",
    open_paths: null,
  });
  // What the editor shows the first time its formulas are in the page.
  await page.evaluate(() => {
    const w = window as unknown as { __firstMath?: number[] };
    new MutationObserver(() => {
      const nodes = document.querySelectorAll(
        '[data-active-tab="true"] [data-type="math_inline"]',
      ).length;
      if (w.__firstMath || nodes === 0) return;
      const drawn = document.querySelectorAll(
        '[data-active-tab="true"] .math-inline-rendered .katex',
      ).length;
      w.__firstMath = [nodes, drawn];
    }).observe(document.body, { childList: true, subtree: true });
  });
  await openRecent(page, "/home/me/maths.md");
  await expect(page.locator(`${editor} h1`)).toContainText("Maths");
  const first = await page.evaluate(
    () => (window as unknown as { __firstMath?: number[] }).__firstMath,
  );
  expect(first).toEqual([2, 2]);
});

test("a formula in a Textus AI proposal is drawn as soon as KaTeX loads", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "The first paragraph.\n\nThe second paragraph.");
  // KaTeX arrives well after the proposal is shown, as on a slow disk.
  await page.route(/katex-bundle/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "m1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "insert_after",
          anchor: "The first paragraph.",
          text: "Its area is $\\pi r^2$.",
        }),
      },
      { kind: "ToolResult", call_id: "m1", output: "Edit proposed" },
      { kind: "Assistant", text: "Added it." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Add the area");
  await composer.press("Enter");
  const proposal = page.locator(`${editor} .pending-insert`);
  // The source while KaTeX loads, then the formula - with nothing else
  // happening in the editor to draw it again.
  await expect(proposal.locator(".math-pending")).toHaveCount(1);
  await expect(proposal.locator(".katex")).toHaveCount(1);
  await expect(proposal.locator(".math-pending")).toHaveCount(0);
});

test("a formula added to a document without maths is drawn once KaTeX loads", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Area $\\pi r^2$ of a circle");
  await expect(
    page.locator(`${editor} .math-inline-rendered .katex`),
  ).toHaveCount(1);
  await expect(page.locator(`${editor} .math-source-hidden`)).toHaveCount(1);
});
