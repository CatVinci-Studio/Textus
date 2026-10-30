import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { PHONE, openPhone } from "./helpers";

/**
 * Tabs under a finger on a phone: held still, a tab lifts; dragged then, it
 * moves or splits the screen, one document above the other; let go where
 * it lifted, it opens its menu. A finger that moves at once scrolls the bar.
 */

test.use(PHONE);

const panes = ".main-pane-split > .split-pane";

async function openTwo(page: Page) {
  await openPhone(page);
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-new-file"),
  );
  await expect(page.locator('.tab-bar [role="tab"]')).toHaveCount(2);
}

/** A finger on the glass: down at a point, moved through others, up. */
async function touch(
  cdp: CDPSession,
  path: { x: number; y: number }[],
  holdMs: number,
  page: Page,
) {
  const at = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: at(path[0]),
  });
  await page.waitForTimeout(holdMs);
  for (const p of path.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: at(p),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function centre(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("a tab held and let go where it lifted opens its menu, Split Down there", async ({
  page,
}) => {
  await openTwo(page);
  const cdp = await page.context().newCDPSession(page);
  const tab = await centre(page, ".tab-bar .tab-pill-title >> nth=0");
  await touch(cdp, [tab], 500, page);
  await expect(
    page.getByRole("menuitem", { name: "Split Down" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Split Down" }).tap();
  await expect(page.locator(panes)).toHaveCount(2);
  // One above the other, each the screen's width.
  await expect
    .poll(() =>
      page.locator(panes).evaluateAll((els) => {
        const [a, b] = els
          .map((el) => el.getBoundingClientRect())
          .sort((p, q) => p.top - q.top);
        return b.top >= a.bottom - 1 && a.width === b.width;
      }),
    )
    .toBe(true);
});

test("a tab held, then dragged to the bottom of the page, splits it there", async ({
  page,
}) => {
  await openTwo(page);
  const cdp = await page.context().newCDPSession(page);
  const tab = await centre(page, ".tab-bar .tab-pill-title >> nth=0");
  const steps = Array.from({ length: 12 }, (_, i) => ({
    x: tab.x,
    y: tab.y + ((880 - tab.y) * (i + 1)) / 12,
  }));
  await touch(cdp, [tab, ...steps], 500, page);
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(".tab-pill-lifted")).toHaveCount(0);
  // The dragged document below, each the screen's width.
  await expect
    .poll(() =>
      page.locator(panes).evaluateAll((els) => {
        const [a, b] = els
          .map((el) => el.getBoundingClientRect())
          .sort((p, q) => p.top - q.top);
        return b.top >= a.bottom - 1 && a.width === b.width;
      }),
    )
    .toBe(true);
});

test("a finger that moves at once scrolls the bar: nothing lifts or splits", async ({
  page,
}) => {
  await openTwo(page);
  const cdp = await page.context().newCDPSession(page);
  const tab = await centre(page, ".tab-bar .tab-pill-title >> nth=0");
  const steps = Array.from({ length: 8 }, (_, i) => ({
    x: tab.x,
    y: tab.y + (i + 1) * 60,
  }));
  await touch(cdp, [tab, ...steps], 0, page);
  await page.waitForTimeout(400);
  await expect(page.locator(".tab-pill-lifted")).toHaveCount(0);
  await expect(page.locator(panes)).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
});
