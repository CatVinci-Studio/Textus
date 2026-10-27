import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A table's header cells wrap like the cells under them, so a long header
// neither widens the table nor runs over the next column.

const LONG = {
  zh: "| 序号 | 这是一个很长的中文表头，需要自动换行才能完整显示，否则会把整列撑得很宽 | 状态 |\n| --- | --- | --- |\n| 1 | 正文 | 完成 |\n",
  en: "| # | A very long English header that ought to wrap onto more lines instead of stretching its column | State |\n| --- | --- | --- |\n| 1 | body | done |\n",
};

/** A CJK header with no punctuation to break after: one word, kept whole
 *  in a table sized to its content, broken once the widths are set. */
const UNBROKEN =
  "| 序号 | 这是一个没有任何标点符号的很长的中文表头需要换行 | 状态 |\n| --- | --- | --- |\n| 1 | 正文 | 完成 |\n";

/** Eight short CJK labels in a narrow table. */
const LABELS =
  "| 序号 | 名称 | 数量 | 单价 | 金额 | 备注 | 状态 | 负责人 |\n|---|---|---|---|---|---|---|---|\n| 1 | 一个名字比较长的商品条目 | 200 | 12 | 2400 | 加急 | 进行中 | 李四 |\n";

const headers = (page: Page) => page.locator(".milkdown th");

/** How many lines a cell's text takes. */
const linesIn = (page: Page, index: number) =>
  headers(page)
    .nth(index)
    .evaluate((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell.querySelector("p") ?? cell);
      const tops = new Set(
        Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)),
      );
      return tops.size;
    });

/** Whether the table is wider than the box it scrolls in. */
const scrolls = (page: Page) =>
  page
    .locator(".table-scroll")
    .evaluate((box) => box.scrollWidth > box.clientWidth + 1);

/** Gives every column a width, as a resize drag does. */
async function setColumnWidths(page: Page, widths: number[]) {
  await page.evaluate((widths) => {
    type Node = {
      type: { name: string };
      attrs: Record<string, unknown>;
    };
    type Transaction = {
      setNodeMarkup(pos: number, type: undefined, attrs: object): Transaction;
    };
    type View = {
      state: {
        tr: Transaction;
        doc: {
          descendants(f: (node: Node, pos: number) => void): void;
          resolve(pos: number): { index(): number };
        };
      };
      dispatch(tr: Transaction): void;
    };
    const view = (window as unknown as { __pmView: View }).__pmView;
    let tr = view.state.tr;
    view.state.doc.descendants((node, pos) => {
      if (!["table_header", "table_cell"].includes(node.type.name)) return;
      const index = view.state.doc.resolve(pos).index();
      tr = tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        colwidth: [widths[index]],
      });
    });
    view.dispatch(tr);
  }, widths);
}

for (const lang of ["zh", "en"] as const) {
  test(`a long ${lang} header wraps instead of widening the table`, async ({
    page,
  }) => {
    await openApp(page, { settings: { language: lang } });
    await pasteMarkdown(page, LONG[lang]);
    expect(await linesIn(page, 1)).toBeGreaterThan(1);
    expect(await scrolls(page)).toBe(false);
    // A short header stays whole, CJK included.
    expect(await linesIn(page, 0)).toBe(1);
    expect(await linesIn(page, 2)).toBe(1);

    const wide = await linesIn(page, 1);
    await page.setViewportSize({ width: 640, height: 700 });
    await expect.poll(() => linesIn(page, 1)).toBeGreaterThan(wide);
    expect(await scrolls(page)).toBe(false);
  });

  test(`a long ${lang} header stays in its column when the widths are set`, async ({
    page,
  }) => {
    await openApp(page, { settings: { language: lang } });
    await pasteMarkdown(page, LONG[lang]);
    await setColumnWidths(page, [80, 200, 120]);
    await expect(page.locator(".milkdown table[data-sized]")).toHaveCount(1);
    const header = headers(page).nth(1);
    const overflow = await header.evaluate(
      (cell) => cell.scrollWidth - cell.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(await linesIn(page, 1)).toBeGreaterThan(2);
  });
}

test("a CJK header with no punctuation breaks once the widths are set", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, UNBROKEN);
  await setColumnWidths(page, [80, 200, 120]);
  const header = headers(page).nth(1);
  expect(
    await header.evaluate((cell) => cell.scrollWidth - cell.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(await linesIn(page, 1)).toBeGreaterThan(1);
});

test("short CJK labels stay whole in a narrow table", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 700 });
  await openApp(page);
  await pasteMarkdown(page, LABELS);
  for (let i = 0; i < 8; i++) expect(await linesIn(page, i)).toBe(1);
  expect(await scrolls(page)).toBe(false);
});

test("a long header wraps in print", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, LONG.en);
  await setColumnWidths(page, [400, 600, 400]);
  await page.emulateMedia({ media: "print" });
  const header = headers(page).nth(1);
  expect(
    await header.evaluate((cell) => cell.scrollWidth - cell.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(await linesIn(page, 1)).toBeGreaterThan(1);
});

test("a table too wide to wrap still scrolls sideways", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  // More columns than the text column holds at each cell's floor.
  const columns = Array.from({ length: 24 }, (_, i) => `Header ${i + 1}`);
  await pasteMarkdown(
    page,
    `| ${columns.join(" | ")} |\n|${" --- |".repeat(columns.length)}\n|${" x |".repeat(columns.length)}\n`,
  );
  expect(await scrolls(page)).toBe(true);
});
