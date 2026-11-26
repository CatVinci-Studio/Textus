import { expect, type Page, test } from "@playwright/test";
import {
  emit,
  openApp,
  pasteMarkdown,
  PHONE,
  restedOn,
  settled,
  TABLET,
} from "./helpers";
import { hasPlugin, openPath } from "./plugin-helpers";

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

    test("names Textus AI nowhere, as iOS goes without it", async ({
      page,
    }) => {
      await openApp(page, { settings: { language: "en", textusAi: true } });
      const naming = () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("body *")]
            .filter((el) => el.checkVisibility() && !el.children.length)
            .map((el) => el.textContent ?? "")
            .concat(
              [...document.querySelectorAll<HTMLElement>("[aria-label]")]
                .filter((el) => el.checkVisibility())
                .map((el) => el.getAttribute("aria-label")!),
            )
            .filter((text) => /\bAI\b|Assistant/.test(text)),
        );
      expect(await naming()).toEqual([]);
      await page.getByRole("button", { name: "Menu", exact: true }).tap();
      expect(await naming()).toEqual([]);
      await page.getByRole("menuitem", { name: /Settings/ }).tap();
      await expect(
        page.locator('[role="dialog"], .settings-tab-page').first(),
      ).toBeVisible();
      expect(await naming()).toEqual([]);
    });

    test("its plugins store lists nothing that needs Textus AI, nor a README's tools for it", async ({
      page,
    }) => {
      test.skip(!hasPlugin("catvinci.abc"), "No textus-plugins checkout");
      // As the official manifests say it from their next release.
      await page.addInitScript(() =>
        Object.assign(window, {
          __devCatalogManifests: {
            "catvinci.keenable": { needsTextusAi: true },
            "catvinci.openverse": { needsTextusAi: true },
          },
        }),
      );
      await openApp(page, { settings: { language: "en" } });
      // Settings' store on the phone, the sidebar's on the tablet.
      const phone = device.device === PHONE;
      const store = phone
        ? page.getByRole("tabpanel", { name: "Plugins" })
        : page.getByRole("complementary", { name: "Sidebar" });
      if (phone) {
        await page.getByRole("button", { name: "Menu", exact: true }).tap();
        await page.getByRole("menuitem", { name: /Settings/ }).tap();
        await page.getByRole("button", { name: "Extensions" }).tap();
        // Plugins is an iPhone's one Extensions tab: no row of tabs.
        await expect(page.getByRole("tab", { name: "Plugins" })).toHaveCount(0);
        await store.getByRole("button", { name: "Search" }).first().tap();
      } else {
        await page
          .getByRole("navigation", { name: "Activity bar" })
          .getByRole("button", { name: "Plugins" })
          .tap();
      }
      const search = store.getByRole("searchbox");
      const card = (id: string) =>
        store.locator(
          phone ? `[data-catalog="${id}"]` : `[data-plugin="${id}"]`,
        );
      // The catalog read: a plugin that does without is there.
      await search.fill("Sheet Music");
      await expect(card("catvinci.abc")).toBeVisible();
      for (const [name, id] of [
        ["Keenable", "catvinci.keenable"],
        ["Openverse", "catvinci.openverse"],
      ]) {
        await search.fill(name);
        await expect(card(id)).toHaveCount(0);
      }
      await search.fill("Sheet Music");
      await card("catvinci.abc")
        .locator(phone ? ".plugin-card-open" : ".plugins-panel-open")
        .tap();
      const readme = page.locator(".plugin-readme");
      await expect(readme).toContainText("ABC notation");
      await expect(readme).not.toContainText("Tools for Textus AI");
    });

    test("draws the document at the text size saved in Settings", async ({
      page,
    }) => {
      await openApp(page, { settings: { docTextSize: 28 } });
      await expect(page.locator(".milkdown:visible")).toHaveCSS(
        "font-size",
        "28px",
      );
    });

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
      await expect(page.locator(".activity-rail")).toBeVisible();
      await fitsTheScreen(page, ".activity-rail");
      // A phone's Settings is ☰'s, a sheet over the window; a tablet's the
      // rail's gear and a tab, as on the desktop.
      if (device.name === "a phone") {
        await page.locator(".window-menu-button").tap();
        await page.getByRole("menuitem", { name: /设置/ }).tap();
        const dialog = page.getByRole("dialog", { name: "设置" });
        await expect(
          dialog.getByRole("button", { name: "外观" }),
        ).toBeVisible();
        await fitsTheScreen(page, '[role="dialog"]');
      } else {
        await page.locator(".activity-rail-settings").tap();
        await expect(page.locator(".settings-tab-page")).toBeVisible();
        // Its sidebar opens with it: the sheet takes the room left in the
        // frame it is drawn, not the moment the tab is mounted.
        await settled(page);
        await fitsTheScreen(page, ".settings-tab-page");
      }
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

test.describe("a tablet's menu and sidebar", () => {
  test.use({ ...TABLET, viewport: { width: 1024, height: 768 } });

  test("are the desktop's, less what it can't do", async ({ page }) => {
    await openApp(page);
    // A keyboard's ⌘T, with no menu bar to take it.
    await page.locator(".ProseMirror").first().click();
    await page.keyboard.press("ControlOrMeta+t");
    await expect(page.locator(".tab-pill")).toHaveCount(2);
    // With it connected, a tab tapped to the front takes the keys.
    await page.evaluate(() => {
      (window as { textusHardwareKeyboard?: boolean }).textusHardwareKeyboard =
        true;
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.locator(".tab-pill").first().tap();
    await expect(
      page.locator('[data-active-tab="true"] .ProseMirror'),
    ).toBeFocused();
    await page.locator(".window-menu-button").first().tap();
    const menu = page.getByRole("menu").first();
    await expect(menu.getByRole("menuitem", { name: "视图" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "文件" }).tap();
    await expect(
      page.getByRole("menuitem", { name: "分享…" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "新建窗口" })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await expect(
      page.locator(".activity-rail").getByRole("button", { name: "插件" }),
    ).toBeVisible();
  });
});

test.describe("the file tree by touch", () => {
  // Any touch screen, a laptop's too: the tablet's folders open by iOS's picker.
  test.use({ hasTouch: true });

  test("a row held and let go shows its menu; held and moved, it goes into a folder", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "touch input by CDP");
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__devFs = { "/proj/a.md": "# A\n", "/proj/notes/n.md": "# N\n" };
      w.__devPickFolder = "/proj";
    });
    await openApp(page);
    await emit(page, "menu-open-folder");
    const row = (name: string) => page.locator(".tree-row", { hasText: name });
    await expect(row("a.md")).toBeVisible();
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
    const a = (await row("a.md").boundingBox())!;
    const from = { x: a.x + 30, y: a.y + a.height / 2 };
    await touch("touchStart", from.x, from.y);
    // Real time: a finger held still long enough for its menu (hold-drag's 300 ms).
    await page.waitForTimeout(450);
    await touch("touchEnd", from.x, from.y);
    await expect(page.getByRole("menuitem", { name: "打开" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    const notes = (await row("notes").boundingBox())!;
    const to = { x: notes.x + 30, y: notes.y + notes.height / 2 };
    await touch("touchStart", from.x, from.y);
    // Real time: a finger held still long enough to lift (hold-drag's 300 ms).
    await page.waitForTimeout(450);
    for (let i = 1; i <= 10; i++)
      await touch(
        "touchMove",
        from.x + ((to.x - from.x) * i) / 10,
        from.y + ((to.y - from.y) * i) / 10,
      );
    await touch("touchEnd", to.x, to.y);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(
            (window as unknown as { __devFs: Record<string, string> }).__devFs,
          ),
        ),
      )
      .toContain("/proj/notes/a.md");
  });
});

test.describe("the rail by touch", () => {
  test.use({ hasTouch: true });

  test("an icon held, then moved, takes its new place", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "touch input by CDP");
    await openApp(page);
    const rail = page.getByRole("navigation", { name: "图标栏" });
    const order = () =>
      rail
        .locator("[data-rail-id]")
        .evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).dataset.railId),
        );
    const before = await order();
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
    const first = (await rail.locator("[data-rail-id]").nth(0).boundingBox())!;
    const third = (await rail.locator("[data-rail-id]").nth(2).boundingBox())!;
    const x = first.x + first.width / 2;
    await touch("touchStart", x, first.y + first.height / 2);
    // Real time: a finger held still long enough to lift (hold-drag's 300 ms).
    await page.waitForTimeout(450);
    for (let i = 1; i <= 10; i++)
      await touch(
        "touchMove",
        x,
        first.y +
          first.height / 2 +
          ((third.y + third.height - first.y) * i) / 10,
      );
    await touch("touchEnd", x, third.y + third.height);
    await expect
      .poll(order)
      .toEqual([before[1], before[2], before[0], ...before.slice(3)]);
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
    // Real time: a finger held still long enough to lift (hold-drag's 300 ms).
    await page.waitForTimeout(450);
    for (let i = 1; i <= 20; i++)
      await touch(
        "touchMove",
        from.x + ((to.x - from.x) * i) / 20,
        from.y + ((to.y - from.y) * i) / 20,
      );
    await restedOn(page);
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
    // The + at the row's end however many tabs it has, beside their list
    // once they overflow.
    const addAtEnd = () =>
      page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>(".tab-bar")!;
        const add = bar.querySelector(".tab-bar-add")!.getBoundingClientRect();
        const list = bar.querySelector(".tab-bar-list");
        const end = list
          ? list.getBoundingClientRect().left
          : bar.getBoundingClientRect().right -
            parseFloat(getComputedStyle(bar).paddingRight);
        return Math.abs(end - add.right) <= 1;
      });
    await page.locator(".tab-bar-add").first().tap();
    expect(await addAtEnd()).toBe(true);
    for (let i = 0; i < 3; i++)
      await page.locator(".tab-bar-add").first().tap();
    await expect(page.locator(".tab-pill")).toHaveCount(5);
    expect(await addAtEnd()).toBe(true);
    // The last tab, open, closed: the row a tab shorter, the one before it
    // open at the row's end.
    await page.locator(".tab-pill-active .tab-pill-close").tap();
    await expect(page.locator(".tab-pill")).toHaveCount(4);
    await settled(page);
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

test.describe("a phone's sidebar pushed back", () => {
  test.use(PHONE);

  test("keeps the tab row in sight as the page slides back", async ({
    page,
  }) => {
    await openApp(page, { animations: true });
    const toggle = page.locator(".window-bar-sidebar-toggle");
    await toggle.tap();
    await expect(page.locator(".app-shell")).toHaveAttribute(
      "data-sidebar",
      "open",
    );
    const sliding = () =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((motion) => motion instanceof CSSTransition).length,
      );
    await expect.poll(sliding).toBe(0);
    await toggle.tap({ force: true });
    // Held halfway: the page still moved, as WebKit can leave it. Nothing
    // drawn over its open tab hides it.
    const over = await page.evaluate(() => {
      for (const motion of document.getAnimations()) {
        if (!(motion instanceof CSSTransition)) continue;
        motion.pause();
        motion.currentTime =
          Number(motion.effect?.getComputedTiming().duration) / 2;
      }
      const tab = document.querySelector(".tab-pill-active")!;
      const box = tab.getBoundingClientRect();
      const stack = document.elementsFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return (
        stack
          .slice(
            0,
            stack.findIndex((el) => tab.contains(el)),
          )
          // Its own parts and what holds it are drawn under it.
          .filter((el) => !tab.contains(el) && !el.contains(tab))
          .filter((el) => {
            const look = getComputedStyle(el);
            return (
              look.backgroundImage !== "none" ||
              !/rgba\(.*, 0\)|transparent/.test(look.backgroundColor)
            );
          })
          .map((el) => el.className)
      );
    });
    expect(over).toEqual([]);
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
