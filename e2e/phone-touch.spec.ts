import { expect, type Page, test } from "@playwright/test";
import { emit, openApp, pasteMarkdown, PHONE, TABLET } from "./helpers";
import { hasPlugin } from "./plugin-helpers";

// A phone turned on its side, and what a finger reaches on a phone and a
// touch tablet.
const PHONE_SIDEWAYS = {
  ...PHONE,
  viewport: { width: 844, height: 390 },
  screen: { width: 844, height: 390 },
};

test.describe("a phone on its side", () => {
  test.use(PHONE_SIDEWAYS);

  test("keeps the phone's layout, Settings in one column", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await expect(page.locator("html")).toHaveAttribute(
      "data-window-chrome",
      "mobile",
    );
    await expect(page.locator(".document-menu-button")).toBeVisible();
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("menuitem", { name: /Settings/ }).tap();
    await expect(page.locator(".settings-layout")).toHaveCSS(
      "flex-direction",
      "column",
    );
    // Every category in the list, none clipped: the sidebar scrolls it.
    const nav = page.locator(".settings-nav");
    await expect(nav.getByRole("button", { name: "About" })).toBeAttached();
    const clipped = await nav.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(clipped).toBeLessThanOrEqual(1);
  });

  test("keeps its island and rail clear of the cutout and the far corner", async ({
    page,
  }) => {
    await openApp(page);
    await page.evaluate(() => {
      const style = document.documentElement.style;
      style.setProperty("--native-safe-left", "47px");
      style.setProperty("--native-safe-right", "47px");
    });
    const island = (await page
      .locator("section.island")
      .first()
      .boundingBox())!;
    expect(island.x).toBeGreaterThanOrEqual(47);
    // Its whole width shows, a margin short of the corner's room.
    expect(island.x + island.width).toBeLessThan(844 - 47);
    await page.locator(".window-bar-sidebar-toggle").tap();
    const rail = (await page.locator(".activity-rail").boundingBox())!;
    expect(rail.x).toBeGreaterThanOrEqual(47);
    await page.locator(".window-bar-sidebar-toggle").tap();
    await page.locator(".window-menu-button").tap();
    await page.getByRole("menuitem", { name: /设置/ }).tap();
    const settings = (await page.locator(".settings-panel").boundingBox())!;
    expect(settings.x).toBeGreaterThanOrEqual(47);
    expect(settings.x + settings.width).toBeLessThanOrEqual(844 - 47);
  });
});

/** How wide and tall a tap still lands on the first visible `selector`,
 *  from its centre out; past the screen's edge counts, as a finger's does. */
function reach(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) =>
      e.checkVisibility(),
    )!;
    const box = el.getBoundingClientRect();
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const side = (dx: number, dy: number) => {
      let n = 0;
      while (n < 30) {
        const [x, y] = [cx + dx * (n + 1), cy + dy * (n + 1)];
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 30;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) break;
        n++;
      }
      return n;
    };
    return {
      width: side(-1, 0) + side(1, 0) + 1,
      height: side(0, -1) + side(0, 1) + 1,
    };
  }, selector);
}

const TOUCH_DEVICES = [
  { name: "a phone", device: PHONE },
  {
    name: "a touch tablet",
    device: { ...TABLET, viewport: { width: 820, height: 1180 } },
  },
];

for (const { name, device } of TOUCH_DEVICES)
  test.describe(`on ${name}`, () => {
    test.use(device);

    test("a command has one way in: the rail, the empty sidebar and ☰ don't repeat another's", async ({
      page,
    }) => {
      await openApp(page, { settings: { language: "en" } });
      const phone = name === "a phone";
      const toggle = page.locator(".window-bar-sidebar-toggle:visible");
      if (phone) await toggle.tap();
      const rail = page.getByRole("navigation", { name: "Activity bar" });
      await expect(rail.getByRole("button", { name: "Files" })).toBeVisible();
      // A phone's outline is ⋯'s, its Settings ☰'s; a tablet's are the
      // desktop's.
      for (const button of ["Outline", "Settings"])
        await expect
          .soft(rail.getByRole("button", { name: button }))
          .toHaveCount(phone ? 0 : 1);
      if (!phone) await rail.getByRole("button", { name: "Files" }).tap();
      const sidebar = page.getByRole("complementary", { name: "Sidebar" });
      // A phone: a line saying ☰ opens files. A tablet: no folder, and the
      // Open Folder button.
      await expect
        .soft(sidebar.getByRole("button", { name: "Open Folder…" }))
        .toHaveCount(phone ? 0 : 1);
      await expect
        .soft(sidebar)
        .toContainText(
          phone
            ? "Open a document or a folder from the menu."
            : "No folder is open yet.",
        );
      if (phone) await page.mouse.click(380, 400);
      await page.getByRole("button", { name: "Menu", exact: true }).tap();
      await expect(
        page.getByRole("menuitem", { name: /Settings/ }),
      ).toHaveCount(1);
      // A phone's sidebar is the bar's button (a tablet's is under View).
      if (phone)
        await expect
          .soft(
            page.locator(".context-menu").getByText("Sidebar", { exact: true }),
          )
          .toHaveCount(0);
    });

    test("every bar, rail, tree and menu control takes a 44pt tap", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.assign(window, {
          __devFs: { "/proj/a.md": "# A\n", "/proj/notes/n.md": "# N\n" },
          __devPickFolder: "/proj",
          __devInvokeResults: {
            "plugin:textus-files|pick_folder": { url: "file:///proj" },
            "plugin:textus-files|begin_access": { path: "/proj" },
          },
        });
      });
      await openApp(page, { settings: { language: "en" } });
      const phone = name === "a phone";
      // Each control in first, then measured until the window is placed:
      // until the bar's controls are measured (a second or two, cold, on a
      // slow machine) the tabs' row runs under ⋯, the +'s target over it,
      // and a tablet's sidebar is clipped while it slides in.
      const big = async (selectors: string[]) => {
        for (const selector of selectors) {
          await expect(
            page.locator(`${selector}:visible`).first(),
          ).toBeVisible();
          for (const side of ["width", "height"] as const)
            await expect.soft
              .poll(async () => (await reach(page, selector))[side], {
                message: `${selector} ${side === "width" ? "wide" : "tall"}`,
              })
              .toBeGreaterThanOrEqual(44);
        }
      };
      await big([
        ".window-menu-button",
        // A phone's + is its tab menu's New.
        ...(phone ? [] : [".tab-bar-add"]),
        // A tablet's x keeps its size: in its 32px tab a fingertip's target
        // would take the taps meant for the tab.
        ...(phone
          ? [
              ".tab-switcher-button",
              ".window-bar-sidebar-toggle",
              ".document-menu-button",
            ]
          : []),
      ]);
      await emit(page, "menu-open-folder");
      await expect(page.locator(".tree-row").first()).toBeVisible();
      await big([
        ".activity-rail-item",
        // A phone's Settings is ☰'s: no gear.
        ...(phone ? [] : [".activity-rail-settings"]),
        ".tree-tool",
        ".tree-row",
      ]);
      // A phone's tools keep to their glyphs, their targets overlapping:
      // the folder's name has more of the row than they do, and each tool
      // a tap across the whole step from it to the next.
      if (phone) {
        const row = await page.evaluate(() => {
          const width = (el: Element) => el.getBoundingClientRect().width;
          const tools = [
            ...document.querySelectorAll(".tree-toolbar .tree-tool"),
          ];
          const boxes = tools.map((el) => el.getBoundingClientRect());
          const across = tools.map((el, i) => {
            const { left, right, top, height } = boxes[i];
            const y = top + height / 2;
            let x = left;
            while (el.contains(document.elementFromPoint(x - 1, y))) x--;
            let end = right;
            while (el.contains(document.elementFromPoint(end, y))) end++;
            return end - x;
          });
          return {
            name: width(document.querySelector(".tree-root-label")!),
            tools: boxes.at(-1)!.right - boxes[0].left,
            step: boxes[1].left - boxes[0].left,
            across,
          };
        });
        expect.soft(row.name).toBeGreaterThan(row.tools);
        for (const width of row.across)
          expect.soft(width).toBeGreaterThanOrEqual(row.step - 1);
      }
      // A tablet's Settings list, in the sidebar.
      if (!phone) {
        await page.locator(".activity-rail-settings").tap();
        await expect(page.locator(".tx-list-item").first()).toBeVisible();
        await big([".tx-list-item"]);
      }
      if (phone) await page.mouse.click(380, 400);
      await page.getByRole("button", { name: "Menu", exact: true }).tap();
      await big([".context-menu-item"]);
      // Settings' search box, a tap at its very edge too; a page's pills,
      // "?" and switches.
      if (phone) {
        await page.getByRole("menuitem", { name: /Settings/ }).tap();
        const search = page.locator(".settings-search");
        await expect(search).toBeVisible();
        await big([".settings-search input"]);
        const box = (await search.boundingBox())!;
        await page.touchscreen.tap(box.x + box.width / 2, box.y + 1);
        await expect(search.locator("input")).toBeFocused();
        await page.getByRole("button", { name: "Extensions" }).tap();
        const controls = [
          ".settings-panel .tx-button",
          ".settings-panel .info-tip-button",
          ".settings-panel .tx-switch",
        ];
        for (const selector of controls)
          await expect(
            page.locator(`${selector}:visible`).first(),
          ).toBeVisible();
        await big(controls);
      }
    });
  });

test.describe("a phone's bar buttons", () => {
  test.use(PHONE);

  test("keep no grey fill once a tap is over", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    const toggle = page.locator(".window-bar-sidebar-toggle:visible");
    await toggle.tap();
    await expect(page.locator(".activity-rail")).toBeVisible();
    // Closed again by the toggle, the last thing tapped.
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });
});

test.describe("a phone's Extensions page", () => {
  test.use(PHONE);

  test("sets each section's title level with its buttons", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("menuitem", { name: /Settings/ }).tap();
    await page.getByRole("button", { name: "Extensions" }).tap();
    await expect(page.locator(".settings-group-actions").first()).toBeVisible();
    // With a catalog, Available's sort and its Hide.
    if (hasPlugin("catvinci.abc"))
      await expect(page.getByRole("button", { name: "Hide" })).toBeVisible();
    // Each control's centre, from its title's. Controls too wide to fit
    // beside the title wrap onto a line of their own under it (by design;
    // how wide depends on the fonts): then level with one another.
    const off = await page.evaluate(() =>
      [...document.querySelectorAll(".settings-group-head")].flatMap((head) => {
        const title = head
          .querySelector(".settings-group-title")!
          .getBoundingClientRect();
        const controls = [
          ...head.querySelectorAll(
            ".settings-group-actions :is(button, .ui-select)",
          ),
        ]
          .filter((el) => el.checkVisibility())
          .map((el) => el.getBoundingClientRect());
        const wrapped =
          controls.length > 0 &&
          controls.every((box) => box.top >= title.bottom);
        const level = wrapped ? controls[0] : title;
        const middle = level.top + level.height / 2;
        return controls.map((box) =>
          Math.round(Math.abs(box.top + box.height / 2 - middle)),
        );
      }),
    );
    expect(off.length).toBeGreaterThan(0);
    expect(off.filter((d) => d > 1)).toEqual([]);
  });
});

test.describe("a phone's document menu", () => {
  test.use(PHONE);

  test("opens the outline's menu on the outline's key, not the sidebar", async ({
    page,
  }) => {
    await openApp(page, {
      settings: { language: "en", shortcuts: { showOutline: "mod+shift+u" } },
    });
    await pasteMarkdown(page, "# One\n\n## Two\n");
    await page.keyboard.press("ControlOrMeta+Shift+u");
    await expect(page.getByRole("menu", { name: "Outline" })).toBeVisible();
    await expect(page.locator(".activity-rail")).toBeHidden();
  });

  test("is the desktop's menu under ⋯, its rows a fingertip tall, the outline too", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const more = page.locator(".document-menu-button");
    await more.tap();
    const menu = page.locator(".context-menu");
    await expect(menu).toBeVisible();
    await expect(page.locator(".sheet-scrim")).toHaveCount(0);
    const button = (await more.boundingBox())!;
    const box = (await menu.boundingBox())!;
    // Hung from ⋯: under it, its right edge at the button's.
    expect(box.y).toBeGreaterThanOrEqual(button.y + button.height);
    expect(
      Math.abs(box.x + box.width - (button.x + button.width)),
    ).toBeLessThan(12);
    for (const row of await menu.locator(".context-menu-item").all())
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("menuitem", { name: "Outline" }).tap();
    await expect(page.getByRole("menu", { name: "Outline" })).toHaveClass(
      /context-menu/,
    );
  });
});

test.describe("a phone's menu from a page over the window", () => {
  test.use(PHONE);

  test("shows over Settings, taking the tap", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("menuitem", { name: /Settings/ }).tap();
    await page.getByRole("button", { name: "General" }).tap();
    await page.locator(".ui-select:visible").first().tap();
    const menu = page.locator(".context-menu");
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const onTop = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest(".context-menu"),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(onTop).toBe(true);
  });
});

test.describe("a phone's unsaved-changes prompt", () => {
  test.use(PHONE);

  test("is the app's alert, its answers a fingertip tall", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await page.locator(".ProseMirror:visible").tap();
    await page.keyboard.type("Hello");
    // Closed from the menu behind the document's name.
    await page.locator(".tab-switcher-button").tap();
    await page.getByRole("menuitem", { name: "Close Tab", exact: true }).tap();
    const prompt = page.locator(".close-prompt.app-dialog");
    await expect(prompt).toBeVisible();
    await expect(page.locator(".sheet-scrim")).toHaveCount(0);
    for (const answer of await prompt.locator("button").all())
      expect((await answer.boundingBox())!.height).toBeGreaterThanOrEqual(43);
  });
});
