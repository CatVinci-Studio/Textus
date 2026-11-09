import { expect, test, type Page } from "@playwright/test";
import { openApp, chromeScale } from "./helpers";

/**
 * A plugin's floating view: opened by the plugin, a transparent page of its
 * own size over the window, dragged anywhere, folded to a dot and closed
 * from its right-click menu - and the plugin hears each change, and which
 * half of the window it sits in.
 */

const HOST = `
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.views.registerWebview("test.float.pet", {
      resolve: function (webview) {
        webview.html = '<div id="pet" style="width:80px;height:80px;background:tomato;border-radius:50%"></div>';
      },
    }),
    textus.layout.onDidChangeFloating(function (change) {
      if (!change.visible)
        textus.ui.notice((change.open ? "folded" : "closed") + " in " + change.place);
      else textus.ui.notice("on the " + change.side);
    }),
  );
  ctx.subscriptions.push(
    textus.commands.register("test.float.dress", function () {
      textus.ui.notice("dressed up");
    }),
  );
  textus.layout.openFloating("test.float.pet");
};
`;

const MANIFEST = {
  id: "test.float",
  name: "Float",
  version: "1.0.0",
  publisher: "test",
  description: "Floats a pet.",
  engines: { textus: "^1.3.0" },
  main: "host.js",
  icon: "icon.svg",
  activationEvents: ["*"],
  permissions: [],
  contributes: {
    floatingViews: [
      { id: "test.float.pet", title: "Pet", width: 120, height: 120 },
    ],
    commands: [{ command: "test.float.dress", title: "Change outfit" }],
    menus: {
      "floating/context": [
        { command: "test.float.dress", when: "view == test.float.pet" },
      ],
    },
  },
};

async function installPlugin(page: Page) {
  await page.addInitScript(
    ({ manifest, host }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: "/plugins/test.float",
          manifest: JSON.stringify(manifest),
          dev: false,
          files: {
            "host.js": host,
            "icon.svg":
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="teal"/></svg>',
          },
        },
      ];
      w.__devPluginState = {
        allOn: true,
        plugins: { [manifest.id]: { enabled: true, granted: [] } },
      };
    },
    { manifest: MANIFEST, host: HOST },
  );
}

test("a floating view opens over the window, moves, folds and closes", async ({
  page,
}) => {
  await installPlugin(page);
  await openApp(page, { settings: { language: "en" } });

  const view = page.getByRole("dialog", { name: "Pet" });
  await expect(view).toBeVisible();
  await expect(view).toHaveCSS(
    "width",
    `${+(120 * (await chromeScale(page))).toFixed(3)}px`,
  );
  // It starts in the corner, as far from the right edge as the bottom.
  const start = (await view.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(viewport.width - start.x - start.width).toBeCloseTo(
    viewport.height - start.y - start.height,
    0,
  );
  // The page is transparent: only what the plugin draws floats.
  const pet = view.frameLocator("iframe").locator("#pet");
  await expect(pet).toBeVisible();
  await expect(view.frameLocator("iframe").locator("body")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  // Dragged by any part of it; where it was left is remembered.
  const before = (await view.boundingBox())!;
  await page.mouse.move(before.x + 60, before.y + 60);
  await page.mouse.down();
  await page.mouse.move(60, before.y - 80, { steps: 8 });
  await page.mouse.up();
  const after = (await view.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 150);
  expect(after.y).toBeLessThan(before.y - 50);
  // Let go near the edge, it settles the same distance in as the corner.
  expect(after.x).toBeCloseTo(viewport.width - start.x - start.width, 0);
  // Now in the left half: a character there turns to face the middle.
  await expect(page.getByText("on the left")).toBeVisible();
  // Resized from its top corner toward the middle: in proportion, never
  // past 1.4x, its bottom and outer edge staying put.
  await view.hover();
  const grip = view.locator(".floating-view-grip");
  await expect(grip).toHaveCSS("opacity", "1");
  const corner = (await grip.boundingBox())!;
  await page.mouse.move(corner.x + 8, corner.y + 8);
  await page.mouse.down();
  await page.mouse.move(corner.x + 300, corner.y - 300, { steps: 6 });
  await page.mouse.up();
  const big = (await view.boundingBox())!;
  // 1.4x its 120px, at the interface's size.
  const most = 168 * (await chromeScale(page));
  expect(big.width).toBeCloseTo(most, 0);
  expect(big.height).toBeCloseTo(most, 0);
  expect(big.x).toBeCloseTo(after.x, 0);
  expect(big.y + big.height).toBeCloseTo(after.y + after.height, 0);
  // Petting her with quick clicks never selects her like text.
  await view.dblclick();
  expect(
    await page.evaluate(() => {
      const box = document.querySelector("[data-floating-view]")!;
      const selection = getSelection();
      return (
        !!selection &&
        !selection.isCollapsed &&
        selection.containsNode(box, true)
      );
    }),
  ).toBe(false);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("textus.floatingViews") ?? "{}"),
  );
  expect(saved["test.float.pet"]).toMatchObject({ open: true });

  // Open when the window comes back, where it was left.
  await page.reload();
  await expect(view).toBeVisible();
  expect((await view.boundingBox())!.x).toBeCloseTo(after.x, -1);
  expect((await view.boundingBox())!.width).toBeCloseTo(most, 0);

  // Folded to a dot and back; the plugin hears it go out of sight.
  await view.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fold Pet" }).click();
  await expect(view).toHaveCount(0);
  await expect(page.getByText("folded in window")).toBeVisible();
  const dot = page.getByRole("button", { name: "Unfold Pet" });
  // Folded, it shows its plugin's icon.
  await expect(dot.locator("img")).toHaveAttribute("src", /^data:image\/svg/);
  await dot.click();
  await expect(view).toBeVisible();

  await view.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Float Pet on the desktop" }),
  ).toHaveCount(0);
  // The plugin's own items lead its menu.
  await expect(page.getByRole("menuitem").first()).toHaveText("Change outfit");
  await page.getByRole("menuitem", { name: "Change outfit" }).click();
  await expect(page.getByText("dressed up")).toBeVisible();
  await view.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close Pet" }).click();
  await expect(view).toHaveCount(0);
  await expect(dot).toHaveCount(0);
  await expect(page.getByText("closed in window")).toBeVisible();
});
