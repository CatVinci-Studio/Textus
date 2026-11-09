import { expect, test, type Page } from "@playwright/test";
import { dragWithMouse, emit, swallowHtmlDrop } from "./helpers";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The Database plugin: a folder's documents as a table, a board or a
// calendar in a ```database block, edits written to their front matter,
// Notion's menus for sorts, filters, options and properties, and a Notion
// export's CSV brought in as such a folder.

const ID = "catvinci.database";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

const week = (start: string, end: string, focus: string[], more = "") =>
  `---\nstart: ${start}\nend: ${end}\nfocus: [${focus.join(", ")}]\n${more}---\n\n# Week\n`;

// A folder unit's database, as Workspace makes one: its rows the notes beside it.
const BASE = [
  "filters:",
  "  and:",
  "    - file.inFolder(this.file.folder)",
  "    - file.path != this.file.path",
  "views:",
  "  - type: table",
  "    name: Table",
  "    sort:",
  "      - property: start",
  "        direction: ASC",
  "  - type: kanban",
  "    name: Board",
  "    groupBy:",
  "      property: status",
  "  - type: calendar",
  "    name: Calendar",
  "    date: start",
  "    end: end",
].join("\n");

const FOLDER = {
  "/work/2026 Calendar/2026 Calendar.md":
    "# 2026 Calendar\n\n```base\n" + BASE + "\n```\n",
  "/work/2026 Calendar/Week1.md": week(
    "2026-01-01",
    "2026-01-04",
    ["Personal"],
    "status: Doing\n",
  ),
  "/work/2026 Calendar/Week2.md": week(
    "2026-01-05",
    "2026-01-11",
    ["Research"],
    "status: Done\nrate: 4\n",
  ),
  "/work/2026 Calendar/Week3.md": week(
    "2026-01-12",
    "2026-01-18",
    ["Research", "Work"],
    "status: Doing\n",
  ),
};

async function open(page: Page, more: Record<string, string> = {}) {
  await swallowHtmlDrop(page);
  await openWithPlugins(page, {
    plugins: {
      [ID]: [
        "files.read",
        "files.write",
        "editor.read",
        "editor.write",
        "ai.tools",
      ],
    },
    folder: { ...FOLDER, ...more },
  });
  await openPath(page, "/work/2026 Calendar/2026 Calendar.md");
  return page
    .frameLocator('[data-active-tab="true"] .plugin-code-block iframe')
    .first();
}

const rows = "#body tbody tr:not(.new-row, .more-row)";

/** The document's text: a block's lines are kept in it. */
const docText = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __pmView: { state: { doc: { textContent: string } } };
        }
      ).__pmView.state.doc.textContent,
  );

const fileText = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[p],
    path,
  );

test("a table of the folder's pages, a cell edited into its page's front matter", async ({
  page,
}) => {
  const db = await open(page);
  await expect(db.locator(rows)).toHaveCount(3);
  await expect(db.locator("thead th")).toHaveText([
    "Page",
    "start",
    "end",
    "focus",
    "status",
    "rate",
    "",
  ]);
  await expect(db.locator(rows).nth(2)).toContainText("Research");
  await expect(db.locator("#count")).toHaveText("3 pages");

  await db.locator(rows).first().locator('td[data-key="rate"]').click();
  await db.locator(rows).first().locator("input").fill("3");
  await db.locator(rows).first().locator("input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toContain("rate: 3");
  await expect(db.locator(rows).first().locator(".tx-rating")).toHaveText(
    "★★★☆☆",
  );
});

/** Textus's own menu, which the page opens over itself. */
const menu = (page: Page) => page.locator(".context-menu").last();
const pick = async (page: Page, name: string) => {
  await menu(page).getByRole("menuitem", { name, exact: true }).click();
};

test("a column's menu sorts it; Filter keeps only the pages that match", async ({
  page,
}) => {
  const db = await open(page);
  await db.locator("thead th", { hasText: "rate" }).click();
  await pick(page, "Descending");
  await expect
    .poll(() => docText(page))
    .toContain("- property: rate\n        direction: DESC");
  await expect(db.locator(rows).first()).toContainText("Week2");

  // A filter by menus: the property, how it compares, one of its options.
  await db.locator("#filter").click();
  await pick(page, "status");
  await pick(page, "is");
  await pick(page, "Done");
  await expect(db.locator(rows)).toHaveCount(1);
  await expect.poll(() => docText(page)).toContain('- status == "Done"');
  const chip = db.locator("#rules .tx-chip", { hasText: "status is Done" });
  await chip.click();
  await pick(page, "Remove");
  await expect(db.locator(rows)).toHaveCount(3);
});

test("a select's options are picked or made from its cell", async ({
  page,
}) => {
  const db = await open(page);
  const status = db.locator(rows).first().locator('td[data-key="status"]');
  await status.click();
  await expect(
    menu(page).getByRole("menuitemradio").or(menu(page).getByRole("menuitem")),
  ).toContainText(["Doing", "Done"]);
  await pick(page, "Create…");
  await page.locator(".app-dialog-input").fill("Review");
  await page.locator(".app-dialog-input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toContain("status: Review");
});

test("properties are added, renamed across the pages, and pages made in the table", async ({
  page,
}) => {
  const db = await open(page);
  await db.locator("thead th.plus").click();
  await menu(page).getByRole("menuitem", { name: "New property" }).hover();
  await pick(page, "Select");
  await page.locator(".app-dialog-input").fill("owner");
  await page.locator(".app-dialog-input").press("Enter");
  // No Obsidian vault here: a select's kind is kept in the base.
  await expect.poll(() => docText(page)).toContain("owner:\n    kind: select");
  await expect(db.locator("thead th", { hasText: "owner" })).toBeVisible();

  await db.locator("thead th", { hasText: "focus" }).click();
  await pick(page, "Rename…");
  await page.locator(".app-dialog-input").fill("area");
  await page.locator(".app-dialog-input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week3.md"))
    .toContain("area:");
  expect(await fileText(page, "/work/2026 Calendar/Week3.md")).not.toContain(
    "focus:",
  );

  await db.locator(".new-row .new").click();
  await db.locator(".draft-row td.title input").fill("Week4");
  await db.locator(".draft-row td.title input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week4.md"))
    .toContain("# Week4");
});

test("the board groups pages by a select, its lists put in order by dragging", async ({
  page,
}) => {
  const db = await open(page);
  await db.getByRole("tab", { name: "Board" }).click();
  await expect(db.locator(".lane-head .tx-tag")).toHaveText(["Doing", "Done"]);
  await expect(db.locator('.lane[data-value="Doing"] .record')).toHaveCount(2);
  // A list's head dragged before another: the order kept in the view.
  await dragWithMouse(
    page,
    db.locator('.lane[data-value="Done"] .lane-head'),
    db.locator('.lane[data-value="Doing"] .lane-head'),
    -40,
  );
  await expect
    .poll(() => docText(page))
    .toContain("groupOrder:\n      - Done\n      - Doing");
  await expect(db.locator(".lane-head .tx-tag")).toHaveText(["Done", "Doing"]);
  await dragWithMouse(
    page,
    db.locator('.lane[data-value="Doing"] .record', { hasText: "Week1" }),
    db.locator('.lane[data-value="Done"] .record').first(),
  );
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toContain("status: Done");
});

test("the calendar puts each week on its days", async ({ page }) => {
  const db = await open(page);
  await db.getByRole("tab", { name: "Calendar" }).click();
  await expect(db.locator(".month-bar strong")).toContainText("2026");
  // Week1 runs from the 1st to the 4th: its name, then three days more.
  await expect(db.locator(".chip", { hasText: "Week1" })).toHaveCount(4);
  await expect(db.locator(".chip.cont", { hasText: "Week1" })).toHaveCount(3);
});

test("zoomed, the block's page draws at the zoom across the column's width, and a pinch over it zooms the document", async ({
  page,
}) => {
  const db = await open(page);
  await expect(db.locator(rows)).toHaveCount(3);
  const frame = page
    .locator('[data-active-tab="true"] .plugin-code-block iframe')
    .first();
  for (let i = 0; i < 3; i++) await emit(page, "menu-zoom-in");
  // Told the zoom, the page draws at it; the frame itself is out of the
  // document's CSS zoom, so its page is as wide as the frame shows.
  await expect
    .poll(() =>
      db.locator("html").evaluate((el) => (el as HTMLElement).style.zoom),
    )
    .toBe("1.331");
  const fits = async () => {
    const outer = await frame.boundingBox();
    const add = await db.locator("#add").boundingBox();
    return !!outer && !!add && add.x + add.width <= outer.x + outer.width + 1;
  };
  await expect.poll(fits).toBe(true);
  // mod+wheel over the page: the document zooms, as anywhere else.
  const zoom = () =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--content-zoom"),
    );
  const before = await zoom();
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 200);
  await page.keyboard.up("Control");
  await expect.poll(zoom).not.toBe(before);
});

test("a long view loads more rows once its end is in sight; folded by Textus, one line", async ({
  page,
}) => {
  const db = await open(page, {
    "/work/2026 Calendar/2026 Calendar.md":
      "# 2026 Calendar\n\n```base\n" +
      BASE.replace("    name: Table\n", "    name: Table\n    limit: 2\n") +
      "\n```\n",
  });
  // Two rows to start; the short block's end is in sight, so the third comes.
  await expect(db.locator(rows)).toHaveCount(3);
  await expect(db.getByRole("button", { name: /more/i })).toHaveCount(0);
  await expect(db.locator("#body tbody tr").last()).toHaveClass(/new-row/);
  // Folded as every drawn block is: the caret on its left, its name left.
  const block = page.locator('[data-active-tab="true"] .plugin-code-block');
  await block.hover();
  await block.locator(".block-fold").click();
  await expect(block.locator("iframe")).toBeHidden();
  await expect(block.locator(".block-folded-line")).toHaveText("Wiki");
  await block.locator(".block-folded-line").click();
  await expect(db.locator("#count")).toHaveText("3 pages");
});

test("zoomed, a column's menu opens under its header", async ({ page }) => {
  const db = await open(page);
  for (let i = 0; i < 3; i++) await emit(page, "menu-zoom-in");
  const th = db.locator("thead th", { hasText: "status" });
  await expect
    .poll(() =>
      db.locator("html").evaluate((el) => (el as HTMLElement).style.zoom),
    )
    .toBe("1.331");
  await th.click();
  const head = (await th.boundingBox())!;
  const box = (await menu(page).boundingBox())!;
  expect(Math.abs(box.x - head.x)).toBeLessThan(4);
  expect(Math.abs(box.y - (head.y + head.height))).toBeLessThan(8);
});

test("a column's head dragged along the others, and its edge to a width, kept in the base", async ({
  page,
}) => {
  const db = await open(page);
  await dragWithMouse(
    page,
    db.locator('thead th[data-key="status"]'),
    db.locator('thead th[data-key="start"]'),
    -30,
  );
  await expect
    .poll(() => docText(page))
    .toContain("order:\n      - file.name\n      - status\n      - start");
  const edge = db.locator('thead th[data-key="end"] .col-resize');
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => docText(page)).toMatch(/columnSize:\n\s+end: \d+/);
});

test("a dragged column rides under the pointer, zoomed or not, and the next one slides aside", async ({
  page,
}) => {
  const db = await open(page);
  const head = db.locator('thead th[data-key="status"]');
  // The column after it, whichever that is.
  const next = head.locator("xpath=following-sibling::th[@data-key][1]");
  const zoom = () =>
    db.locator("html").evaluate((el) => (el as HTMLElement).style.zoom);
  for (const zoomIn of [0, 3]) {
    for (let i = 0; i < zoomIn; i++) await emit(page, "menu-zoom-in");
    // The page takes the zoom, then draws again: drag what is there then.
    if (zoomIn) await expect.poll(zoom).toBe("1.331");
    await expect(head).toBeVisible();
    const box = (await head.boundingBox())!;
    const beside = (await next.boundingBox())!;
    const at = { x: box.x + 12, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 20, at.y, { steps: 3 });
    // Past the point where their centres meet, whatever their widths.
    const by = (box.width + beside.width) / 2 + 6;
    await page.mouse.move(at.x + by, at.y, { steps: 3 });
    // No copy of it: the column itself moves, as far as the pointer did.
    await expect(db.locator(".tx-drag-ghost")).toHaveCount(0);
    const moved = (await head.boundingBox())!;
    expect(Math.abs(moved.x - box.x - by)).toBeLessThan(3);
    // The one passed slides into the room it left.
    await expect
      .poll(async () => (await next.boundingBox())!.x)
      .toBeLessThan(beside.x - 10);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  }
});

test("any view's menu opens on a right click, and a view is deleted from it", async ({
  page,
}) => {
  const db = await open(page);
  await db.getByRole("tab", { name: "Calendar" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete view/i }).click();
  await expect(db.getByRole("tab")).toHaveText([/Table/, /Board/]);
  await expect.poll(() => docText(page)).not.toContain("type: calendar");
});

test("a view's tab dragged before another, kept in the base", async ({
  page,
}) => {
  const db = await open(page);
  await dragWithMouse(
    page,
    db.getByRole("tab", { name: "Calendar" }),
    db.getByRole("tab", { name: "Table" }),
    -10,
  );
  await expect(db.getByRole("tab")).toHaveText([/Calendar/, /Table/, /Board/]);
  await expect
    .poll(() => docText(page))
    .toMatch(/type: calendar[\s\S]*type: table[\s\S]*type: kanban/);
});

test("a row's right-click menu opens or deletes its page, asked first", async ({
  page,
}) => {
  const db = await open(page);
  await expect(db.locator(rows)).toHaveCount(3);
  await db
    .locator(rows)
    .first()
    .locator('td[data-key="status"]')
    .click({ button: "right" });
  // Laid out as a Markdown table's menu: the row's own under Row.
  await expect(
    menu(page).getByRole("menuitem", { name: "Insert Row Below" }),
  ).toBeVisible();
  await menu(page).getByRole("menuitem", { name: "Row", exact: true }).hover();
  await page
    .locator(".context-menu")
    .getByRole("menuitem", { name: "Delete Row" })
    .click();
  await page.getByRole("button", { name: "Delete page" }).click();
  await expect(db.locator(rows)).toHaveCount(2);
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toBeUndefined();
});

test("a date is typed, or picked from the month under its field", async ({
  page,
}) => {
  const db = await open(page);
  const week1 = db.locator(rows).filter({ hasText: "Week1" });
  const cell = week1.locator('td[data-key="start"]');
  await cell.click();
  const pop = db.locator(".date-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".date-pop-day.chosen")).toHaveText("1");
  await pop.locator(".date-pop-day:not(.other)", { hasText: /^15$/ }).click();
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toContain("start: 2026-01-15");
  await expect(pop).toHaveCount(0);
  // Typed, as before (another row: Week1 has just moved down the table).
  const week2 = db.locator(rows).filter({ hasText: "Week2" });
  await week2.locator('td[data-key="start"]').click();
  await week2.locator("input").fill("2026-01-06");
  await week2.locator("input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week2.md"))
    .toContain("start: 2026-01-06");
});

test("in a narrow column the block starts folded to its line, and stays open once opened", async ({
  page,
}) => {
  await page.setViewportSize({ width: 460, height: 800 });
  await open(page);
  const block = page.locator('[data-active-tab="true"] .plugin-code-block');
  await expect(block).toHaveAttribute("data-folded", "");
  await expect(block.locator(".block-folded-line")).toHaveText("Wiki");
  await block.locator(".block-folded-line").click();
  await expect(block).not.toHaveAttribute("data-folded");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("textus-opened-blocks")),
    )
    .toContain("2026 Calendar.md");
});

test("zoomed, a date's month opens under its field", async ({ page }) => {
  const db = await open(page);
  for (let i = 0; i < 3; i++) await emit(page, "menu-zoom-in");
  await expect
    .poll(() =>
      db.locator("html").evaluate((el) => (el as HTMLElement).style.zoom),
    )
    .toBe("1.331");
  const cell = db
    .locator(rows)
    .filter({ hasText: "Week2" })
    .locator('td[data-key="start"]');
  await cell.click();
  const field = (await cell.locator("input").boundingBox())!;
  const month = (await db.locator(".date-pop").boundingBox())!;
  expect(Math.abs(month.x - field.x)).toBeLessThan(8);
  expect(Math.abs(month.y - (field.y + field.height))).toBeLessThan(16);
  await page.keyboard.press("Escape");
  await expect(db.locator(".date-pop")).toHaveCount(0);
});

test("a field in the page takes Textus's own menu for its text, not the system's", async ({
  page,
}) => {
  const db = await open(page);
  const first = db.locator(rows).first();
  await first.locator("td.title").click();
  const field = first.locator("input");
  await field.fill("Week1x");
  await field.click({ button: "right" });
  // Its text's items, then the row's and column's, as a table's in the editor.
  await expect(
    menu(page).getByRole("menuitem", { name: "Insert Row Below" }),
  ).toBeVisible();
  await pick(page, "Select All");
  await expect
    .poll(() =>
      field.evaluate(
        (el) =>
          (el as HTMLInputElement).selectionEnd! -
          (el as HTMLInputElement).selectionStart!,
      ),
    )
    .toBe(6);
});
