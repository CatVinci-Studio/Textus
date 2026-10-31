import { expect, test, type Page } from "@playwright/test";
import { PHONE, openPhone } from "./helpers";
import { pluginsAtStart } from "./plugin-helpers";

/**
 * Plugins on the iPhone, as on the desktop in a narrower form: their
 * commands in the title row's menu, their panels in the sidebar, and
 * Settings › Extensions to manage them.
 */

test.use(PHONE);

/** Bookmarks, and Quick Notes, which keeps Textus running in the
 *  background: the desktop's only. */
const BOTH = {
  "catvinci.bookmarks": ["editor.read", "files.read"],
  "catvinci.quick-notes": [],
};

async function open(page: Page, plugins: Record<string, string[]> = BOTH) {
  await pluginsAtStart(page, { plugins });
  await openPhone(page);
}

async function openExtensions(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.getByText("Extensions", { exact: true }).first().tap();
}

test("a plugin's command opens in place under Plugins in the menu", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Menu" }).tap();
  const plugins = page.getByRole("menuitem", { name: "Plugins", exact: true });
  await plugins.tap();
  await expect(plugins).toHaveAttribute("aria-expanded", "true");
  // Under its row, not in a menu of its own beside it.
  await expect(page.locator(".app-menu-flyout")).toHaveCount(0);
  await expect(
    page.locator(".app-menu-inline").getByRole("menuitem", {
      name: "Manage Plugins…",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /New Quick Note/ }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: /Bookmark Selection/ }).tap();
  await expect(page.locator(".app-menu")).toHaveCount(0);
});

test("Settings › Extensions has the plugins, with no MCP servers to run", async ({
  page,
}) => {
  await open(page);
  await openExtensions(page);
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["Themes", "Plugins", "Skills"]);
  await page.getByRole("tab", { name: "Plugins" }).tap();
  await expect(page.getByText("Bookmarks", { exact: true })).toBeVisible();
  // One for the desktop alone says so, and the catalog doesn't offer it.
  await expect(
    page.getByText("Works on the computer only").first(),
  ).toBeVisible();
  await expect(
    page.locator('.plugin-card[data-catalog="catvinci.quick-notes"]'),
  ).toHaveCount(0);
});

test("the catalog on the phone leaves out the plugins for the desktop alone", async ({
  page,
}) => {
  await open(page, { "catvinci.bookmarks": ["editor.read", "files.read"] });
  await openExtensions(page);
  await page.getByRole("tab", { name: "Plugins" }).tap();
  const available = page.locator(
    ".extensions-available .plugin-card[data-catalog]",
  );
  await expect(
    available.and(page.locator('[data-catalog="catvinci.cjk-spacing"]')),
  ).toHaveCount(1);
  await expect(
    available.and(page.locator('[data-catalog="catvinci.quick-notes"]')),
  ).toHaveCount(0);
});
