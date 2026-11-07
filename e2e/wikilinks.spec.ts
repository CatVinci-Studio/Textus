import { expect, test, type Page } from "@playwright/test";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

/**
 * [[wikilinks]] read as their names, as in Obsidian, with the brackets
 * shown while the caret is on one; a document written with them offers
 * Backlinks once.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const NOTES = {
  "/notes/one.md": "# One\n\nGo to [[two]] now.\n",
  "/notes/two.md": "# Two\n\nNothing here.\n",
};

async function open(page: Page, plugins: Record<string, string[]> = {}) {
  await openWithPlugins(page, { plugins, folder: NOTES });
  await openPath(page, "/notes/one.md");
  await expect(page.locator(`${editor} h1`)).toContainText("One");
}

test("a document with wikilinks suggests Two-way Links on the card", async ({
  page,
}) => {
  test.skip(
    !hasPlugin("catvinci.backlinks"),
    "Backlinks isn't in the checkout",
  );
  await open(page);
  const card = page.locator(".suggest-card");
  await expect(card).toContainText("Plugin suggestion:");
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await expect(card).toHaveCount(0);
  // It reads the folder's notes, and asks to.
  await page
    .locator(".app-dialog")
    .getByRole("button", { name: "Allow" })
    .click();
  await expect(page.locator(".app-dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (window as unknown as { __devPlugins?: { id: string }[] })
            .__devPlugins ?? []
        ).map((p) => p.id),
      ),
    )
    .toContain("catvinci.backlinks");
  // Installed, it isn't suggested again.
  await page.reload();
  await openPath(page, "/notes/one.md");
  await expect(page.locator(`${editor} h1`)).toContainText("One");
  await page.waitForTimeout(500);
  await expect(page.locator(".suggest-card")).toHaveCount(0);
});
