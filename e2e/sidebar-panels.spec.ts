import { expect, test, type Page } from "@playwright/test";
import { MAC, emit, expectNear, openApp, pasteMarkdown } from "./helpers";

// Sidebar panels: the name on the window bar's line, the search on the
// second row level with the islands' top; the plugin list opens a plugin's
// page in a tab of its own.

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
}

const top = async (page: Page, selector: string) =>
  (await page.locator(selector).first().boundingBox())!.y;

for (const panel of ["settings", "manage-plugins"]) {
  test(`${panel}: the search row is level with the islands' top`, async ({
    page,
  }) => {
    await open(page);
    await emit(
      page,
      panel === "settings" ? "menu-open-settings" : "menu-manage-plugins",
    );
    const row = await top(page, ".sidebar .tx-pane-row");
    const sheet = await top(page, "section.island");
    expectNear(row, sheet, 1);
  });
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
