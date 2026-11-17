import { expect, type Page, test } from "@playwright/test";
import { openApp, PHONE, TABLET } from "./helpers";
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
  });
});
