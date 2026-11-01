import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A plugin page is drawn with the app's own controls - the same rules,
 * not a copy - and opens the app's own menus.
 */

const HOST = `
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.views.registerWebview("test.ui.panel", {
      resolve: function (webview) {
        webview.html = [
          '<button class="tx-button primary" id="primary">Save</button>',
          '<button class="tx-button" id="more">More</button>',
          '<p id="out"></p>',
          "<script>",
          "const api = acquireTextusApi();",
          "document.getElementById('more').onclick = async (e) => {",
          "  const chosen = await api.menu([",
          "    { label: 'Rename', value: 'rename' },",
          "    'separator',",
          "    { label: 'Delete', value: 'delete', danger: true },",
          "  ], e.currentTarget);",
          "  document.getElementById('out').textContent = String(chosen);",
          "};",
          "</script>",
        ].join("\\n");
      },
    }),
  );
};
`;

const MANIFEST = {
  id: "test.ui",
  name: "UI",
  version: "1.0.0",
  publisher: "test",
  description: "Draws with the app's controls.",
  engines: { textus: "^1.3.0" },
  main: "host.js",
  activationEvents: ["*"],
  permissions: [],
  contributes: { sidebarTabs: [{ id: "test.ui.panel", title: "UI" }] },
};

test("a plugin page's controls are the app's, and its menu is the app's menu", async ({
  page,
}) => {
  await page.addInitScript(
    ({ manifest, host }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: "/plugins/test.ui",
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
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-toggle-sidebar"),
  );
  await page
    .locator(".sidebar-tabs")
    .getByRole("button", { name: "UI" })
    .click();
  const panel = page.frameLocator(".plugin-webview-frame");

  // The primary button is ink: the app's --ui-primary, through its own rule.
  const ink = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--ui-primary")
      .trim(),
  );
  const fill = await panel
    .locator("#primary")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const expected = await page.evaluate((colour) => {
    const probe = document.createElement("div");
    probe.style.background = colour;
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, ink);
  expect(fill).toBe(expected);
  await expect(panel.locator("#primary")).toHaveCSS("border-radius", "999px");

  // The page asks; the app draws its own menu and answers with the choice.
  await panel.locator("#more").click();
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  await expect(panel.locator("#out")).toHaveText("delete");
});
