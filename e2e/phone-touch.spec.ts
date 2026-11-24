import { expect, type Page, test } from "@playwright/test";
import { emit, openApp, PHONE, TABLET } from "./helpers";

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
      const big = async (selectors: string[]) => {
        for (const selector of selectors) {
          const size = await reach(page, selector);
          expect
            .soft(size.width, `${selector} wide`)
            .toBeGreaterThanOrEqual(44);
          expect
            .soft(size.height, `${selector} tall`)
            .toBeGreaterThanOrEqual(44);
        }
      };
      await big([
        ".window-menu-button",
        ".tab-bar-add",
        // A tablet's x keeps its size: in its 32px tab a fingertip's target
        // would take the taps meant for the tab.
        ...(phone
          ? [
              ".tab-pill-close",
              ".window-bar-sidebar-toggle",
              ".document-menu-button",
            ]
          : []),
      ]);
      await emit(page, "menu-open-folder");
      await expect(page.locator(".tree-row").first()).toBeVisible();
      await big([
        ".activity-rail-item",
        ".activity-rail-settings",
        ".tree-tool",
        ".tree-row",
      ]);
      // A tablet's Settings list, in the sidebar.
      if (!phone) {
        await page.locator(".activity-rail-settings").tap();
        await expect(page.locator(".tx-list-item").first()).toBeVisible();
        await big([".tx-list-item"]);
      }
      if (phone) await page.mouse.click(380, 400);
      await page.getByRole("button", { name: "Menu", exact: true }).tap();
      await big([".context-menu-item"]);
    });
  });

test.describe("a phone's document menu", () => {
  test.use(PHONE);

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
    await page.locator(".tab-pill-close").first().tap();
    const prompt = page.locator(".close-prompt.app-dialog");
    await expect(prompt).toBeVisible();
    await expect(page.locator(".sheet-scrim")).toHaveCount(0);
    for (const answer of await prompt.locator("button").all())
      expect((await answer.boundingBox())!.height).toBeGreaterThanOrEqual(43);
  });
});
