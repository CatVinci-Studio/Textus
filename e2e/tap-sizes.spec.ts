import { expect, type Page, test } from "@playwright/test";
import { emit, openApp, PHONE, TABLET } from "./helpers";

// Everything a finger can tap, at every Interface Size step, on a phone and
// a touch tablet: each takes a 44pt tap and stays on the screen.

/** The controls on screen whose tap is under 44 either way, as
 *  "name width×height": each measured by where a tap still lands on it, so
 *  a hit area grown past the drawn box counts. */
function smallTaps(page: Page, within = "body"): Promise<string[]> {
  return page.evaluate((within) => {
    const controls = document.querySelectorAll<HTMLElement>(
      [
        "button",
        '[role="button"]',
        '[role="tab"]',
        '[role^="menuitem"]',
        '[role="option"]',
        "select",
        'input:not([type="hidden"])',
        "a[href]",
      ]
        .map((control) => `:is(${within}) ${control}`)
        .join(", "),
    );
    const small: string[] = [];
    for (const el of controls) {
      // A phone's folder tools share their targets, leaving the folder's
      // name its room (phone-touch.spec.ts measures them).
      if (
        !el.checkVisibility() ||
        el.closest(".milkdown, .cm-editor, [inert]") ||
        el.matches('[data-window-chrome="mobile"] .tree-toolbar .tree-tool')
      )
        continue;
      const box = el.getBoundingClientRect();
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
      if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue;
      // Under something else (a sheet over it): not tappable now.
      const top = document.elementFromPoint(cx, cy);
      if (!top || !el.contains(top)) continue;
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
      const width = side(-1, 0) + side(1, 0) + 1;
      const height = side(0, -1) + side(0, 1) + 1;
      // Counted a whole pixel at a time from a centre that may sit on a
      // half: a 44 that starts mid-pixel counts 43.
      if (width < 43 || height < 43) {
        const name =
          el.getAttribute("aria-label") ||
          el.textContent?.trim().slice(0, 24) ||
          el.className;
        small.push(`${name} ${width}×${height}`);
      }
    }
    return small;
  }, within);
}

/** What runs off the screen's side: the page itself, or a bar's control. */
function offScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > innerWidth + 1) out.push(`page ${root.scrollWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>(
      ".window-bar button, .activity-rail button",
    )) {
      if (!el.checkVisibility()) continue;
      // At the edge is fine (a tap lands there); a quarter cut off is not.
      const box = el.getBoundingClientRect();
      const shown = Math.min(box.right, innerWidth) - Math.max(box.left, 0);
      if (shown < box.width * 0.75)
        out.push(
          `${el.getAttribute("aria-label") ?? el.className} ${Math.round(box.left)}…${Math.round(box.right)}`,
        );
    }
    return out;
  });
}

const DEVICES = [
  { name: "a phone", device: PHONE },
  { name: "a touch tablet", device: TABLET },
];
const STEPS = [
  ["Small", 0.85],
  ["Medium", 1],
  ["Large", 1.25],
  ["Extra Large", 1.5],
  ["Largest", 1.75],
] as const;

for (const { name, device } of DEVICES)
  test.describe(`on ${name}`, () => {
    test.use(device);

    for (const [step, scale] of STEPS)
      test(`at ${step}, everything takes a 44pt tap and stays on screen`, async ({
        page,
      }) => {
        await page.addInitScript(() => {
          Object.assign(window, {
            __devFs: {
              "/proj/a.md": "# A\n\nText.\n",
              "/proj/n/b.md": "# B\n",
            },
            __devPickFolder: "/proj",
            __devInvokeResults: {
              "plugin:textus-files|pick_folder": { url: "file:///proj" },
              "plugin:textus-files|begin_access": { path: "/proj" },
            },
          });
        });
        await openApp(page, {
          settings: {
            language: "en",
            uiTextScale: scale,
            uiSizeFollowsSystem: false,
          },
        });
        const phone = name === "a phone";
        await emit(page, "menu-open-folder");
        const tree = page.locator(".tree-row").first();
        await expect(tree).toBeAttached();
        if (phone && !(await tree.isVisible()))
          await page.locator(".window-bar-sidebar-toggle").tap();
        await expect(tree).toBeVisible();
        const where = `${name} at ${step}`;
        // A phone's sidebar pushes the page aside, its bar half off the
        // screen: the sidebar and the rail are what is in reach.
        await expect.soft
          .poll(
            () => smallTaps(page, phone ? ".sidebar, .activity-rail" : "body"),
            { message: `${where}: sidebar` },
          )
          .toEqual([]);
        if (!phone)
          await expect.soft
            .poll(() => offScreen(page), { message: `${where}: sidebar` })
            .toEqual([]);
        await page.getByRole("treeitem", { name: "a.md" }).tap();
        await expect(page.locator(".milkdown").first()).toBeVisible();
        await expect.soft
          .poll(() => smallTaps(page), { message: `${where}: document` })
          .toEqual([]);
        await expect.soft
          .poll(() => offScreen(page), { message: `${where}: document` })
          .toEqual([]);
        await page.getByRole("button", { name: "Menu", exact: true }).tap();
        await expect(page.getByRole("menuitem").first()).toBeVisible();
        await expect.soft
          .poll(() => smallTaps(page, ".context-menu"), {
            message: `${where}: menu`,
          })
          .toEqual([]);
        await page.getByRole("menuitem", { name: /Settings/ }).tap();
        await expect(page.getByLabel("Search settings")).toBeVisible();
        await expect.soft
          .poll(() => smallTaps(page), { message: `${where}: Settings` })
          .toEqual([]);
        await expect.soft
          .poll(() => offScreen(page), { message: `${where}: Settings` })
          .toEqual([]);
      });
  });
