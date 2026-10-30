import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A link or image committed by an input method becomes a working link or
// image, and is saved without escaping backslashes.

const editor = '[data-active-tab="true"] .ProseMirror';
const URL = "http://www.baidu.com";
const SRC =
  "https://i.pinimg.com/originals/f8/53/b8/f853b86957f6412dc57eb2949cdfe6ae.jpg";
const LINK = `[百度](${URL})`;
const IMAGE = `![美女](${SRC})`;

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
  return value.trim();
}

/** Commits `text` through an input method, as one composition. */
async function imeCommit(page: Page, text: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  await cdp.send("Input.insertText", { text });
  await cdp.detach();
  await page.waitForTimeout(50);
}

// Typed and pasted ones are tested in vitest
// (src/editor/markdown/typed-links.test.ts).
const ways: [string, (page: Page, line: string) => Promise<void>][] = [
  [
    "typed with a Chinese input method",
    async (page, line) => {
      // The words go in as compositions; so does the closing parenthesis,
      // as some input methods commit punctuation.
      for (const char of line) {
        if (/[一-鿿)]/.test(char)) await imeCommit(page, char);
        else await page.keyboard.type(char);
      }
    },
  ],
];

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
});

for (const [way, write] of ways) {
  test(`a link and an image ${way} work and save without backslashes`, async ({
    page,
    browserName,
  }) => {
    // The input method is driven over CDP, which only Chromium has.
    test.skip(way.includes("input method") && browserName !== "chromium");
    await write(page, LINK);
    await page.keyboard.press("Enter");
    await write(page, IMAGE);

    await expect(page.locator(`${editor} a[href="${URL}"]`)).toHaveText("百度");
    await expect(page.locator(`${editor} img[src="${SRC}"]`)).toHaveAttribute(
      "alt",
      "美女",
    );
    expect(await sourceOf(page)).toBe(`${LINK}\n\n${IMAGE}`);
  });
}
