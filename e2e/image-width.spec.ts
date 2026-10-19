import { expect, test, type Page } from "@playwright/test";
import { PHONE, openApp, openPhone, pasteMarkdown } from "./helpers";

// An image's width preset - right-click › Image width, or the phone's
// keyboard toolbar - is stored as `{textus-width=N%}` in its title, and
// Image width: Auto takes it out again. On an image without a caption that
// once left a null title, which the image node refuses: Auto did nothing.

const editor = '[data-active-tab="true"] .ProseMirror';
// A 200x100 block, narrower than the page, so Auto and 50% differ.
const SRC =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzhhYyIvPjwvc3ZnPg==";
const IMAGE = `![chart](${SRC})`;

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
}

/** The active document's Markdown, read from source mode (and back). */
async function sourceOf(page: Page): Promise<string> {
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit(page, "menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value.trim().replace(SRC, "SRC");
}

/** Right-clicks the image and returns its context menu. */
async function imageMenu(page: Page) {
  await page.locator(`${editor} .image-view img`).click({ button: "right" });
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function chooseWidth(page: Page, label: string) {
  // Past the history's grouping delay, so each choice is its own undo step.
  await page.waitForTimeout(600);
  const menu = await imageMenu(page);
  await menu.getByText(label, { exact: true }).click();
  await expect(menu).toHaveCount(0);
}

for (const [name, markdown, saved] of [
  ["without a caption", IMAGE, "![chart](SRC)"],
  ["with a caption", IMAGE.replace(/\)$/, ' "Cap")'), '![chart](SRC "Cap")'],
] as const) {
  test(`Image width: Auto undoes a preset on an image ${name}`, async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await pasteMarkdown(page, `Text above.\n\n${markdown}\n\nText below.\n`);
    const view = page.locator(`${editor} .image-view`);
    const autoWidth = (await view.boundingBox())!.width;

    await chooseWidth(page, "Image width: 50%");
    await expect(view).toHaveClass(/image-view-sized/);
    expect((await view.boundingBox())!.width).not.toBe(autoWidth);

    await chooseWidth(page, "Image width: Auto");
    await expect(view).not.toHaveClass(/image-view-sized/);
    expect(await view.evaluate((el) => el.style.width)).toBe("");
    expect((await view.boundingBox())!.width).toBe(autoWidth);
    await expect(
      (await imageMenu(page)).getByText("✓ Image width: Auto"),
    ).toBeVisible();
    // The menu listens from a tick after it opens.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await page.keyboard.press("Escape");
    await expect(page.locator(".context-menu")).toHaveCount(0);

    // Undo brings the preset back; redo takes it out again.
    await page.locator(editor).getByText("Text below.").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(view).toHaveClass(/image-view-sized/);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(view).not.toHaveClass(/image-view-sized/);

    // Saved without the width, and read back from it (source mode
    // re-parses the Markdown) still automatic.
    expect(await sourceOf(page)).toBe(`Text above.\n\n${saved}\n\nText below.`);
    await expect(view).not.toHaveClass(/image-view-sized/);
  });
}

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the toolbar's Auto undoes a width preset", async ({ page }) => {
    await openPhone(page);
    await pasteMarkdown(page, `Text above.\n\n${IMAGE}\n\nText below.\n`);
    const toolbar = page.getByRole("toolbar");
    const view = page.locator(`${editor} .image-view`);
    await view.tap();

    await toolbar.getByRole("button", { name: "Image width: 50%" }).tap();
    await expect(view).toHaveAttribute("style", /width: 50%/);

    const auto = toolbar.getByRole("button", { name: "Image width: Auto" });
    await auto.tap();
    await expect(view).not.toHaveClass(/image-view-sized/);
    await expect(auto).toHaveAttribute("aria-pressed", "true");
  });
});
