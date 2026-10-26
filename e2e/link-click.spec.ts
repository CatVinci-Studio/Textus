import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Ctrl/Cmd+click follows a link (a Markdown file in a tab, a web link in the
// browser) while a plain click only places the caret. Opened as a dropped
// file is, the document has a path for relative links.

const editor = '[data-active-tab="true"] .ProseMirror';

const DOC = "[Chapter one](./notes/ch1.md) and [the site](https://example.com)";

/** What was asked to open in the browser (the dev shim's record). */
const opened = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __devLinks?: unknown[] }).__devLinks ?? [],
  );

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, { read_text_file: DOC, file_mtime_ms: 1 });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      }
    ).__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/home/me/index.md"],
      position: { x: 0, y: 0 },
    }),
  );
  await expect(page.locator(`${editor} a`)).toHaveCount(2);
});

test("Ctrl/Cmd+click on a relative Markdown link opens that file in a tab", async ({
  page,
}) => {
  const before = await page.locator(".ProseMirror").count();
  await page
    .locator(`${editor} a`, { hasText: "Chapter one" })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".ProseMirror")).toHaveCount(before + 1);
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    /ch1/,
  );
  expect(page.url()).not.toContain("ch1.md");
});

test("Ctrl/Cmd+click on a web link opens it in the system browser", async ({
  page,
}) => {
  await page
    .locator(`${editor} a`, { hasText: "the site" })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect
    .poll(() => opened(page))
    .toEqual([{ cmd: "open_web_link", url: "https://example.com" }]);
  expect(page.context().pages()).toHaveLength(1);
});

test("a plain click on a link opens nothing", async ({ page }) => {
  const before = await page.locator(".ProseMirror").count();
  await page.locator(`${editor} a`, { hasText: "Chapter one" }).click();
  await page.locator(`${editor} a`, { hasText: "the site" }).click();
  await page.waitForTimeout(300);
  await expect(page.locator(".ProseMirror")).toHaveCount(before);
  expect(await opened(page)).toEqual([]);
  expect(page.context().pages()).toHaveLength(1);
});
