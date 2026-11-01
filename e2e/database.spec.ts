import { expect, test, type Page } from "@playwright/test";
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
    "start ↑",
    "end",
    "focus",
    "status",
    "rate",
    "+",
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

test("a column's menu sorts it; Filter keeps only the pages that match", async ({
  page,
}) => {
  const db = await open(page);
  await db.locator("thead th", { hasText: "rate" }).click();
  await db.getByRole("button", { name: "↓ Descending" }).click();
  await expect.poll(() => docText(page)).toContain("sort: -rate");
  await expect(db.locator(rows).first()).toContainText("Week2");

  await db.locator("#filter").click();
  const rule = db.locator(".pop .rule").first();
  await rule.locator("select").first().selectOption("status");
  await rule.locator("select").nth(2).selectOption("Done");
  await expect(db.locator(rows)).toHaveCount(1);
  await expect.poll(() => docText(page)).toContain("filter: status = Done");
  // The menu stays open while it is changed; its chip shows what it does.
  await expect(db.locator("#rules")).toContainText("status is Done");
  await rule.getByRole("button", { name: "Remove" }).click();
  await expect(db.locator(rows)).toHaveCount(3);
});

test("a select's options are picked or made from its cell", async ({
  page,
}) => {
  const db = await open(page);
  const status = db.locator(rows).first().locator('td[data-key="status"]');
  await status.click();
  await expect(db.locator(".pop .options .tag")).toHaveText(["Doing", "Done"]);
  await db.locator(".pop input").fill("Review");
  await db.locator(".pop input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toContain("status: Review");
});

test("properties are added, renamed across the pages, and pages made in the table", async ({
  page,
}) => {
  const db = await open(page);
  await db.locator("thead th.plus").click();
  await db.locator(".pop input").fill("owner");
  await db.getByRole("button", { name: "Select", exact: true }).click();
  await expect.poll(() => docText(page)).toContain("types: owner=select");
  await expect(db.locator("thead th", { hasText: "owner" })).toBeVisible();

  await db.locator("thead th", { hasText: "focus" }).click();
  await db.locator('.pop input[aria-label="Rename"]').fill("area");
  await db.locator('.pop input[aria-label="Rename"]').press("Enter");
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
  await expect(db.locator(".lane-head .tag")).toHaveText(["Doing", "Done"]);
  await expect(db.locator('.lane[data-value="Doing"] .card')).toHaveCount(2);
  // In the document, as an edit of its block: saved with it.
  await expect.poll(() => docText(page)).toContain("view: board");
  await db
    .locator('.lane[data-value="Doing"] .card', { hasText: "Week1" })
    .dragTo(db.locator('.lane[data-value="Done"]'));
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toContain("status: Done");
});

test("the calendar puts each week on its days", async ({ page }) => {
  const db = await open(page);
  await db.getByRole("tab", { name: "Calendar" }).click();
  await expect(db.locator(".nav strong")).toContainText("2026");
  // Week1 runs from the 1st to the 4th: its name, then three days more.
  await expect(db.locator(".chip", { hasText: "Week1" })).toHaveCount(4);
  await expect(db.locator(".chip.cont", { hasText: "Week1" })).toHaveCount(3);
});

test("a Notion export's CSV comes in as pages with properties, and a page to see them", async ({
  page,
}) => {
  const csv =
    "Week name,Start Day,Focus Field\n" +
    'Week1 0123456789abcdef0123456789abcdef,"January 1, 2026",Personal\n' +
    'Week11,"March 9, 2026","Health, Personal"\n';
  await open(page, {
    "/work/Notion/Cal 0123456789abcdef0123456789abcdef.csv": csv,
    "/work/Notion/Cal 0123456789abcdef0123456789abcdef/Week1 0123456789abcdef0123456789abcdef.md":
      "# Week1\n\nStart Day: January 1, 2026\nFocus Field: Personal\n\nA calm week.\n",
  });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-toggle-sidebar"),
  );
  const tree = page.locator(".sidebar .tree-main .tree-row");
  await tree.filter({ hasText: /^Notion$/ }).click();
  await tree.filter({ hasText: ".csv" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Import from Notion…" }).click();
  await expect
    .poll(() => fileText(page, "/work/Notion/Cal/Week11.md"))
    .toContain("start_day: 2026-03-09");
  const first = await fileText(page, "/work/Notion/Cal/Week1.md");
  expect(first).toContain("A calm week.");
  expect(first).not.toContain("Start Day:");
  expect(await fileText(page, "/work/Notion/Cal.md")).toContain(
    "```database\nfrom: Cal",
  );
});
