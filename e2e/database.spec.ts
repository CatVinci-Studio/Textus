import { expect, test, type Page } from "@playwright/test";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The Database plugin: a folder's documents as a table, a board or a
// calendar in a ```database block, edits written to their front matter, and
// a Notion export's CSV brought in as such a folder.

const ID = "catvinci.database";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

const week = (start: string, end: string, focus: string[], more = "") =>
  `---\nstart: ${start}\nend: ${end}\nfocus: [${focus.join(", ")}]\n${more}---\n\n# Week\n`;

const FOLDER = {
  "/work/2026 Calendar.md":
    "# 2026 Calendar\n\n```database\nfrom: 2026 Calendar\nview: table\nsort: start\n```\n",
  "/work/2026 Calendar/Week1.md": week("2026-01-01", "2026-01-04", [
    "Personal",
  ]),
  "/work/2026 Calendar/Week2.md": week(
    "2026-01-05",
    "2026-01-11",
    ["Research"],
    "rate: 4\n",
  ),
  "/work/2026 Calendar/Week3.md": week("2026-01-12", "2026-01-18", [
    "Research",
    "Work",
  ]),
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
  await expect(db.locator("tbody tr")).toHaveCount(3);
  await expect(db.locator("thead th")).toHaveText([
    "Page",
    "start",
    "end",
    "focus",
    "rate",
  ]);
  await expect(db.locator("tbody tr").nth(2)).toContainText("Research");
  await expect(db.locator("#count")).toHaveText("3 pages");

  await db.locator("tbody tr").first().locator('td[data-key="rate"]').click();
  await db.locator("tbody tr").first().locator("input").fill("3");
  await db.locator("tbody tr").first().locator("input").press("Enter");
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toContain("rate: 3");
  await expect(db.locator("tbody tr").first().locator(".stars")).toHaveText(
    "★★★☆☆",
  );
});

test("the board groups pages by a list property; the view is kept in the block", async ({
  page,
}) => {
  const db = await open(page);
  await db.getByRole("tab", { name: "Board" }).click();
  await expect(db.locator(".lane-head span:first-child")).toHaveText([
    "Personal",
    "Research",
    "Work",
  ]);
  await expect(db.locator('.lane[data-value="Research"] .card')).toHaveCount(2);
  // In the document, as an edit of its block: saved with it.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __pmView: { state: { doc: { textContent: string } } };
            }
          ).__pmView.state.doc.textContent,
      ),
    )
    .toContain("view: board");
  await db
    .locator('.lane[data-value="Personal"] .card')
    .dragTo(db.locator('.lane[data-value="Work"]'));
  await expect
    .poll(() => fileText(page, "/work/2026 Calendar/Week1.md"))
    .toMatch(/focus:\s*\n?\s*-?\s*\[?Work/);
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
