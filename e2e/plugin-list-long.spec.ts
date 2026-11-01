import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";
import { openSidebarList } from "./plugin-helpers";

/**
 * A plugin's list of thousands of items (a big folder's tasks) draws a page
 * of rows at a time, the rest as it is scrolled to.
 */

const HOST = `
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.views.registerList("test.long.panel", {
      items: () =>
        Array.from({ length: 5000 }, (_, i) => ({
          id: "t" + i,
          label: "Task " + (i + 1),
          checkbox: false,
        })),
    }),
  );
};
`;

test("a list of thousands of items draws a page at a time", async ({
  page,
}) => {
  await page.addInitScript((host) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [
      {
        id: "test.long",
        dir: "/plugins/test.long",
        manifest: JSON.stringify({
          id: "test.long",
          name: "Long",
          version: "1.0.0",
          publisher: "test",
          description: "Lists five thousand tasks.",
          engines: { textus: "^1.3.0" },
          main: "host.js",
          contributes: {
            sidebarTabs: [
              { id: "test.long.panel", title: "Long list", type: "list" },
            ],
          },
        }),
        dev: false,
        files: { "host.js": host },
      },
    ];
    w.__devPluginState = {
      allOn: true,
      plugins: { "test.long": { enabled: true, granted: [] } },
    };
  }, HOST);
  await openApp(page, { settings: { language: "en" } });
  const list = await openSidebarList(page, "Long list");
  const rows = list.getByRole("treeitem");
  await expect(rows.first()).toHaveText("Task 1");
  const first = await rows.count();
  expect(first).toBeLessThan(500);
  // Scrolled to its end, the next page comes, and so on to the last.
  for (let i = 0; i < 40 && (await rows.count()) < 5000; i++) {
    await rows.last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await expect(list.getByText("Task 5000", { exact: true })).toBeAttached();
  expect(await rows.count()).toBe(5000);
});
