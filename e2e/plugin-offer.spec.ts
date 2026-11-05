import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A plugin suggests an official one with textus.offerPlugin: one dialog
// however often it asks, and the answer comes back to it.

const HOST = `
// Not awaited in activate: activation has 10 s, the user may take longer.
exports.activate = function () {
  var ask = function (id) {
    return textus.commands.execute("textus.offerPlugin", {
      id: id,
      reason: "Boards for the pages you import.",
    });
  };
  // Listed, but not official: no dialog.
  ask("catvinci.database")
    .then(function (listed) {
      return Promise.all([
        listed,
        ask("catvinci.kanban"),
        ask("catvinci.kanban"),
        ask("catvinci.kanban"),
      ]);
    })
    .then(function (answers) {
      textus.ui.notice("answers: " + answers.join(","));
    });
};
`;

const MANIFEST = {
  id: "test.offer",
  name: "Offer",
  version: "1.0.0",
  publisher: "test",
  description: "Suggests another plugin.",
  engines: { textus: "^1.3.0" },
  main: "host.js",
  activationEvents: ["*"],
  permissions: [],
  contributes: {},
};

async function openWithOfferingPlugin(page: Page) {
  await page.addInitScript(
    ({ manifest, host }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: "/plugins/test.offer",
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "host.js": host },
        },
      ];
      w.__devPluginState = {
        allOn: true,
        plugins: { [manifest.id]: { enabled: true, granted: [] } },
      };
      // As a community plugin is listed.
      w.__devCatalogStats = { "catvinci.database": { official: false } };
    },
    { manifest: MANIFEST, host: HOST },
  );
  await openApp(page, { settings: { language: "en" } });
}

test("a plugin's suggestion asks once, installs the plugin and answers true", async ({
  page,
}) => {
  await openWithOfferingPlugin(page);
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("Install the Kanban plugin?");
  // Who asks, and a key typed as it opens lands on Cancel.
  await expect(dialog.locator(".app-dialog-title")).toHaveText("Offer");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(dialog).toContainText("“Boards for the pages you import.”");
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole("button", { name: "Install", exact: true }).click();
  // Its permissions, as any install asks.
  const ask = page.locator(".app-dialog");
  await expect(ask).toContainText("Kanban asks to:");
  await ask.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText("answers: false,true,false,false")).toBeVisible();
});

test("declined, nothing is installed and the plugin hears false", async ({
  page,
}) => {
  await openWithOfferingPlugin(page);
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByText("answers: false,false,false,false"),
  ).toBeVisible();
  await expect(page.locator(".app-dialog")).toHaveCount(0);
});
