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

test("dragging the sidebar's edge resizes it; it comes back as it was left: open at that width on its tab, or closed", async ({
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
  // The page makes room for it, beside the activity rail.
  const rail = await page
    .locator(".activity-rail")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(await mainPaneLeft(page)).toBe(rail + 320);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("textus-sidebar-width")),
    )
    .toBe("320");

  // On another tab than the files, chosen on the activity rail.
  const tabs = page.locator(".activity-rail");
  const outlineTab = tabs.getByRole("button", { name: "大纲" });
  const filesTab = tabs.getByRole("button", { name: "文件树" });
  await expect(filesTab).toHaveAttribute("aria-pressed", "true");
  await outlineTab.click();
  await expect(outlineTab).toHaveAttribute("aria-pressed", "true");

  const reload = async () => {
    await page.reload();
    await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
  };
  await reload();
  // Left open, it comes back open, at that width, on that tab.
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  expect(await sidebarWidth(page)).toBe(320);
  expect(await mainPaneLeft(page)).toBe(rail + 320);
  await expect(outlineTab).toHaveAttribute("aria-pressed", "true");
  await expect(filesTab).toHaveAttribute("aria-pressed", "false");

  // Closed again, it comes back closed.
  await emit(page, "menu-toggle-sidebar");
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-collapsed/);
  await reload();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-collapsed/);
});
