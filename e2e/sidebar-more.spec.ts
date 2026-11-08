import { expect, test } from "@playwright/test";
import { dragWithMouse, openApp, swallowHtmlDrop } from "./helpers";

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

test("a tab dragged along the bar takes the place it is let go at", async ({
  page,
}) => {
  await swallowHtmlDrop(page);
  await openApp(page, { settings: { language: "en" } });
  await page.waitForFunction(
    () => !!(window as unknown as { __textusPlugins?: Api }).__textusPlugins,
  );
  await page.evaluate(() => {
    const { sidebarTabs } = (window as unknown as { __textusPlugins: Api })
      .__textusPlugins;
    sidebarTabs.register({
      id: "example-1",
      label: () => "Example 1",
      Icon: () => "1",
      Panel: () => null,
    });
  });
  await page.keyboard.press("ControlOrMeta+\\");
  const labels = () =>
    page
      .locator(".sidebar-tabs .sidebar-tab")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  const before = await labels();
  const tabs = page.locator(".sidebar-tabs .sidebar-tab");
  await dragWithMouse(page, tabs.last(), tabs.first(), -4);
  await expect
    .poll(labels)
    .toEqual([before[before.length - 1], ...before.slice(0, -1)]);
  // The release is no click: the dragged tab isn't shown.
  await expect(
    page.locator('.sidebar-tab[aria-label="Example 1"]'),
  ).not.toHaveClass(/sidebar-tab-active/);
});
