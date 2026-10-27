import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A plugin loaded from a folder reloads when its files change, and its
 * errors show on its page in Settings.
 */

const host = (word: string) => `
exports.activate = function () {
  textus.commands.register("test.dev.say", function () {
    return textus.ui.message("${word}");
  });
  setTimeout(function () { throw new Error("oops from ${word}"); }, 0);
};
`;

function entry(word: string) {
  return {
    id: "test.dev",
    dir: "/home/me/test.dev",
    manifest: JSON.stringify({
      id: "test.dev",
      name: "Dev",
      version: "1.0.0",
      publisher: "test",
      description: "In the making.",
      engines: { textus: "^1.3.0" },
      main: "host.js",
      activationEvents: ["onStartupFinished"],
      contributes: {
        commands: [{ command: "test.dev.say", title: "Say" }],
        menus: { "app/plugins": [{ command: "test.dev.say" }] },
      },
    }),
    dev: true,
    files: { "host.js": host(word) },
  };
}

async function open(page: Page) {
  await page.addInitScript((plugin) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [plugin];
    w.__devPluginStamps = { "test.dev": 1 };
    w.__devPluginState = {
      allOn: true,
      plugins: { "test.dev": { enabled: true, granted: [] } },
    };
  }, entry("first"));
  await openApp(page, { settings: { language: "en" } });
}

const say = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-plugin-command", "test.dev.say"),
  );

test("a plugin loaded from a folder is loaded again when it changes", async ({
  page,
}) => {
  await open(page);
  await say(page);
  await expect(page.getByText("first", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();
  // Once the folder has been looked at, its files change.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devStampReads?: number }).__devStampReads ??
          0,
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate((plugin) => {
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [plugin];
    w.__devPluginStamps = { "test.dev": 2 };
  }, entry("second"));
  await expect
    .poll(
      async () => {
        await say(page);
        const shown = await page.getByText("second", { exact: true }).count();
        if (!shown) await page.getByRole("button", { name: "OK" }).click();
        return shown;
      },
      { timeout: 10_000 },
    )
    .toBe(1);
});

test("what goes wrong in a plugin is on its page", async ({ page }) => {
  await open(page);
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-manage-plugins"),
  );
  await page
    .locator('.plugin-card[data-plugin="test.dev"] .plugin-card-open')
    .click();
  const errors = page.locator('[data-plugin-errors="test.dev"]');
  await expect(errors).toContainText("oops from first");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(errors).toHaveCount(0);
});
