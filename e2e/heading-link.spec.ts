import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A link into another file's heading (`./ch1.md#part-two`) opens that file
// scrolled to the heading - in a new tab, or the tab it is already open
// in. A heading the file doesn't have opens it at its top.

const editor = '[data-active-tab="true"] .ProseMirror';
const scroller = '[data-active-tab="true"] .editor-scroll';

const INDEX = [
  "[Part two](./ch1.md#part-two)",
  "[The end](./ch1.md#%E7%AC%AC%E4%BA%8C%E7%AB%A0%E7%B5%90%E5%B0%BE)",
  "[Nowhere](./ch1.md#no-such-heading)",
].join("\n\n");

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} of filler.`).join(
    "\n\n",
  );

const CH1 = `# Chapter one\n\n${filler(60)}\n\n## Part two\n\n${filler(60)}\n\n## 第二章：結尾\n\nLast words.`;

async function openIndex(page: Page) {
  await page.evaluate(
    ({ index, ch1 }) => {
      const w = window as unknown as {
        __devFiles: Record<string, string>;
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = { "/home/me/index.md": index, "/home/me/ch1.md": ch1 };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: ["/home/me/index.md"],
        position: { x: 0, y: 0 },
      });
    },
    { index: INDEX, ch1: CH1 },
  );
  await expect(page.locator(`${editor} a`)).toHaveCount(3);
}

const follow = (page: Page, text: string) =>
  page
    .locator(`${editor} a`, { hasText: text })
    .click({ modifiers: ["ControlOrMeta"] });

/** Whether the active tab's heading `text` is on screen. */
async function headingOnScreen(page: Page, text: string) {
  const box = await page.locator(scroller).boundingBox();
  const heading = await page
    .locator(`${editor} h2`, { hasText: text })
    .boundingBox();
  return (
    !!box &&
    !!heading &&
    heading.y >= box.y &&
    heading.y + heading.height <= box.y + box.height
  );
}

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await openIndex(page);
});

test("a link into another file's heading opens the file there", async ({
  page,
}) => {
  await follow(page, "Part two");
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    /ch1/,
  );
  await expect.poll(() => headingOnScreen(page, "Part two")).toBe(true);
  expect(
    await page.locator(scroller).evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(0);
});

test("a link into a file already open switches to its tab and scrolls, Chinese heading too", async ({
  page,
}) => {
  await follow(page, "Part two");
  await expect.poll(() => headingOnScreen(page, "Part two")).toBe(true);
  await page.locator(".tab-pill", { hasText: "index" }).click();
  await expect(page.locator(`${editor} a`)).toHaveCount(3);
  const editors = await page.locator(".ProseMirror").count();
  await follow(page, "The end");
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    /ch1/,
  );
  await expect.poll(() => headingOnScreen(page, "第二章")).toBe(true);
  // The same tab, not a second copy of the file.
  await expect(page.locator(".ProseMirror")).toHaveCount(editors);
});

test("a heading the file doesn't have opens it at its top", async ({
  page,
}) => {
  await follow(page, "Nowhere");
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    /ch1/,
  );
  await expect(page.locator(`${editor} h1`)).toContainText("Chapter one");
  await page.waitForTimeout(300);
  expect(await page.locator(scroller).evaluate((el) => el.scrollTop)).toBe(0);
});
