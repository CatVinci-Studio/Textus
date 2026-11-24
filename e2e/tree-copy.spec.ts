import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

/*
 * Files copied and moved within the tree (as on Windows and Linux): Cut,
 * Copy and Paste, Duplicate, a drag with Ctrl held, and a name already
 * taken where they go.
 */

async function openFolder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/proj/plan.md": "# Plan\n",
      "/proj/notes/n.md": "# N\n",
    };
    w.__devPickFolder = "/proj";
  });
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
}

const row = (page: Page, name: string) =>
  page.locator(`.tree-row[data-path="/proj/${name}"]`);

const files = (page: Page) =>
  page.evaluate(() =>
    Object.keys(
      (window as unknown as { __devFs: Record<string, string> }).__devFs,
    ).sort(),
  );

test("Copy and Paste into a folder, Duplicate beside, each undone", async ({
  page,
}) => {
  await openFolder(page);
  await row(page, "plan.md").focus();
  await page.keyboard.press("ControlOrMeta+c");
  await row(page, "notes").focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => files(page)).toContain("/proj/notes/plan.md");
  expect(await files(page)).toContain("/proj/plan.md");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => files(page)).not.toContain("/proj/notes/plan.md");

  await row(page, "plan.md").focus();
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(() => files(page)).toContain("/proj/plan copy.md");
  await row(page, "plan.md").focus();
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(() => files(page)).toContain("/proj/plan copy 2.md");
});

test("a cut pasted where the name is taken asks, and Keep Both numbers it", async ({
  page,
}) => {
  await openFolder(page);
  await row(page, "plan.md").focus();
  await page.keyboard.press("ControlOrMeta+c");
  await row(page, "notes").focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => files(page)).toContain("/proj/notes/plan.md");

  // The row cut is faded until it moves.
  await row(page, "plan.md").focus();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(row(page, "plan.md")).toHaveClass(/tree-row-cut/);
  await row(page, "notes").focus();
  await page.keyboard.press("ControlOrMeta+v");
  await page.getByRole("button", { name: "Keep Both" }).click();
  await expect
    .poll(() => files(page))
    .toEqual([
      "/proj/notes/n.md",
      "/proj/notes/plan 2.md",
      "/proj/notes/plan.md",
    ]);
});

test("a row dragged with Ctrl held is copied; the menu has Duplicate", async ({
  page,
}) => {
  await openFolder(page);
  const from = (await row(page, "plan.md").boundingBox())!;
  const to = (await row(page, "notes").boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 4, { steps: 4 });
  await page.keyboard.down("Control");
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect.poll(() => files(page)).toContain("/proj/notes/plan.md");
  expect(await files(page)).toContain("/proj/plan.md");

  await row(page, "notes/n.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect.poll(() => files(page)).toContain("/proj/notes/n copy.md");
});
