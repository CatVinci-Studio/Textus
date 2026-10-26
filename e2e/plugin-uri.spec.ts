import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * textus:// links (src-tauri plugins/uri.rs, plugins/plugin-uri.ts): one
 * that came before the window did, and one that comes later, each given
 * to the plugin it names - started for it; a link no plugin takes is said
 * so.
 */

const HOST = `
exports.activate = function () {
  textus.uri.registerHandler(function (uri) {
    textus.ui.statusItem("clip", { text: uri.path + " " + uri.query.title });
  });
};
`;

const ENTRY = {
  id: "test.clip",
  dir: "/plugins/test.clip",
  manifest: JSON.stringify({
    id: "test.clip",
    name: "Clip",
    version: "1.0.0",
    publisher: "test",
    description: "Takes clips from the browser.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
  }),
  dev: false,
  files: { "host.js": HOST },
};

async function open(page: Page) {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: [] } },
    };
    w.__devPluginUris = ["textus://test.clip/save?title=First"];
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
}

async function arrive(page: Page, link: string) {
  await page.evaluate((link) => {
    const w = window as unknown as {
      __devPluginUris: string[];
      __devEmitTauriEvent: (n: string) => void;
    };
    w.__devPluginUris = [link];
    w.__devEmitTauriEvent("plugin-uri");
  }, link);
}

test("a link waiting at start and one that comes later reach their plugin", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText("/save First")).toBeVisible();
  await arrive(page, "textus://test.clip/again?title=Second");
  await expect(page.getByText("/again Second")).toBeVisible();
});

test("a link for no plugin that is on says so", async ({ page }) => {
  await open(page);
  await arrive(page, "textus://someone.else/x");
  await expect(page.locator(".app-dialog")).toContainText(
    "No plugin that is turned on opens this link: textus://someone.else/x",
  );
});
