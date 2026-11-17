import { expect, type Page, test } from "@playwright/test";
import { emit, openApp, pasteMarkdown, PHONE, TABLET } from "./helpers";
import { openPath } from "./plugin-helpers";

// The everyday flows on a touch screen: a phone (its own layout) and a
// tablet (the desktop's layout, by touch).
const DEVICES = [
  { name: "a phone", device: PHONE },
  { name: "a tablet", device: TABLET },
];

/** Nothing in `within` reaches past the screen's right edge. */
async function fitsTheScreen(page: Page, within = "body") {
  const wide = await page.evaluate(
    (within) =>
      [...document.querySelectorAll<HTMLElement>(`${within} *`)]
        .filter((el) => el.checkVisibility?.() ?? true)
        .map((el) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.right > innerWidth + 1)
        .filter(({ el }) => !el.closest("[data-offscreen], .ProseMirror"))
        .map(({ el }) => el.getAttribute("class") || el.tagName),
    within,
  );
  expect(wide).toEqual([]);
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  expect(scroll).toBeLessThanOrEqual(0);
}

for (const device of DEVICES)
  test.describe(`on ${device.name}`, () => {
    test.use(device.device);

    test("writing, a second tab and back, the sidebar and settings", async ({
      page,
    }) => {
      await openApp(page);
      await fitsTheScreen(page);
      const editor = page.locator(".ProseMirror:visible");
      await editor.tap();
      await page.keyboard.type("A first line");
      await expect(editor).toContainText("A first line");

      await page.locator(".tab-bar-add").first().tap();
      await expect(page.locator(".tab-pill")).toHaveCount(2);
      // With no keyboard up a phone's new document waits for a tap.
      await page.locator(".ProseMirror:visible").tap();
      await page.keyboard.type("Second");
      await expect(page.locator(".ProseMirror:visible")).toHaveText("Second");
      await page.locator(".tab-pill").first().tap();
      await expect(page.locator(".ProseMirror:visible")).toHaveText(
        "A first line",
      );

      // The phone keeps its rail and sidebar out of sight until asked; they
      // come in pushing the island aside.
      const toggle = page.locator(".window-bar-sidebar-toggle:visible");
      if (await toggle.count()) await toggle.tap();
      const settings = page.locator(".activity-rail-settings");
      await expect(settings).toBeVisible();
      await fitsTheScreen(page, ".activity-rail");
      await settings.tap();
      const dialog = page.getByRole("dialog", { name: "设置" });
      await expect(dialog.getByRole("button", { name: "外观" })).toBeVisible();
      await fitsTheScreen(page, '[role="dialog"]');
    });
  });

test.describe("on a phone with its keyboard up", () => {
  test.use(PHONE);

  test("a new document takes the keys at once", async ({ page }) => {
    await openApp(page);
    await page.locator(".ProseMirror:visible").tap();
    // The app says how much of the screen the keyboard covers.
    await page.evaluate(() =>
      dispatchEvent(new CustomEvent("textus-keyboard", { detail: 300 })),
    );
    await page.keyboard.type("A first line");
    await page.locator(".tab-bar-add").first().tap();
    const fresh = page.locator(".ProseMirror:visible");
    await expect(fresh).toBeFocused();
    await page.keyboard.type("Second");
    await expect(fresh).toHaveText("Second");
  });
});

test.describe("searching on a phone", () => {
  test.use(PHONE);

  test("a found line opens its document there", async ({ page }) => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
    lines[70] = "the needle here";
    await page.addInitScript((text) => {
      (window as unknown as Record<string, unknown>).__devFs = {
        "/w/a.md": text,
        "/w/b.md": "# B\n",
      };
    }, lines.join("\n\n"));
    await openApp(page);
    await openPath(page, "/w/b.md");
    const toggle = page.locator(".window-bar-sidebar-toggle:visible");
    if (await toggle.count()) await toggle.tap();
    await page.locator('[data-rail-id="search"]').tap();
    await page.locator(".search-panel input").first().fill("needle");
    await page.locator(".search-text-line").first().tap();
    const hit = page.locator(".ProseMirror:visible p", {
      hasText: "the needle here",
    });
    await expect(hit).toBeInViewport();
    // The caret in the found line, not at the end of the one before.
    const at = await page.evaluate(
      () =>
        (
          window as unknown as {
            __pmView: { state: { selection: { $from: { parent: Node } } } };
          }
        ).__pmView.state.selection.$from.parent.textContent,
    );
    expect(at).toBe("the needle here");
  });
});

test.describe("dragging a tab by touch on a tablet", () => {
  test.use({ ...TABLET, viewport: { width: 1024, height: 768 } });

  test("let go at the island's edge, it opens an island there", async ({
    page,
    browserName,
  }) => {
    // A finger's own event stream, which stays with the node it began on.
    test.skip(browserName !== "chromium", "touch input by CDP");
    await openApp(page);
    await page.locator(".tab-bar-add").first().tap();
    await expect(page.locator(".tab-pill")).toHaveCount(2);
    const cdp = await page.context().newCDPSession(page);
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      x: number,
      y: number,
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const pill = (await page.locator(".tab-pill").last().boundingBox())!;
    const sheet = (await page.locator("section.island").first().boundingBox())!;
    const from = { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 };
    const to = { x: sheet.x + sheet.width - 30, y: sheet.y + sheet.height / 2 };
    await touch("touchStart", from.x, from.y);
    await page.waitForTimeout(450);
    for (let i = 1; i <= 20; i++)
      await touch(
        "touchMove",
        from.x + ((to.x - from.x) * i) / 20,
        from.y + ((to.y - from.y) * i) / 20,
      );
    await page.waitForTimeout(200);
    await touch("touchEnd", to.x, to.y);
    await expect(page.locator(".main-pane > section.island")).toHaveCount(2);
  });
});

test.describe("a fold closed and opened again", () => {
  test.use({ ...TABLET, viewport: { width: 1024, height: 768 } });

  test("gives the wide layout its sidebar back", async ({ page }) => {
    await openApp(page);
    const sidebar = page.locator(".sidebar");
    await emit(page, "menu-toggle-sidebar");
    await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
    // Folded: a phone's layout, its sidebar put away.
    await page.setViewportSize({ width: 390, height: 768 });
    await expect(
      page.locator(".window-bar-sidebar-toggle:visible"),
    ).toHaveCount(1);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  });
});

test.describe("a tap in the page's margin on a tablet", () => {
  test.use(TABLET);

  test("beside the gap above a table puts the caret in the line above", async ({
    page,
  }) => {
    await openApp(page);
    await pasteMarkdown(
      page,
      "above\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nlast",
    );
    const editor = page.locator(".ProseMirror:visible");
    const line = (await editor
      .locator("p", { hasText: "above" })
      .boundingBox())!;
    const table = (await editor.locator("table").boundingBox())!;
    const column = (await editor.boundingBox())!;
    const sheet = (await page.locator(".editor-scroll:visible").boundingBox())!;
    const gap = (line.y + line.height + table.y) / 2;
    // In the page's own margin, left of the text column.
    expect(column.x - sheet.x).toBeGreaterThan(12);
    await page.touchscreen.tap((sheet.x + column.x) / 2, gap);
    await page.keyboard.type("k");
    await expect(editor.locator("p").first()).toHaveText("abovek");
  });
});

test.describe("a phone on its side", () => {
  test.use({ ...PHONE, viewport: { width: 900, height: 400 } });

  test("shows a toast and a card at its foot without one over the other", async ({
    page,
  }) => {
    await openApp(page);
    const boxes = await page.evaluate(() => {
      const put = (corner: string, width: number) => {
        const toast = document.createElement("div");
        toast.className = "corner-toast";
        toast.style.width = `${width}px`;
        toast.style.height = "40px";
        document
          .querySelector(`.corner-stack[data-corner="${corner}"]`)!
          .append(toast);
        return toast;
      };
      const start = put("start", 448).getBoundingClientRect();
      const end = put("end", 572).getBoundingClientRect();
      return { start, end, height: innerHeight, width: innerWidth };
    });
    const { start, end } = boxes;
    const apart =
      start.right <= end.left ||
      end.right <= start.left ||
      start.bottom <= end.top ||
      end.bottom <= start.top;
    expect(apart).toBe(true);
    for (const box of [start, end]) {
      expect(box.bottom).toBeLessThanOrEqual(boxes.height);
      expect(box.right).toBeLessThanOrEqual(boxes.width);
    }
  });
});

test.describe("a phone's tab row", () => {
  test.use(PHONE);

  test("shows no slice of a tab before the first whole one", async ({
    page,
  }) => {
    await openApp(page);
    for (let i = 0; i < 4; i++)
      await page.locator(".tab-bar-add").first().tap();
    await expect(page.locator(".tab-pill")).toHaveCount(5);
    // The last tab, open, closed: the row a tab shorter, the one before it
    // open at the row's end.
    await page.locator(".tab-pill-active .tab-pill-close").tap();
    await expect(page.locator(".tab-pill")).toHaveCount(4);
    await page.waitForTimeout(500);
    const cut = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".tab-bar")!;
      const from =
        bar.getBoundingClientRect().left +
        parseFloat(getComputedStyle(bar).paddingLeft);
      return [...bar.querySelectorAll<HTMLElement>(".tab-pill")]
        .map((pill) => pill.getBoundingClientRect())
        .filter((box) => box.left < from - 1 && box.right > from + 1)
        .map((box) => [box.left, box.right, from]);
    });
    expect(cut).toEqual([]);
  });
});

test.describe("reordering tabs on a phone", () => {
  test.use(PHONE);

  test("a tab dragged along the row keeps its document's scroll", async ({
    page,
  }) => {
    const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}.`);
    await page.addInitScript((text) => {
      (window as unknown as Record<string, unknown>).__devFiles = {
        "/w/a.md": text,
      };
    }, long.join("\n\n"));
    await openApp(page);
    await openPath(page, "/w/a.md");
    await page.locator(".tab-bar-add").first().tap();
    await expect(page.locator(".tab-pill")).toHaveCount(2);
    await page
      .locator(".tab-pill")
      .first()
      .evaluate((pill) => {
        const touch = { bubbles: true, pointerType: "touch", isPrimary: true };
        pill.dispatchEvent(new PointerEvent("pointerdown", touch));
        pill.dispatchEvent(new PointerEvent("pointerup", touch));
      });
    const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
    await expect(scroller).toContainText("Paragraph 150");
    await scroller.evaluate((el) => (el.scrollTop = 2000));
    // A long press, then the finger along the row past the next tab.
    await page
      .locator(".tab-pill")
      .first()
      .evaluate(async (pill) => {
        const next = pill.nextElementSibling!.getBoundingClientRect();
        const { left, top, width, height } = pill.getBoundingClientRect();
        const y = top + height / 2;
        const at = (type: string, x: number) =>
          pill.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerType: "touch",
              pointerId: 7,
              isPrimary: true,
              clientX: x,
              clientY: y,
            }),
          );
        const x = left + width / 2;
        const dx = next.width + width / 2 + 10;
        at("pointerdown", x);
        await new Promise((r) => setTimeout(r, 450));
        for (let step = 1; step <= 10; step++) {
          at("pointermove", x + (dx * step) / 10);
          await new Promise((r) => setTimeout(r, 30));
        }
        at("pointerup", x + dx);
      });
    await expect(page.locator(".tab-pill").nth(1)).toContainText("a.md");
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(2000);
  });
});
