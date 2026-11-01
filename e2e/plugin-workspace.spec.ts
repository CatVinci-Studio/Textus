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

const LISTENER = `
exports.activate = function () {
  let changes = 0;
  textus.metadata.onDidChange(async () => {
    changes++;
    const tags = await textus.metadata.tags();
    textus.ui.statusItem("seen", {
      text: "changes " + changes + ": " + tags.map((t) => t.tag).join(","),
    });
  });
  textus.ui.statusItem("seen", { text: "listening" });
};
`;

test("a plugin listening from the start hears of a folder opened later", async ({
  page,
}) => {
  await page.addInitScript((host) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [
      {
        id: "test.listen",
        dir: "/plugins/test.listen",
        manifest: JSON.stringify({
          id: "test.listen",
          name: "Listen",
          version: "1.0.0",
          publisher: "test",
          description: "Hears of the folder's changes.",
          engines: { textus: "^1.3.0" },
          main: "host.js",
          activationEvents: ["onStartupFinished"],
          permissions: ["files.read"],
        }),
        dev: false,
        files: { "host.js": host },
      },
    ];
    w.__devPluginState = {
      allOn: true,
      plugins: { "test.listen": { enabled: true, granted: ["files.read"] } },
    };
    w.__devFs = { "/work/notes/a.md": "# A\n\nBoats at dusk. #boats\n" };
    w.__devPickFolder = "/work/notes";
  }, LISTENER);
  await openApp(page, { settings: { language: "en" } });
  await expect(status(page)).toHaveText("listening");
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-folder"),
  );
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
  // Coming back to the window looks the folder over: first as it is, then
  // after a note gained a tag.
  const lookAgain = () =>
    page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await lookAgain();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const fs = (window as unknown as { __devFs: Record<string, string> })
      .__devFs;
    fs["/work/notes/a.md"] += "\nThe harbour. #harbour\n";
  });
  await lookAgain();
  await expect(status(page)).toHaveText(/changes \d+: .*harbour/);
});
