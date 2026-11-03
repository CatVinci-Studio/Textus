import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A plugin's floating view: opened by the plugin, a transparent page of its
 * own size over the window, moved by its bar, folded to a dot and closed by
 * the user - and the plugin hears each change.
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
  activationEvents: ["*"],
  permissions: [],
  contributes: {
    floatingViews: [
      { id: "test.float.pet", title: "Pet", width: 120, height: 120 },
    ],
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
          files: { "host.js": host },
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
  await expect(view).toHaveCSS("width", "120px");
  // The page is transparent: only what the plugin draws floats.
  const pet = view.frameLocator("iframe").locator("#pet");
  await expect(pet).toBeVisible();
  await expect(view.frameLocator("iframe").locator("body")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  // Its bar moves it; where it was left is remembered.
  const before = await view.boundingBox();
  await view.hover();
  const grip = view.getByRole("button", { name: "Move Pet" });
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 190, box.y - 140, { steps: 6 });
  await page.mouse.up();
  const after = (await view.boundingBox())!;
  expect(after.x).toBeLessThan(before!.x - 150);
  expect(after.y).toBeLessThan(before!.y - 100);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("textus.floatingViews") ?? "{}"),
  );
  expect(saved["test.float.pet"]).toMatchObject({ open: true });

  // Open when the window comes back, where it was left.
  await page.reload();
  await expect(view).toBeVisible();
  expect((await view.boundingBox())!.x).toBeCloseTo(after.x, -1);

  // Folded to a dot and back; the plugin hears it go out of sight.
  await view.getByRole("button", { name: "Fold Pet" }).click();
  await expect(view).toHaveCount(0);
  await expect(page.getByText("folded in window")).toBeVisible();
  const dot = page.getByRole("button", { name: "Unfold Pet" });
  await dot.click();
  await expect(view).toBeVisible();

  await view.hover();
  await view.getByRole("button", { name: "Close Pet" }).click();
  await expect(view).toHaveCount(0);
  await expect(dot).toHaveCount(0);
  await expect(page.getByText("closed in window")).toBeVisible();
});
