import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// What a paste puts in the markdown. The dev shim answers the image
// commands with canned srcs.

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

/** Dispatches a paste carrying exactly these clipboard flavors. */
async function paste(page: Page, flavors: Record<string, string>) {
  await page.evaluate((data) => {
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    target.focus();
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data))
      transfer.setData(type, value);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, flavors);
  await page.waitForTimeout(300);
}

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const editor = '[data-active-tab="true"] .ProseMirror';

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
});

test("a pasted URL becomes a link with the URL as its text", async ({
  page,
}) => {
  const url = "https://github.com/CatVinci-Studio/Textus/issues";
  await paste(page, { "text/plain": url });
  await expect(page.locator(`${editor} a[href="${url}"]`)).toHaveText(url);
  expect(await sourceOf(page)).toBe(`[${url}](${url})`);
});

test("an empty-text link shows its URL and is saved as written", async ({
  page,
}) => {
  await pasteMarkdown(page, "See [](https://x.org/a) and <https://x.org/b>");
  await expect(page.locator(`${editor} a[href="https://x.org/a"]`)).toHaveText(
    "https://x.org/a",
  );
  expect(await sourceOf(page)).toBe(
    "See [](https://x.org/a) and <https://x.org/b>",
  );
});

test("a screenshot pasted as a blob: image is stored in assets/", async ({
  page,
}) => {
  await mockInvoke(page, { save_pasted_image: { src: "assets/shot.png" } });
  // What WebKitGTK hands the page for a bitmap on the clipboard.
  const blobUrl = await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  }, PNG);
  await paste(page, { "text/html": `<img src="${blobUrl}">` });
  await expect(page.locator(`${editor} .image-view img`)).toHaveCount(1);
  await expect.poll(() => sourceOf(page)).toBe("![](assets/shot.png)");
});

/** Holds the next save_pasted_image until `releaseSave` - a slow disk or
 *  image host - and pastes a screenshot the way WebKitGTK hands it over. */
async function pasteScreenshotWithSlowSave(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __devInvokeResults: Record<string, unknown>;
      __releaseSave: () => void;
    };
    w.__devInvokeResults = {
      save_pasted_image: new Promise((resolve) => {
        w.__releaseSave = () => resolve({ src: "assets/shot.png" });
      }),
    };
  });
  const blobUrl = await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  }, PNG);
  await paste(page, { "text/html": `<img src="${blobUrl}">` });
}

function releaseSave(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __releaseSave: () => void }).__releaseSave(),
  );
}

/** The srcs the document's images have (not the asset: URLs shown). */
function imageSrcs(page: Page): Promise<string[]> {
  return page
    .locator(`${editor} .image-view img`)
    .evaluateAll((imgs) =>
      imgs.map((img) => (img as HTMLImageElement).dataset.docSrc ?? ""),
    );
}

test("undo after a slow screenshot save never brings its blob: src back", async ({
  page,
}) => {
  await pasteScreenshotWithSlowSave(page);
  // Past the history's grouping delay, so the swap would be its own step.
  await page.waitForTimeout(800);
  await releaseSave(page);
  await expect.poll(() => imageSrcs(page)).toEqual(["assets/shot.png"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => imageSrcs(page)).toEqual([]);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => imageSrcs(page)).toEqual(["assets/shot.png"]);
});

test("a screenshot undone before its save lands comes back stored on redo", async ({
  page,
}) => {
  await pasteScreenshotWithSlowSave(page);
  await page.keyboard.press("Control+z");
  await expect.poll(() => imageSrcs(page)).toEqual([]);
  await releaseSave(page);
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => imageSrcs(page)).toEqual(["assets/shot.png"]);
});

test("an image file copied in the file manager is pasted as an image", async ({
  page,
}) => {
  await mockInvoke(page, {
    read_binary_file_base64: PNG,
    save_pasted_image: { src: "assets/copied.png" },
  });
  await paste(page, {
    "text/uri-list": "file:///home/me/%E5%9B%BE/shot.png",
    "text/plain": "/home/me/图/shot.png",
  });
  expect(await sourceOf(page)).toBe("![](assets/copied.png)");
});

test("a file:// link to an image, as WebKitGTK renders a copied file", async ({
  page,
}) => {
  await mockInvoke(page, {
    read_binary_file_base64: PNG,
    save_pasted_image: { src: "assets/linked.png" },
  });
  await paste(page, {
    "text/html": '<a href="file:///home/me/shot.png">/home/me/shot.png</a>',
    "text/plain": "/home/me/shot.png",
  });
  expect(await sourceOf(page)).toBe("![](assets/linked.png)");
});

test("a copied non-image file still pastes as a link", async ({ page }) => {
  await paste(page, {
    "text/html": '<a href="file:///home/me/a.pdf">/home/me/a.pdf</a>',
    "text/plain": "/home/me/a.pdf",
  });
  expect(await sourceOf(page)).toBe("[/home/me/a.pdf](file:///home/me/a.pdf)");
});

/** A real Ctrl+V of `text` at the caret as it stands; paste() would
 *  refocus the editor and move the caret to the end. */
async function pasteHere(page: Page, text: string) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("ControlOrMeta+v");
  await page.waitForTimeout(300);
}

/** Puts the caret `n` characters into the first paragraph, selecting the
 *  next `select` characters. */
async function caretAt(page: Page, n: number, select = 0) {
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("Home");
  for (let i = 0; i < n; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < select; i++)
    await page.keyboard.press("Shift+ArrowRight");
}

test("a URL pasted inside a link's text joins it instead of splitting it", async ({
  page,
}) => {
  await pasteMarkdown(page, "Before [Textus](https://t.example) after.");
  // "Before [Tex|tus" - the caret on the link shows its Markdown, and the
  // URL goes into it as text.
  await caretAt(page, 11);
  await pasteHere(page, "https://inner.example");
  await page.keyboard.press("End");
  await expect(page.locator(`${editor} a`)).toHaveCount(1);
  expect(await sourceOf(page)).toBe(
    "Before [Texhttps://inner.exampletus](https://t.example) after.",
  );
});

test("a URL pasted over selected words links them", async ({ page }) => {
  await pasteMarkdown(page, "Read the docs today.");
  // "Read the |docs| today."
  await caretAt(page, 9, 4);
  await pasteHere(page, "https://docs.example");
  expect(await sourceOf(page)).toBe(
    "Read the [docs](https://docs.example) today.",
  );
});

test("a URL pasted over a link's URL only changes where it points", async ({
  page,
}) => {
  await pasteMarkdown(page, "Before [Textus](https://old.example) after.");
  // "Before [Textus](|https://old.example|)", in the link's Markdown.
  await caretAt(page, 16, 19);
  await pasteHere(page, "https://new.example");
  await page.keyboard.press("End");
  await expect(page.locator(`${editor} a`)).toHaveCount(1);
  expect(await sourceOf(page)).toBe(
    "Before [Textus](https://new.example) after.",
  );
});

/** What the system clipboard holds after a copy: its plain text and HTML. */
async function clipboardNow(page: Page) {
  return page.evaluate(async () => {
    const out: Record<string, string> = {};
    for (const item of await navigator.clipboard.read())
      for (const type of item.types)
        out[type] = await (await item.getType(type)).text();
    return out;
  });
}

const LINKED = "See [Textus](https://textus.catvinci.com) and **bold** text.";

test("a copy's plain text is its Markdown source, and code copied inside a code block is the code alone", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await pasteMarkdown(page, LINKED + "\n\n```js\nlet x = 1;\n```");
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const clip = await clipboardNow(page);
  expect(clip["text/plain"]).toBe(LINKED + "\n\n```js\nlet x = 1;\n```");
  // The formatting travels in the HTML, for apps that take it.
  expect(clip["text/html"]).toContain('href="https://textus.catvinci.com');

  await page.evaluate((sel) => {
    const code = document.querySelector(`${sel} pre code`)!;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text;
    let last = first;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n as Text;
    getSelection()!.setBaseAndExtent(first, 0, last, last.data.length);
  }, editor);
  await page.keyboard.press("ControlOrMeta+c");
  expect((await clipboardNow(page))["text/plain"]).toBe("let x = 1;");
});

test("Copy as Plain Text gives the words as they read; an old copy setting changes nothing", async ({
  page,
}) => {
  // A settings file that still has the old Copy setting loads, and Cmd+C
  // gives the Markdown source.
  await openApp(page, {
    settings: { language: "en", copyTextMode: "plain" },
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await pasteMarkdown(page, LINKED);
  const first = page.locator(`${editor} p`).first();
  await first.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  expect((await clipboardNow(page))["text/plain"]).toBe(LINKED);
  await first.click({ button: "right" });
  await page
    .locator(".context-menu-item")
    .getByText("Copy as Plain Text", { exact: true })
    .click();
  await expect
    .poll(() =>
      clipboardNow(page)
        .then((c) => c["text/plain"])
        .catch(() => ""),
    )
    .toBe("See Textus (https://textus.catvinci.com) and bold text.");
});

test("the context menu's Copy and Paste keep the formatting, as Cmd+C and Cmd+V do", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await pasteMarkdown(page, LINKED + "\n\nEnd.");
  const first = page.locator(`${editor} p`).first();
  await first.click();
  await page.keyboard.press("ControlOrMeta+a");
  await first.click({ button: "right" });
  await page
    .locator(".context-menu-item")
    .getByText("Copy", { exact: true })
    .click();
  // The menu's copy writes the clipboard asynchronously.
  await expect
    .poll(() =>
      clipboardNow(page)
        .then((c) => c["text/plain"])
        .catch(() => ""),
    )
    .toBe(LINKED + "\n\nEnd.");
  const last = page.locator(`${editor} p`).last();
  await last.click();
  await page.evaluate((sel) => {
    const text = [...document.querySelectorAll(`${sel} p`)].pop()!.firstChild!;
    getSelection()!.collapse(text, text.textContent!.length);
  }, editor);
  await last.click({ button: "right" });
  await page
    .locator(".context-menu-item")
    .getByText("Paste", { exact: true })
    .click();
  await expect(page.locator(`${editor} a`)).toHaveCount(2);
  await expect(
    page.locator(`${editor} strong, ${editor} .md-strong`),
  ).toHaveCount(2);
});

test("Paste as Plain Text keeps Markdown marks as text", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator(editor).click();
  await page.evaluate(() => navigator.clipboard.writeText("**not bold**"));
  await page.locator(editor).click({ button: "right" });
  await page
    .locator(".context-menu-item")
    .getByText("Paste as Plain Text", { exact: true })
    .click();
  await expect(page.locator(`${editor} p`).first()).toHaveText("**not bold**");
  await expect(
    page.locator(`${editor} strong, ${editor} .md-strong`),
  ).toHaveCount(0);
});

test("lines pasted into a table cell stay in that cell", async ({ page }) => {
  await pasteMarkdown(page, "| a | b |\n| - | - |\n| c | d |");
  await page.locator(`${editor} td p`).first().click();
  await page.keyboard.press("End");
  await pasteHere(page, "one\n\ntwo");
  await expect(page.locator(`${editor} td`)).toHaveText(["cone two", "d"]);
});

test("Word's list paragraphs paste as a list, nested by level", async ({
  page,
}) => {
  const item = (level: number, list: string, bullet: string, text: string) =>
    `<p class=MsoListParagraph style='mso-list:${list} level${level} lfo1'><![if !supportLists]><span style='mso-list:Ignore'>${bullet}<span>&nbsp;&nbsp; </span></span><![endif]>${text}<o:p></o:p></p>`;
  await paste(page, {
    "text/html":
      "<html xmlns:o='urn:schemas-microsoft-com:office:office'><body>" +
      item(1, "l0", "·", "one") +
      item(2, "l0", "o", "nested") +
      item(1, "l0", "·", "two") +
      item(1, "l1", "1.", "first") +
      "</body></html>",
    "text/plain": "·   one\no   nested\n·   two\n1.  first",
  });
  expect(await sourceOf(page)).toBe("* one\n  * nested\n* two\n\n1. first");
});

test("a heading pasted into the middle of a line keeps its #", async ({
  page,
}) => {
  await pasteMarkdown(page, "Before after.");
  await caretAt(page, 7);
  await pasteHere(page, "# Title ");
  expect(await sourceOf(page)).toBe("Before # Title after.");
});
