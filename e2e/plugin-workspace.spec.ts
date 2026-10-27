import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
import { openPath } from "./plugin-helpers";

/**
 * textus.metadata's all and search over the open folder; refused without
 * files.read.
 */

const HOST = `
async function look() {
  try {
    const read = await textus.metadata.all();
    const found = await textus.metadata.search("call", { limit: 5 });
    textus.ui.statusItem("found", {
      text:
        read.map((d) => d.rel).join(",") +
        " | " +
        found.hits.map((h) => h.rel + ":" + h.line + " " + h.text).join(", "),
    });
  } catch (err) {
    textus.ui.statusItem("found", { text: err.message });
  }
}

exports.activate = function () {
  // Without files.read the folder's changes aren't told either: it looks
  // once, at the start.
  look();
  textus.files.onDidChangeRoot(look);
};
`;

async function open(page: Page, granted: string[]) {
  await page.addInitScript(
    ({ host, granted }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: "test.find",
          dir: "/plugins/test.find",
          manifest: JSON.stringify({
            id: "test.find",
            name: "Find",
            version: "1.0.0",
            publisher: "test",
            description: "Finds words in the folder.",
            engines: { textus: "^1.3.0" },
            main: "host.js",
            activationEvents: ["*"],
            permissions: ["files.read"],
          }),
          dev: false,
          files: { "host.js": host },
        },
      ];
      w.__devPluginState = {
        allOn: true,
        plugins: { "test.find": { enabled: true, granted } },
      };
      w.__devFs = {
        "/notes/a.md": "# A\n\n- [ ] Call Ann\n",
        "/notes/sub/b.md": "Nothing here.\n",
        "/notes/.hidden/c.md": "call",
        "/notes/notes.txt": "call me",
      };
    },
    { host: HOST, granted },
  );
  await openApp(page, { settings: { language: "en" } });
  await openPath(page, "/notes/a.md");
}

const status = (page: Page) => page.locator(".window-bar .plugin-status-item");

test("a plugin reads the folder's documents and searches them in one call", async ({
  page,
}) => {
  await open(page, ["files.read"]);
  await expect(status(page)).toHaveText(
    "a.md,sub/b.md | a.md:3 - [ ] Call Ann",
  );
});

test("without files.read the folder's documents are refused", async ({
  page,
}) => {
  await open(page, []);
  await expect(status(page)).toContainText(
    "test.find was not granted files.read",
  );
});
