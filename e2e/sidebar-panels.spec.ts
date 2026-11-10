import { expect, test, type Page } from "@playwright/test";
import { MAC, emit, expectNear, openApp, pasteMarkdown } from "./helpers";

// Sidebar panels: the plugin list opens a plugin's page in a tab of its
// own; the sidebar steps aside for the islands and widens by its edge.

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
}

test("a plugin in the list opens its page in a tab named for it", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-manage-plugins");
  const row = page.locator(".plugins-panel-row").first();
  await expect(row).toBeVisible();
  await row.locator(".plugins-panel-open").click();
  await expect(page.locator(".tab-pill").last()).toContainText("插件：");
  // Another plugin replaces it in the same tab.
  const count = await page.locator(".tab-pill").count();
  await page
    .locator(".plugins-panel-row")
    .nth(1)
    .locator(".plugins-panel-open")
    .click();
  await expect(page.locator(".tab-pill")).toHaveCount(count);
});

test("Select All in the second island selects that island's document", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "第一篇");
  await emit(page, "menu-split-right");
  const second = page.locator(".ProseMirror").nth(1);
  await expect(second).toBeVisible();
  await second.click();
  await page.keyboard.type("第二篇");
  await page.keyboard.press(MAC ? "Meta+A" : "Control+A");
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain("第二篇");
  expect(selected).not.toContain("第一篇");
});

test("too narrow for the sidebar and the islands at their least, the sidebar steps aside, and comes back with the room", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "# 第三章");
  const sidebar = page.locator(".sidebar");
  await emit(page, "menu-toggle-sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator("section.island")).toHaveCount(2);
  await page.setViewportSize({ width: 900, height: 760 });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await page.setViewportSize({ width: 1200, height: 760 });
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  // Opened by hand in a narrow window, it stays.
  await page.setViewportSize({ width: 900, height: 760 });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await emit(page, "menu-toggle-sidebar");
  await page.waitForTimeout(300);
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  // Opening the AI where it leaves too little room puts nothing away.
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator("section.island")).toHaveCount(1);
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator("section.island")).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
});

test("its edge dragged out, the sidebar shows whole at its new width and the islands make room", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-toggle-sidebar");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  await page.waitForTimeout(600);
  const edge = (await page.locator(".sidebar-resizer").boundingBox())!;
  const before = (await sidebar.boundingBox())!;
  const island = (await page.locator("section.island").first().boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 120, edge.y + edge.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = (await sidebar.boundingBox())!;
  expectNear(after.width, before.width + 120, 4);
  // Not clipped at the width it had.
  const clip = await sidebar.evaluate((el) => getComputedStyle(el).clipPath);
  expect(clip === "none" || clip === "").toBe(true);
  const moved = (await page.locator("section.island").first().boundingBox())!;
  expectNear(moved.x, island.x + 120, 4);
});
