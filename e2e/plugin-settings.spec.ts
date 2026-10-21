import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
import { openWithPlugins } from "./plugin-helpers";

/**
 * Settings › Plugins with the catalog the dev server serves from the
 * textus-plugins checkout (vite.dev-plugins.ts): nothing comes installed,
 * the catalog's plugins are offered with who made them, installing one
 * turns it on, each installed plugin is a card that opens its own page,
 * and a plugin that needs a setting on asks for it.
 */

const emit = (page: Page, event: string) =>
  page.evaluate(
    (name) =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent(name),
    event,
  );

async function openPluginsPage(page: Page) {
  await emit(page, "menu-manage-plugins");
  await expect(
    page.locator(".settings-nav-item", { hasText: "Extensions" }),
  ).toHaveAttribute("aria-current", /page|true/);
}

test("nothing comes installed, and the catalog offers the official plugins", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await openPluginsPage(page);
  const installed = page.locator(".settings-group", { hasText: "Installed" });
  await expect(installed).toContainText("None yet.");
  const graph = page.locator('.plugin-card[data-catalog="catvinci.graph"]');
  await expect(graph).toContainText("Graph View");
  await expect(graph.locator(".plugin-official")).toHaveText("Official");
  await expect(graph).toContainText("by CatVinci Studio");
  // No plugin's artwork among Settings' rows.
  await expect(page.locator(".settings-panel img")).toHaveCount(0);
});

test("installing from the list turns the plugin on, behind its permissions", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await openPluginsPage(page);
  await page
    .locator('.plugin-card[data-catalog="catvinci.tasks"]')
    .getByRole("button", { name: "Install" })
    .click();
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("asks to:");
  await dialog.getByRole("button", { name: "Allow" }).click();
  const card = page.locator('.plugin-card[data-plugin="catvinci.tasks"]');
  await expect(card).toBeVisible();
  await expect(card.getByRole("checkbox")).toBeChecked();
  await expect(card.locator(".plugin-official")).toHaveText("Official");
  await expect(
    page.locator('.plugin-card[data-catalog="catvinci.tasks"]'),
  ).toHaveCount(0);
});

test("a card opens the plugin's own page: its settings, what it adds, its permissions", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.daily-notes": ["workspace.read", "workspace.write"] },
  });
  await openPluginsPage(page);
  await page
    .locator(
      '.plugin-card[data-plugin="catvinci.daily-notes"] .plugin-card-open',
    )
    .click();
  const own = page.locator('[data-plugin-page="catvinci.daily-notes"]');
  await expect(own.locator(".plugin-page-title")).toHaveText(
    "Calendar & Daily Notes",
  );
  // Its settings, drawn as Textus's own rows.
  const settings = own.locator(".settings-group", { hasText: "Settings" });
  await expect(
    settings.locator("input.plugin-setting-input").first(),
  ).toHaveValue("Daily");
  await expect(
    own.locator(".settings-group", { hasText: "About" }),
  ).toContainText("Permissions");
  await own.getByRole("button", { name: /All plugins/ }).click();
  await expect(
    page.locator('.plugin-card[data-plugin="catvinci.daily-notes"]'),
  ).toBeVisible();
});

test("Quick Notes asks for background mode, and its page says when it is on", async ({
  page,
}) => {
  await openWithPlugins(page, { plugins: {} });
  await openPluginsPage(page);
  await page
    .locator('.plugin-card[data-catalog="catvinci.quick-notes"]')
    .getByRole("button", { name: "Install" })
    .click();
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(dialog).toContainText(
    "Quick Notes needs “Keep running in the background”",
  );
  await dialog.getByRole("button", { name: "Turn on" }).click();
  await page
    .locator(
      '.plugin-card[data-plugin="catvinci.quick-notes"] .plugin-card-open',
    )
    .click();
  const needs = page.locator(".settings-group", { hasText: "Needs" });
  await expect(needs).toContainText("Keep running in the background");
  await expect(needs.locator(".plugin-requirement-met")).toHaveText("On");
});

test("a command picked in the tray with no window open runs in the window opened for it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__devPendingPluginCommand =
      "catvinci.quick-notes.capture";
  });
  await openWithPlugins(page, {
    plugins: { "catvinci.quick-notes": ["document.propose"] },
  });
  await expect(page.locator(".app-dialog")).toContainText(
    "Note something down",
  );
});
