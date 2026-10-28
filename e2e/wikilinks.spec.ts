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

const shown = (page: Page) =>
  page
    .locator(`${editor} .wikilink`)
    .first()
    .evaluate((el) => (el as HTMLElement).innerText);

async function open(page: Page, plugins: Record<string, string[]> = {}) {
  await openWithPlugins(page, { plugins, folder: NOTES });
  await openPath(page, "/notes/one.md");
  await expect(page.locator(`${editor} h1`)).toContainText("One");
}

test("a wikilink shows its name, and its brackets while the caret is on it", async ({
  page,
}) => {
  await open(page);
  const line = page.locator(`${editor} p`).first();
  await line.click();
  await page.keyboard.press("End");
  await expect.poll(() => shown(page)).toBe("two");
  // Right after the link's end: on it.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(() => shown(page)).toBe("[[two]]");
  await page.keyboard.press("Home");
  await expect.poll(() => shown(page)).toBe("two");
});

test("a document with wikilinks offers Backlinks, once", async ({ page }) => {
  test.skip(
    !hasPlugin("catvinci.backlinks"),
    "Backlinks isn't in the checkout",
  );
  await open(page);
  const notice = page.locator(".notice", { hasText: "[[wikilinks]]" });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Install" }).click();
  await expect(notice).toHaveCount(0);
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
  // Offered once ever: the next window doesn't.
  await page.reload();
  await openPath(page, "/notes/one.md");
  await expect(page.locator(`${editor} h1`)).toContainText("One");
  await page.waitForTimeout(500);
  await expect(page.locator(".notice")).toHaveCount(0);
});
