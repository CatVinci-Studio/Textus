import { expect, test, type Page } from "@playwright/test";
import { changeSettings, emit, openApp, expectNear } from "./helpers";

/**
 * The window bar's sidebar toggle: the row's first control, which belongs to
 * the bar, so the sidebar's slide never moves it.
 */

const toggle = '.window-bar [aria-label="Sidebar"]';
const sidebar = ".sidebar";

const left = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.getBoundingClientRect().left);

const centre = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.left + box.width / 2;
  });

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

test(
  "the sidebar's slide leaves the toggle where it is",
  { tag: "@perf" },
  async ({ page }) => {
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
  },
);

test("with the activity rail, the window shows its tabs, one or many, + beside them; without it, one document is a clean sheet with its title centred over the column", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(".main-pane > .tab-bar .tab-pill")).toHaveCount(1);
  await expect(
    page.locator(".main-pane > .tab-bar .tab-bar-add"),
  ).toBeVisible();
  // The rail turned off: the title, centred over the document column.
  await changeSettings(page, { activityRail: false });
  await expect(page.locator(".main-pane > .tab-bar")).toHaveCount(0);
  expectNear(
    await centre(page, ".window-bar-title"),
    await centre(page, ".main-pane"),
  );
  // The AI panel takes its width from the other side of the column.
  await page.locator(".window-bar-toggle").click();
  await expect(page.locator(".agent-panel")).toBeVisible();
  expectNear(
    await centre(page, ".window-bar-title"),
    await centre(page, ".main-pane"),
  );
});

test(
  "the title slides with the sidebar, frame for frame",
  { tag: "@perf" },
  async ({ page }) => {
    await openApp(page, { settings: { language: "en" }, animations: true });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator(toggle).click();
    await expect(page.locator(sidebar)).not.toHaveClass(/sidebar-collapsed/);
    // Its opening slide over first: one turned back at its start lasts as
    // little as it had run.
    await page.waitForFunction(
      () => document.querySelector(".sidebar")!.getAnimations().length === 0,
    );

    const slide = await page.evaluate(async () => {
      const title = document.querySelector(".window-bar-title")!;
      const side = document.querySelector(".sidebar")!;
      const pane = document.querySelector(".main-pane")!;
      const button = document.querySelector<HTMLElement>(
        ".window-bar-sidebar-toggle",
      )!;
      const drift: number[] = [];
      const wanted: number[] = [];
      // A click's state can land a frame or two later on a busy machine: wait
      // for the sidebar itself, or the sample can miss the whole slide.
      const waitFor = async (closed: boolean) => {
        const until = performance.now() + 5000;
        while (performance.now() < until) {
          await new Promise(requestAnimationFrame);
          if (side.classList.contains("sidebar-collapsed") === closed) return;
        }
      };
      // The title's centre should be midway between the sidebar's moving edge
      // and the column's far edge, in the frame it is drawn.
      const sample = async (forMs: number) => {
        const until = performance.now() + forMs;
        while (performance.now() < until) {
          await new Promise(requestAnimationFrame);
          const box = title.getBoundingClientRect();
          const want =
            (side.getBoundingClientRect().right +
              pane.getBoundingClientRect().right) /
            2;
          drift.push(Math.abs(box.left + box.width / 2 - want));
          wanted.push(want);
        }
      };
      // Out, at the exit's faster curve, then back in on the spring.
      button.click();
      await waitFor(true);
      await sample(600);
      button.click();
      await waitFor(false);
      await sample(700);
      return {
        worst: Math.max(...drift),
        travelled: Math.max(...wanted) - Math.min(...wanted),
      };
    });
    const { worst, travelled } = slide;
    // Seen across the slide, not at either end of it.
    expect(travelled).toBeGreaterThan(50);
    expect(worst).toBeLessThan(1);
  },
);

test(
  "the title slides with the AI panel, rather than jumping to its column",
  { tag: "@perf" },
  async ({ page }) => {
    await openApp(page, { settings: { language: "en" }, animations: true });
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const slides = await page.evaluate(async () => {
      const title = document.querySelector(".window-bar-title")!;
      const toggle = document.querySelector<HTMLElement>(".window-bar-toggle")!;
      const sliding = (a: Animation) =>
        a instanceof CSSTransition &&
        a.transitionProperty === "transform" &&
        a.playState === "running";
      // The panel mounts - or unmounts, once its exit has played - a frame or
      // more after the click, so wait on the title's own transition rather
      // than on a clock.
      const waitForSlide = async () => {
        const until = performance.now() + 3000;
        while (performance.now() < until) {
          if (title.getAnimations().some(sliding)) return true;
          await new Promise(requestAnimationFrame);
        }
        return false;
      };
      const settle = async () => {
        const until = performance.now() + 3000;
        while (performance.now() < until) {
          if (!title.getAnimations().some((a) => a.playState === "running"))
            return;
          await new Promise(requestAnimationFrame);
        }
      };
      toggle.click();
      const opening = await waitForSlide();
      await settle();
      toggle.click();
      const closing = await waitForSlide();
      await settle();
      return { opening, closing };
    });

    expect(slides).toEqual({ opening: true, closing: true });
  },
);

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
    // The Mac app uses the system's menu bar, so no menu button in the row.
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

  test(
    "moves into that corner and back at once, as the lights go and come",
    { tag: "@perf" },
    async ({ page }) => {
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
    },
  );
});

test(
  "the menu button is the sidebar toggle's twin, hover and all",
  { tag: "@perf" },
  async ({ page }) => {
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
  },
);

/** The fill of the window's frame pieces: the title bar, the activity
 *  rail and the sidebar (design-language.md 5.7). */
async function frame(page: Page) {
  return page.evaluate(() =>
    [".window-bar", ".activity-rail", ".sidebar"].map(
      (selector) =>
        getComputedStyle(document.querySelector(selector)!).backgroundColor,
    ),
  );
}

test("the title bar, the activity rail and the sidebar are one frame; the sidebar's contents stay below the bar", async ({
  page,
}) => {
  // Opaque, so the bar's colour is the frame's own.
  await openApp(page, { settings: { language: "en", solidTitleBar: true } });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(toggle).click();
  await expect(page.locator(sidebar)).not.toHaveClass(/sidebar-collapsed/);
  const [bar, rail, side] = await frame(page);
  expect(rail).toBe(bar);
  expect(side).toBe(bar);
  // The frame is not the page.
  const page_ = await page
    .locator(".editor-scroll")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(page_).not.toBe(bar);

  // Its contents stay below the bar rather than riding up into it.
  const box = (await page.locator(".window-bar").boundingBox())!;
  const body = (await page.locator(".sidebar-body").boundingBox())!;
  expect(body.y).toBeGreaterThanOrEqual(box.y + box.height);

  // Closed, the sidebar slides under the rail: nothing of it shows past
  // the rail's edge, and the page floats beside the rail as a sheet, its
  // own edge the line between them.
  await page.locator(toggle).click();
  await expect(page.locator(sidebar)).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(sidebar)).toBeHidden();
  await expect(page.locator(".activity-rail")).toHaveCSS(
    "border-right-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("the activity rail opens a tab, closes the sidebar on the open one, and hides from its right-click menu until Settings brings it back", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const rail = page.locator(".activity-rail");
  const outline = rail.getByRole("button", { name: "Outline" });
  await outline.click();
  await expect(page.locator(sidebar)).not.toHaveClass(/sidebar-collapsed/);
  await expect(
    page
      .locator(".sidebar .outline, .sidebar .outline-empty, .sidebar-body")
      .first(),
  ).toBeVisible();
  await expect(outline).toHaveAttribute("aria-pressed", "true");
  await outline.click();
  await expect(page.locator(sidebar)).toHaveClass(/sidebar-collapsed/);

  await rail.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide the Activity Bar" }).click();
  await expect(rail).toHaveCount(0);
  // The sidebar's tabs are along its top again.
  await page.locator(toggle).click();
  await expect(page.locator(".sidebar-tabs")).toBeVisible();

  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  await panel.getByRole("checkbox", { name: "Show the activity bar" }).click();
  await page.keyboard.press("Escape");
  await expect(rail).toBeVisible();
});
