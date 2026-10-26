import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * textus.export.onWillExport: a plugin adds CSS and changes the HTML; a
 * script it puts in is taken out.
 */

const HOST = `
exports.activate = function () {
  textus.export.onWillExport(function (page) {
    return {
      css: "h1 { counter-increment: chapter; }",
      html: page.html.replace("</h1>", " (" + page.format + ")</h1>") +
        '<footer class="stamp">Exported</footer><script>window.bad = 1</script>',
    };
  });
};
`;

const ENTRY = {
  id: "test.export",
  dir: "/plugins/test.export",
  manifest: JSON.stringify({
    id: "test.export",
    name: "Export stamp",
    version: "1.0.0",
    publisher: "test",
    description: "Stamps an export.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    permissions: ["editor.read"],
    activationEvents: ["onStartupFinished"],
  }),
  dev: false,
  files: { "host.js": HOST },
};

test("a plugin's onWillExport adds to an HTML export, and its scripts are taken out", async ({
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
    w.__devFs = { "/work/a.md": "# Title\n\nBody.\n" };
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  const written = () =>
    page.evaluate(
      () => (window as unknown as { __written?: string }).__written ?? "",
    );
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __written?: string;
      __devEmitTauriEvent: (n: string, p?: unknown) => void;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/a.html");
      if (cmd === "write_text_file") {
        w.__written = String(args?.contents ?? "");
        return Promise.resolve();
      }
      return invoke(cmd, args);
    };
    w.__devEmitTauriEvent("menu-open-recent", "/work/a.md");
  });
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror h1'),
  ).toContainText("Title");
  // Exported once the plugin has started and listens.
  await expect
    .poll(async () => {
      await page.evaluate(() =>
        (
          window as unknown as {
            __devEmitTauriEvent: (n: string, p?: unknown) => void;
          }
        ).__devEmitTauriEvent("menu-export-html"),
      );
      await page.waitForTimeout(300);
      return written();
    })
    .toContain('class="stamp"');
  const html = await written();
  expect(html).toContain("(html)</h1>");
  expect(html).toContain("h1 { counter-increment: chapter; }");
  expect(html).not.toContain("window.bad");
});
