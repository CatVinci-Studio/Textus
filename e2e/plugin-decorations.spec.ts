import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Marks a plugin puts on the text (textus.editor.registerDecorations,
 * document-view/plugin-decorations.ts): the blocks in sight go to the
 * plugin, and what it answers is drawn - on an anchor's words or a whole
 * block - and drawn again as the text changes.
 */

const HOST = `
exports.activate = function () {
  textus.editor.registerDecorations({
    decorate: function (blocks) {
      var marks = [];
      blocks.forEach(function (b) {
        if (b.markdown.indexOf("TODO") >= 0)
          marks.push({ block: b.id, anchor: "TODO", style: "highlight", tone: "warning", tooltip: "Still to do" });
        if (b.kind === "heading")
          marks.push({ block: b.id, style: "badge", text: "draft" });
      });
      return marks;
    },
  });
};
`;

const ENTRY = {
  id: "test.marks",
  dir: "/plugins/test.marks",
  manifest: JSON.stringify({
    id: "test.marks",
    name: "Marks",
    version: "1.0.0",
    publisher: "test",
    description: "Marks what is still to do.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    permissions: ["editor.read"],
    activationEvents: ["onEditor"],
  }),
  dev: false,
  files: { "host.js": HOST },
};

test("a plugin's marks are drawn on its words and follow the text", async ({
  page,
}) => {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: ["editor.read"] } },
    };
    w.__devFs = { "/work/a.md": "# Plan\n\nWrite it. TODO check.\n" };
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
  const mark = editor.locator(".plugin-mark-highlight");
  await expect(mark).toHaveText("TODO", { timeout: 10_000 });
  await expect(mark).toHaveAttribute("title", "Still to do");
  await expect(editor.locator("h1 .plugin-mark-badge")).toHaveText("draft");

  // A new TODO is marked once typing rests.
  await editor.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Another TODO here.");
  await expect(mark).toHaveCount(2);
});
