import { expect, test, type Page } from "@playwright/test";
import { MAC, openApp, pasteMarkdown, settled } from "./helpers";

// A table's own tools at its top right: they show on hover and while the
// caret is in it, and change what the file says.

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";

async function open(page: Page, markdown = TABLE, animations = false) {
  await page.setViewportSize({ width: 1200, height: 760 });
  // No completion: its suggestion, waiting at the caret in a cell, widens
  // the column under the pointer on its way to the tools.
  await openApp(page, {
    settings: { menuBarShown: false, language: "en", enableCompletion: false },
    animations,
  });
  await page.locator(".ProseMirror:visible").first().click();
  await pasteMarkdown(page, markdown);
  return page.locator(".table-wrapper").first();
}

const tool = (page: Page, name: string, exact = true) =>
  page.locator(".table-toolbar").getByRole("button", { name, exact });

/** A tool pressed as a hand does: from the head row, which shows them,
 *  straight across to it, leaving the table on its way. */
async function press(page: Page, name: string, exact = true) {
  await page.locator(".table-wrapper th").first().hover();
  const to = (await tool(page, name, exact).boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.down();
  await page.mouse.up();
}

test("a table's tools align the caret's column, size it, and delete it", async ({
  page,
}) => {
  const table = await open(page);
  await table.locator("td", { hasText: "2" }).click();
  // Its tools come with the pointer by its head row, not with the caret.
  const tools = table.locator(".block-toolbar-actions");
  await expect(tools).toHaveCSS("opacity", "0");
  await table.locator("th").last().hover();
  await expect(tools).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/table-tools.png" });
  await press(page, "Align Center");
  await expect(table.locator("th").nth(1)).toHaveCSS("text-align", "center");
  await expect(table.locator("td").nth(1)).toHaveCSS("text-align", "center");

  await press(page, "Rows and Columns 2 × 2", false);
  const card = page.getByRole("dialog", { name: "Rows and Columns" });
  await expect(card).toBeVisible();
  await card.locator('[data-cell="2,2"]').hover();
  await expect(card.getByText("3 × 3")).toBeVisible();
  await page.screenshot({ path: "test-results/table-size.png" });
  await card.locator('[data-cell="2,2"]').click();
  await expect(card).toHaveCount(0);
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);

  // Smaller again: the cells with text it would cut are marked first.
  await press(page, "Rows and Columns 3 × 3", false);
  await card.locator('[data-cell="1,0"]').hover();
  await expect(card.locator(".is-lost")).toHaveCount(2);
  await expect(card.getByText("Cells with text will be removed")).toBeVisible();
  await page.screenshot({ path: "test-results/table-size-lost.png" });
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // Over a narrow column the tools give way rather than run past the table.
  await page.setViewportSize({ width: 330, height: 760 });
  await settled(page);
  await table.locator("th").last().hover();
  const box = (await table.boundingBox())!;
  for (const pill of await table.locator(".block-pill:visible").all())
    expect((await pill.boundingBox())!.x).toBeGreaterThanOrEqual(box.x - 0.5);
  await expect(tool(page, "Delete Table")).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 760 });

  await press(page, "Delete Table");
  await expect(page.locator(".table-wrapper")).toHaveCount(0);
});

test("a row's grip picks the row, and pulled it moves the row; a column's the same", async ({
  page,
}) => {
  const table = await open(
    page,
    "intro\n\n| h | k |\n| --- | --- |\n| 1 | x |\n| 2 | y |\n| 3 | z |\n",
  );
  const cell = (text: string) => table.locator("td", { hasText: text });
  await cell("3").hover();
  const grip = page.locator(".table-grip-row");
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  const top = (await cell("1").boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top.y + 2, { steps: 8 });
  await expect(page.locator(".table-wrapper[data-dragging=row]")).toHaveCount(
    1,
  );
  await page.screenshot({ path: "test-results/table-grip-drag.png" });
  await page.mouse.up();
  const firstColumn = () =>
    table.locator("tbody tr td:first-child").allInnerTexts();
  await expect.poll(firstColumn).toEqual(["3", "1", "2"]);

  await cell("y").hover();
  const colGrip = page.locator(".table-grip-col");
  const c = (await colGrip.boundingBox())!;
  const left = (await table.locator("th").first().boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(left.x + 4, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(table.locator("th").first()).toHaveText("k");

  // Pressed without a pull: the whole row is picked.
  await cell("1").hover();
  await page.locator(".table-grip-row").click();
  await expect(table.locator(".selectedCell")).toHaveCount(2);

  // With no mouse over it (a finger), the grips follow the caret; a column
  // picked leaves the row grip on the caret's row.
  await cell("1").click();
  await page.mouse.move(2, 2);
  const rowY = async () => (await grip.boundingBox())!.y;
  const before = await rowY();
  await page.locator(".table-grip-col").dispatchEvent("click");
  await expect(table.locator(".selectedCell")).toHaveCount(4);
  expect(await rowY()).toBe(before);

  // Zoomed, with the caret out of the table: the lifted row stays under the
  // pointer, and let go, it lands where the others made room.
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--content-zoom", "1.25"),
  );
  await page.locator(".ProseMirror p").first().click();
  const order = await firstColumn();
  await cell(order[2]!).hover();
  const g2 = (await grip.boundingBox())!;
  const lifted = table.locator("tbody tr").nth(3);
  const was = (await lifted.boundingBox())!;
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.mouse.down();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2 - 30, {
    steps: 6,
  });
  const now = (await lifted.boundingBox())!;
  expect(Math.abs(now.y - was.y + 30)).toBeLessThan(2);
  const up = (await cell(order[0]!).boundingBox())!;
  await page.mouse.move(g2.x + g2.width / 2, up.y + 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(firstColumn).toEqual([order[2], order[0], order[1]]);

  // A column's edge, zoomed too: no column jumps when it is pressed, and
  // the edge stays under the pointer.
  const heads = table.locator("th");
  const h0 = (await heads.nth(0).boundingBox())!;
  const h1 = (await heads.nth(1).boundingBox())!;
  const edge = { x: h0.x + h0.width - 1, y: h0.y + h0.height / 2 };
  await page.mouse.move(edge.x - 6, edge.y);
  await page.mouse.move(edge.x, edge.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(edge.x + 1, edge.y);
  const pressed = (await heads.nth(1).boundingBox())!.width;
  expect(Math.abs(pressed - h1.width)).toBeLessThan(2);
  await page.mouse.move(edge.x + 40, edge.y, { steps: 6 });
  // Held past the history's grouping: still one undo step.
  await page.waitForTimeout(700);
  await page.mouse.up();
  const after = (await heads.nth(0).boundingBox())!;
  expect(Math.abs(after.width - (h0.width + 40))).toBeLessThan(3);
  await page.keyboard.press(MAC ? "Meta+z" : "Control+z");
  await expect
    .poll(async () => (await heads.nth(0).boundingBox())!.width)
    .toBeCloseTo(h0.width, 0);
  await expect(table.locator("table")).not.toHaveAttribute("data-sized", /.*/);

  // A press on the edge that moves nothing sizes nothing.
  await page.mouse.move(edge.x - 6, edge.y);
  await page.mouse.move(edge.x, edge.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(table.locator("table")).not.toHaveAttribute("data-sized", /.*/);
});

test("the grips sit at the middle of their row and column, the document zoomed too", async ({
  page,
}) => {
  const table = await open(
    page,
    "| h | k |\n| --- | --- |\n| 1 | x |\n| 2 | y |\n| 3 | z |\n",
  );
  const middle = async (selector: string) => {
    const b = (await page.locator(selector).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  for (const zoom of ["1", "1.5"]) {
    await page.evaluate(
      (z) => document.documentElement.style.setProperty("--content-zoom", z),
      zoom,
    );
    const cell = table.locator("td", { hasText: "y" });
    await cell.hover();
    const c = (await cell.boundingBox())!;
    const row = await middle(".table-grip-row");
    const col = await middle(".table-grip-col");
    expect(Math.abs(row.y - (c.y + c.height / 2))).toBeLessThan(2);
    expect(Math.abs(col.x - (c.x + c.width / 2))).toBeLessThan(2);
  }
});

test("a selection dragged from the text above into an empty cell keeps both ends", async ({
  page,
}) => {
  await open(page, "Above the table.\n\n| a | b |\n| --- | --- |\n|  | 2 |\n");
  const from = (await page
    .locator(".ProseMirror:visible > p")
    .first()
    .boundingBox())!;
  const cell = (await page.locator(".table-wrapper td").first().boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  const ends = await page.evaluate(() => {
    const s = getSelection()!;
    const inCell = (n: Node | null) =>
      !!(n instanceof Element ? n : n?.parentElement)?.closest("td, th");
    return [inCell(s.anchorNode), inCell(s.focusNode), s.anchorOffset > 0];
  });
  // From where it was pressed, not pulled back to the paragraph's start.
  expect(ends).toEqual([false, true, true]);
});

test("a click below a table that ends the document starts a paragraph there", async ({
  page,
}) => {
  const table = await open(page);
  await settled(page);
  const box = (await table.boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height + 40);
  await page.keyboard.type("after");
  await expect(page.locator(".ProseMirror:visible > p").last()).toHaveText(
    "after",
  );
  await expect(table.locator("td", { hasText: "after" })).toHaveCount(0);
});

test("the + strips under and beside a table add a row and a column, reached from the table", async ({
  page,
}) => {
  const table = await open(page);
  // Each strip shows by its own edge only: not with the pointer on the head
  // row's first cell, the row's with it in the last row, the column's by
  // the last column.
  const strip = (which: string) => table.locator(`.table-add-${which}-btn`);
  await table.locator("th").first().hover();
  await expect(strip("row")).toHaveCSS("opacity", "0");
  await expect(strip("col")).toHaveCSS("opacity", "0");
  await table.locator("td").first().hover();
  await expect(strip("row")).toHaveCSS("opacity", "1");
  await expect(strip("col")).toHaveCSS("opacity", "0");
  await table.locator("th").last().hover();
  await expect(strip("col")).toHaveCSS("opacity", "1");
  const box = (await table.locator("table").boundingBox())!;
  // A press just inside the table's last row or last column is the
  // table's own: neither strip reaches over it.
  await table.locator("td").last().hover();
  await page.mouse.click(box.x + 40, box.y + box.height - 2);
  await page.mouse.click(box.x + box.width - 2, box.y + box.height - 12);
  await expect(table.locator("tr")).toHaveCount(2);
  await expect(table.locator("tr").first().locator("th")).toHaveCount(2);
  // From inside the table straight down onto the strip, as a hand moves.
  await page.mouse.move(box.x + 40, box.y + box.height - 6);
  await page.mouse.move(box.x + 40, box.y + box.height + 10, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(page.locator(".ProseMirror:visible > p")).toHaveCount(0);

  const wide = (await table.locator("table").boundingBox())!;
  // Its "+" drawn whole in the narrow strip, not squeezed away.
  const plus = await table.locator(".table-add-col-btn svg").boundingBox();
  expect(plus?.width).toBeGreaterThan(10);
  await page.mouse.move(wide.x + wide.width - 6, wide.y + 20);
  await page.mouse.move(wide.x + wide.width + 3, wide.y + 20, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);
});

test("a row or column added opens up, and one dragged glides into its place @perf", async ({
  page,
}) => {
  const table = await open(page, TABLE, true);
  const moving = (cell: string) =>
    table
      .locator(cell)
      .evaluate((el) =>
        el.getAnimations().some((a) => a.playState !== "finished"),
      );
  // Tab in the last cell adds a row.
  await table.locator("td").last().click();
  await page.keyboard.press("Tab");
  await expect(table.locator("tr")).toHaveCount(3);
  expect(await moving("tr:last-child td >> nth=0")).toBe(true);
  // A column added before the last: the last one slides over.
  await table.locator("th").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert Column Right" }).click();
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);
  expect(await moving("tr:first-child th >> nth=1")).toBe(true);
  expect(await moving("tr:first-child th >> nth=2")).toBe(true);
  // The last row pulled to the top lands there, not snapped.
  await table.locator("tr:last-child td").first().hover();
  const grip = page.locator(".table-grip-row");
  const g = (await grip.boundingBox())!;
  const top = (await table.locator("td").first().boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top.y + 2, { steps: 8 });
  await page.mouse.up();

  await expect(table.locator("tbody tr:nth-child(2) td").first()).toHaveText(
    "",
  );
  // One pulled a little and let go glides back home, not snapped.
  await table.locator("tbody tr:last-child td").first().hover();
  const g2 = (await grip.boundingBox())!;
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.mouse.down();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2 - 10, {
    steps: 4,
  });
  await page.mouse.up();
  expect(await moving("tbody tr:last-child td >> nth=0")).toBe(true);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("a table shows its tools only while the caret is in it", async ({
    page,
  }) => {
    await open(
      page,
      `${TABLE}\nbetween\n\n| c | d |\n| --- | --- |\n| 3 | 4 |\n`,
    );
    const tables = page.locator(".table-wrapper");
    const actions = (i: number) =>
      tables.nth(i).locator(".block-toolbar-actions");
    await tables.nth(0).locator("td", { hasText: "1" }).tap();
    await expect(actions(0)).toHaveCSS("opacity", "1");
    await tables.nth(1).locator("td", { hasText: "3" }).tap();
    await expect(actions(1)).toHaveCSS("opacity", "1");
    // iOS leaves :hover on what a finger touched last.
    await tables.nth(0).hover();
    await expect(actions(0)).toHaveCSS("opacity", "0");
    // Its size grid has cells a finger can hit.
    await tables
      .nth(1)
      .getByRole("button", { name: "Rows and Columns 2 × 2" })
      .tap();
    await expect(page.locator(".tx-size-grid-cells > span").first()).toHaveCSS(
      "width",
      "28px",
    );
    // A press just inside a first-column cell is the cell's, not the grip's
    // beside it (a long press there gave no Paste on iOS).
    const cell = tables.nth(1).locator("td", { hasText: "3" });
    await cell.tap();
    const box = (await cell.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.closest("td, button")?.tagName,
      [box.x + 6, box.y + box.height / 2],
    );
    expect(hit).toBe("TD");
  });

  test("the row grip follows the caret after a pasted row is undone", async ({
    page,
  }) => {
    const table = await open(
      page,
      "| h | k |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |\n| c1 | c2 |\n",
    );
    const gripAtCaret = () =>
      page.evaluate(() => {
        const grip = document.querySelector(".table-grip-row")!;
        const sel = getSelection()!.anchorNode;
        const cell = (
          sel instanceof Element ? sel : sel?.parentElement
        )?.closest("td, th");
        if (!cell) return "no caret cell";
        const g = grip.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        return Math.abs(g.top + g.height / 2 - (c.top + c.height / 2)) < 2
          ? "at caret"
          : `grip ${g.top} vs ${cell.textContent}`;
      });
    await table.locator("td", { hasText: "c1" }).tap();
    await table.locator("td", { hasText: "a1" }).tap();
    await pasteMarkdown(page, "w1\tw2");
    await expect(table.locator("td", { hasText: "w1" })).toHaveCount(1);
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect(table.locator("td", { hasText: "w1" })).toHaveCount(0);
    await expect.poll(gripAtCaret).toBe("at caret");
    // A row put in above the caret's, by the phone's table buttons: the
    // grip goes down with the caret's row.
    await table.locator("td", { hasText: "c1" }).tap();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("textus:table-action", { detail: "row-above" }),
      ),
    );
    await expect(table.locator("tr")).toHaveCount(5);
    // Nothing else moves it on a phone: no pointer passes over the table.
    await page.waitForTimeout(300);
    expect(await gripAtCaret()).toBe("at caret");
  });
});

test("Tab takes a waiting suggestion before it moves on a cell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: { menuBarShown: false, language: "en", enableCompletion: true },
  });
  await page.locator(".ProseMirror:visible").first().click();
  await pasteMarkdown(page, TABLE);
  const table = page.locator(".table-wrapper").first();
  await table.locator("td").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" more words here");
  await expect(page.locator(".ghost-text")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Tab");
  await expect(table.locator("td").first()).toContainText("canned dev-shim");
  await expect(page.locator(".ghost-text")).toHaveCount(0);
});
