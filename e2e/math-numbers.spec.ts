import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * Equation numbers run in order across the document, as LaTeX numbers them,
 * in the editor, the split preview and an HTML export. \tag replaces a
 * row's number, \notag drops it, and the starred forms have none.
 */

const DOC = [
  // Not math first: a paste puts its first block into the empty line as
  // plain text.
  "Numbers",
  "",
  "$$",
  "\\begin{gather}",
  "a=1\\\\",
  "b=2",
  "\\end{gather}",
  "$$",
  "",
  "Between.",
  "",
  "$$",
  "\\begin{align}",
  "c&=3 \\tag{A}\\\\",
  "d&=4 \\notag\\\\",
  "e&=5",
  "\\end{align}",
  "$$",
  "",
  "$$",
  "\\begin{gather*}",
  "f=6\\\\",
  "g=7",
  "\\end{gather*}",
  "$$",
  "",
  "$$",
  "\\begin{equation}",
  "h=8",
  "\\end{equation}",
  "$$",
  "",
  "The end.",
].join("\n");

/** What each display formula under `scope` shows at the right ("(1)(2)").
 *  The numbers are CSS counters in ::before, which no DOM API reads back,
 *  so this asks Chromium's layout snapshot. */
async function equationLabels(page: Page, scope: string): Promise<string[]> {
  const count = await page.evaluate((selector) => {
    const displays = document.querySelectorAll(
      `${selector} .katex-display > .katex > .katex-html`,
    );
    displays.forEach((el, i) => el.setAttribute("data-eqn-probe", String(i)));
    return displays.length;
  }, scope);
  const cdp = await page.context().newCDPSession(page);
  const snap = await cdp.send("DOMSnapshot.captureSnapshot", {
    computedStyles: [],
  });
  await cdp.detach();
  await page.evaluate(() =>
    document
      .querySelectorAll("[data-eqn-probe]")
      .forEach((el) => el.removeAttribute("data-eqn-probe")),
  );
  const { strings } = snap;
  const { nodes, layout } = snap.documents[0];
  const parent = nodes.parentIndex ?? [];
  const attr = (node: number, name: string): string | undefined => {
    const list = nodes.attributes?.[node] ?? [];
    for (let i = 0; i < list.length; i += 2)
      if (strings[list[i]] === name) return strings[list[i + 1]];
    return undefined;
  };
  const labels: string[] = Array.from({ length: count }, () => "");
  layout.nodeIndex.forEach((node, i) => {
    const text = layout.text[i] >= 0 ? strings[layout.text[i]] : "";
    if (!text) return;
    let inTag = false;
    for (let n = node; n >= 0; n = parent[n]) {
      if (/\bkatex-tag\b/.test(attr(n, "class") ?? "")) inTag = true;
      const probe = attr(n, "data-eqn-probe");
      if (probe !== undefined) {
        if (inTag) labels[Number(probe)] += text;
        return;
      }
    }
  });
  return labels.map((label) => label.replace(/[\s\u200b]/g, ""));
}

const EXPECTED = ["(1)(2)", "(A)(3)", "", "(4)"];

async function openDoc(page: Page) {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  // The caret ends on the last line, away from every formula.
  await expect(
    page.locator('[data-active-tab="true"] .math-block-rendered'),
  ).toHaveCount(4);
}

test("equation numbers run on across the formulas in the editor", async ({
  page,
}) => {
  await openDoc(page);
  expect(
    await equationLabels(page, '[data-active-tab="true"] .milkdown'),
  ).toEqual(EXPECTED);
});

test("the split view's preview numbers the formulas the same way", async ({
  page,
}) => {
  await openDoc(page);
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-toggle-split-view"),
  );
  const preview = '[data-active-tab="true"] .split-preview';
  await expect(page.locator(`${preview} .katex-display`)).toHaveCount(4);
  expect(await equationLabels(page, preview)).toEqual(EXPECTED);
});

test("an HTML export keeps the equation numbers", async ({ page, context }) => {
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
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-export-html");
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __written?: string }).__written ?? "",
      ),
    )
    .toContain("katex-display");
  const html = await page.evaluate(
    () => (window as unknown as { __written: string }).__written,
  );
  // The file on its own, as a browser opens it.
  const exported = await context.newPage();
  await exported.setContent(html);
  expect(await equationLabels(exported, ".milkdown")).toEqual(EXPECTED);
});
