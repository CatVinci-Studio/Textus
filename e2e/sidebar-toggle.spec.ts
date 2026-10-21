import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * The window bar's sidebar toggle (app/WindowBar.tsx): the row's first
 * control - beside the menu button where the app draws the frame, just
 * past the traffic lights on a Mac, in their corner in full screen. It
 * belongs to the bar, so the sidebar's slide never moves it.
 */

const toggle = '.window-bar [aria-label="Sidebar"]';
const sidebar = ".sidebar";

const left = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.getBoundingClientRect().left);

test("the toggle opens and closes the sidebar, beside the menu button", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const button = page.locator(toggle);
  await expect(button).toHaveAccessibleDescription(/^Sidebar \(.+\\\)$/);
  // A first launch opens with the sidebar closed.
  await expect(button).toHaveAttribute("aria-pressed", "false");
  const menu = page.locator(".window-menu-button");
  if ((await menu.count()) > 0) {
    const menuBox = (await menu.boundingBox())!;
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(menuBox.x + menuBox.width);
    expect(box.x - (menuBox.x + menuBox.width)).toBeLessThan(8);
  }
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(sidebar)).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(sidebar)).toBeHidden();
});

test("the sidebar's slide leaves the toggle where it is", async ({ page }) => {
  await openApp(page, { settings: { language: "en" }, animations: true });
  const at = await left(page, toggle);
  // Every frame of the slide out and back.
  const frames = await page.evaluate(async (selector) => {
    const button = document.querySelector(selector)!;
    const seen: number[] = [];
    (button as HTMLElement).click();
    const until = performance.now() + 700;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      seen.push(button.getBoundingClientRect().left);
    }
    (button as HTMLElement).click();
    const back = performance.now() + 700;
    while (performance.now() < back) {
      await new Promise(requestAnimationFrame);
      seen.push(button.getBoundingClientRect().left);
    }
    return seen;
  }, toggle);
  expect(new Set(frames)).toEqual(new Set([at]));
});

test.describe("on a Mac", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    });
  });

  test("past the traffic lights, and in their corner in full screen", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    // The browser has no window or menu bar of its own; the Mac app's
    // window is the native one, with the system's menu bar, so no menu
    // button in the row.
    await page.evaluate(() => {
      document.documentElement.dataset.windowChrome = "native";
      document.querySelector(".window-menu-button")?.remove();
    });
    expect(await left(page, toggle)).toBeGreaterThanOrEqual(76);
    await page.evaluate(() => {
      document.documentElement.dataset.windowFullscreen = "";
    });
    expect(await left(page, toggle)).toBeLessThan(16);
  });
});
