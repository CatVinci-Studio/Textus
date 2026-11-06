import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A plugin suggests an official one with textus.offerPlugin: one card
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
  // Listed, but not official: no card.
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
  const card = page.locator(".suggest-card");
  // One line naming the plugin; the editor keeps the focus.
  await expect(card).toContainText("Plugin suggestion: Kanban");
  await expect(card).toHaveCount(1);
  await expect(card.locator(":focus")).toHaveCount(0);
  await card.locator(".suggest-card-summary").click();
  await expect(card).toContainText("Boards of cards in lists");
  await card.getByRole("button", { name: "Install", exact: true }).click();
  // Its permissions, as any install asks.
  const ask = page.locator(".app-dialog");
  await expect(ask).toContainText("Kanban asks to:");
  await ask.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText("answers: false,true,false,false")).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("Later: nothing is installed and the plugin hears false", async ({
  page,
}) => {
  await openWithOfferingPlugin(page);
  const card = page.locator(".suggest-card");
  await card.getByRole("button", { name: "Later" }).click();
  await expect(
    page.getByText("answers: false,false,false,false"),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".app-dialog")).toHaveCount(0);
});

test("× puts the suggestion away, after a reload too", async ({ page }) => {
  await openWithOfferingPlugin(page);
  await page
    .locator(".suggest-card")
    .getByRole("button", { name: "Don't suggest this again" })
    .click();
  await expect(page.locator(".suggest-card")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("answers: false,false,false,false"),
  ).toBeVisible();
  await expect(page.locator(".suggest-card")).toHaveCount(0);
});
