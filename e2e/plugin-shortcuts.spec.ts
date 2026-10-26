import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A plugin command's key in Settings › Shortcuts (settings/sections/
 * shortcut-rows.tsx): listed under Plugins with its manifest's key, set
 * to another - which then runs it, and the old one no longer does - and
 * refused, with the owner's name, where an app action has the key.
 */

const HOST = `
var count = 0;
exports.activate = function () {
  textus.commands.register("test.keys.ping", function () {
    count += 1;
    textus.ui.notice("Ping " + count);
  });
};
`;

const ENTRY = {
  id: "test.keys",
  dir: "/plugins/test.keys",
  manifest: JSON.stringify({
    id: "test.keys",
    name: "Keys",
    version: "1.0.0",
    publisher: "test",
    description: "A command with a key.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    contributes: {
      commands: [{ command: "test.keys.ping", title: "Ping" }],
      keybindings: [{ command: "test.keys.ping", key: "mod+alt+y" }],
    },
  }),
  dev: false,
  files: { "host.js": HOST },
};

test("a plugin command's key is listed, set again, and refused where an app action has it", async ({
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
  const notice = page.locator("[role=status]").first();
  await page.keyboard.press("Control+Alt+Y");
  await expect(notice).toContainText("Ping 1");

  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.locator(".settings-nav-item", { hasText: "Shortcuts" }).click();
  const plugins = page.locator(".settings-group", { hasText: "Plugins" });
  const key = plugins.getByRole("button", { name: /^Ping: / });
  await expect(key).toHaveAccessibleName(/Ctrl\+Alt\+Y/);

  // The command palette's key is the app's.
  await key.click();
  await page.keyboard.press("Control+Shift+P");
  await expect(plugins.getByRole("alert")).toContainText("Command Palette");

  await key.click();
  await page.keyboard.press("Control+Alt+U");
  await expect(key).toHaveAccessibleName(/Ctrl\+Alt\+U/);
  await page.keyboard.press("Escape");
  await page.locator("body").press("Control+Alt+U");
  await expect(notice).toContainText("Ping 2");
});
