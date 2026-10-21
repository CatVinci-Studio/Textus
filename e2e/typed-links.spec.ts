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

test("an image typed mid-sentence goes in where it was typed", async ({
  page,
}) => {
  await page.keyboard.type("See ![](assets/a.png) here");
  await expect(page.locator(`${editor} img[src="assets/a.png"]`)).toHaveCount(
    1,
  );
  expect(await sourceOf(page)).toBe("See ![](assets/a.png) here");
});

/** Presses `key` `times` times, a frame apart, as a writer does: pressed
 *  back to back, the editor's selection sometimes trails the browser's. */
async function press(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  }
}

const LINKED = `${editor} a[href="https://a.org"]`;

test("words typed after a pasted link are not part of it", async ({ page }) => {
  await page.keyboard.type("See ");
  await paste(page, "[Textus](https://a.org)");
  await page.keyboard.type(" now");
  await expect(page.locator(LINKED)).toHaveText("Textus");
  await press(page, "Enter");
  expect(await sourceOf(page)).toBe("See [Textus](https://a.org) now");
});

test("a URL pasted between the parentheses autopair put in makes the link", async ({
  page,
}) => {
  await page.keyboard.type("See [Textus](");
  await paste(page, "https://a.org");
  // Past the ")" the autopair put in, rather than typing it.
  await press(page, "ArrowRight");
  await page.keyboard.type(" now");
  await expect(page.locator(LINKED)).toHaveText("Textus");
  await press(page, "Enter");
  expect(await sourceOf(page)).toBe("See [Textus](https://a.org) now");
});

test("a link written as []() first, then filled in, is one once the caret leaves", async ({
  page,
}) => {
  await page.keyboard.type("See []() now");
  await press(page, "ArrowLeft", 7);
  await page.keyboard.type("Textus");
  await press(page, "ArrowRight", 2);
  await paste(page, "https://a.org");
  // Still inside its parentheses: still being written.
  await expect(page.locator(LINKED)).toHaveText("https://a.org");
  await press(page, "End");
  await expect(page.locator(LINKED)).toHaveText("Textus");
  // An undo takes the link back to its text, which then stays text.
  await press(page, "ControlOrMeta+z");
  await expect(page.locator(LINKED)).toHaveText("https://a.org");
  await press(page, "Home");
  await expect(page.locator(LINKED)).toHaveText("https://a.org");
  await press(page, "ControlOrMeta+Shift+z");
  await press(page, "End");
  await press(page, "Enter");
  expect(await sourceOf(page)).toBe("See [Textus](https://a.org) now");
});

test("escaped brackets read from a file stay text when the paragraph is edited", async ({
  page,
}) => {
  await paste(page, "Write \\[a](b) literally.");
  await expect(page.locator(`${editor} p`).first()).toHaveText(
    "Write [a](b) literally.",
  );
  await press(page, "End");
  await page.keyboard.type(" Done");
  await press(page, "Home");
  await expect(page.locator(`${editor} a`)).toHaveCount(0);
});

test("a URL typed out is a link once a space follows it", async ({ page }) => {
  await page.keyboard.type("See https://a.org");
  // Still being typed: not yet.
  await expect(page.locator(`${editor} a`)).toHaveCount(0);
  await page.keyboard.type(" now. Or www.b.org.");
  await expect(page.locator(LINKED)).toHaveText("https://a.org");
  // The full stop ending the sentence isn't part of it.
  await press(page, "Enter");
  await expect(page.locator(`${editor} a[href="http://www.b.org"]`)).toHaveText(
    "www.b.org",
  );
  expect(await sourceOf(page)).toBe("See <https://a.org> now. Or www.b.org.");
});
