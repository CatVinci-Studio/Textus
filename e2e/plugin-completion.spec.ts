import { expect, test, type Page } from "@playwright/test";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

/**
 * Completions a plugin suggests as you type, with the official LaTeX
 * Completion plugin: a backslash in a formula lists commands.
 */

test.skip(
  !hasPlugin("catvinci.latex-completion"),
  "needs the textus-plugins checkout with LaTeX Completion",
);

const list = (page: Page) => page.locator(".completion-list:not([hidden])");
const formula = (page: Page) =>
  page.locator('[data-active-tab="true"] .math-inline').first();

async function open(page: Page, granted = ["editor.read"]) {
  await openWithPlugins(page, {
    plugins: { "catvinci.latex-completion": granted },
    folder: { "/notes/maths.md": "Area $x$ here.\n\nPlain words.\n" },
  });
  await openPath(page, "/notes/maths.md");
  // Into the formula from the left, past its x: its source shows while
  // the caret is in it.
  await page
    .locator('[data-active-tab="true"] .ProseMirror p', { hasText: "Area" })
    .click({ position: { x: 2, y: 8 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < "Area x".length + 1; i++)
    await page.keyboard.press("ArrowRight");
}

test("a backslash in a formula lists LaTeX commands, and Enter writes one", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type(" \\fr");
  await expect(list(page).locator(".completion-item").first()).toContainText(
    "\\frac",
  );
  // The formula's drawn preview, where the list shows, steps aside.
  for (const preview of await page.locator(".math-float-preview").all())
    await expect(preview).toHaveCSS("visibility", "hidden");
  await page.keyboard.press("Enter");
  await expect(list(page)).toHaveCount(0);
  // The caret in the first braces: what is typed next is the numerator.
  await page.keyboard.type("a");
  await expect(formula(page)).toContainText("x \\frac{a}{}");
});

test("the arrows choose another command, and Esc puts the list away", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type(" \\in");
  const items = list(page).locator(".completion-item");
  // Those starting so, in the plugin's order: \int, then \in.
  await expect(items.nth(0)).toContainText("\\int");
  await expect(items.nth(1)).toContainText("\\in");
  await expect(items.nth(1)).toContainText("∈");
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" y \\al");
  await expect(items.first()).toContainText("\\alpha");
  await page.keyboard.press("Escape");
  await expect(list(page)).toHaveCount(0);
  await expect(formula(page)).toContainText("x \\in y \\al");
});

test("outside a formula nothing is listed", async ({ page }) => {
  await open(page);
  await page
    .locator('[data-active-tab="true"] .ProseMirror p', { hasText: "Plain" })
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type(" \\fr");
  await page.waitForTimeout(300);
  await expect(list(page)).toHaveCount(0);
});

test("without document.read the plugin is not asked", async ({ page }) => {
  await open(page, []);
  await page.keyboard.type(" \\fr");
  await page.waitForTimeout(300);
  await expect(list(page)).toHaveCount(0);
});
