import { expect, test, type Page } from "@playwright/test";
import {
  openApp,
  pasteMarkdown,
  PHONE,
  selectionRead,
  settled,
  sourceOf,
} from "./helpers";

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
  expect(await sourceOf(page)).toBe("## Middle\n\n- Omega");
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

test("selected text pulled moves where it is let go; with Option or Ctrl a copy goes", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "move me here\n\nto the end");
  const word = page.locator(`${editor} > p`).first();
  await word.dblclick({ position: { x: 8, y: 8 } });
  await selectionRead(page);
  const box = (await word.boundingBox())!;
  const end = (await block(page, "to the end").boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 2, end.y + end.height / 2, {
    steps: 8,
  });
  await expect(page.locator(".text-drop-caret")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(`${editor} > p`)).toHaveText([
    " me here",
    "to the endmove",
  ]);
  await expect(page.locator(".text-drop-caret")).toHaveCount(0);

  // The moved word is still selected: pulled again with the key held, a copy.
  const moved = page.locator(`${editor} > p`).nth(1);
  const at = (await moved.boundingBox())!;
  const start = (await block(page, "me here").boundingBox())!;
  await page.mouse.move(at.x + at.width - 12, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 1, start.y + start.height / 2, { steps: 8 });
  const copyKey = process.platform === "darwin" ? "Alt" : "Control";
  await page.keyboard.down(copyKey);
  await page.mouse.up();
  await page.keyboard.up(copyKey);
  await expect(page.locator(`${editor} > p`)).toHaveText([
    "move me here",
    "to the endmove",
  ]);
});

test.describe("under a finger", () => {
  test.use(PHONE);

  test("⋮⋮ stands by the caret's block: tapped, its menu; held, the block moves", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await pasteMarkdown(page, "First\n\nSecond\n\nThird");
    await block(page, "First").tap();
    const grip = page.locator(`${handle} .block-handle-grip`);
    await expect(grip).toBeVisible();
    await expect(page.locator(`${handle} .block-handle-add`)).toBeHidden();
    await grip.tap();
    await expect(
      page.getByRole("menuitem", { name: "Delete Block" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Held still, then pulled below the last block.
    const end = (await block(page, "Third").boundingBox())!;
    await grip.evaluate(
      async (el, to) => {
        const { left, top, width, height } = el.getBoundingClientRect();
        const x = left + width / 2;
        const from = top + height / 2;
        const at = (type: string, y: number) =>
          (type === "pointerdown" ? el : window).dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerType: "touch",
              pointerId: 9,
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: x,
              clientY: y,
            }),
          );
        at("pointerdown", from);
        await new Promise((r) => setTimeout(r, 600));
        for (let step = 1; step <= 10; step++) {
          at("pointermove", from + ((to - from) * step) / 10);
          await new Promise((r) => setTimeout(r, 20));
        }
        at("pointerup", to);
      },
      end.y + end.height - 2,
    );
    await expect(page.locator(`${editor} > p`)).toHaveText([
      "Second",
      "Third",
      "First",
    ]);
  });

  test("beside a heading, the fold caret is tapped, not the ⋮⋮ beside it", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await pasteMarkdown(page, "## Part\n\nUnder it");
    const heading = page.locator(`${editor} h2`);
    await heading.tap();
    const caret = heading.locator(".heading-fold");
    await expect(caret).toBeVisible();
    // What a finger on the caret's middle lands on is the caret.
    expect(
      await caret.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return !!hit && el.contains(hit);
      }),
    ).toBe(true);
    await caret.tap();
    await expect(page.getByText("Under it")).toBeHidden();
  });
});
