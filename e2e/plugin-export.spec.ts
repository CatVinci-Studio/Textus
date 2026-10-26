import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Export for Publishing (plugins/plugin-export.ts, src-tauri
 * plugins/export.rs): a plugin you made goes into a folder under your
 * name, ready to be a repository; the window asks the name and the
 * folder, and says where it went. The layout itself is export.rs's tests.
 */

const ENTRY = {
  id: "local.word-count",
  dir: "/plugins/local.word-count",
  manifest: JSON.stringify({
    id: "local.word-count",
    name: "Word Count",
    version: "0.1.0",
    publisher: "local",
    description: "Counts words.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
  }),
  dev: false,
  files: { "host.js": "exports.activate = function () {};" },
};

test("a plugin you made is exported under your name, to the folder you pick", async ({
  page,
}) => {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: [] } },
    };
    w.__devPickPluginFolder = "/home/jane/code";
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-manage-plugins"),
  );
  await page
    .locator('.plugin-card[data-plugin="local.word-count"] .plugin-card-open')
    .click();
  await page.getByRole("button", { name: "Export for Publishing…" }).click();
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("textbox").fill("jane");
  await dialog.getByRole("button", { name: "Choose a Folder…" }).click();
  await expect(page.locator(".app-dialog")).toContainText(
    "Exported to /home/jane/code/jane.word-count.",
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __devPluginExports: unknown[] })
          .__devPluginExports,
    ),
  ).toEqual([
    { id: "local.word-count", publisher: "jane", folder: "/home/jane/code" },
  ]);
});
