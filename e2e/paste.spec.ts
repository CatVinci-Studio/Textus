import { expect, test, type Page } from "@playwright/test";
import {
  LINE_END,
  LINE_START,
  mockInvoke,
  openApp,
  pasteMarkdown,
} from "./helpers";

// Issues #59 and #60: what a paste puts in the markdown. The backend is the
// dev shim, so the image commands answer with canned srcs - the Rust side
// of storing the file is covered by its own tests.

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
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => imageSrcs(page)).toEqual([]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => imageSrcs(page)).toEqual(["assets/shot.png"]);
});

test("a screenshot undone before its save lands comes back stored on redo", async ({
  page,
}) => {
  await pasteScreenshotWithSlowSave(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => imageSrcs(page)).toEqual([]);
  await releaseSave(page);
  await page.waitForTimeout(300);
  await page.keyboard.press("ControlOrMeta+Shift+z");
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

/** A real Ctrl+V of `text` at the caret as it stands, through the system
 *  clipboard (paste() dispatches the event itself, after focusing the
 *  editor, which reads the caret afresh and puts it at the end). */
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
  // "Before Tex|tus"
  await caretAt(page, 10);
  await pasteHere(page, "https://inner.example");
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

test("a URL pasted over a link's whole text only changes where it points", async ({
  page,
}) => {
  await pasteMarkdown(page, "Before [Textus](https://old.example) after.");
  await caretAt(page, 7, 6);
  await pasteHere(page, "https://new.example");
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

test("a copy's plain text reads as words, links with their address", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await pasteMarkdown(page, LINKED);
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const clip = await clipboardNow(page);
  expect(clip["text/plain"]).toBe(
    "See Textus (https://textus.catvinci.com) and bold text.",
  );
  // The formatting still travels in the HTML, for apps that take it.
  expect(clip["text/html"]).toContain('href="https://textus.catvinci.com');
});

test("set to Markdown, a copy's plain text is the source", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", copyTextMode: "markdown" },
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await pasteMarkdown(page, LINKED);
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  expect((await clipboardNow(page))["text/plain"].trimEnd()).toBe(LINKED);
});

test("the context menu's Copy and Paste keep the formatting", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await pasteMarkdown(page, LINKED + "\n\nEnd.");
  const first = page.locator(`${editor} p`).first();
  await first.click();
  await page.keyboard.press(LINE_START);
  await page.keyboard.press(`Shift+${LINE_END}`);
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
    .toBe("See Textus (https://textus.catvinci.com) and bold text.");
  const last = page.locator(`${editor} p`).last();
  await last.click();
  await page.keyboard.press(LINE_END);
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
