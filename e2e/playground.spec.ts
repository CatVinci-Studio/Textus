import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The browser playground (src/playground/): the editor alone, as it runs at
// textus.catvinci.com/playground/ - no dev shim, nothing native behind it.

const editor = ".editor-content .ProseMirror";

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Opens the playground, failing the test on any request that leaves the
 *  page's own server. */
async function openPlayground(page: Page) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (!/^(data|blob):/.test(url))
      expect(new URL(url).origin, url).toBe(origin);
  });
  await page.goto("/playground/");
  await expect(page.locator(`${editor} h1`)).toBeVisible();
}

/** The document as saved in this browser. */
function saved(page: Page) {
  return page.evaluate(() =>
    localStorage.getItem("textus-playground:document"),
  );
}

/** Types a new paragraph at the end of the sample, once its diagram has
 *  drawn and the page stopped growing. */
async function typeAtEnd(page: Page, text: string) {
  await expect(page.locator(`${editor} .mermaid-preview svg`)).toBeVisible({
    timeout: 15_000,
  });
  await page.locator(`${editor} h1`).click();
  await page.keyboard.press("Control+End");
  // The caret move reaches the editor's state on selectionchange, a task
  // later; an Enter sent at once still went to the heading.
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

test("the first visit shows the sample, rendered", async ({ page }) => {
  await openPlayground(page);
  await expect(page.locator(`${editor} h1`)).toContainText("Welcome to Textus");
  await expect(page.locator(`${editor} table`)).toBeVisible();
  await expect(page.locator(`${editor} .katex`).first()).toBeVisible();
  // KaTeX's fonts are bundled as woff2 alone (vite.katex-fonts.ts); the
  // formulas must still get them rather than a fallback face.
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => {
      let loaded = false;
      document.fonts.forEach((face) => {
        if (face.family === "KaTeX_Main" && face.status === "loaded")
          loaded = true;
      });
      return loaded;
    }),
    "KaTeX's fonts did not load",
  ).toBe(true);
  await expect(page.locator(`${editor} .mermaid-preview svg`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Download Textus" }),
  ).toHaveAttribute("href", "https://textus.catvinci.com/#download");
  await expect(
    page.getByText("Your document is kept in this browser only."),
  ).toBeVisible();
  // Nothing is saved until something is written.
  expect(await saved(page)).toBeNull();
});

test("typing is saved and survives a reload", async ({ page }) => {
  await openPlayground(page);
  await typeAtEnd(page, "Written in the browser");
  await expect.poll(() => saved(page)).toContain("Written in the browser");
  await page.reload();
  await expect(page.locator(editor)).toContainText("Written in the browser");
  await expect(page.locator(`${editor} h1`)).toContainText("Welcome to Textus");
});

test("an edit the debounce still holds is kept on leaving", async ({
  page,
}) => {
  await openPlayground(page);
  // At the end of the heading's text. A click in the heading's middle
  // landed inside "Textus" with CI's fonts, and an End sent at once - while
  // the click first draws the heading's "# " marker - was sometimes lost in
  // Chromium, so the "!" went in before the "s": "Textu!s" (also on the
  // commit before #245, with the CPU slowed down).
  const end = await page.locator(`${editor} h1`).evaluate((heading) => {
    const range = document.createRange();
    range.selectNodeContents(heading);
    const box = range.getBoundingClientRect();
    return { x: box.right - 1, y: box.top + box.height / 2 };
  });
  await page.mouse.click(end.x, end.y);
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  // Straight away, before the listener reports it.
  await page.reload();
  await expect(page.locator(`${editor} h1`)).toContainText(
    "Welcome to Textus!",
  );
});

test("Import replaces the document, and Undo brings it back", async ({
  page,
}) => {
  await openPlayground(page);
  await page.getByTestId("playground-import-input").setInputFiles({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("﻿# Imported\r\n\r\n- [ ] a task\r\n"),
  });
  await expect(page.locator(`${editor} h1`)).toContainText("Imported");
  await expect(page.locator(`${editor} li`)).toHaveText("a task");
  await expect.poll(() => saved(page)).toContain("# Imported");

  await page.locator(editor).focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(`${editor} h1`)).toContainText("Welcome to Textus");
});

test("a Markdown file dropped on the page is imported", async ({ page }) => {
  await openPlayground(page);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# Dropped\n"], "dropped.markdown"));
    document.querySelector(".ProseMirror")!.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(`${editor} h1`)).toContainText("Dropped");
});

test("a file that isn't Markdown is turned away", async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId("playground-import-input").setInputFiles({
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(page.getByRole("status")).toHaveText(
    "Only .md, .markdown and .txt files can be imported.",
  );
  await expect(page.locator(`${editor} h1`)).toContainText("Welcome to Textus");
});

test("Export downloads the document as Markdown", async ({ page }) => {
  await openPlayground(page);
  await typeAtEnd(page, "Exported line");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Welcome to Textus.md");
  const text = readFileSync(await download.path(), "utf8");
  expect(text).toMatch(/^# Welcome to Textus\n/);
  expect(text).toContain("```mermaid");
  expect(text).toContain("Exported line");
});

test("source mode shows the Markdown and takes edits back", async ({
  page,
}) => {
  await openPlayground(page);
  await page.locator(editor).click();
  await page.keyboard.press("Control+/");
  const source = page.locator("textarea.source-view");
  await expect(source).toBeVisible();
  await expect(source).toHaveValue(/^# Welcome to Textus\n/);
  await source.fill("# From source\n\n$x^2$ squared\n\nEnd\n");
  await page.getByRole("button", { name: "Source" }).click();
  await expect(source).toHaveCount(0);
  await expect(page.locator(`${editor} h1`)).toContainText("From source");
  await expect(page.locator(`${editor} .katex`)).toBeVisible();
  expect(await saved(page)).toBe("# From source\n\n$x^2$ squared\n\nEnd\n");
});

test("a pasted image inserts nothing and says why", async ({ page }) => {
  await openPlayground(page);
  const before = await page.locator(editor).innerHTML();
  await page.evaluate((png) => {
    const target = document.querySelector<HTMLElement>(".ProseMirror")!;
    target.focus();
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "image.png", { type: "image/png" }));
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, PNG);
  await expect(page.getByRole("status")).toHaveText(
    "Images need the Textus desktop app.",
  );
  await expect(
    page.locator(`${editor} img:not(.ProseMirror-separator)`),
  ).toHaveCount(0);
  expect(await page.locator(editor).innerHTML()).toBe(before);
  expect(await saved(page)).toBeNull();
});

test.describe("in Chinese", () => {
  test.use({ locale: "zh-CN" });

  test("the page and the sample follow the browser's language", async ({
    page,
  }) => {
    await openPlayground(page);
    await expect(page.locator(`${editor} h1`)).toContainText("欢迎使用 Textus");
    await expect(page.getByRole("button", { name: "导入" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  });
});
