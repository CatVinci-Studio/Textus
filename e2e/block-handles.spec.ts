import { expect, test, type Page } from "@playwright/test";
import {
  emit,
  MAC,
  openApp,
  pasteMarkdown,
  PHONE,
  selectionRead,
  settled,
  sourceOf,
} from "./helpers";

// A block's ⋮⋮ in the margin: shown for the block under the mouse; pulled,
// it moves the block; clicked, it opens the block's menu.

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
  // Lifted off the page; room open where it will land.
  await expect(page.locator(".block-drag-lift")).toBeVisible();
  await expect(page.locator(`${editor} .block-drag-room`)).toBeVisible();
  await expect(block(page, "First")).toHaveClass(/block-drag-gone/);
  await page.mouse.up();
  await expect(page.locator(`${editor} > p`)).toHaveText([
    "Second",
    "Third",
    "First",
  ]);
  await expect(page.locator(`${editor} .block-drag-room`)).toHaveCount(0);
  // Put down with the caret in it, not picked whole in a frame.
  await expect(page.locator(`${editor} .ProseMirror-selectednode`)).toHaveCount(
    0,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(`${editor} > p`)).toHaveText([
    "First",
    "Second",
    "Third",
  ]);
});

test("a block let go: its copy flies to where it landed, then goes", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" }, animations: true });
  await pasteMarkdown(page, "First\n\nSecond\n\nThird");
  await hover(page, "First");
  const grip = (await page
    .locator(`${handle} .block-handle-grip`)
    .boundingBox())!;
  const third = (await block(page, "Third").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + 40, third.y + third.height - 2, { steps: 8 });
  await page.mouse.up();
  const ghost = page.locator(".block-drag-lift");
  expect(
    await ghost.evaluate((el) => el.getAnimations().length),
  ).toBeGreaterThan(0);
  await expect(ghost).toHaveCount(0);
  await expect(page.locator(`${editor} > p`)).toHaveText([
    "Second",
    "Third",
    "First",
  ]);
});

test("a block pulled slowly past its neighbours never flips back and forth", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "# Title line\n\n- one\n- two\n- three\n\nEnd");
  const title = (await page.locator(`${editor} h1`).boundingBox())!;
  await page.mouse.move(title.x + 30, title.y + title.height / 2);
  await expect(page.locator(handle)).toBeVisible();
  const grip = (await page
    .locator(`${handle} .block-handle-grip`)
    .boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y0 = grip.y + grip.height / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  // Where the room is: which of the editor's children (its own place
  // while it would stay); none before the drag begins.
  const aim = () =>
    page.evaluate((sel) => {
      const kids = [...document.querySelector(sel)!.children];
      const room = kids.findIndex((k) =>
        k.classList.contains("block-drag-room"),
      );
      return room >= 0 ? `room@${room}` : null;
    }, editor);
  const seen: string[] = [];
  for (let dy = 0; dy <= 160; dy += 2) {
    await page.mouse.move(x, y0 + dy);
    const now = await aim();
    if (now && seen.at(-1) !== now) seen.push(now);
  }
  for (let dy = 160; dy >= -10; dy -= 2) {
    await page.mouse.move(x, y0 + dy);
    const now = await aim();
    if (now && seen.at(-1) !== now) seen.push(now);
  }
  await page.keyboard.press("Escape");
  await page.mouse.up();
  // Down, then back up: the room only ever moves one way at a time.
  const at = seen.map((v) => Number(v.slice(5)));
  const turn = at.indexOf(Math.max(...at));
  expect(at.length).toBeGreaterThan(2);
  for (let i = 1; i < at.length; i++)
    expect(i <= turn ? at[i] > at[i - 1] : at[i] < at[i - 1]).toBe(true);
});

test("a list item's handle stays with it across the markers; pulled, the item moves", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Intro\n\n- Alpha\n- Beta\n  - Inner\n- Gamma");
  const item = (text: string) =>
    page.locator(`${editor} li`, { hasText: text }).last();
  const beta = (await item("Beta").boundingBox())!;
  const y = beta.y + 8;
  await page.mouse.move(beta.x + 10, y);
  const grip = page.locator(`${handle} .block-handle-grip`);
  await expect(grip).toBeVisible();
  const at = (await grip.boundingBox())!;
  // Across the item's marker to its grip: the handle stays where it was.
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, {
    steps: 12,
  });
  expect(await grip.boundingBox()).toEqual(at);
  const gamma = (await item("Gamma").boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(gamma.x + 40, gamma.y + gamma.height - 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.locator(`${editor} > ul > li > p`)).toHaveText([
    "Alpha",
    "Gamma",
    "Beta",
  ]);
  await expect(page.locator(`${editor} ul ul li`)).toHaveText("Inner");
});

test("a list's only item pulled away can go back between the headings round it, its ⋮⋮ held all the way", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "- Top\n\n## Life\n\n- Eat\n\n## Work\n\nEnd");
  const life = (await block(page, "Life").boundingBox())!;
  const work = (await block(page, "Work").boundingBox())!;
  const top = (await block(page, "Top").boundingBox())!;
  const eat = (await page
    .locator(`${editor} li`, { hasText: "Eat" })
    .boundingBox())!;
  await page.mouse.move(eat.x + 10, eat.y + 8);
  await expect(page.locator(handle)).toBeVisible();
  const grip = (await page
    .locator(`${handle} .block-handle-grip`)
    .boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  const room = page.locator(`${editor} .block-drag-room`);
  // Up by Top: the room opens under it, the ⋮⋮ under the pointer.
  const up = { x: top.x + 40, y: top.y + top.height - 2 };
  await page.mouse.move(up.x, up.y, { steps: 8 });
  const carried = (await page
    .locator(".block-drag-lift .block-drag-grip")
    .boundingBox())!;
  expect(Math.abs(carried.x + carried.width / 2 - up.x)).toBeLessThan(
    carried.width,
  );
  expect(Math.abs(carried.y + carried.height / 2 - up.y)).toBeLessThan(
    carried.height,
  );
  await expect
    .poll(async () => (await room.boundingBox())!.y)
    .toBeLessThan(life.y);
  // Back between Life and Work: its own place opens there again.
  await page.mouse.move(up.x, (life.y + life.height + work.y) / 2, {
    steps: 8,
  });
  await expect
    .poll(async () => (await room.boundingBox())!.y)
    .toBeGreaterThan(life.y + life.height / 2);
  await page.mouse.up();
  expect(await sourceOf(page)).toBe(
    "- Top\n\n## Life\n\n- Eat\n\n## Work\n\nEnd",
  );
});

test("a block pulled into the document beside it moves there; with Option or Ctrl a copy goes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Left one\n\nLeft two");
  await emit(page, "menu-split-right");
  const editors = page.locator(".ProseMirror");
  await expect(editors).toHaveCount(2);
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("Right line");
  const right = editors.filter({ hasText: "Right line" });
  const left = editors.filter({ hasNotText: "Right line" });
  const pull = async (text: string, copy: boolean) => {
    const from = (await left.locator("p", { hasText: text }).boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    const grip = (await page
      .locator(".block-handle:visible .block-handle-grip")
      .boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    // Below the last line, aimed again once the room has opened.
    for (let i = 0; i < 2; i++) {
      const to = (await right.locator("p").last().boundingBox())!;
      await page.mouse.move(to.x + 40, to.y + to.height + 4, { steps: 10 });
    }
    await expect(right.locator(".block-drag-room")).toBeVisible();
    if (copy) await page.keyboard.down(MAC ? "Alt" : "Control");
    await page.mouse.up();
    if (copy) await page.keyboard.up(MAC ? "Alt" : "Control");
  };
  await pull("Left two", false);
  await expect(right.locator("p")).toHaveText(["Right line", "Left two"]);
  await expect(left.locator("p")).toHaveText(["Left one"]);
  await pull("Left one", true);
  await expect(right.locator("p")).toHaveText([
    "Right line",
    "Left two",
    "Left one",
  ]);
  await expect(left.locator("p")).toHaveText(["Left one"]);
});

test("⋮⋮ alone in the margin turns its block into another kind or deletes it", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "## Middle\n\nOmega\n\nAlpha");
  await hover(page, "Omega");
  await expect(page.locator(`${handle} button:visible`)).toHaveCount(1);

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

test("the handles come with the fold caret over a block's line, stay away while typing, and are off in Settings", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "## Part one\n\nSome text that runs on for a while",
  );
  // Anywhere on the line: ⋮⋮ and the fold caret, together.
  const heading = (await block(page, "Part one").boundingBox())!;
  const caret = page.locator(`${handle} .block-handle-fold`);
  await expect(caret).toBeHidden();
  await page.mouse.move(heading.x + heading.width - 20, heading.y + 10);
  await expect(page.locator(handle)).toBeVisible();
  await expect(caret).toBeVisible();
  // Outside the heading's text.
  await expect(page.locator(`${editor} h2 button`)).toHaveCount(0);
  // Left of ⋮⋮, never over it; reached across ⋮⋮, both stay.
  const grip = (await page
    .locator(`${handle} .block-handle-grip`)
    .boundingBox())!;
  const fold = (await caret.boundingBox())!;
  expect(fold.x + fold.width).toBeLessThanOrEqual(grip.x + 1);
  await page.mouse.move(fold.x + fold.width / 2, fold.y + fold.height / 2, {
    steps: 10,
  });
  await settled(page);
  await expect(page.locator(handle)).toBeVisible();
  await expect(caret).toBeVisible();
  // Folded, its caret stays in the same place with the mouse gone.
  await caret.click();
  await expect(page.getByText("Some text")).toBeHidden();
  await hover(page, "Part one");
  const mark = page.locator(".heading-fold-mark .block-handle-fold");
  await expect(mark).toHaveAttribute("aria-expanded", "false");
  const kept = (await mark.boundingBox())!;
  expect(Math.abs(kept.x - fold.x)).toBeLessThan(1);
  expect(Math.abs(kept.y - fold.y)).toBeLessThan(1);
  await mark.click();
  await expect(mark).toHaveCount(0);
  await hover(page, "Some text");
  await page.locator(editor).press("End");
  await page.keyboard.type(" more");
  await expect(page.locator(handle)).toBeHidden();
  await openApp(page, { settings: { language: "en", blockHandles: false } });
  await pasteMarkdown(page, "## Part one\n\nSome text");
  const box = (await block(page, "Some text").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await settled(page);
  await expect(page.locator(handle)).toBeHidden();
  // A heading's fold caret still comes over its line, alone.
  const title = (await block(page, "Part one").boundingBox())!;
  await page.mouse.move(title.x + 6, title.y + 10);
  await expect(page.locator(`${handle} .block-handle-fold`)).toBeVisible();
  await expect(page.locator(`${handle} .block-handle-grip`)).toBeHidden();
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
    await grip.tap();
    await expect(
      page.getByRole("menuitem", { name: "Delete Block" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // The menu gone and the grip back by the caret: what the hold needs.
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(grip).toBeVisible();

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
    const caret = page.locator(`${handle} .block-handle-fold`);
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

test("zoomed in, the blocks making room slide from where they were drawn", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" }, animations: true });
  await pasteMarkdown(page, "First\n\nSecond\n\nThird");
  const box = (await block(page, "Second").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 4);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await settled(page);
  await hover(page, "First");
  const grip = (await page
    .locator(`${handle} .block-handle-grip`)
    .boundingBox())!;
  const second = (await block(page, "Second").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 20, second.y + second.height - 2, {
    steps: 10,
  });
  // Second steps up past the room, its slide starting where it was drawn:
  // the zoom not counted twice.
  const startsAt = await block(page, "Second").evaluate((el) => {
    const flight = el.getAnimations().find((a) => a.id === "flip");
    if (!flight) return null;
    flight.pause();
    flight.currentTime = 0;
    return el.getBoundingClientRect().top;
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(startsAt).not.toBeNull();
  expect(Math.abs(startsAt! - second.y)).toBeLessThan(2);
});

test("in split view the preview's fold caret comes by a heading's start, with no ⋮⋮", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", viewMode: "split" } });
  await page.locator(".cm-content").first().click();
  await page.keyboard.insertText("## Part one\n\nSome text\n");
  const heading = page.locator(".split-preview-editor h2");
  await expect(heading).toHaveText(/Part one/);
  const box = (await heading.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 10);
  const tools = page.locator(".split-preview-editor .block-handle");
  await expect(tools.locator(".block-handle-fold")).toBeVisible();
  await expect(tools.locator(".block-handle-grip")).toBeHidden();
});
