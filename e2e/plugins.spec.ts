import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The plugin system end to end, with a small plugin installed through the
 * dev shim (window.__devPlugins).
 */

const editor = '[data-active-tab="true"] .ProseMirror';

const HOST = `
exports.activate = function (ctx) {
  textus.commands.register("test.hello.greet", async function () {
    const count = ((await ctx.storage.global.get("count")) || 0) + 1;
    await ctx.storage.global.set("count", count);
    await textus.ui.message("Hello " + count);
  });
  textus.views.registerWebview("test.hello.panel", {
    resolve: function (webview) {
      webview.onDidReceiveMessage(async function (message) {
        if (message === "ping") {
          const text = await textus.editor.getText();
          webview.postMessage("pong " + text.trim());
        }
        if (message === "propose")
          await textus.editor.propose({ action: "append", text: "Added by Hello." });
        if (message === "outline") {
          const outline = await textus.editor.getOutline();
          webview.postMessage(outline.map((h) => h.level + ":" + h.text).join("|"));
        }
        if (message === "status")
          textus.ui.statusItem("count", {
            text: "Hello here",
            tooltip: "Greet",
            command: "test.hello.greet",
          });
        if (message === "l10n")
          webview.postMessage(textus.l10n.t("greeting", "host"));
        if (message === "folder") {
          try {
            await textus.files.list("");
          } catch (err) {
            webview.postMessage("refused: " + err.message);
          }
        }
      });
      webview.html = [
        "<button id=ping>Ping</button>",
        "<button id=propose>Propose</button>",
        "<button id=folder>Folder</button>",
        "<button id=outline>Outline</button>",
        "<button id=status>Status</button>",
        "<button id=l10n>L10n</button>",
        "<p id=page></p>",
        "<p id=out></p>",
        "<script>",
        "const api = acquireTextusApi();",
        "for (const id of ['ping', 'propose', 'folder', 'outline', 'status', 'l10n'])",
        "  document.getElementById(id).onclick = () => api.postMessage(id);",
        "api.onMessage((m) => (document.getElementById('out').textContent = m));",
        "let storage = 'open';",
        "try { localStorage.setItem('x', '1'); } catch { storage = 'blocked'; }",
        "let app = 'open';",
        "try { void parent.document.title; } catch { app = 'blocked'; }",
        "document.getElementById('page').textContent = api.t('greeting', 'page');",
        "document.body.dataset.storage = storage;",
        "document.body.dataset.app = app;",
        "document.body.dataset.tauri = String('__TAURI_INTERNALS__' in window);",
        "</script>",
      ].join("\\n");
    },
  });
};
`;

const MANIFEST = {
  id: "test.hello",
  name: "Hello",
  version: "1.0.0",
  publisher: "test",
  description: "Says hello.",
  engines: { textus: "^1.2.0" },
  main: "host.js",
  permissions: ["editor.read", "editor.propose"],
  contributes: {
    commands: [{ command: "test.hello.greet", title: "Greet" }],
    menus: {
      "editor/context": [{ command: "test.hello.greet" }],
      "app/plugins": [{ command: "test.hello.greet" }],
    },
    sidebarTabs: [{ id: "test.hello.panel", title: "%tab%" }],
  },
  l10n: {
    en: { tab: "Hello", greeting: "Hello from the {0}" },
    zh: { tab: "你好", greeting: "来自{0}的问候" },
    "zh-Hant": { tab: "哈囉", greeting: "來自{0}的問候" },
  },
};

async function open(page: Page) {
  await page.addInitScript(
    ({ manifest, host }) => {
      if (window.top !== window) return;
      (window as unknown as { __devPlugins: unknown }).__devPlugins = [
        {
          id: "test.hello",
          dir: "/plugins/test.hello",
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "host.js": host },
        },
      ];
    },
    { manifest: MANIFEST, host: HOST },
  );
  await openApp(page, { settings: { language: "en" } });
}

const emit = (page: Page, event: string) =>
  page.evaluate(
    (name) =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent(name),
    event,
  );

async function openPluginsPage(page: Page) {
  await emit(page, "menu-manage-plugins");
  await expect(
    page.locator(".settings-nav-item", { hasText: "Extensions" }),
  ).toHaveAttribute("aria-current", /page|true/);
}

async function turnOn(page: Page) {
  await openPluginsPage(page);
  const row = page.locator('.plugin-card[data-plugin="test.hello"]');
  await expect(row).toContainText("Says hello.");
  await row.getByRole("button", { name: "Turn On" }).click();
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("Hello asks to:");
  await expect(dialog).toContainText(
    "Read the document in front and its selection",
  );
  await expect(dialog).toContainText("Suggest edits to the document");
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(row.getByRole("button", { name: "Turn Off" })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function openPanel(page: Page) {
  await emit(page, "menu-toggle-sidebar");
  await page
    .locator(".sidebar-tabs")
    .getByRole("button", { name: "Hello" })
    .click();
  return page.frameLocator(".plugin-webview-frame");
}

test("a plugin turned on shows its panel, sandboxed, talking to its code", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "Some words");
  await turnOn(page);
  const panel = await openPanel(page);
  await panel.locator("#ping").click();
  await expect(panel.locator("#out")).toHaveText("pong Some words");
  // The frame reaches none of the window: no storage, no DOM, no Tauri.
  await expect(panel.locator("body")).toHaveAttribute(
    "data-storage",
    "blocked",
  );
  await expect(panel.locator("body")).toHaveAttribute("data-app", "blocked");
  await expect(panel.locator("body")).toHaveAttribute("data-tauri", "false");
  // And a call it wasn't granted is refused.
  await panel.locator("#folder").click();
  await expect(panel.locator("#out")).toContainText(
    "refused: test.hello was not granted files.read",
  );
});

test("a plugin's edit is a proposal in the document", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, "First line");
  await turnOn(page);
  const panel = await openPanel(page);
  await panel.locator("#propose").click();
  await expect(page.locator(`${editor} .pending-insert`)).toContainText(
    "Added by Hello.",
  );
});

test("a plugin's command runs from the editor's menu and keeps what it stored", async ({
  page,
}) => {
  await open(page);
  await turnOn(page);
  for (const n of [1, 2]) {
    await page.locator(editor).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Greet" }).click();
    const notice = page.getByRole("alertdialog");
    await expect(notice).toContainText(`Hello ${n}`);
    await notice.getByRole("button").click();
  }
});

test("refusing its permissions leaves a plugin off", async ({ page }) => {
  await open(page);
  await openPluginsPage(page);
  const row = page.locator('.plugin-card[data-plugin="test.hello"]');
  await row.getByRole("button", { name: "Turn On" }).click();
  await page
    .locator(".app-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(row.getByRole("button", { name: "Turn On" })).toBeVisible();
  await page.keyboard.press("Escape");
  await emit(page, "menu-toggle-sidebar");
  await expect(
    page.locator(".sidebar-tabs").getByRole("button", { name: "Hello" }),
  ).toHaveCount(0);
});

test("turning every plugin off takes its tab away", async ({ page }) => {
  await open(page);
  await turnOn(page);
  await emit(page, "menu-toggle-sidebar");
  const tab = page
    .locator(".sidebar-tabs")
    .getByRole("button", { name: "Hello" });
  await expect(tab).toHaveCount(1);
  await openPluginsPage(page);
  // The switch for them all is above the installed plugins.
  await page.getByRole("checkbox", { name: "All plugins" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(tab).toHaveCount(0);
});

test("the search above the installed plugins narrows them", async ({
  page,
}) => {
  await open(page);
  await openPluginsPage(page);
  const card = page.locator('[data-plugin="test.hello"]');
  await expect(card).toHaveCount(1);
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("no such plugin");
  await expect(card).toHaveCount(0);
  await search.fill("hel");
  await expect(card).toHaveCount(1);
});

test("a plugin reads the document's outline, and puts a status in the window bar that runs its command", async ({
  page,
}) => {
  await open(page);
  await turnOn(page);
  await pasteMarkdown(
    page,
    "# Harbour\n\nText.\n\n```\n# not a heading\n```\n\n## Boats",
  );
  const panel = await openPanel(page);
  await panel.locator("#outline").click();
  await expect(panel.locator("#out")).toHaveText("1:Harbour|2:Boats");
  await panel.locator("#status").click();
  const status = page.locator(".window-bar .plugin-status-item", {
    hasText: "Hello here",
  });
  await expect(status).toBeVisible();
  await status.click();
  await expect(page.locator(".app-dialog")).toContainText("Hello 1");
});

test("a plugin's strings come in the UI's language, from its manifest", async ({
  page,
}) => {
  await page.addInitScript(
    ({ manifest, host }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: "test.hello",
          dir: "/plugins/test.hello",
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "host.js": host },
        },
      ];
      w.__devPluginState = {
        allOn: true,
        plugins: {
          "test.hello": { enabled: true, granted: manifest.permissions },
        },
      };
    },
    { manifest: MANIFEST, host: HOST },
  );
  // Traditional Chinese has its own strings, not the Simplified ones.
  await openApp(page, { settings: { language: "zh-Hant" } });
  await emit(page, "menu-toggle-sidebar");
  await page
    .locator(".sidebar-tabs")
    .getByRole("button", { name: "哈囉" })
    .click();
  const panel = page.frameLocator(".plugin-webview-frame");
  await expect(panel.locator("#page")).toHaveText("來自page的問候");
  await panel.locator("#l10n").click();
  await expect(panel.locator("#out")).toHaveText("來自host的問候");
});
