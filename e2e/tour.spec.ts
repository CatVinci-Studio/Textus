import { expect, test } from "@playwright/test";
import { emit, openApp } from "./helpers";

// The first-run tour: each step lights a part of the window, which stays
// usable through the hole, and doing what it asks moves the tour on.

test("the tour walks the window, moving on as each thing is done", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  // From the Start page, with no document open: the tour brings its own.
  await openApp(page, {
    settings: { startPageOnLaunch: true, restoreSessionOnStartup: false },
    ready: ".activity-rail",
  });
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toHaveCount(0);
  await emit(page, "menu-open-help", "welcome");

  const title = page.locator(".tour-title");
  const primary = page.locator(".tour-card .tx-button.primary");
  await expect(title).toHaveText("欢迎使用 Textus");
  await primary.click();

  // The sidebar opens through the hole, from the rail's own button.
  await expect(title).toHaveText(/侧边栏/);
  if ((await title.textContent()) === "侧边栏")
    await page.locator('.activity-rail [data-rail-id="tree"]').click();
  await expect(title).toHaveText("侧边栏里有什么");
  await expect(page.locator(".tour-ring")).toBeVisible();
  // The card sits past the open sidebar, its files in sight.
  const side = await page.locator("aside.sidebar").boundingBox();
  // Placed again once the sidebar has its width.
  await expect
    .poll(async () => (await page.locator(".tour-card").boundingBox())!.x)
    .toBeGreaterThanOrEqual(side!.x + side!.width);
  // Each rail button is lit alone and opens its own panel.
  for (const id of ["tree", "outline", "search", "plugins"]) {
    const button = page.locator(`.activity-rail [data-rail-id="${id}"]`);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const ring = (await page.locator(".tour-ring").boundingBox())!;
    expect(ring.height).toBeLessThan(80);
    await primary.click();
  }
  await primary.click();
  await expect(title).toHaveText("设置");
  await primary.click();

  // Typing Markdown in the practice tab moves on by itself.
  // The practice document comes to the front, ready to type in.
  await expect(title).toHaveText("所见即所得");
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toBeFocused();
  // Each kind of Markdown is ticked off as it is typed; all four move on.
  const done = page.locator(".tour-tasks > li[data-done]");
  await page.keyboard.type("# 标题");
  await page.keyboard.press("Enter");
  await expect(done).toHaveCount(1);
  await page.keyboard.type("- 牛奶");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(done).toHaveCount(2);
  await page.keyboard.type("1. 第一步");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(done).toHaveCount(3);
  await page.keyboard.type("- [ ] 回电话");
  await expect(title).toHaveText("Textus AI");

  // Not signed in: the AI's own panel asks; skipping goes to the end.
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(title).toHaveText("登录 AI");
  await page.getByRole("button", { name: "暂时跳过" }).click();
  await expect(title).toHaveText("准备好了");
  await primary.click();
  await expect(page.locator(".tour-layer")).toHaveCount(0);
});
