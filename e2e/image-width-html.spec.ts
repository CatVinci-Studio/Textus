import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// An image's width is saved as `<img ... width="50%">`, which other editors
// show too, and Image width: Auto saves `![]()` again. An older
// `{textus-width=N%}` title or a Typora zoom opens at its width, saved as is.

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
