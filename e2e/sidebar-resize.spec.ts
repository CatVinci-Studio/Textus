import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

// The sidebar's width follows the handle, stays within its bounds, is
// remembered for the next window, and the keyboard can do the same.

async function openSidebar(page: Page) {
  await emit(page, "menu-toggle-sidebar");
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
}

const sidebarWidth = (page: Page) =>
  page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width);

const mainPaneLeft = (page: Page) =>
  page.locator(".main-pane").evaluate((el) => el.getBoundingClientRect().left);

/** Drags the handle's middle `dx` px sideways. */
async function dragHandle(page: Page, dx: number) {
  const box = (await page.locator(".sidebar-resizer").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

test("dragging the sidebar's edge resizes it, and it comes back open at that width", async ({
  page,
}) => {
  await openApp(page);
  await openSidebar(page);
  const handle = page.getByRole("separator", { name: "调整侧边栏宽度" });
  await expect(handle).toHaveAttribute("aria-valuenow", "240");
  expect(await sidebarWidth(page)).toBe(240);

  await dragHandle(page, 80);
  await expect(handle).toHaveAttribute("aria-valuenow", "320");
  expect(await sidebarWidth(page)).toBe(320);
  // The page makes room for it.
  expect(await mainPaneLeft(page)).toBe(320);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("textus-sidebar-width")),
    )
    .toBe("320");

  await page.reload();
  await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
  // Left open, it comes back open.
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  expect(await sidebarWidth(page)).toBe(320);
  expect(await mainPaneLeft(page)).toBe(320);
});

test("the sidebar comes back on the tab it was left on", async ({ page }) => {
  await openApp(page);
  await openSidebar(page);
  const tabs = page.locator(".sidebar-tabs");
  const outlineTab = tabs.getByRole("button", { name: "大纲" });
  const filesTab = tabs.getByRole("button", { name: "文件树" });
  await expect(filesTab).toHaveClass(/sidebar-tab-active/);
  await outlineTab.click();
  await expect(outlineTab).toHaveClass(/sidebar-tab-active/);

  await page.reload();
  await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  await expect(outlineTab).toHaveClass(/sidebar-tab-active/);
  await expect(filesTab).not.toHaveClass(/sidebar-tab-active/);
});

test("a sidebar closed again comes back closed", async ({ page }) => {
  const collapsed = /sidebar-collapsed/;
  const reload = async () => {
    await page.reload();
    await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
  };
  await openApp(page);
  await expect(page.locator(".sidebar")).toHaveClass(collapsed);
  // Left open, it comes back open: the first test checks that.
  await openSidebar(page);
  await emit(page, "menu-toggle-sidebar");
  await expect(page.locator(".sidebar")).toHaveClass(collapsed);
  await reload();
  await expect(page.locator(".sidebar")).toHaveClass(collapsed);
});
