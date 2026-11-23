import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
import { PHONE, settled, TABLET } from "./helpers";
import {
  hasPlugin,
  openPath,
  openWithPlugins,
  tabFrame,
} from "./plugin-helpers";

// Plugin pages by touch: their small controls a finger can hit, a list's
// row held for its menu, a board's list held and dragged.

const permissions = (id: string): string[] =>
  JSON.parse(
    readFileSync(
      join(pluginsCheckout()!, "plugins", id, "textus-plugin.json"),
      "utf8",
    ),
  ).permissions ?? [];

const BOARD =
  "---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] Outline\n\n## Done\n\n- [x] Title\n";

async function openBoard(page: Page) {
  await openWithPlugins(page, {
    plugins: { "catvinci.kanban": permissions("catvinci.kanban") },
    folder: { "/work/notes/board.md": BOARD },
  });
  await openPath(page, "/work/notes/board.md");
  await expect(tabFrame(page).locator(".list-head").first()).toBeVisible();
}

/** A finger on the page, by CDP. */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
}

test.describe("on a phone", () => {
  test.use(PHONE);

  test("a board's round icon buttons and checkboxes take a fingertip's tap around them", async ({
    page,
  }) => {
    test.skip(!hasPlugin("catvinci.kanban"), "no plugins checkout");
    await openBoard(page);
    const frame = tabFrame(page);
    const targets = await frame
      .locator(".tx-icon-button, .ui-check")
      .evaluateAll((all) =>
        all
          .filter((el) => el.checkVisibility())
          .filter((el) => el.getBoundingClientRect().right + 4 < innerWidth)
          .map((el) => {
            const box = el.getBoundingClientRect();
            const y = box.top + box.height / 2;
            // Just outside what is drawn, still inside 44 around it.
            const beside = document.elementFromPoint(box.right + 4, y);
            return {
              round: el.matches(".ui-check") || box.width === box.height,
              hit: beside === el || el.contains(beside),
            };
          }),
      );
    expect(targets.length).toBeGreaterThan(1);
    for (const target of targets)
      expect(target).toEqual({ round: true, hit: true });
    // Nothing reaches past the page's edge for it.
    expect(
      await frame
        .locator("html")
        .evaluate((html) => html.scrollWidth - html.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
});

test.describe("on a tablet", () => {
  test.use(TABLET);

  test("a board's list held, then dragged by its head, takes its new place", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "touch input by CDP");
    test.skip(!hasPlugin("catvinci.kanban"), "no plugins checkout");
    await openBoard(page);
    const heads = tabFrame(page).locator(".list-head");
    const todo = (await heads.nth(0).boundingBox())!;
    const done = (await heads.nth(1).boundingBox())!;
    const touch = await finger(page);
    // A frame's boxes are given in the window's coordinates.
    const y = done.y + done.height / 2;
    const from = done.x + 8;
    await touch("touchStart", from, y);
    // Real time: a finger held still long enough to lift (page-drag's 500 ms).
    await page.waitForTimeout(700);
    const to = todo.x - 20;
    for (let i = 1; i <= 10; i++)
      await touch("touchMove", from + ((to - from) * i) / 10, y);
    await touch("touchEnd");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __devFs: Record<string, string> }).__devFs[
              "/work/notes/board.md"
            ],
        ),
      )
      .toMatch(/## Done[\s\S]*## Todo/);
  });

  test("a tag held in the sidebar's list shows its menu, as a right-click does", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "touch input by CDP");
    test.skip(!hasPlugin("catvinci.tags"), "no plugins checkout");
    await openWithPlugins(page, {
      plugins: { "catvinci.tags": permissions("catvinci.tags") },
      folder: { "/work/notes/a.md": "# A\n\n#project\n" },
    });
    await openPath(page, "/work/notes/a.md");
    await page.getByRole("button", { name: "Tags", exact: true }).tap();
    const row = page.locator(".plugin-list-row", { hasText: "project" });
    const box = (await row.boundingBox())!;
    const touch = await finger(page);
    await touch("touchStart", box.x + 40, box.y + box.height / 2);
    // It opens while the finger is still down, and stays once it lifts.
    const rename = page.getByRole("menuitem", { name: /Rename/ });
    await expect(rename).toBeVisible();
    await touch("touchEnd");
    await settled(page);
    await expect(rename).toBeVisible();
  });
});
