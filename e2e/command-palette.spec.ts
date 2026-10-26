import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * The Command Palette: the menus' items and the plugins' commands in one
 * list, found by typing; Enter runs the one picked.
 */

const HOST = `
exports.activate = function () {
  textus.commands.register("test.palette.hello", function () {
    textus.ui.notice("Hello from the palette");
  });
};
`;

const ENTRY = {
  id: "test.palette",
  dir: "/plugins/test.palette",
  manifest: JSON.stringify({
    id: "test.palette",
    name: "Palette",
    version: "1.0.0",
    publisher: "test",
    description: "A command for the palette.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    contributes: {
      commands: [{ command: "test.palette.hello", title: "Say Hello" }],
    },
  }),
  dev: false,
  files: { "host.js": HOST },
};

test("the palette finds a menu item and a plugin's command, and runs them", async ({
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
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  // The backend's menu dispatch: an item run sends its event.
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __devEmitTauriEvent: (n: string) => void;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "trigger_menu_item") return invoke(cmd, args);
      w.__devEmitTauriEvent(`menu-${String(args?.id)}`);
      return Promise.resolve();
    };
  });
  const palette = page.getByRole("dialog", { name: "Type a command…" });

  await page.keyboard.press("ControlOrMeta+Shift+P");
  await expect(palette).toBeVisible();
  await page.keyboard.type("split right");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await expect(palette.getByRole("option")).toContainText("View");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.locator(".split-pane")).toHaveCount(2);

  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.keyboard.type("hello");
  await page.keyboard.press("Enter");
  await expect(page.locator("[role=status]").first()).toContainText(
    "Hello from the palette",
  );
});
