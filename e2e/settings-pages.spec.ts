import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

// Settings: the list of pages in the sidebar (the gear, ⌘,), one page at a
// time in the one Settings tab; every way in lands there.

const PAGES = [
  "general",
  "look-basic",
  "edit-text",
  "edit-img",
  "edit-export",
  "providers",
  "chat",
  "memory",
  "mcp",
  "shortcuts",
  "privacy",
  "about",
];

const gear = (page: Page) => page.locator(".activity-rail-settings");
const tabs = (page: Page) => page.locator(".tab-pill");
const sidebarTitle = (page: Page) => page.locator(".sidebar-title");

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  return errors;
}

test("⌘, opens the list in the sidebar and the Settings tab; the gear toggles the list", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-open-settings");
  await expect(tabs(page)).toHaveText(["未命名", "设置：通用"]);
  await expect(sidebarTitle(page)).toHaveText("设置");
  await expect(gear(page)).toHaveAttribute("aria-pressed", "true");
  await gear(page).click();
  await expect(gear(page)).toHaveAttribute("aria-pressed", "false");
  await expect(tabs(page)).toHaveText(["未命名", "设置：通用"]);
  await gear(page).click();
  await expect(sidebarTitle(page)).toHaveText("设置");
});

test("every page draws, in the one tab, without an error", async ({ page }) => {
  const errors = await open(page);
  await emit(page, "menu-open-settings");
  for (const id of PAGES) {
    await page.evaluate(
      (page) =>
        window.dispatchEvent(
          new CustomEvent("textus:open-settings-page", { detail: { page } }),
        ),
      id,
    );
    await expect(page.locator(".settings-tab-page > *").first()).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);
  }
  expect(errors).toEqual([]);
});

test("groups fold, and open on the page shown", async ({ page }) => {
  await open(page);
  await emit(page, "menu-open-settings");
  const nav = page.locator(".sidebar");
  await expect(nav.getByText("图片", { exact: true })).toHaveCount(0);
  await nav.getByText("编辑", { exact: true }).click();
  await nav.getByText("图片", { exact: true }).click();
  await expect(nav.getByText("图片", { exact: true })).toBeVisible();
});

test("Check for Updates opens About; a plugin's settings open its page's tab", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-check-updates");
  await expect(page.locator(".settings-about-card-icon")).toBeVisible();
  await emit(page, "menu-plugin-command", "plugin-settings:cloud-sync");
  await expect(tabs(page).last()).toContainText("插件：");
  await emit(page, "menu-manage-plugins");
  await expect(sidebarTitle(page)).toHaveText("插件");
});

test("the list's last item goes to the plugins panel", async ({ page }) => {
  await open(page);
  await emit(page, "menu-open-settings");
  await page.locator(".settings-nav-away").click();
  await expect(sidebarTitle(page)).toHaveText("插件");
});

test("installed themes show as the store's do", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: {
      menuBarShown: false,
      userThemes: [{ id: "mine", name: "我的主题", file: "mine.css" }],
      themeId: "mine",
    },
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("textus:open-settings-page", {
        detail: { page: "look-basic" },
      }),
    ),
  );
  const mine = page.locator('[data-user-theme="mine"]');
  await expect(mine).toHaveClass(/theme-gallery-item/);
  await expect(mine.locator(".theme-gallery-preview")).toBeVisible();
});

test("in too narrow a column, Settings asks for room instead of squeezing its rows", async ({
  page,
}) => {
  // Narrow enough that, the sidebar stepped aside, Settings and the AI
  // still share too little.
  await page.setViewportSize({ width: 640, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  await emit(page, "menu-open-settings");
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator(".settings-tab-narrow")).toBeVisible();
  await expect(page.locator(".settings-tab-page")).toBeHidden();
});
