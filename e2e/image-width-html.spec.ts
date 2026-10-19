import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// An image's width is saved as `<img ... width="50%">`, which GitHub,
// Typora, Obsidian and VS Code all show, and Image width: Auto saves it as
// `![]()` again. A file an older Textus saved - the width in the title as
// `{textus-width=N%}` - still opens at that width and is saved as written
// until its width changes; so is a Typora `<img style="zoom">`.

const editor = '[data-active-tab="true"] .ProseMirror';
// A 200x100 block, narrower than the page, so the widths differ.
const SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAAAzElEQVR42u3SMQ0AAAgEsZePFrQgChMMDE2q4HKpHjgXCTAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIyFsVTAWBgLY4GxMBbGAmNhLIwFxuK3BVCerNZ6by7IAAAAAElFTkSuQmCC";

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

/** Opens `markdown` as a file on disk. */
async function openFile(page: Page, markdown: string) {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    read_text_file: markdown.split("SRC").join(SRC),
    write_text_file: null,
  });
  await emit(page, "menu-open-recent", "/home/me/notes.md");
  await expect(page.locator(`${editor} .image-view`).first()).toBeVisible();
}

/** Saves the file and returns what was written, SRC for the picture. */
async function save(page: Page): Promise<string> {
  await emit(page, "menu-save-file");
  const written = () =>
    page.evaluate(() =>
      (
        (window as unknown as { __devInvokeCalls?: unknown[] })
          .__devInvokeCalls as { cmd: string; contents?: string }[]
      ).filter((call) => call.cmd === "write_text_file"),
    );
  await expect.poll(async () => (await written()).length).toBeGreaterThan(0);
  const calls = await written();
  return calls[calls.length - 1].contents!.split(SRC).join("SRC");
}

async function chooseWidth(page: Page, label: string) {
  await page
    .locator(`${editor} .image-view img`)
    .first()
    .click({ button: "right" });
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  await menu.getByText(label, { exact: true }).click();
  await expect(menu).toHaveCount(0);
}

async function ticked(page: Page): Promise<string[]> {
  await page
    .locator(`${editor} .image-view img`)
    .first()
    .click({ button: "right" });
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  const labels = await menu.getByText(/^✓ Image width/).allTextContents();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  return labels;
}

/** Types into the paragraph after the image, so the document is edited
 *  without touching the image. */
async function editElsewhere(page: Page) {
  await page.locator(editor).getByText("Text below.").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" More.");
  await expect(page.locator(editor)).toContainText("Text below. More.");
}

test("50% saves <img width>, and Auto saves ![]() again", async ({ page }) => {
  await openFile(page, "Text above.\n\n![chart](SRC)\n\nText below.\n");
  const view = page.locator(`${editor} .image-view`);

  await chooseWidth(page, "Image width: 50%");
  await expect(view).toHaveAttribute("style", /width: 50%/);
  expect(await save(page)).toBe(
    'Text above.\n\n<img src="SRC" alt="chart" width="50%">\n\nText below.\n',
  );
  expect(await ticked(page)).toEqual(["✓ Image width: 50%"]);

  await chooseWidth(page, "Image width: Auto");
  await expect(view).not.toHaveClass(/image-view-sized/);
  expect(await save(page)).toBe(
    "Text above.\n\n![chart](SRC)\n\nText below.\n",
  );
});

test("a file an older Textus saved opens at its width and saves as written", async ({
  page,
}) => {
  const old =
    'Text above.\n\n![chart](SRC "Cap {textus-width=30%}")\n\nText below.\n';
  await openFile(page, old);
  const view = page.locator(`${editor} .image-view`);
  await expect(view).toHaveAttribute("style", /width: 30%/);
  await expect(view.locator("img")).toHaveAttribute("title", "Cap");
  await editElsewhere(page);
  expect(await save(page)).toBe(old.replace("below.", "below. More."));
  expect(await ticked(page)).toEqual(["✓ Image width: 30%"]);

  await chooseWidth(page, "Image width: 70%");
  expect(await save(page)).toBe(
    'Text above.\n\n<img src="SRC" alt="chart" title="Cap" width="70%">\n\nText below. More.\n',
  );
});

test("an <img> written elsewhere is an image and round-trips", async ({
  page,
}) => {
  const typora =
    'Text above.\n\n<img src="SRC" alt="chart" style="zoom:50%;" />\n\nA <img src=\'SRC\' width=120 /> icon.\n\nText below.\n';
  await openFile(page, typora);
  const views = page.locator(`${editor} .image-view`);
  await expect(views).toHaveCount(2);
  await editElsewhere(page);
  expect(await save(page)).toBe(typora.replace("below.", "below. More."));

  // A pixel width shows, and ticks none of the presets.
  await expect(views.nth(1)).toHaveAttribute("style", /width: 120px/);
  await page.locator(`${editor} .image-view img`).nth(1).click({
    button: "right",
  });
  await expect(page.locator(".context-menu")).toBeVisible();
  await expect(
    page.locator(".context-menu").getByText(/^✓ Image width/),
  ).toHaveCount(0);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await page.keyboard.press("Escape");

  // Resized, Typora's zoom gives way to the width.
  await chooseWidth(page, "Image width: 50%");
  expect(await save(page)).toContain('<img src="SRC" alt="chart" width="50%">');
});
