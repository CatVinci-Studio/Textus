import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

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
  await emit(page, "menu-settings");
  await expect(tabs(page)).toHaveText(["未命名", "设置：通用"]);
  await expect(sidebarTitle(page)).toHaveText("设置");
  await expect(gear(page)).toHaveAttribute("aria-pressed", "true");
  await gear(page).click();
  await expect(gear(page)).toHaveAttribute("aria-pressed", "false");
  await expect(tabs(page)).toHaveText(["未命名", "设置：通用"]);
  await gear(page).click();
  await expect(sidebarTitle(page)).toHaveText("设置");
  // Open: ⌘, brings it forward where it was. Closed: back at General.
  await page.getByRole("button", { name: "外观" }).first().click();
  await expect(tabs(page).nth(1)).toHaveText("设置：外观");
  await tabs(page).first().click();
  await emit(page, "menu-settings");
  await expect(tabs(page).nth(1)).toHaveText("设置：外观");
  await emit(page, "menu-close-tab");
  await expect(tabs(page)).toHaveText(["未命名"]);
  await emit(page, "menu-settings");
  await expect(tabs(page)).toHaveText(["未命名", "设置：通用"]);
});

test("every page draws, in the one tab, without an error", async ({ page }) => {
  const errors = await open(page);
  await emit(page, "menu-settings");
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
  await emit(page, "menu-settings");
  const nav = page.locator(".sidebar");
  await expect(nav.getByText("图片", { exact: true })).toHaveCount(0);
  await nav.getByText("编辑", { exact: true }).click();
  await nav.getByText("图片", { exact: true }).click();
  await expect(nav.getByText("图片", { exact: true })).toBeVisible();
});

test("Check for Updates opens About, its licenses a read-only document; a plugin's settings open its page's tab", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-check-updates");
  await expect(page.locator(".settings-about-card-icon")).toBeVisible();
  await page.getByRole("button", { name: "开源许可" }).click();
  await expect(tabs(page).last()).toContainText("开源许可");
  const licenses = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(licenses.locator("h1")).toHaveText("Open-source licenses");
  await expect(licenses).toHaveAttribute("contenteditable", "false");
  await emit(page, "menu-check-updates");
  await emit(page, "menu-plugin-command", "plugin-settings:cloud-sync");
  await expect(tabs(page).last()).toContainText("插件：");
  await emit(page, "menu-manage-plugins");
  await expect(sidebarTitle(page)).toHaveText("插件");
});

test("the list's last item goes to the plugins panel", async ({ page }) => {
  await open(page);
  await emit(page, "menu-settings");
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
  // In a grid of cards, the store's beside it.
  await expect(mine.locator("..")).toHaveCSS("display", "grid");
});

test("first-line indent sets in the document's paragraphs, not a list's", async ({
  page,
}) => {
  await openApp(page, { settings: { firstLineIndent: true } });
  await pasteMarkdown(page, "One.\n\nTwo.\n\n- item\n");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const indent = (sel: string) =>
    editor
      .locator(sel)
      .first()
      .evaluate((e) => parseFloat(getComputedStyle(e).textIndent));
  await expect.poll(() => indent(":scope > p")).toBeGreaterThan(0);
  expect(await indent("li p")).toBe(0);
});

test("a custom endpoint's model is picked from its list, and a name it lacks fails the test", async ({
  page,
}) => {
  await openApp(page, { settings: { textusAi: true, aiProvider: "custom" } });
  await page.evaluate(() => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      {
        custom_endpoint_status: {
          base_url: "http://relay.test/v1",
          api_key: null,
          has_api_key: true,
          model: "6.1sol",
        },
        fetch_custom_models: ["gpt-6.1-sol", "gpt-6.1-luna"],
        set_custom_endpoint: null,
      };
    window.dispatchEvent(
      new CustomEvent("textus:open-settings-page", {
        detail: { page: "providers" },
      }),
    );
  });
  const panel = page.locator(".providers-detail");
  await panel.getByRole("button", { name: "测试连接" }).click();
  await expect(panel.locator(".settings-error")).toContainText("6.1sol");
  // The list is now the model's choices, here and in the model pickers.
  const model = panel.getByRole("combobox", { name: "模型" });
  await model.click();
  await page.getByRole("option", { name: "gpt-6.1-luna" }).click();
  await panel.getByRole("button", { name: "测试连接" }).click();
  await expect(panel.locator(".settings-success")).toBeVisible();
  await panel.getByRole("button", { name: "保存" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (window as unknown as { __devInvokeCalls: { cmd: string }[] })
            .__devInvokeCalls ?? []
        ).find((c) => c.cmd === "set_custom_endpoint"),
      ),
    )
    .toMatchObject({ model: "gpt-6.1-luna" });
});

test("the search reads the pages once its box is focused, before the first letter", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-settings");
  const box = page.locator(".settings-nav-panel input").first();
  const index = page.locator(".settings-search-index");
  await expect(index).toHaveCount(0);
  await box.focus();
  // Read before the first letter, so typing finds it ready.
  await expect(index).toHaveCount(1);
  await box.pressSequentially("字体", { delay: 30 });
  await expect(page.locator(".settings-nav-hit").first()).toBeVisible();
  await box.fill("");
  await box.blur();
  await expect(index).toHaveCount(0);
});

test("Layout switched in Settings lays the islands out again at once", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-settings");
  await page.getByRole("button", { name: "外观" }).first().click();
  await expect(page.locator(".settings-group-note")).toContainText("经典");
  const sidebar = page.locator(".sidebar");
  const island = page.locator("section.island").first();
  const gap = async () =>
    (await island.boundingBox())!.x -
    ((await sidebar.boundingBox())!.x + (await sidebar.boundingBox())!.width);
  expect(await gap()).toBeGreaterThan(4);
  await page.getByRole("combobox", { name: "布局" }).click();
  await page.getByRole("option", { name: "经典" }).click();
  // Flush against the sidebar, with no island gap left over.
  await expect.poll(gap).toBeLessThanOrEqual(1);
});

test("a tab brought to the front by a click takes the focus without the keyboard's ring", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-settings");
  await tabs(page).first().click();
  await tabs(page).first().locator(".tab-pill-close").click();
  await expect(tabs(page)).toHaveText(["设置：通用"]);
  const pill = tabs(page).first();
  await expect(pill).toBeFocused();
  expect(await pill.evaluate((el) => el.matches(":focus-visible"))).toBe(false);
});

test("Make your theme opens Create in a tab of its own, filled, with the AI on or off", async ({
  page,
}) => {
  for (const textusAi of [true, false]) {
    await page.setViewportSize({ width: 1200, height: 760 });
    await openApp(page, { settings: { menuBarShown: false, textusAi } });
    await emit(page, "menu-settings");
    await page.locator(".sidebar").getByText("外观").first().click();
    await page.getByText("制作你的主题").first().click();
    await expect(page.locator(".create-studio-title")).toBeVisible();
    const box = await page.locator(".create-studio").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(400);
  }
});
