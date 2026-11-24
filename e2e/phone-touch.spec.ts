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
            .toBeGreaterThanOrEqual(43);
          expect
            .soft(size.height, `${selector} tall`)
            .toBeGreaterThanOrEqual(43);
        }
      };
      await big([
        ".window-menu-button",
        ".tab-bar-add",
        ".tab-pill-close",
        ...(phone
          ? [".window-bar-sidebar-toggle", ".document-menu-button"]
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
      if (phone) await page.mouse.click(380, 400);
      await page.getByRole("button", { name: "Menu", exact: true }).tap();
      await big([".context-menu-item"]);
    });
  });
