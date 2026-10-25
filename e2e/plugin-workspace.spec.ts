import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
import { openPath } from "./plugin-helpers";

/**
 * The open folder's documents for a plugin in one call
 * (textus.workspace.readDocuments and search; src-tauri
 * plugins/workspace.rs through the dev shim): a small plugin puts what it
 * found in the window bar, and without workspace.read it is refused.
 */

const HOST = `
async function look() {
  try {
    const read = await textus.workspace.readDocuments();
    const found = await textus.workspace.search("call", { limit: 5 });
    textus.window.setStatusItem("found", {
      text:
        read.documents.map((d) => d.rel).join(",") +
        " | " +
        found.hits.map((h) => h.rel + ":" + h.line + " " + h.text).join(", "),
    });
  } catch (err) {
    textus.window.setStatusItem("found", { text: err.message });
  }
}

exports.activate = function () {
  // Without workspace.read the folder's changes aren't told either: it
  // looks once, at the start.
  look();
  textus.workspace.onDidChangeRoot(look);
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
            permissions: ["workspace.read"],
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
  await open(page, ["workspace.read"]);
  await expect(status(page)).toHaveText(
    "a.md,sub/b.md | a.md:3 - [ ] Call Ann",
  );
});

test("without workspace.read the folder's documents are refused", async ({
  page,
}) => {
  await open(page, []);
  await expect(status(page)).toContainText(
    "test.find was not granted workspace.read",
  );
});
