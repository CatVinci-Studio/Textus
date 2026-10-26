import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/** A plugin's settings of every kind on its page. */

const HOST = `
exports.activate = function () {
  textus.commands.register("test.kinds.rebuild", async function () {
    var words = await textus.settings.get("words");
    textus.ui.notice("Rebuilt with " + words.length + " words");
  });
};
`;

const ENTRY = {
  id: "test.kinds",
  dir: "/plugins/test.kinds",
  manifest: JSON.stringify({
    id: "test.kinds",
    name: "Kinds",
    version: "1.0.0",
    publisher: "test",
    description: "Settings of every kind.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    contributes: {
      commands: [{ command: "test.kinds.rebuild", title: "Rebuild" }],
      settings: [
        {
          key: "legend",
          type: "boolean",
          default: false,
          title: "Legend",
          group: "Chart",
        },
        {
          key: "legendColor",
          type: "color",
          default: "#3366ff",
          title: "Legend colour",
          when: "legend",
        },
        {
          key: "height",
          type: "number",
          default: 300,
          min: 100,
          max: 800,
          title: "Height",
        },
        {
          key: "words",
          type: "list",
          default: ["alpha"],
          title: "Words",
          group: "Words",
        },
        {
          key: "rebuild",
          type: "button",
          command: "test.kinds.rebuild",
          title: "Rebuild index",
        },
      ],
    },
  }),
  dev: false,
  files: { "host.js": HOST },
};

test("a plugin's settings of every kind", async ({ page }) => {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: [] } },
    };
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-manage-plugins"),
  );
  await page
    .locator('.plugin-card[data-plugin="test.kinds"] .plugin-card-open')
    .click();
  const own = page.locator('[data-plugin-page="test.kinds"]');

  // Two groups, each heading once.
  await expect(own.locator(".plugin-setting-group")).toHaveText([
    "Chart",
    "Words",
  ]);
  // The colour shows only while the legend is on.
  const color = own.getByLabel("Legend colour");
  await expect(color).toHaveCount(0);
  await own.getByText("Legend", { exact: true }).click();
  await expect(color).toHaveValue("#3366ff");

  // A number past its bounds is kept within them.
  const height = own.getByLabel("Height");
  await height.fill("5000");
  await height.blur();
  await expect(height).toHaveValue("800");

  // A list is a line each; the plugin gets the list.
  const words = own.getByLabel("Words");
  await expect(words).toHaveValue("alpha");
  await words.fill("alpha\n\nbeta\n gamma ");
  await words.blur();
  await own.getByRole("button", { name: "Rebuild index" }).click();
  await expect(
    page.locator(".app-notice, [role=status]").first(),
  ).toContainText("Rebuilt with 3 words");
});
