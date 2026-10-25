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

/** The things the eye compares between two controls: the box - its size and
 *  its rounding - how far it is dimmed, what it fills with, and how fast
 *  that changes. */
async function look(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: s.width,
      height: s.height,
      radius: s.borderRadius,
      cursor: s.cursor,
      opacity: s.opacity,
      background: s.backgroundColor,
      duration: s.transitionDuration,
    };
  });
}

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

  test("moves into that corner and back at once, as the lights go and come", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" }, animations: true });
    await page.evaluate(() => {
      document.documentElement.dataset.windowChrome = "native";
      document.querySelector(".window-menu-button")?.remove();
    });
    const frames = await page.evaluate(async (selector) => {
      const button = document.querySelector(selector)!;
      const seen: number[] = [];
      for (const on of [true, false]) {
        if (on) document.documentElement.dataset.windowFullscreen = "";
        else delete document.documentElement.dataset.windowFullscreen;
        await new Promise(requestAnimationFrame);
        seen.push(Math.round(button.getBoundingClientRect().left));
      }
      return seen;
    }, toggle);
    // The next frame already has it there: no slide that never kept pace
    // with the window's own animation.
    expect(frames[0]).toBeLessThan(16);
    expect(frames[1]).toBeGreaterThanOrEqual(76);
  });
});

test("the menu button is the sidebar toggle's twin, hover and all", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const toggle = ".window-bar-sidebar-toggle";
  const menu = ".window-menu-button";

  // At rest: the menu button takes the bar's own controls' box, rounding,
  // dimming and transition, not the caption buttons' full-height, square
  // one (window-bar.css, window-controls.css).
  expect(await look(page, toggle)).toEqual(await look(page, menu));

  const lit = [];
  for (const selector of [toggle, menu]) {
    await page.locator(selector).hover();
    // Past the 80ms hover transition, and short of the tooltip's 400ms.
    await page.waitForTimeout(250);
    const state = await look(page, selector);
    expect(Number(state.opacity)).toBe(1);
    expect(state.background).not.toBe("rgba(0, 0, 0, 0)");
    lit.push(state);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
  }
  // Lit, they fill with the same colour for the same time.
  expect(lit[0]).toEqual(lit[1]);
});

/** The bar's strip for the sidebar's surface (window-bar.css): its fill, its
 *  edge, and where the box sits once its slide out of the way is counted. */
async function strip(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".window-bar")!;
    const s = getComputedStyle(bar, "::before");
    const left =
      s.transform === "none" ? 0 : new DOMMatrixReadOnly(s.transform).m41;
    return {
      background: s.backgroundColor,
      border: s.borderRightWidth,
      borderColor: s.borderRightColor,
      left,
      visibility: s.visibility,
    };
  });
}

test("the sidebar's surface reaches the window's top, its own layout does not", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(toggle).click();
  await expect(page.locator(sidebar)).not.toHaveClass(/sidebar-collapsed/);

  // The strip carries the sidebar's fill and edge, so the two read as one
  // surface from the window's top to its bottom.
  const side = await page.locator(sidebar).evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      background: s.backgroundColor,
      border: s.borderRightWidth,
      borderColor: s.borderRightColor,
    };
  });
  expect(await strip(page)).toEqual({
    ...side,
    left: 0,
    visibility: "visible",
  });

  // Its contents stay below the bar rather than riding up into it.
  const bar = (await page.locator(".window-bar").boundingBox())!;
  const tabs = (await page.locator(".sidebar-tabs").boundingBox())!;
  expect(tabs.y).toBeGreaterThanOrEqual(bar.y + bar.height);

  // Closed, the surface goes with the sidebar: its right edge lands on the
  // window's left edge, with no sliver left behind.
  const width = (await page.locator(sidebar).boundingBox())!.width;
  await page.locator(toggle).click();
  await expect(page.locator(sidebar)).toHaveClass(/sidebar-collapsed/);
  const hidden = await strip(page);
  expect(hidden.visibility).toBe("hidden");
  expect(Math.round(hidden.left)).toBe(-Math.round(width));
});

test("the surface slides with the sidebar, frame for frame", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" }, animations: true });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(toggle).click();
  await expect(page.locator(sidebar)).not.toHaveClass(/sidebar-collapsed/);

  const slide = await page.evaluate(async () => {
    const bar = document.querySelector(".window-bar")!;
    const side = document.querySelector(".sidebar")!;
    document.querySelector<HTMLElement>(".window-bar-sidebar-toggle")!.click();
    const drift: number[] = [];
    const lefts: number[] = [];
    const until = performance.now() + 500;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      const s = getComputedStyle(bar, "::before");
      const left =
        s.transform === "none" ? 0 : new DOMMatrixReadOnly(s.transform).m41;
      const sideLeft = side.getBoundingClientRect().left;
      drift.push(Math.abs(left - sideLeft));
      lefts.push(sideLeft);
    }
    return {
      worst: Math.max(...drift),
      travelled: Math.max(...lefts) - Math.min(...lefts),
    };
  });
  const { worst, travelled } = slide;
  // Seen across the slide, not at either end of it.
  expect(travelled).toBeGreaterThan(50);
  expect(worst).toBeLessThan(1);
});

test("the sidebar opens on the tab it was left on, after a restart (#347)", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(toggle).click();
  await page
    .locator(".sidebar-tabs")
    .getByRole("button", { name: "Outline" })
    .click();
  await page.reload();
  await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
  await expect(page.locator(sidebar)).toBeVisible();
  await expect(
    page.locator(".sidebar-tabs").getByRole("button", { name: "Outline" }),
  ).toHaveClass(/sidebar-tab-active/);
});
