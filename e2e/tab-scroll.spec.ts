import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A tab switched away from and back to shows the place it was left at. A
// tab in the back is display: none, and WebKit (WebKitGTK, WKWebView) set
// a hidden scroller back to the top: the document opened at its first
// line again. Also run in WebKit: E2E_WEBKIT=1 (playwright.config.ts).

const editor = '[data-active-tab="true"] .ProseMirror';
const scroller = '[data-active-tab="true"] > .editor-scroll';

const LONG = Array.from(
  { length: 400 },
  (_, i) => `Paragraph ${i} of a long document.`,
).join("\n\n");

function drop(page: Page, path: string, text: string) {
  return page.evaluate(
    ({ path, text }) => {
      const w = window as unknown as Record<string, unknown> & {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = {
        ...(w.__devFiles as Record<string, string> | undefined),
        [path]: text,
      };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
    },
    { path, text },
  );
}

test("a tab back in front is where it was left", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await drop(page, "/notes/long.md", LONG);
  await expect(page.locator(editor)).toContainText("Paragraph 399");
  const line = page.locator(`${editor} p`, { hasText: "Paragraph 300 of" });
  await line.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(200);
  const scrolled = await page.locator(scroller).evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(1000);

  await drop(page, "/notes/short.md", "A short note.");
  await expect(page.locator(editor)).toContainText("A short note.");
  // Back to the long one: the tab before.
  await page.keyboard.press("Control+Shift+Tab");
  await expect(page.locator(editor)).toContainText("Paragraph 399");
  await expect
    .poll(() => page.locator(scroller).evaluate((el) => el.scrollTop))
    .toBe(scrolled);
  await expect(line).toBeInViewport();
});

test("a file opened again opens where it was last read, at another width too (#348)", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await drop(page, "/notes/long.md", LONG);
  await expect(page.locator(editor)).toContainText("Paragraph 399");
  const line = page.locator(`${editor} p`, { hasText: "Paragraph 300 of" });
  await line.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  // Closed, and opened again in a narrower window.
  await page.keyboard.press("Control+w");
  await expect(page.locator(editor)).not.toContainText("Paragraph 399");
  await page.setViewportSize({ width: 900, height: 700 });
  await drop(page, "/notes/long.md", LONG);
  await expect(page.locator(editor)).toContainText("Paragraph 399");
  await expect
    .poll(() =>
      line.evaluate((el) => {
        const s = el.closest(".editor-scroll")!.getBoundingClientRect();
        return Math.abs(el.getBoundingClientRect().top - s.top);
      }),
    )
    .toBeLessThan(4);
});

test("a file never scrolled opens at its top", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await drop(page, "/notes/other.md", LONG);
  await expect(page.locator(editor)).toContainText("Paragraph 399");
  await page.waitForTimeout(300);
  expect(await page.locator(scroller).evaluate((el) => el.scrollTop)).toBe(0);
});
