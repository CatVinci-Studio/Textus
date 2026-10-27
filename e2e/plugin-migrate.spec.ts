import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Official plugins written for the old plugin API move to their rewrites
 * when a window starts; Split Panes, now part of Textus, is removed.
 */

const old = (id: string, permissions: string[]) => ({
  id,
  dir: `/plugins/${id}`,
  manifest: JSON.stringify({
    id,
    name: id,
    version: "1.0.4",
    publisher: "catvinci",
    description: "Before the plugin API 1.0.",
    engines: { textus: "^1.3.0-beta.1" },
    main: "host.js",
    permissions,
  }),
  dev: false,
  files: { "host.js": "exports.activate = function () {};" },
});

/** The version the catalog the dev server serves offers. */
async function catalogVersion(page: Page, id: string): Promise<string> {
  const index = await (
    await page.request.get("/dev-plugins/index.json")
  ).json();
  return (index.plugins as { id: string; version: string }[]).find(
    (p) => p.id === id,
  )!.version;
}

test("old official plugins are replaced by their rewrites, and Split Panes goes", async ({
  page,
}) => {
  await page.addInitScript(
    (plugins) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = plugins;
      w.__devPluginState = {
        allOn: true,
        plugins: {
          "catvinci.tasks": {
            enabled: true,
            granted: ["workspace.read", "workspace.write"],
            official: true,
          },
          "catvinci.split-panes": {
            enabled: true,
            granted: [],
            official: true,
          },
        },
      };
    },
    [
      old("catvinci.tasks", ["workspace.read", "workspace.write"]),
      old("catvinci.split-panes", []),
    ],
  );
  await openApp(page, { settings: { language: "en" } });
  const state = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __devPlugins: { id: string; manifest: string }[];
        __devPluginState: {
          plugins: Record<string, { enabled: boolean; granted: string[] }>;
        };
      };
      return {
        installed: w.__devPlugins.map(
          (p) => `${p.id}@${JSON.parse(p.manifest).version}`,
        ),
        tasks: w.__devPluginState.plugins["catvinci.tasks"],
      };
    });
  await expect
    .poll(async () => (await state()).installed)
    .toEqual([
      `catvinci.tasks@${await catalogVersion(page, "catvinci.tasks")}`,
    ]);
  expect((await state()).tasks).toMatchObject({
    enabled: true,
    granted: ["files.read", "files.write"],
  });
});
