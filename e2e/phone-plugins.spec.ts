import { expect, test } from "@playwright/test";
import { PHONE, openPhone } from "./helpers";
import { pluginsAtStart } from "./plugin-helpers";

/**
 * Plugins on the iPhone, as on the desktop in a narrower form: their
 * commands in the title row's menu, their panels in the sidebar, and
 * Settings › Extensions to manage them.
 */

test.use(PHONE);

test.beforeEach(async ({ page }) => {
  await pluginsAtStart(page, { plugins: { "catvinci.quick-notes": [] } });
  await openPhone(page);
});

test("a plugin's command opens in place under Plugins in the menu", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Menu" }).tap();
  const plugins = page.getByRole("menuitem", { name: "Plugins" });
  await plugins.tap();
  await expect(plugins).toHaveAttribute("aria-expanded", "true");
  // Under its row, not in a menu of its own beside it.
  await expect(page.locator(".app-menu-flyout")).toHaveCount(0);
  await expect(
    page.locator(".app-menu-inline").getByRole("menuitem", {
      name: "Manage Plugins…",
    }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: /New Quick Note/ }).tap();
  await expect(page.locator(".app-menu")).toHaveCount(0);
});

test("Settings › Extensions has the plugins, with no MCP servers to run", async ({
  page,
}) => {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.getByText("Extensions", { exact: true }).first().tap();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["Themes", "Plugins", "Skills"]);
  await page.getByRole("tab", { name: "Plugins" }).tap();
  await expect(page.getByText("Quick Notes", { exact: true })).toBeVisible();
});
