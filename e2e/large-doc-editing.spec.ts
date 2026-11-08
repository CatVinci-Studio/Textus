import { expect, test } from "@playwright/test";
import { openApp, settled } from "./helpers";

// Editing across a large document, where off-screen formulas draw as they
// come near: select and copy all, find at its end, an outline jump that
// stays, typing and Enter mid-way, and a tab switched away and back.

const editor = '[data-active-tab="true"] .ProseMirror';
const scroller = '[data-active-tab="true"] > .editor-scroll';
const COUNT = 1400;

const DOC = [
  "# Start",
  "$$\n\\begin{equation} a = b \\end{equation}\n$$",
  ...Array.from({ length: COUNT }, (_, i) =>
    i % 100 === 99
      ? `## Section ${(i + 1) / 100}`
      : `Paragraph ${i} keeps going with words enough to fill most of a line here.`,
  ),
  "$$\n\\begin{equation} c = d \\end{equation}\n$$",
  "The zebracorn end.",
].join("\n\n");

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { settings: { language: "en", newDocumentMode: "tab" } });
  await page.evaluate((markdown) => {
    const w = window as unknown as Record<string, unknown> & {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    w.__devFiles = { "/notes/large.md": markdown };
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/notes/large.md"],
      position: { x: 0, y: 0 },
    });
  }, DOC);
  await expect(page.locator(editor)).toContainText("zebracorn");
});

test("shift-click from the start to the end selects everything between", async ({
  page,
}) => {
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page
    .locator(scroller)
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  const end = page.locator(`${editor} p`, { hasText: "zebracorn" });
  await end.click({ modifiers: ["Shift"] });
  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selected).toContain("Paragraph 700 keeps");
  expect(selected).toContain("zebracorn");
});

test("typing and Enter in the middle work as anywhere", async ({ page }) => {
  const p = page.locator(`${editor} p`, { hasText: "Paragraph 700 keeps" });
  await p.scrollIntoViewIfNeeded();
  // Drawn once it is in view: the click waits for that frame, as a reader's
  // does.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  // The first click only focuses the editor here; the second places the
  // caret.
  await p.click();
  await p.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A new line.");
  await expect(
    page.locator(`${editor} p`, { hasText: "A new line." }),
  ).toBeInViewport();
});

test("a tab back in front shows the same place, at the same heights", async ({
  page,
}) => {
  const p = page.locator(`${editor} p`, { hasText: "Paragraph 900 keeps" });
  await p.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await settled(page);
  // From the top of the scroller: the tab bar comes with the second tab.
  const fromTop = (el: Element) =>
    el.getBoundingClientRect().top -
    el.closest(".editor-scroll")!.getBoundingClientRect().top;
  const before = await p.evaluate(fromTop);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown> & {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    (w.__devFiles as Record<string, string>)["/notes/small.md"] = "A note.";
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/notes/small.md"],
      position: { x: 0, y: 0 },
    });
  });
  await expect(page.locator(editor)).toContainText("A note.");
  // The tab before it: the large document's.
  await page.keyboard.press("Control+Shift+Tab");
  await expect(page.locator(editor)).toContainText("zebracorn");
  await settled(page);
  const after = await p.evaluate(fromTop);
  expect(Math.abs(after - before)).toBeLessThan(2);
});
