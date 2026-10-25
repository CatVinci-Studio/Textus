import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
import { openWithPlugins } from "./plugin-helpers";

/**
 * Settings › Plugins with the catalog the dev server serves from the
 * textus-plugins checkout (vite.dev-plugins.ts): nothing comes installed,
 * Get plugins offers the catalog's plugins with who made them and a search
 * over them, the list kept from last time shows when a fresh one can't be
 * had, installing one turns it on, each installed plugin is a card that
 * opens its own page, and a plugin that needs a setting on asks for it.
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

async function openGetPlugins(page: Page) {
  await openPluginsPage(page);
  await page.getByRole("button", { name: "Get more" }).click();
  await expect(page.locator(".plugin-get-page")).toBeVisible();
}

test("nothing comes installed, and the catalog offers the official plugins", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await openPluginsPage(page);
  const installed = page.locator(".settings-group", { hasText: "Installed" });
  await expect(installed).toContainText("None yet.");
  // The catalog is a page of its own, not a list under the installed ones.
  await expect(page.locator(".plugin-card[data-catalog]")).toHaveCount(0);
  await page.getByRole("button", { name: "Get more" }).click();
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
  await openGetPlugins(page);
  await page
    .locator('.plugin-card[data-catalog="catvinci.tasks"]')
    .getByRole("button", { name: "Install" })
    .click();
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("asks to:");
  await dialog.getByRole("button", { name: "Allow" }).click();
  // Installed, it shows how it is used: its USAGE.md in a tab, a clean
  // draft, with Settings out of the way.
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  const guide = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(guide.locator("h1")).toContainText("Tasks");
  await expect(guide).toContainText("Every task in your folder");
  const tabs = page.locator(".tab-bar [role=tab]");
  const count = await tabs.count();
  await openPluginsPage(page);
  const card = page.locator('.plugin-card[data-plugin="catvinci.tasks"]');
  await expect(card).toBeVisible();
  await expect(card.getByRole("checkbox")).toBeChecked();
  await expect(card.locator(".plugin-official")).toHaveText("Official");
  // Its page opens the guide again - the tab already open, not another.
  await card.locator(".plugin-card-open").click();
  await page.getByRole("button", { name: "How to use" }).click();
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  await expect(guide.locator("h1")).toContainText("Tasks");
  await expect(tabs).toHaveCount(count);
});

test("the guide comes in the UI's language", async ({ page }) => {
  await openApp(page, { settings: { language: "zh" } });
  await emit(page, "menu-manage-plugins");
  await page.getByRole("button", { name: "获取更多" }).click();
  await page
    .locator('.plugin-card[data-catalog="catvinci.tasks"]')
    .getByRole("button", { name: "安装" })
    .click();
  await page
    .locator(".app-dialog")
    .getByRole("button", { name: "允许" })
    .click();
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror h1'),
  ).toContainText("任务");
});

test("Get plugins searches the catalog by name, what it does and who made it", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await openGetPlugins(page);
  const cards = page.locator(".plugin-get-page .plugin-card");
  const all = await cards.count();
  expect(all).toBeGreaterThan(3);
  const search = page.getByRole("searchbox", {
    name: "Search plugins, themes, skills and servers",
  });
  await search.fill("kanban");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-catalog", "catvinci.kanban");
  // Every word has to match, in any field.
  await search.fill("catvinci graph");
  await expect(cards).toHaveCount(1);
  await search.fill("CatVinci Studio");
  await expect(cards).toHaveCount(all);
  await search.fill("no such plugin");
  await expect(cards).toHaveCount(0);
  await expect(page.locator(".plugin-get-page")).toContainText(
    "No plugin matches “no such plugin”.",
  );
});

test("the list kept from last time shows when a fresh one can't be had", async ({
  page,
}) => {
  // Kept last time: Tasks alone, from the catalog the dev server serves.
  const index = await (
    await page.request.get("/dev-plugins/index.json")
  ).json();
  const kept = (index.plugins as { id: string }[]).filter(
    (p) => p.id === "catvinci.tasks",
  );
  await page.addInitScript((list) => {
    const w = window as unknown as Record<string, unknown>;
    w.__devCatalogFails = "offline";
    w.__devCatalogCache = list;
  }, kept);
  await openApp(page, { settings: { language: "en" } });
  await openGetPlugins(page);
  await expect(
    page.locator('.plugin-card[data-catalog="catvinci.tasks"]'),
  ).toBeVisible();
  await expect(page.locator(".plugin-get-page .plugin-card")).toHaveCount(1);
  const problem = page.locator(".plugin-catalog-problem");
  await expect(problem).toContainText(
    "Showing the list from last time - couldn’t get a newer one: offline",
  );
  // Once the catalog can be had again, Try again brings the fresh one.
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__devCatalogFails;
  });
  await problem.getByRole("button", { name: "Try again" }).click();
  await expect(problem).toHaveCount(0);
  await expect(
    page.locator('.plugin-card[data-catalog="catvinci.graph"]'),
  ).toBeVisible();
});

test("a card opens the plugin's own page: its settings, what it adds, its permissions", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.daily-notes": [
        "workspace.read",
        "workspace.write",
        "document.read",
      ],
    },
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
  await openGetPlugins(page);
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
  // Its guide opens over Settings closed; back to its page.
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  await openPluginsPage(page);
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

test("a plugin's setting can be the project's own, over the general one", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.daily-notes": [
        "workspace.read",
        "workspace.write",
        "document.read",
      ],
    },
    folder: { "/work/notes/a.md": "# A\n" },
  });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-recent", "/work/notes/a.md"),
  );
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText("A");
  await openPluginsPage(page);
  await page
    .locator(
      '.plugin-card[data-plugin="catvinci.daily-notes"] .plugin-card-open',
    )
    .click();
  const own = page.locator('[data-plugin-page="catvinci.daily-notes"]');
  const folder = () => own.locator("input.plugin-setting-input").first();
  const scope = {
    selectOption: async (value: "global" | "project") => {
      await own.getByRole("combobox", { name: "Applies to" }).click();
      await page
        .getByRole("option", {
          name: value === "global" ? "Every document" : /This project/,
        })
        .click();
    },
  };
  await expect(folder()).toHaveValue("Daily");
  await scope.selectOption("project");
  await folder().fill("Journal");
  await folder().blur();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devFs: Record<string, string> }).__devFs[
            "/work/notes/.textus/settings.json"
          ] ?? "",
      ),
    )
    .toContain('"Journal"');
  // For every document it is still Daily.
  await scope.selectOption("global");
  await expect(folder()).toHaveValue("Daily");
  await expect(own).toContainText("This project has its own value.");
  // Back to the general value for the project.
  await scope.selectOption("project");
  await expect(folder()).toHaveValue("Journal");
  await own
    .getByRole("button", { name: "Use the general value" })
    .first()
    .click();
  await expect(folder()).toHaveValue("Daily");
});
