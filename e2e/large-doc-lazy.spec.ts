import { expect, test, type Page } from "@playwright/test";
import { END, openApp, pasteMarkdown } from "./helpers";

// A document past the threshold draws only the blocks near the screen; the
// rest are placeholders of their height. Nothing a reader does should tell:
// scrolling, find, the outline, copying and typing all reach every block.

const editor = '[data-active-tab="true"] .ProseMirror';
const scroller = '[data-active-tab="true"] > .editor-scroll';
const COUNT = 2400;

const DOC = [
  "# Start",
  ...Array.from({ length: COUNT }, (_, i) =>
    i % 100 === 99
      ? `## Section ${(i + 1) / 100}`
      : `Paragraph ${i} keeps going with words enough to fill most of a line here.`,
  ),
  "The zebracorn end.",
].join("\n\n");

const emit = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );

const frames = (page: Page, count = 3) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++)
      await new Promise((r) => requestAnimationFrame(r));
  }, count);

/** The first block not wholly above the screen: its text and its top. */
const firstShown = (page: Page) =>
  page.evaluate(
    ([editor, scroller]) => {
      const top = document.querySelector(scroller)!.getBoundingClientRect().top;
      for (const el of document.querySelector(editor)!.children) {
        const box = el.getBoundingClientRect();
        if (box.bottom > top)
          return { text: el.textContent ?? "", top: box.top };
      }
      return null;
    },
    [editor, scroller],
  );

test.beforeEach(async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  // That one pastes the document instead.
  if (testInfo.title.startsWith("pasted")) return;
  await openApp(page, { settings: { language: "en", newDocumentMode: "tab" } });
  await page.evaluate((markdown) => {
    const w = window as unknown as Record<string, unknown> & {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    w.__devFiles = { "/notes/long.md": markdown };
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/notes/long.md"],
      position: { x: 0, y: 0 },
    });
  }, DOC);
  await expect(page.locator(editor)).toContainText("Paragraph 3 keeps");
});

test("only the blocks near the screen are drawn, the document whole", async ({
  page,
}) => {
  expect(await page.locator(`${editor} > .lazy-block`).count()).toBeGreaterThan(
    COUNT - 200,
  );
  const blocks = await page.evaluate(
    () =>
      (
        (window as unknown as Record<string, unknown>).__pmView as {
          state: { doc: { childCount: number } };
        }
      ).state.doc.childCount,
  );
  expect(blocks).toBe(COUNT + 2);
});

test("scrolling to the end draws it", async ({ page }) => {
  const end = page.locator(`${editor} p`, { hasText: "zebracorn" });
  await expect(async () => {
    await page
      .locator(scroller)
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await frames(page);
    await expect(end).toBeInViewport({ timeout: 100 });
  }).toPass();
});

test("what is read stays put while the blocks around it are drawn", async ({
  page,
}) => {
  await page
    .locator(scroller)
    .evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  await frames(page, 2);
  const before = await firstShown(page);
  await page.waitForTimeout(500);
  const after = await firstShown(page);
  expect(after?.text).toBe(before?.text);
  expect(Math.abs(after!.top - before!.top)).toBeLessThan(2);
  // And what is on screen is drawn, not placeholders.
  expect(before?.text).toMatch(/Paragraph|Section/);
});

test("scrolling back up through drawn and released blocks doesn't jump", async ({
  page,
}) => {
  const box = page.locator(scroller);
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight / 3));
  await frames(page);
  // Down by screens, past where blocks are released, and back.
  for (let i = 0; i < 12; i++) {
    await box.evaluate((el) => (el.scrollTop += el.clientHeight));
    await frames(page, 2);
  }
  for (let i = 0; i < 12; i++) {
    await box.evaluate((el) => (el.scrollTop -= el.clientHeight));
    await frames(page, 2);
  }
  const before = await firstShown(page);
  await page.waitForTimeout(300);
  const after = await firstShown(page);
  expect(after?.text).toBe(before?.text);
  expect(Math.abs(after!.top - before!.top)).toBeLessThan(2);
});

/** Opens the find bar: in WebKit the first request right after a file
 *  opens can come before its tab listens (as without lazy drawing). */
async function openFind(page: Page) {
  const input = page.locator(".find-replace-input").first();
  await expect(async () => {
    await emit(page, "menu-find-replace");
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass();
  return input;
}

test("find reaches the last block and shows its match", async ({ page }) => {
  await (await openFind(page)).fill("zebracorn");
  const match = page.locator(`${editor} .find-match-active`);
  await expect(match).toHaveText("zebracorn");
  await expect(match).toBeInViewport();
});

test("find counts the matches in blocks out of sight", async ({ page }) => {
  await (await openFind(page)).fill("Section 2");
  // Section 2 and Section 20 to 24.
  await expect(page.locator(".find-replace-count")).toContainText("6");
});

test("pasted past the threshold, the outline jumps to a heading out of sight, which stays", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, DOC);
  await expect(page.locator(editor)).toContainText("zebracorn");
  expect(await page.locator(`${editor} > .lazy-block`).count()).toBeGreaterThan(
    COUNT - 200,
  );
  await emit(page, "menu-toggle-sidebar");
  await page.locator(".sidebar-tab").nth(1).click();
  await page
    .locator(".outline-row .tree-label", { hasText: "Section 23" })
    .click();
  const target = page.locator(`${editor} > h2`, { hasText: "Section 23" });
  await expect(target).toBeInViewport();
  const top = () => target.evaluate((el) => el.getBoundingClientRect().top);
  await page.waitForTimeout(800);
  const first = await top();
  await page.waitForTimeout(400);
  expect(Math.abs((await top()) - first)).toBeLessThan(2);
  await expect(target).toBeInViewport();
});

test("copying everything copies the blocks out of sight", async ({ page }) => {
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  const copied = await page.evaluate(() => {
    let text = "";
    const read = (event: ClipboardEvent) => {
      text = event.clipboardData?.getData("text/plain") ?? "";
    };
    window.addEventListener("copy", read);
    document.execCommand("copy");
    window.removeEventListener("copy", read);
    return text;
  });
  expect(copied).toContain("Paragraph 1200 keeps");
  expect(copied).toContain("zebracorn");
});

test("typing far down the document lands where the caret is", async ({
  page,
}) => {
  await page
    .locator(scroller)
    .evaluate((el) => (el.scrollTop = el.scrollHeight * 0.7));
  await frames(page);
  const p = page.locator(`${editor} p`).filter({ hasText: /^Paragraph/ });
  const target = p.nth(Math.floor((await p.count()) / 2));
  const text = (await target.textContent())!;
  // The first click only focuses the editor here; the second places the
  // caret.
  await target.click();
  await target.click();
  await page.keyboard.press(END);
  await page.keyboard.type(" Added.");
  await expect(
    page.locator(`${editor} p`, { hasText: `${text} Added.` }),
  ).toBeInViewport();
});
