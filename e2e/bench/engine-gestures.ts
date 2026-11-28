import { expect, type Page } from "@playwright/test";
import { emit, openApp, settled } from "../helpers";
import { mixedDoc } from "../perf/large-docs";

/**
 * The window-engine gestures the engine benchmark plays (plan step 7):
 * each sets up the window with a heavy document open, then plays one
 * repeatable gesture that leaves the window as it found it, so it can be
 * played again for each measuring pass.
 */

export interface Gesture {
  name: string;
  setup: (page: Page) => Promise<void>;
  play: (page: Page) => Promise<void>;
}

/** A long mixed document: thousands of blocks, images, maths, tables,
 *  diagrams - the lazy blocks on, relaying it out far from free. */
const HEAVY = mixedDoc("zh", 5000);
const HEAVY_PATH = "/bench/heavy.md";
/** One frame of a pointer moving at a steady hand's pace. */
const STEP_MS = 16;
/** A dwell over a drop zone (drop-intent's 150 ms) and the room it opens
 *  (--dur-slow) drawn to its end. */
const REST_MS = 500;
/** A side panel's or the AI's toggle, run to its end. */
const TOGGLE_MS = 500;

export async function openHeavy(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    animations: true,
    settings: { language: "en", menuBarShown: false },
  });
  const first = HEAVY.markdown.split("\n")[0]!.replace(/^#+ /, "");
  await page.evaluate(
    async ({ path, markdown, first }) => {
      const w = window as unknown as Record<string, unknown> & {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = { [path]: markdown };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
      await new Promise<void>((resolve) => {
        const look = () => {
          const el = document.querySelector(
            '[data-active-tab="true"] .ProseMirror',
          );
          if (el?.textContent?.includes(first)) resolve();
          else requestAnimationFrame(look);
        };
        look();
      });
    },
    { path: HEAVY_PATH, markdown: HEAVY.markdown, first },
  );
  // The lazy blocks' first drawing and the views' first measures done.
  await page.waitForTimeout(1500);
  await settled(page);
}

type Point = { x: number; y: number };

/** The pointer along `points`, `steps` moves a leg, one a frame. */
async function glide(page: Page, from: Point, to: Point, steps: number) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await page.waitForTimeout(STEP_MS);
  }
}

async function centre(page: Page, selector: string, nth = 0): Promise<Point> {
  const box = (await page.locator(selector).nth(nth).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags `selector`'s centre `dx` along and back, a move a frame. */
async function dragAndBack(page: Page, selector: string, dx: number) {
  const at = await centre(page, selector);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const out = { x: at.x + dx, y: at.y };
  await glide(page, at, out, 30);
  await glide(page, out, at, 30);
  await page.mouse.up();
}

async function splitRight(page: Page) {
  await emit(page, "menu-split-right");
  await expect(page.locator("section.island")).toHaveCount(2);
  await settled(page);
}

export const GESTURES: Gesture[] = [
  {
    // The right island lifted by its tab (Alt), carried over the heavy
    // island's zones - its left edge, its foot - so the room each would
    // take opens and closes, then put back (Esc).
    name: "island-drag",
    setup: splitRight,
    play: async (page) => {
      const tab = page.locator(".island-row").last().locator(".tab-pill");
      const t = (await tab.first().boundingBox())!;
      const heavy = (await page
        .locator("section.island")
        .first()
        .boundingBox())!;
      const own = (await page.locator("section.island").last().boundingBox())!;
      const start = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
      const lifted = { x: start.x - 40, y: start.y + 160 };
      const leftEdge = { x: heavy.x + 8, y: heavy.y + heavy.height / 2 };
      const foot = {
        x: heavy.x + heavy.width / 2,
        y: heavy.y + heavy.height - 8,
      };
      const home = { x: own.x + own.width / 2, y: own.y + own.height / 2 };
      await page.keyboard.down("Alt");
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await glide(page, start, lifted, 10);
      await glide(page, lifted, leftEdge, 20);
      await page.waitForTimeout(REST_MS);
      await glide(page, leftEdge, foot, 20);
      await page.waitForTimeout(REST_MS);
      await glide(page, foot, home, 20);
      await page.waitForTimeout(REST_MS);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await expect(page.locator("section.island")).toHaveCount(2);
    },
  },
  {
    // The heavy document's tab dragged along a row of five past the
    // others and back: each makes room as it passes.
    name: "tab-room",
    setup: async (page) => {
      for (let i = 0; i < 4; i++) await emit(page, "menu-new-file");
      await expect(page.locator(".tab-pill")).toHaveCount(5);
      await page.locator(".tab-pill").first().click();
      await settled(page);
    },
    play: async (page) => {
      const first = await centre(page, ".tab-pill", 0);
      const last = await centre(page, ".tab-pill", 4);
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      const end = { x: last.x + 20, y: first.y };
      await glide(page, first, end, 40);
      await glide(page, end, first, 40);
      await page.mouse.up();
    },
  },
  {
    name: "sidebar-resize",
    setup: async (page) => {
      // Open: a new window may already show it.
      if (!(await page.locator(".sidebar-resizer").isVisible()))
        await emit(page, "menu-toggle-sidebar");
      await expect(page.locator(".sidebar-resizer")).toBeVisible();
      await settled(page);
    },
    play: (page) => dragAndBack(page, ".sidebar-resizer", 120),
  },
  {
    name: "sidebar-toggle",
    setup: async () => {},
    play: async (page) => {
      for (let i = 0; i < 4; i++) {
        await emit(page, "menu-toggle-sidebar");
        await page.waitForTimeout(TOGGLE_MS);
      }
    },
  },
  {
    name: "split-resize",
    setup: splitRight,
    play: (page) => dragAndBack(page, ".split-divider", -150),
  },
  {
    name: "ai-toggle",
    setup: async () => {},
    play: async (page) => {
      for (let i = 0; i < 4; i++) {
        await emit(page, "menu-toggle-agent-panel");
        await page.waitForTimeout(TOGGLE_MS);
      }
    },
  },
];
