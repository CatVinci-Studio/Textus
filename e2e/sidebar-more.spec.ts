import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/** Plugin tabs that don't fit the sidebar's width go under More. */

type Api = {
  sidebarTabs: {
    register: (t: {
      id: string;
      label: () => string;
      Icon: () => string;
      Panel: () => null;
    }) => () => void;
  };
};

test("tabs past the sidebar's width go under More, the one shown keeps its button", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.waitForFunction(
    () => !!(window as unknown as { __textusPlugins?: Api }).__textusPlugins,
  );
  await page.evaluate(() => {
    const { sidebarTabs } = (window as unknown as { __textusPlugins: Api })
      .__textusPlugins;
    for (const n of [1, 2, 3, 4, 5, 6])
      sidebarTabs.register({
        id: `example-${n}`,
        label: () => `Example ${n}`,
        Icon: () => String(n),
        Panel: () => null,
      });
  });
  await page.keyboard.press("ControlOrMeta+\\");
  const more = page.locator('.sidebar-tab[aria-label="More"]');
  await expect(more).toBeVisible();
  const tabs = page.locator(".sidebar-tabs .sidebar-tab");
  const width = await page
    .locator(".sidebar-tabs")
    .evaluate((el) => el.clientWidth);
  expect(await tabs.count()).toBe(Math.floor(width / 30));

  await more.click();
  await page.getByRole("menuitem", { name: "Example 6" }).click();
  const shown = page.locator('.sidebar-tab[aria-label="Example 6"]');
  await expect(shown).toHaveClass(/sidebar-tab-active/);
  await expect(more).toBeVisible();
});
