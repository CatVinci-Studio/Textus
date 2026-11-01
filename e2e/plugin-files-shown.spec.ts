import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * What a plugin writes in the open folder shows in the sidebar, its
 * settings page is as tall as what it shows, and a setting of several
 * lines sits in a box, not a pill.
 */

const HOST = `
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.commands.register("test.sync.pull", async () => {
      const root = await textus.files.root();
      await textus.files.writeText(root + "/Pulled/from-cloud.md", "# Pulled\\n");
      await textus.files.writeText(root + "/top.md", "# Top\\n");
    }),
    textus.views.registerSettingsPage({
      resolve(view) {
        view.html =
          '<main><p>Top of the page</p><div style="height: 900px"></div>' +
          "<p>Bottom of the page</p></main>";
      },
    }),
  );
};
`;

const emit = (page: Page, event: string, payload?: unknown) =>
  page.evaluate(
    ([name, value]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, v?: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, value),
    [event, payload],
  );

async function open(page: Page) {
  await page.addInitScript((host) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [
      {
        id: "test.sync",
        dir: "/plugins/test.sync",
        manifest: JSON.stringify({
          id: "test.sync",
          name: "Sync",
          version: "1.0.0",
          publisher: "test",
          description: "Brings files down from elsewhere.",
          engines: { textus: "^1.3.0" },
          main: "host.js",
          activationEvents: ["*"],
          permissions: ["files.read", "files.write"],
          contributes: {
            commands: [{ command: "test.sync.pull", title: "Pull" }],
            settingsPage: { title: "Sync" },
            settings: [
              {
                key: "ignore",
                type: "string",
                title: "Ignore",
                multiline: true,
                default: "",
              },
            ],
          },
        }),
        dev: false,
        files: { "host.js": host },
      },
    ];
    w.__devPluginState = {
      allOn: true,
      plugins: {
        "test.sync": { enabled: true, granted: ["files.read", "files.write"] },
      },
    };
    w.__devFs = { "/work/notes/a.md": "# A\n" };
    w.__devPickFolder = "/work/notes";
  }, HOST);
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
}

test("files a plugin makes show in the sidebar, their folders left shut", async ({
  page,
}) => {
  await open(page);
  const tree = page.getByRole("tree", { name: "Files" });
  await expect(tree.getByText("a.md")).toBeVisible();
  await emit(page, "menu-plugin-command", "test.sync.pull");
  await expect(tree.getByText("top.md")).toBeVisible();
  const folder = tree.getByRole("treeitem", { name: "Pulled" });
  await expect(folder).toBeVisible();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
});

test("a plugin's settings page is as tall as its page, not a box to scroll", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-manage-plugins");
  await page
    .locator('.plugin-card[data-plugin="test.sync"] .plugin-card-open')
    .click();
  const frame = page.locator(".plugin-settings-page .plugin-webview-frame");
  await expect(
    page
      .frameLocator(".plugin-settings-page .plugin-webview-frame")
      .getByText("Bottom of the page"),
  ).toBeAttached();
  await expect
    .poll(async () => (await frame.boundingBox())?.height ?? 0)
    .toBeGreaterThan(900);
});

test("a setting of several lines is a box, not a pill", async ({ page }) => {
  await open(page);
  await emit(page, "menu-manage-plugins");
  await page
    .locator('.plugin-card[data-plugin="test.sync"] .plugin-card-open')
    .click();
  const box = page.getByRole("textbox", { name: "Ignore" });
  await expect(box).toBeVisible();
  const radius = await box.evaluate((el) =>
    parseFloat(getComputedStyle(el).borderTopLeftRadius),
  );
  expect(radius).toBeLessThan(20);
});
