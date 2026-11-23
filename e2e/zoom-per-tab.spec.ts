import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown, PHONE } from "./helpers";

// Each tab keeps its own zoom: zooming the document on the right leaves
// the one on the left as it was - unless documents zoom together; over
// Settings a zoom does nothing.

const zoomOf = (page: Page, i: number) =>
  page
    .locator("[data-tab-id]")
    .nth(i)
    .evaluate((tab) =>
      parseFloat(
        getComputedStyle(tab).getPropertyValue("--content-zoom") || "1",
      ),
    );

async function zoomIn(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  // Real time: a pinch ends once the wheel has been still a moment (useZoom's 250 ms).
  await page.waitForTimeout(600);
}

test("a zoom changes only the tab it is over", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await emit(page, "menu-split-right");
  const sheets = page.locator("section.island");
  await expect(sheets).toHaveCount(2);
  const right = (await sheets.nth(1).boundingBox())!;
  await zoomIn(page, right.x + right.width / 2, right.y + right.height / 2);
  expect(await zoomOf(page, 1)).toBeGreaterThan(1.1);
  expect(await zoomOf(page, 0)).toBe(1);
});

test("zoomed together, a zoom over one document sizes them all", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: { menuBarShown: false, zoomTogether: true },
  });
  await emit(page, "menu-split-right");
  const sheets = page.locator("section.island");
  await expect(sheets).toHaveCount(2);
  const right = (await sheets.nth(1).boundingBox())!;
  await zoomIn(page, right.x + right.width / 2, right.y + right.height / 2);
  expect(await zoomOf(page, 1)).toBeGreaterThan(1.1);
  expect(await zoomOf(page, 0)).toBe(await zoomOf(page, 1));
});

test("over Settings, a zoom does nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await emit(page, "menu-settings");
  const page_ = (await page.locator(".settings-tab").boundingBox())!;
  await zoomIn(page, page_.x + page_.width / 2, page_.y + 200);
  const zooms = await page
    .locator("[data-tab-id]")
    .evaluateAll((tabs) =>
      tabs.map((t) =>
        parseFloat(
          getComputedStyle(t).getPropertyValue("--content-zoom") || "1",
        ),
      ),
    );
  expect(zooms.every((z) => z === 1)).toBe(true);
});

test("a trackpad pinch right after a scroll zooms (Windows: ctrl+wheel in fractions)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  const sheet = (await page.locator("section.island").first().boundingBox())!;
  await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + sheet.height / 2);
  // Two fingers land and drift a little, then spread.
  await page.mouse.wheel(0, 3);
  // Mid-pinch the column is only drawn larger: no relayout of the document.
  // Read in the same task as the pinch: it rests (and lands) 150 ms after
  // its last event, sooner than a loaded runner's next round trip.
  const midPinch = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y)!;
      for (let i = 0; i < 12; i++)
        target.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -8.5,
            ctrlKey: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      const tab = document.querySelector("[data-tab-id]")!;
      const column = document.querySelector(".editor-content")!;
      return {
        zoom: getComputedStyle(tab).getPropertyValue("--content-zoom") || "1",
        transform: getComputedStyle(column).transform,
      };
    },
    { x: sheet.x + sheet.width / 2, y: sheet.y + sheet.height / 2 },
  );
  expect(parseFloat(midPinch.zoom)).toBe(1);
  expect(midPinch.transform).toMatch(/matrix/);
  const column = page.locator(".editor-content").first();
  await expect.poll(() => zoomOf(page, 0)).toBeGreaterThan(1.1);
  await expect(column).toHaveCSS("transform", "none");
});

test("zoomed in a narrow window, the text's margin still holds a block's fold caret", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  const sheet = (await page.locator("section.island").first().boundingBox())!;
  await zoomIn(page, sheet.x + sheet.width / 2, sheet.y + sheet.height / 2);
  const zoom = await zoomOf(page, 0);
  expect(zoom).toBeGreaterThan(1.1);
  // A drawn block's fold caret (block-fold.css), at the text's left edge.
  const { pane, caret } = await page
    .locator(".editor-content:visible")
    .first()
    .evaluate((el) => {
      const block = document.createElement("div");
      block.className = "block-foldable";
      const fold = block.appendChild(document.createElement("button"));
      fold.className = "block-fold";
      el.querySelector(".milkdown")!.append(block);
      const caret = fold.getBoundingClientRect().left;
      block.remove();
      return { pane: el.getBoundingClientRect().left, caret };
    });
  expect(caret).toBeGreaterThanOrEqual(pane);
});

test.describe("a pinch on a phone", () => {
  test.use(PHONE);

  test("has the caret placed again where its text went", async ({ page }) => {
    await openApp(page);
    const editor = page.locator(".ProseMirror:visible");
    await editor.tap();
    await page.keyboard.type("你好 hello");
    // iOS's WebKit moves its own caret only on a selection change, and
    // reads where to as the zoom lands; WebKit's pinch events, by hand.
    const placed = await editor.evaluate(async (pm) => {
      const box = pm.getBoundingClientRect();
      const at = { clientX: box.left + box.width / 2, clientY: box.top + 20 };
      const pinch = (type: string, scale: number) =>
        window.dispatchEvent(
          Object.assign(new Event(type, { cancelable: true }), at, { scale }),
        );
      const before = getSelection()!.focusOffset;
      pinch("gesturestart", 1);
      for (let step = 1; step <= 5; step++)
        pinch("gesturechange", 1 + step / 5);
      await new Promise((r) => setTimeout(r, 50));
      let changed = 0;
      document.addEventListener("selectionchange", () => changed++);
      pinch("gestureend", 2);
      await new Promise((r) => setTimeout(r, 100));
      return { changed, same: getSelection()!.focusOffset === before };
    });
    expect(await zoomOf(page, 0)).toBe(2);
    expect(placed.changed).toBeGreaterThan(0);
    expect(placed.same).toBe(true);
    await expect(editor).toBeFocused();
  });
});

test.describe("a pinch on a phone, part way down", () => {
  test.use(PHONE);

  test("lands with the line under the fingers where the pinch drew it", async ({
    page,
  }) => {
    await openApp(page);
    const editor = page.locator(".ProseMirror:visible");
    await editor.tap();
    const paragraph =
      "城市更新不只是拆旧建新，很多居民已经在这里生活了几十年。".repeat(6);
    await pasteMarkdown(page, Array(40).fill(paragraph).join("\n\n"));
    // The text rewraps as it lands: a block's share of its height is not
    // where its characters went. The line held is the one at the column's
    // middle, under a character there.
    const moved = await editor.evaluate(async (pm) => {
      const scroller = pm.closest<HTMLElement>(".editor-scroll")!;
      scroller.scrollTop = scroller.scrollHeight / 2;
      await new Promise((r) => setTimeout(r, 300));
      const column = pm.closest(".editor-content")!.getBoundingClientRect();
      const x = column.left + column.width / 2;
      const charAt = (y: number) => {
        const hit = document.caretRangeFromPoint(x, y)!;
        const length = hit.startContainer.textContent!.length;
        const char = document.createRange();
        char.setStart(
          hit.startContainer,
          Math.min(hit.startOffset, length - 1),
        );
        char.setEnd(
          hit.startContainer,
          Math.min(hit.startOffset, length - 1) + 1,
        );
        return char;
      };
      const middle = charAt(innerHeight / 2).getBoundingClientRect();
      const at = { clientX: x, clientY: middle.top + middle.height / 2 };
      const pinch = (type: string, scale: number) =>
        window.dispatchEvent(
          Object.assign(new Event(type, { cancelable: true }), at, { scale }),
        );
      pinch("gesturestart", 1);
      for (let step = 1; step <= 5; step++)
        pinch("gesturechange", 1 + step / 5);
      await new Promise((r) => requestAnimationFrame(r));
      const char = charAt(at.clientY);
      const before = char.getBoundingClientRect().top;
      pinch("gestureend", 2);
      const now = char.getBoundingClientRect();
      // Hit there again: the box is where the character is drawn.
      const hit = document.caretRangeFromPoint(now.left + 1, at.clientY)!;
      return {
        by: Math.abs(now.top - before),
        hit: hit.startContainer === char.startContainer,
      };
    });
    expect(await zoomOf(page, 0)).toBe(2);
    expect(moved.by).toBeLessThan(4);
    expect(moved.hit).toBe(true);

    // The menu's zoom holds the line at the pane's middle the same way.
    const before = await editor.evaluate((pm) => {
      const pane = pm.closest(".editor-scroll")!.getBoundingClientRect();
      const hit = document.caretRangeFromPoint(
        pane.left + pane.width / 2,
        pane.top + pane.height / 2,
      )!;
      const length = hit.startContainer.textContent!.length;
      const char = document.createRange();
      char.setStart(hit.startContainer, Math.min(hit.startOffset, length - 1));
      char.setEnd(
        hit.startContainer,
        Math.min(hit.startOffset, length - 1) + 1,
      );
      (window as unknown as { held: Range }).held = char;
      return char.getBoundingClientRect().top;
    });
    await emit(page, "menu-zoom-in");
    await expect.poll(() => zoomOf(page, 0)).toBeGreaterThan(2);
    const after = await page.evaluate(
      () =>
        (window as unknown as { held: Range }).held.getBoundingClientRect().top,
    );
    expect(Math.abs(after - before)).toBeLessThan(4);
  });
});

test.describe("a pinch on an Android phone", () => {
  test.use({
    ...PHONE,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  });

  test("zooms the document by two fingers' spread, as an iPhone's does", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "touches sent by CDP");
    await openApp(page);
    const box = (await page.locator(".ProseMirror:visible").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 120;
    // No gesture events in Android's web view: the touches themselves.
    const cdp = await page.context().newCDPSession(page);
    const fingers = (type: "touchStart" | "touchMove", apart: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: [
          { x: x - apart / 2, y, id: 0 },
          { x: x + apart / 2, y, id: 1 },
        ],
      });
    await fingers("touchStart", 60);
    for (let apart = 70; apart <= 120; apart += 10)
      await fingers("touchMove", apart);
    // Drawn larger while the fingers move, laid out once they lift.
    await expect(page.locator(".editor-content").first()).toHaveCSS(
      "transform",
      /matrix/,
    );
    expect(await zoomOf(page, 0)).toBe(1);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(() => zoomOf(page, 0)).toBe(2);
  });
});
