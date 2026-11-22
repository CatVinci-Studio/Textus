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

test("custom endpoints are added, each with its name and model, and removed", async ({
  page,
}) => {
  await openApp(page, { settings: { textusAi: true } });
  await page.evaluate(() => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      { fetch_custom_models: ["gpt-6.1-sol", "gpt-6.1-luna"] };
    window.dispatchEvent(
      new CustomEvent("textus:open-settings-page", {
        detail: { page: "providers" },
      }),
    );
  });
  const list = page.locator(".providers-list");
  const panel = page.locator(".providers-detail");
  const saved = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __devStorage: {
              customEndpoints: { id: string; name: string; model: string }[];
            };
          }
        ).__devStorage.customEndpoints,
    );
  await list.getByRole("button", { name: "添加自定义接口" }).click();
  await panel.getByRole("textbox", { name: "名称" }).fill("中转 A");
  await panel
    .getByRole("textbox", { name: "接口地址" })
    .fill("http://relay-a.test/v1");
  await panel.getByRole("textbox", { name: "模型" }).fill("6.1sol");
  // Reached is not enough: a model the endpoint doesn't list fails the test.
  await panel.getByRole("button", { name: "测试连接" }).click();
  await expect(panel.locator(".settings-error")).toContainText("6.1sol");
  const model = panel.getByRole("combobox", { name: "模型" });
  await model.click();
  await page.getByRole("option", { name: "gpt-6.1-luna" }).click();
  await panel.getByRole("button", { name: "测试连接" }).click();
  await expect(panel.locator(".settings-success")).toBeVisible();
  await panel.getByRole("button", { name: "保存" }).click();
  await expect(list.getByRole("button", { name: "中转 A" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // A second relay serving the same models, chosen apart by its name.
  await list.getByRole("button", { name: "添加自定义接口" }).click();
  await panel.getByRole("textbox", { name: "名称" }).fill("中转 B");
  await panel
    .getByRole("textbox", { name: "接口地址" })
    .fill("http://relay-b.test/v1");
  await panel.getByRole("button", { name: "获取模型列表" }).click();
  await panel.getByRole("button", { name: "保存" }).click();
  await expect(list.getByRole("button", { name: "中转 B" })).toBeVisible();
  expect(await saved()).toMatchObject([
    { name: "中转 A", model: "gpt-6.1-luna" },
    { name: "中转 B", model: "gpt-6.1-sol" },
  ]);
  const chatProvider = page.getByRole("combobox", { name: "对话用的服务商" });
  await chatProvider.click();
  await page.getByRole("option", { name: "中转 B" }).click();
  await expect(chatProvider).toContainText("中转 B");
  // Removed, it leaves the lists and the chat no longer points at it.
  await list.getByRole("button", { name: "中转 B" }).click();
  await panel.getByRole("button", { name: "移除" }).click();
  await page.locator(".app-dialog .close-prompt-primary").click();
  await expect(list.getByRole("button", { name: "中转 B" })).toHaveCount(0);
  expect(await saved()).toMatchObject([{ name: "中转 A" }]);
  await expect(chatProvider).not.toContainText("中转 B");
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

test("the classic look turns on in one switch, and off gives back the look before it", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-settings");
  await page.getByRole("button", { name: "外观" }).first().click();
  const classic = page.getByRole("switch", { name: "使用旧版本样式" });
  const rail = page.getByRole("switch", { name: "显示左侧图标栏" });
  const titleRow = page.getByRole("switch", { name: "标题栏单独一行显示" });
  const layout = page.getByRole("combobox", { name: "布局" });
  await expect(classic).not.toBeChecked();
  await titleRow.click();
  await classic.click();
  await expect(classic).toBeChecked();
  await expect(layout).toContainText("经典");
  // The rail itself still shows while the sidebar is open.
  await expect(rail).not.toBeChecked();
  await expect(titleRow).toBeChecked();
  await classic.click();
  await expect(classic).not.toBeChecked();
  await expect(layout).toContainText("浮动岛");
  await expect(rail).toBeChecked();
  // The title row was on before: it stays on.
  await expect(titleRow).toBeChecked();
});

test("custom CSS is written from the installed themes' ⋯", async ({ page }) => {
  await open(page);
  await emit(page, "menu-settings");
  await page.getByRole("button", { name: "外观" }).first().click();
  await expect(page.locator(".settings-tab-page textarea")).toHaveCount(0);
  await page
    .getByRole("region", { name: "已安装主题" })
    .locator(".extensions-more button")
    .click();
  await page.getByRole("menuitem", { name: "自定义 CSS…" }).click();
  const dialog = page.getByRole("dialog", { name: "自定义 CSS" });
  await dialog.getByRole("textbox").fill("#write { letter-spacing: 1px; }");
  await dialog.getByRole("button", { name: "完成" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll("style")].some((s) =>
          s.textContent?.includes("letter-spacing: 1px"),
        ),
      ),
    )
    .toBe(true);
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

test("changing what one tilde reads as redraws an edited document, its text kept", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "H~2~O and 5~10人");
  const doc = page.locator(".milkdown .ProseMirror").first();
  await expect(doc.locator("sub")).toHaveText("2");
  await emit(page, "menu-settings");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("textus:open-settings-page", {
        detail: { page: "edit-text" },
      }),
    ),
  );
  await page.getByLabel("单个波浪线 ~文字~").click();
  await page.getByRole("option", { name: "原样显示" }).click();
  await tabs(page).first().click();
  await expect(doc.locator("sub")).toHaveCount(0);
  await expect(doc).toContainText("H~2~O and 5~10人");
});

test("one newline in a paragraph breaks the line once the setting says so, its text kept", async ({
  page,
}) => {
  await open(page);
  // From a file: a paste would make two paragraphs of the two lines.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown> & {
      __devEmitTauriEvent: (name: string, payload: unknown) => void;
    };
    w.__devFiles = { "/notes/lines.md": "one\ntwo" };
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/notes/lines.md"],
      position: { x: 0, y: 0 },
    });
  });
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(doc).toContainText("one two");
  const soft = doc.locator('[data-type="hardbreak"][data-is-inline="true"]');
  const drawn = () =>
    soft.evaluate((el) => getComputedStyle(el, "::after").content);
  await expect(soft).toHaveCount(1);
  await expect(doc).not.toHaveAttribute("data-line-breaks");
  expect(await drawn()).toBe("none");
  await emit(page, "menu-settings");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("textus:open-settings-page", {
        detail: { page: "edit-text" },
      }),
    ),
  );
  await page.getByLabel("段落中的单个换行").click();
  await page.getByRole("option", { name: "换行", exact: true }).click();
  await tabs(page).filter({ hasText: "lines" }).click();
  await expect(doc).toHaveAttribute("data-line-breaks", "");
  expect(await drawn()).not.toBe("none");
  await expect(doc).toContainText("one two");
});

test("Make your theme opens the theme workshop in a tab of its own, filled, with the AI on or off", async ({
  page,
}) => {
  for (const textusAi of [true, false]) {
    await page.setViewportSize({ width: 1200, height: 760 });
    await openApp(page, { settings: { menuBarShown: false, textusAi } });
    await emit(page, "menu-settings");
    await page.locator(".sidebar").getByText("外观").first().click();
    await page.getByText("制作你的主题").first().click();
    await expect(page.locator(".theme-workshop")).toBeVisible();
    const box = await page.locator(".theme-workshop-studio").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(400);
  }
});

test("the margin views are offered as the document behind Settings has room for, not as its hidden page measures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  // An edited draft stays mounted, out of sight, behind the Settings tab.
  await pasteMarkdown(page, "# 第一章");
  await emit(page, "menu-settings");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("textus:open-settings-page", {
        detail: { page: "chat" },
      }),
    ),
  );
  await page.getByRole("combobox", { name: "修订显示方式" }).click();
  const list = page.getByRole("listbox", { name: "修订显示方式" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await expect(list.getByRole("option", { disabled: true })).toHaveCount(0);
});
