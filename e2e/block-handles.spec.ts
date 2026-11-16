import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, settled, sourceOf } from "./helpers";

// A block's ＋ and ⋮⋮ in the margin: shown for the block under the mouse,
// ⋮⋮ pulled moves it, ＋ adds a block below, ⋮⋮ clicked opens its menu.

const editor = '[data-active-tab="true"] .ProseMirror';
const handle = '[data-active-tab="true"] .block-handle';
const block = (page: Page, text: string) =>
  page.locator(`${editor} > *`, { hasText: text }).first();

async function hover(page: Page, text: string) {
  const box = (await block(page, text).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await expect(page.locator(handle)).toBeVisible();
}

test("a block pulled by its handle moves where it is let go, in one undo step", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "First\n\nSecond\n\nThird");
  await hover(page, "First");
  // The handle stands in the margin, on the block's first line.
  const grip = (await page
    .locator(`${handle} .block-handle-grip`)
    .boundingBox())!;
  const first = (await block(page, "First").boundingBox())!;
  expect(grip.x + grip.width).toBeLessThanOrEqual(first.x);
  expect(grip.y + grip.height / 2).toBeGreaterThan(first.y);
  expect(grip.y + grip.height / 2).toBeLessThan(first.y + first.height);

  const third = (await block(page, "Third").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + 40, third.y + third.height - 2, { steps: 8 });
  await expect(page.locator(".block-drop-line")).toBeVisible();
  await expect(block(page, "First")).toHaveClass(/tx-drag-source/);
  await page.mouse.up();
  await expect(page.locator(`${editor} > p`)).toHaveText([
    "Second",
    "Third",
    "First",
  ]);
  await expect(page.locator(".block-drop-line")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(`${editor} > p`)).toHaveText([
    "First",
    "Second",
    "Third",
  ]);
});

test("＋ adds the block picked below; ⋮⋮ turns it into another kind or deletes it", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Alpha\n\nOmega");
  await hover(page, "Alpha");
  await page.locator(`${handle} .block-handle-add`).click();
  await page.getByRole("menuitem", { name: "Heading 2" }).click();
  await page.keyboard.type("Middle");
  await expect(page.locator(`${editor} > h2`)).toContainText("Middle");

  await hover(page, "Omega");
  await page.locator(`${handle} .block-handle-grip`).click();
  await page.getByRole("menuitem", { name: "Turn Into" }).hover();
  await page.getByRole("menuitem", { name: "Bullet List" }).click();
  await expect(page.locator(`${editor} > ul li`)).toHaveText("Omega");

  await hover(page, "Alpha");
  await page.locator(`${handle} .block-handle-grip`).click();
  await page.getByRole("menuitem", { name: "Delete Block" }).click();
  await settled(page);
  expect(await sourceOf(page)).toBe("## Middle\n\n* Omega");
});

test("the handles stay away while typing, and off in Settings", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Some text");
  await hover(page, "Some text");
  await page.locator(editor).press("End");
  await page.keyboard.type(" more");
  await expect(page.locator(handle)).toBeHidden();
  await openApp(page, { settings: { language: "en", blockHandles: false } });
  await pasteMarkdown(page, "Some text");
  const box = (await block(page, "Some text").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await expect(page.locator(handle)).toBeHidden();
});
