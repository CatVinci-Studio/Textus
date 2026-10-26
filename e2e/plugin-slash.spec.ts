import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * The `/` menu (plugins/contributions/slash-commands.ts): a plugin's
 * commands put in `menus["editor/slash"]` are offered when a word starts
 * with "/", filtered by what follows; taking one removes the "/" word and
 * runs the command, which writes at the caret.
 */

const HOST = `
exports.activate = function () {
  textus.commands.registerEditorCommand("test.slash.date", function (editor) {
    return editor.insertText("2026-10-25");
  });
};
`;

const ENTRY = {
  id: "test.slash",
  dir: "/plugins/test.slash",
  manifest: JSON.stringify({
    id: "test.slash",
    name: "Slash",
    version: "1.0.0",
    publisher: "test",
    description: "A / command.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    permissions: ["editor.write"],
    contributes: {
      commands: [{ command: "test.slash.date", title: "Insert Date" }],
      menus: { "editor/slash": [{ command: "test.slash.date" }] },
    },
  }),
  dev: false,
  files: { "host.js": HOST },
};

test("a plugin's / command is offered as a word starts with /, and runs", async ({
  page,
}) => {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: ["editor.write"] } },
    };
    w.__devFs = { "/work/a.md": "# A\n\nToday is\n" };
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-recent", "/work/a.md"),
  );
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("p").click();
  await page.keyboard.press("End");
  const list = page.locator(".completion-list");

  // Not inside a word.
  await page.keyboard.type(" a/");
  await expect(list).toBeHidden();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");

  await page.keyboard.type("/ins");
  await expect(list).toContainText("Insert Date");
  await page.keyboard.press("Enter");
  await expect(list).toBeHidden();
  await expect(editor.locator("p")).toHaveText("Today is 2026-10-25");
});
