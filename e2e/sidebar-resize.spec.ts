import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// The sidebar's width is the user's to drag (app/sidebar-width.ts,
// ui/ResizeHandle.tsx): it follows the handle, stays within its bounds,
// is remembered for the next window, and the keyboard can do the same.

async function openSidebar(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-toggle-sidebar"),
  );
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
  // Left open, it comes back open (#152).
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  expect(await sidebarWidth(page)).toBe(320);
  expect(await mainPaneLeft(page)).toBe(320);
});

test("the sidebar resizes from the keyboard within its bounds, and resets on a double click", async ({
  page,
}) => {
  await openApp(page);
  await openSidebar(page);
  const handle = page.getByRole("separator", { name: "调整侧边栏宽度" });
  await expect(handle).toHaveAttribute("aria-orientation", "vertical");
  await expect(handle).toHaveAttribute("aria-valuemin", "180");
  await expect(handle).toHaveAttribute("aria-valuemax", "480");

  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "280");
  expect(await sidebarWidth(page)).toBe(280);
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "260");
  expect(
    await page.evaluate(() => localStorage.getItem("textus-sidebar-width")),
  ).toBe("260");

  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "240");
  expect(await sidebarWidth(page)).toBe(240);

  // Nor can a drag take it past those bounds.
  await dragHandle(page, 900);
  // 480px at most (45% of this 1180px window would be more).
  expect(await sidebarWidth(page)).toBe(480);
  await dragHandle(page, -900);
  expect(await sidebarWidth(page)).toBe(180);
});

test("a remembered width too wide for a small window is narrowed to fit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await openApp(page, { storage: { "textus-sidebar-width": "460" } });
  await openSidebar(page);
  // 45% of 800px.
  expect(await sidebarWidth(page)).toBe(360);
  await page.setViewportSize({ width: 1300, height: 700 });
  await expect.poll(() => sidebarWidth(page)).toBe(460);
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
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (name: string) => void }
    ).__devEmitTauriEvent("menu-toggle-sidebar"),
  );
  await expect(page.locator(".sidebar")).toHaveClass(collapsed);
  await reload();
  await expect(page.locator(".sidebar")).toHaveClass(collapsed);
});
