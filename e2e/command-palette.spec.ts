import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * The Command Palette: the menus' items and the plugins' commands in one
 * list, found by typing; Enter runs the one picked.
 */

// A bundled Markdown parser's rules hold both "<!--" and "<script": the
// host's page must still run all of the plugin's code.
const HOST = `
const HTML_OPENERS = ["<!--", "<script>"];
exports.activate = function () {
  if (HTML_OPENERS.length !== 2) throw new Error("cut short");
  textus.commands.register("test.palette.hello", function () {
    textus.ui.notice("Hello from the palette");
  });
  textus.commands.register("test.palette.line", async function () {
    const got = await textus.ui.pick([":write", ":quit"], {
      commands: true,
      value: ":",
    });
    textus.ui.notice("Line: " + JSON.stringify(got));
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
      commands: [
        { command: "test.palette.hello", title: "Say Hello" },
        { command: "test.palette.line", title: "Command Line" },
      ],
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

test("a plugin's command line lists its own commands among the palette's, and hands back what was typed", async ({
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
  const line = async () => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await page.keyboard.type("command line");
    await page.keyboard.press("Enter");
    await expect(palette.getByRole("combobox")).toHaveValue(":");
  };
  const status = page.locator("[role=status]").first();

  await line();
  await page.keyboard.type("qu");
  await expect(palette.getByRole("option").first()).toContainText(":quit");
  await page.keyboard.press("Enter");
  await expect(status).toContainText('Line: ":quit"');

  await line();
  await page.keyboard.type("999");
  await expect(palette.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(status).toContainText('Line: {"typed":":999"}');

  // ":split right" finds the menu's Split Right, which runs.
  await line();
  await page.keyboard.type("split right");
  await page.keyboard.press("Enter");
  await expect(page.locator(".split-pane")).toHaveCount(2);
});

test("the palette changes the appearance, the editor theme and Textus AI", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", theme: "light" } });
  const palette = page.getByRole("dialog", { name: "Type a command…" });
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.keyboard.type("appearance");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  // The choices come up in a pick of their own.
  await page.getByRole("option", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.keyboard.type("textus ai on or off");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Textus AI" })).toHaveClass(
    /off|disabled/,
  );
});
