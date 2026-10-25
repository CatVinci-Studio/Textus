import { expect, test } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// The plugin skill's reply in the AI panel: "Install this plugin" under it
// installs the named files as a plugin and turns it on - asking for its
// permissions - with the conversation still in view; its command works and
// How to use opens its guide.

const manifest = (version: string) => ({
  id: "local.word-count",
  name: "Word Count",
  version,
  publisher: "local",
  description: "Counts the words of the document.",
  engines: { textus: "^1.3.0" },
  main: "host.js",
  permissions: ["editor.read"],
  contributes: {
    commands: [{ command: "local.word-count.count", title: "Count Words" }],
    menus: { "app/plugins": [{ command: "local.word-count.count" }] },
  },
});

const reply = (version: string) =>
  [
    "A command that counts the words of the document.",
    "",
    "```json textus-plugin.json",
    JSON.stringify(manifest(version), null, 2),
    "```",
    "",
    "```js host.js",
    "exports.activate = function () {",
    '  textus.commands.register("local.word-count.count", function () {',
    '    return textus.ui.message("Counted from ' + version + '");',
    "  });",
    "};",
    "```",
    "",
    "```markdown USAGE.md",
    "# Word Count",
    "",
    "Run Plugins › Count Words.",
    "```",
  ].join("\n");

const count = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-plugin-command", "local.word-count.count"),
  );

async function ask(page: import("@playwright/test").Page, version: string) {
  const message = "/plugin a command that counts words";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: message },
      { kind: "Assistant", text: reply(version) },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");
}

test("Install this plugin installs the reply's plugin and turns it on", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await ask(page, "1.0.0");

  const chip = page.locator(
    '.agent-plugin-chip[data-plugin="local.word-count"]',
  );
  await expect(chip).toContainText("Word Count");
  await expect(chip.locator(".agent-plugin-permissions")).toContainText(
    "Read the document",
  );
  await chip.getByRole("button", { name: "Install this plugin" }).click();
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("Word Count asks to:");
  await dialog.getByRole("button", { name: "Allow" }).click();

  await expect(chip.getByRole("button", { name: "Installed" })).toBeDisabled();

  await count(page);
  await expect(page.getByText("Counted from 1.0.0")).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();

  // A later reply with the plugin at another version offers Update.
  await ask(page, "1.0.1");
  const next = page.locator(".agent-plugin-chip").last();
  await next.getByRole("button", { name: "Update the plugin" }).click();
  await expect(next.getByRole("button", { name: "Installed" })).toBeDisabled();
  await expect
    .poll(async () => {
      await count(page);
      const shown = await page
        .getByText("Counted from 1.0.1")
        .isVisible()
        .catch(() => false);
      if (!shown)
        await page
          .getByRole("button", { name: "OK" })
          .click({ timeout: 500 })
          .catch(() => {});
      return shown;
    })
    .toBe(true);
  await page.getByRole("button", { name: "OK" }).click();

  await next.getByRole("button", { name: "How to use" }).click();
  const guide = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(guide.locator("h1")).toContainText("Word Count");
  await expect(guide).toContainText("Count Words");
});

test("a plugin's page asks the AI to change it, in Create mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [
      {
        id: "local.word-count",
        dir: "/plugins/local.word-count",
        manifest: JSON.stringify({
          id: "local.word-count",
          name: "Word Count",
          version: "1.0.0",
          publisher: "local",
          description: "Counts words.",
          engines: { textus: "^1.3.0" },
          main: "host.js",
        }),
        dev: false,
        files: { "host.js": "exports.activate = function () {};" },
      },
    ];
  });
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-manage-plugins"),
  );
  await page
    .locator('.plugin-card[data-plugin="local.word-count"] .plugin-card-open')
    .click();
  await page.getByRole("button", { name: "Edit with AI" }).click();
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  const panel = page.locator(".agent-panel");
  await expect(panel.locator(".agent-panel-empty")).toContainText(
    "Make a theme, plugin or skill",
  );
  await expect(panel.locator(".inline-chat-input")).toHaveValue(
    "Change the Word Count plugin (local.word-count): ",
  );
});

test("a plugin written in the conversation can't take someone else's id", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "make tasks better" },
      {
        kind: "Assistant",
        text: reply("1.0.0").replace(/local\.word-count/g, "catvinci.tasks"),
      },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("make tasks better");
  await composer.press("Enter");
  const chip = page.locator('.agent-plugin-chip[data-plugin="catvinci.tasks"]');
  await chip.getByRole("button", { name: "Install this plugin" }).click();
  await expect(page.locator(".app-dialog")).toContainText("someone else's");
});
