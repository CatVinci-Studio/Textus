import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A document reopened from the last session or Open Recent comes back with
// the caret where it was left, as long as the file hasn't changed since.

const editor = '[data-active-tab="true"] .ProseMirror';
const scroller = '[data-active-tab="true"] .editor-scroll';
const PATH = "/home/me/long.md";

const DOC = Array.from(
  { length: 80 },
  (_, i) => `Paragraph ${i + 1} of the story.`,
).join("\n\n");

/** Every load of the page reopens PATH as the last session does, from a
 *  disk holding `files`. */
async function session(
  page: Page,
  options: { files?: Record<string, string>; mtime?: number } = {},
) {
  await page.addInitScript(
    ({ files, mtime, path }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__devFiles = files;
      w.__devFileMtimes = Object.fromEntries(
        Object.keys(files).map((p) => [p, mtime]),
      );
      w.__devInvokeResults = { take_pending_open_path: path };
    },
    {
      files: options.files ?? { [PATH]: DOC },
      mtime: options.mtime ?? 1,
      path: PATH,
    },
  );
}

/** The paragraph the caret is in. */
const caretParagraph = (page: Page) =>
  page.evaluate(
    () =>
      window
        .getSelection()
        ?.anchorNode?.parentElement?.closest("p")
        ?.textContent?.trim() ?? null,
  );

const scrollTop = (page: Page) =>
  page.locator(scroller).evaluate((el) => el.scrollTop);

async function leaveCaretAt(page: Page, text: string) {
  await page.locator(`${editor} p`, { hasText: text }).click();
  await expect.poll(() => caretParagraph(page)).toBe(text);
}

test("a reloaded session puts the caret back where it was left", async ({
  page,
}) => {
  await session(page);
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(`${editor} p`)).toHaveCount(80);
  await leaveCaretAt(page, "Paragraph 70 of the story.");
  await page.reload();
  await expect(page.locator(`${editor} p`)).toHaveCount(80);
  await expect
    .poll(() => caretParagraph(page))
    .toBe("Paragraph 70 of the story.");
  expect(await scrollTop(page)).toBeGreaterThan(0);
});

test("a caret past the end of a file that got shorter lands at its end", async ({
  page,
}) => {
  await session(page, { files: { [PATH]: "Only line." } });
  await page.addInitScript(
    (path) =>
      localStorage.setItem(
        "textus-last-carets",
        JSON.stringify({ [path]: { offset: 99999, mtime: 1 } }),
      ),
    PATH,
  );
  await openApp(page, { settings: { language: "en" } });
  await expect.poll(() => caretParagraph(page)).toBe("Only line.");
  expect(await page.evaluate(() => window.getSelection()?.anchorOffset)).toBe(
    "Only line.".length,
  );
});

test("a file changed since opens at its top", async ({ page }) => {
  await session(page, { mtime: 2 });
  await page.addInitScript(
    (path) =>
      localStorage.setItem(
        "textus-last-carets",
        JSON.stringify({ [path]: { offset: DOC.length, mtime: 1 } }),
      ),
    PATH,
  );
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(`${editor} p`)).toHaveCount(80);
  await page.waitForTimeout(300);
  expect(await scrollTop(page)).toBe(0);
  expect(await caretParagraph(page)).not.toBe("Paragraph 80 of the story.");
});

test("nothing is restored with Restore Previous Session off", async ({
  page,
}) => {
  await session(page);
  await openApp(page, {
    settings: { language: "en", restoreSessionOnStartup: false },
  });
  await expect(page.locator(`${editor} p`)).toHaveCount(80);
  await leaveCaretAt(page, "Paragraph 70 of the story.");
  await page.reload();
  await expect(page.locator(`${editor} p`)).toHaveCount(80);
  await page.waitForTimeout(300);
  expect(await scrollTop(page)).toBe(0);
});

test("Typewriter Mode puts the restored caret's line in the middle", async ({
  page,
}) => {
  await session(page);
  await openApp(page, { settings: { language: "en", typewriterMode: true } });
  await expect(page.locator(`${editor} p`)).toHaveCount(80);
  await leaveCaretAt(page, "Paragraph 60 of the story.");
  await page.reload();
  await expect
    .poll(() => caretParagraph(page))
    .toBe("Paragraph 60 of the story.");
  const box = (await page.locator(scroller).boundingBox())!;
  const line = (await page
    .locator(`${editor} p`, { hasText: "Paragraph 60 of" })
    .boundingBox())!;
  const middle = box.y + box.height / 2;
  expect(Math.abs(line.y + line.height / 2 - middle)).toBeLessThan(40);
});

// Over the large-document threshold the place is kept as a document
// position: serializing the markdown before the caret is too slow.
test("a large document comes back at its caret too", async ({ page }) => {
  const big = Array.from(
    { length: 4200 },
    (_, i) => `Paragraph ${i + 1} of the story.`,
  ).join("\n\n");
  await session(page, { files: { [PATH]: big } });
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(`${editor} p`)).toHaveCount(4200);
  await leaveCaretAt(page, "Paragraph 4100 of the story.");
  await page.reload();
  await expect(page.locator(`${editor} p`)).toHaveCount(4200);
  await expect
    .poll(() => caretParagraph(page))
    .toBe("Paragraph 4100 of the story.");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("textus-last-carets") ?? "{}"),
  );
  expect(stored[PATH]).toEqual({ pos: expect.any(Number), mtime: 1 });
});

test("File > Open Recent opens a document at its last caret", async ({
  page,
}) => {
  await page.addInitScript(
    ({ path, doc }) => {
      (window as unknown as Record<string, unknown>).__devFiles = {
        [path]: doc,
      };
      localStorage.setItem(
        "textus-last-carets",
        JSON.stringify({
          [path]: { offset: doc.indexOf("Paragraph 50 ") + 5, mtime: 1 },
        }),
      );
    },
    { path: PATH, doc: DOC },
  );
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(
    (path) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-open-recent", path),
    PATH,
  );
  await expect(page.locator(`${editor} p`)).toHaveCount(80);
  await expect
    .poll(() => caretParagraph(page))
    .toBe("Paragraph 50 of the story.");
});
