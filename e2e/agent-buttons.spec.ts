import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";
import { openPath } from "./plugin-helpers";

// An outside agent a plugin brings (contributes.agents) has its button at
// the window bar's end, beside Textus AI's: a press starts a conversation
// with it, in a tab of its own.

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor"/></svg>';

const manifest = {
  id: "example.agent",
  name: "Example Agent",
  version: "0.1.0",
  publisher: "example",
  engines: { textus: ">=1.3.12" },
  icon: "icon.svg",
  main: "host.js",
  permissions: ["agents"],
  contributes: {
    statusItems: [{ id: "path", text: "Study › Dissertation_Committee" }],
    agents: [
      {
        id: "example.agent.coder",
        name: "Coder",
        command: "coder-acp",
        args: [],
      },
    ],
  },
};

test("an outside agent's button starts a conversation with it, each press a new one", async ({
  page,
}) => {
  await page.addInitScript(
    ({ manifest, icon }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: `/plugins/${manifest.id}`,
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "icon.svg": icon, "host.js": "" },
        },
      ];
      w.__devFs = { "/work/a.md": "# A\n" };
      w.__devPluginState = {
        allOn: true,
        plugins: {
          [manifest.id]: { enabled: true, granted: manifest.permissions },
        },
      };
    },
    { manifest, icon: ICON },
  );
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  // A document's conversations are kept with it: a place for several.
  await openPath(page, "/work/a.md");
  const agent = page.getByRole("button", { name: "Coder" });
  await expect(agent).toBeVisible();
  // Before Textus AI's own button.
  const ai = page.getByRole("button", { name: "Textus AI" }).first();
  expect((await agent.boundingBox())!.x).toBeLessThan(
    (await ai.boundingBox())!.x,
  );
  await agent.click();
  await expect(page.locator(".ai-tab")).toBeVisible();
  // Named for who answers; Textus AI's own button isn't lit beside it.
  const coder = page.locator(".tab-pill", { hasText: "Coder" });
  await expect(coder).toHaveCount(1);
  await expect(ai).toHaveAttribute("aria-pressed", "false");
  // Pressed again: another conversation with it, beside the first.
  await agent.click();
  await expect(coder).toHaveCount(2);
  // Short of room, the bar's status gives way to its icon before the tabs
  // under it lose theirs: nothing laid over them.
  const bar = page.locator(".window-bar");
  const status = page.locator(".plugin-status-item").first();
  await expect(bar).not.toHaveAttribute("data-fit", /status|agents/);
  // Less than a tab's room left beside the status: it gives way.
  await page.setViewportSize({ width: 440, height: 760 });
  await expect(bar).toHaveAttribute("data-fit", /status|agents/);
  await expect(status.locator(".plugin-status-text")).toBeHidden();
  // The tab in front ends before the status starts.
  const frontTab = page.locator('.tab-pill[aria-selected="true"]').first();
  await expect
    .poll(async () => {
      const tab = await frontTab.boundingBox();
      const shown = await status.boundingBox();
      return tab && shown ? shown.x - (tab.x + tab.width) : -1;
    })
    .toBeGreaterThanOrEqual(0);

  // Listed in Settings' External tools, Manage opening its plugin's page.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("textus:open-settings-page", { detail: { page: "mcp" } }),
    ),
  );
  const row = page.locator(".settings-row", { hasText: "Coder" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "管理" }).click();
  await expect(page.locator(".tab-pill", { hasText: "插件：" })).toBeVisible();
});
