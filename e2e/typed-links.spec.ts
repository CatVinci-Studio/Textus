import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Issue #189: a link or an image written out in the editor - typed, typed
// with the URL pasted in, pasted whole, or with its words committed by a
// Chinese input method - is a working link or image, and is saved without
// the backslashes that turned it back into text.

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

/** Pastes `text` as plain text, as copying from another app does. */
async function paste(page: Page, text: string) {
  await page.evaluate(
    ([selector, t]) => {
      const target = document.querySelector<HTMLElement>(selector)!;
      const transfer = new DataTransfer();
      transfer.setData("text/plain", t);
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [editor, text],
  );
  await page.waitForTimeout(100);
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

const ways: [string, (page: Page, line: string) => Promise<void>][] = [
  ["typed", (page, line) => page.keyboard.type(line)],
  [
    "typed with the URL pasted in",
    async (page, line) => {
      const open = line.indexOf("](") + 2;
      await page.keyboard.type(line.slice(0, open));
      await paste(page, line.slice(open, -1));
      await page.keyboard.type(")");
    },
  ],
  ["pasted", paste],
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
  }) => {
    await write(page, LINK);
    await page.keyboard.press("Enter");
    await write(page, IMAGE);

    await expect(page.locator(`${editor} a[href="${URL}"]`)).toHaveText("百度");
    await expect(page.locator(`${editor} img[src="${SRC}"]`)).toHaveAttribute(
      "alt",
      "美女",
    );
    // A paste goes through the DOM, where Milkdown's image takes its alt
    // as a title too; that is not what this issue is about.
    const source = (await sourceOf(page)).replace(` "美女")`, ")");
    expect(source).toBe(`${LINK}\n\n${IMAGE}`);
  });
}

test("an image typed mid-sentence goes in where it was typed", async ({
  page,
}) => {
  await page.keyboard.type("See ![](assets/a.png) here");
  await expect(page.locator(`${editor} img[src="assets/a.png"]`)).toHaveCount(
    1,
  );
  expect(await sourceOf(page)).toBe("See ![](assets/a.png) here");
});
