import { expect, test, type Page } from "@playwright/test";
import { emit } from "./helpers";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The Database plugin: a folder's documents as a table, a board or a
// calendar in a ```database block, edits written to their front matter,
// Notion's menus for sorts, filters, options and properties, and a Notion
// export's CSV brought in as such a folder.

const ID = "catvinci.database";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

const week = (start: string, end: string, focus: string[], more = "") =>
  `---\nstart: ${start}\nend: ${end}\nfocus: [${focus.join(", ")}]\n${more}---\n\n# Week\n`;

const FOLDER = {
  "/work/2026 Calendar.md":
    "# 2026 Calendar\n\n```database\nfrom: 2026 Calendar\nview: table\nsort: start\n```\n",
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
  await openPath(page, "/work/2026 Calendar.md");
  return page
    .frameLocator('[data-active-tab="true"] .plugin-code-block iframe')
    .first();
}

const rows = "#body tbody tr:not(.new-row)";

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
  await expect(db.locator(rows).first().locator(".stars")).toHaveText("★★★☆☆");
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
  await expect.poll(() => docText(page)).toContain("sort: -rate");
  await expect(db.locator(rows).first()).toContainText("Week2");

  // A filter by menus: the property, how it compares, one of its options.
  await db.locator("#filter").click();
  await pick(page, "status");
  await pick(page, "is");
  await pick(page, "Done");
  await expect(db.locator(rows)).toHaveCount(1);
  await expect.poll(() => docText(page)).toContain("filter: status = Done");
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
  await expect.poll(() => docText(page)).toContain("types: owner=select");
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
  await db.locator(".new-title input").fill("Week4");
  await db.locator(".new-title input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week4.md"))
    .toContain("# Week4");
});

test("the board groups pages by a select, as Notion's by status; the view is kept in the block", async ({
  page,
}) => {
  const db = await open(page);
  await db.getByRole("tab", { name: "Board" }).click();
  await expect(db.locator(".lane-head .tx-tag")).toHaveText(["Doing", "Done"]);
  await expect(db.locator('.lane[data-value="Doing"] .record')).toHaveCount(2);
  // In the document, as an edit of its block: saved with it.
  await expect.poll(() => docText(page)).toContain("view: board");
  await db
    .locator('.lane[data-value="Doing"] .record', { hasText: "Week1" })
    .dragTo(db.locator('.lane[data-value="Done"]'));
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
