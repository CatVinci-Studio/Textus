import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * ctx.storage.document(path): a plugin's data for a document follows a
 * rename, and the plugin hears it.
 */

const HOST = `
var ctx;
exports.activate = function (context) {
  ctx = context;
  textus.commands.register("test.docdata.mark", function () {
    return ctx.storage.document("/work/notes/a.md").set("zoom", 2);
  });
  textus.commands.register("test.docdata.read", async function () {
    var zoom = await ctx.storage.document("/work/notes/Opening.md").get("zoom");
    var old = await ctx.storage.document("/work/notes/a.md").keys();
    textus.ui.notice("zoom " + zoom + ", left " + old.length);
  });
  textus.files.onDidRename(function (e) {
    textus.ui.notice("renamed to " + e.to);
  });
};
`;

const ENTRY = {
  id: "test.docdata",
  dir: "/plugins/test.docdata",
  manifest: JSON.stringify({
    id: "test.docdata",
    name: "Doc data",
    version: "1.0.0",
    publisher: "test",
    description: "Keeps something for a document.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    permissions: ["files.read"],
    activationEvents: ["onStartupFinished"],
    contributes: {
      commands: [
        { command: "test.docdata.mark", title: "Mark" },
        { command: "test.docdata.read", title: "Read" },
      ],
    },
  }),
  dev: false,
  files: { "host.js": HOST },
};

const run = (page: Page, command: string) =>
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, p: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-plugin-command", id),
    command,
  );

test("a document's plugin data follows it when it is renamed", async ({
  page,
}) => {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: ["files.read"] } },
    };
    w.__devFs = { "/work/notes/a.md": "# Alpha" };
    w.__devPickFolder = "/work/notes";
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  const emit = (name: string, payload?: unknown) =>
    page.evaluate(
      ([n, p]) =>
        (
          window as unknown as {
            __devEmitTauriEvent: (n: string, p: unknown) => void;
          }
        ).__devEmitTauriEvent(n as string, p),
      [name, payload] as const,
    );
  await emit("menu-open-recent", "/work/notes/a.md");
  await emit("menu-toggle-sidebar");
  const notice = page.locator("[role=status]").first();

  await run(page, "test.docdata.mark");
  await page
    .locator(".sidebar .tree-main .tree-row", { hasText: "a.md" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Opening");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rename" })
    .click();
  await expect(notice).toContainText("renamed to /work/notes/Opening.md");

  await run(page, "test.docdata.read");
  await expect(page.locator("[role=status]")).toContainText("zoom 2, left 0");
});
