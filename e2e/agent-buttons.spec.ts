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
