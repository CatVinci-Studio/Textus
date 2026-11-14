import { expect, test } from "@playwright/test";
import { emit, openApp } from "./helpers";

// The first-run tour: each step lights a part of the window, which stays
// usable through the hole, and doing what it asks moves the tour on.

test("the tour walks the window, moving on as each thing is done", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page);
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
  for (let i = 0; i < 4; i++) await primary.click();
  await expect(title).toHaveText("设置");
  await primary.click();

  // Typing Markdown in the practice tab moves on by itself.
  await expect(title).toHaveText("所见即所得");
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("# 标题");
  await expect(title).toHaveText("Textus AI");

  // Not signed in: the AI's own panel asks; skipping goes to the end.
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(title).toHaveText("登录 AI");
  await page.getByRole("button", { name: "暂时跳过" }).click();
  await expect(title).toHaveText("准备好了");
  await primary.click();
  await expect(page.locator(".tour-layer")).toHaveCount(0);
});
