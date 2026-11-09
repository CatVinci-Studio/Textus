import { expect, test } from "@playwright/test";
import { emit, openApp } from "./helpers";

/**
 * textus.showFolder: a plugin shows a folder inside the open one in the
 * sidebar, as a double click on it does (Notion Import, into what it made).
 */

const HOST = `
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.commands.register("test.show.go", function () {
      return textus.commands.execute("textus.showFolder", "/work/notes/drafts");
    }),
    textus.commands.register("test.show.outside", function () {
      return textus.commands.execute("textus.showFolder", "/elsewhere");
    }),
  );
};
`;

const MANIFEST = {
  id: "test.show",
  name: "Show",
  version: "1.0.0",
  publisher: "test",
  description: "Shows a folder.",
  engines: { textus: "^1.3.0" },
  main: "host.js",
  activationEvents: ["*"],
  permissions: [],
  contributes: {
    commands: [
      { command: "test.show.go", title: "Show Drafts" },
      { command: "test.show.outside", title: "Show Elsewhere" },
    ],
  },
};

test("a plugin shows a folder inside the open one in the sidebar, and nothing outside it", async ({
  page,
}) => {
  await page.addInitScript(
    ({ manifest, host }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: "/plugins/test.show",
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "host.js": host },
        },
      ];
      w.__devPluginState = {
        allOn: true,
        plugins: { [manifest.id]: { enabled: true, granted: [] } },
      };
      w.__devFs = {
        "/work/notes/a.md": "# Alpha",
        "/work/notes/drafts/old.md": "# Old",
      };
      w.__devPickFolder = "/work/notes";
    },
    { manifest: MANIFEST, host: HOST },
  );
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-recent", "/work/notes/a.md");
  await emit(page, "menu-toggle-sidebar");
  const root = page.locator(".sidebar .tree-root-label");
  await expect(root).toHaveText("notes");
  const run = async (name: string) => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
  };
  await run("Show Elsewhere");
  await page.waitForTimeout(300);
  await expect(root).toHaveText("notes");
  await run("Show Drafts");
  await expect(root).toHaveText("drafts");
});
