import { expect, test, type Page } from "@playwright/test";
import { openApp, openPhone, PHONE } from "./helpers";

// Settings' search box (src/settings/SettingsSearch.tsx): typing lists the
// matching rows of every page - labels, group titles, subpages such as
// More themes, the shortcut list and the hidden "?" text - grouped by
// page; Enter or a click opens the row's page and goes to it; Esc clears;
// Ctrl/⌘+F reaches the box while Settings is open.

async function openSettings(page: Page, title = "Settings") {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("in English", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
  });

  test("lists matches by page and goes to the one picked with Enter", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const box = dialog.getByRole("combobox", { name: "Search settings" });
    await box.fill("zen");
    const results = dialog.getByRole("listbox", { name: "Search results" });
    await expect(
      results.getByRole("group", { name: "Editor & Appearance" }),
    ).toContainText("Zen Mode");
    // Its shortcut, on a page of its own.
    await expect(
      results.getByRole("group", { name: "Shortcuts" }),
    ).toContainText("Toggle zen mode");
    await expect(box).toHaveAttribute(
      "aria-activedescendant",
      (await results.getByRole("option").first().getAttribute("id")) ?? "",
    );

    await box.press("Enter");
    await expect(box).toHaveValue("");
    const region = dialog.getByRole("region", { name: "Editor & Appearance" });
    await expect(region).toBeVisible();
    const zen = region.getByRole("checkbox", { name: "Zen Mode" });
    await expect(zen).toBeFocused();
    await expect(
      region.locator(".settings-search-hit", { hasText: "Zen Mode" }),
    ).toHaveCount(1);
  });

  test("finds a row by its ? text and a row on a subpage", async ({ page }) => {
    const dialog = await openSettings(page);
    const box = dialog.getByRole("combobox", { name: "Search settings" });
    await box.fill("LAYS DIAGRAMS");
    const results = dialog.getByRole("listbox", { name: "Search results" });
    await expect(results.getByRole("option")).toHaveCount(1);
    await expect(results.getByRole("option")).toContainText("Diagram engine");

    await box.fill("custom css");
    const more = results.getByRole("group", {
      name: "Editor & Appearance › More themes",
    });
    await more.getByRole("option", { name: /Custom CSS/ }).click();
    await expect(
      dialog.getByRole("region", { name: "More themes" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Custom CSS" }),
    ).toBeFocused();
  });

  test("↑/↓ move through the results, across pages", async ({ page }) => {
    const dialog = await openSettings(page);
    const box = dialog.getByRole("combobox", { name: "Search settings" });
    await box.fill("tab");
    const options = dialog.getByRole("option");
    await expect(options.nth(1)).toBeVisible();
    await box.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await box.press("ArrowUp");
    await box.press("ArrowUp");
    await expect(options.last()).toHaveAttribute("aria-selected", "true");
  });

  test("Esc clears the box, and the next Esc closes Settings", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const box = dialog.getByRole("combobox", { name: "Search settings" });
    await box.fill("nothing like this");
    await expect(dialog.getByRole("status")).toHaveText("No settings match.");
    await box.press("Escape");
    await expect(box).toHaveValue("");
    await expect(dialog.getByRole("region", { name: "General" })).toBeVisible();
    await box.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Ctrl/⌘+F goes to the box while Settings is open, not to the document's find bar", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Privacy" }).click();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(
      dialog.getByRole("combobox", { name: "Search settings" }),
    ).toBeFocused();
    await expect(page.locator(".find-replace-bar")).toHaveCount(0);
  });
});

test.describe("in Chinese", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { settings: { language: "zh" } });
  });

  test("finds Chinese labels, and full-width letters as half-width", async ({
    page,
  }) => {
    const dialog = await openSettings(page, "设置");
    const box = dialog.getByRole("combobox", { name: "搜索设置" });
    await box.fill("标签页");
    const results = dialog.getByRole("listbox", { name: "搜索结果" });
    await expect(results.getByRole("group", { name: "快捷键" })).toContainText(
      "下一个标签页",
    );

    await box.fill("ＣＳＳ");
    await expect(
      results.getByRole("group", { name: "编辑与外观 › 更多主题" }),
    ).toContainText("自定义 CSS");

    await box.fill("画图更快");
    await results.getByRole("option", { name: /图表引擎/ }).click();
    await expect(
      dialog.getByRole("region", { name: "编辑与外观" }),
    ).toBeVisible();
    await expect(
      dialog.locator(".settings-search-hit", { hasText: "图表引擎" }),
    ).toHaveCount(1);
  });

  test("says so when nothing matches", async ({ page }) => {
    const dialog = await openSettings(page, "设置");
    await dialog
      .getByRole("combobox", { name: "搜索设置" })
      .fill("不存在的设置");
    await expect(dialog.getByRole("status")).toHaveText("没有匹配的设置。");
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("the box sits above the tabs and leads to the row", async ({ page }) => {
    await openPhone(page, { settings: { language: "en" } });
    const dialog = await openSettings(page);
    const box = dialog.getByRole("combobox", { name: "Search settings" });
    await box.fill("typewriter");
    await dialog
      .getByRole("option", { name: /Typewriter Mode/ })
      .first()
      .click();
    await expect(
      dialog.getByRole("checkbox", { name: "Typewriter Mode" }),
    ).toBeInViewport();
  });
});
