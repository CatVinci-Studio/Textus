import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// The heavy parts of the app load on first use (src/lazy/lazy-module.ts):
// a window opens with its own language's strings only, Settings and the
// diagram and formula engines come when they are needed, and the parts
// likely to be opened soon ("warm") load once the window is idle.

function loaded(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      window as unknown as { __loadedModules: () => string[] }
    ).__loadedModules(),
  );
}

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
}

test("a window opens in its language with only that language's strings", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "zh" } });
  // The first frame is already in Chinese: its strings loaded before it.
  await expect(page.locator(".ProseMirror").first()).toBeVisible();
  const now = await loaded(page);
  expect(now).toContain("locale:zh");
  expect(
    now.filter((name) => name.startsWith("locale:") && name !== "locale:zh"),
  ).toEqual([]);
  expect(now).not.toContain("mermaid");
  expect(now).not.toContain("katex");
});

test("Settings is warmed while the window is idle and opens at once", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await expect.poll(() => loaded(page)).toContain("settings");
  await emit(page, "menu-open-settings");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("a language picked loads its strings and shows them", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", languageChosen: false, onboardingShown: true },
  });
  const hint = page.locator('[data-active-tab="true"] .empty-doc-placeholder');
  await expect(hint).toHaveAttribute(
    "data-placeholder",
    "Start writing in Markdown…",
  );
  expect(await loaded(page)).not.toContain("locale:ja");
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "日本語" }).click();
  await page.locator(".language-welcome-continue").click();
  await expect(hint).not.toHaveAttribute(
    "data-placeholder",
    "Start writing in Markdown…",
  );
  expect(await loaded(page)).toContain("locale:ja");
});

test("a diagram loads its engine when one is drawn", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  expect(await loaded(page)).not.toContain("mermaid");
  await pasteMarkdown(
    page,
    "```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```\n\nEnd.",
  );
  await expect(
    page.locator(
      '[data-active-tab="true"] .ProseMirror .mermaid-preview > svg',
    ),
  ).toHaveCount(1, { timeout: 10_000 });
  expect(await loaded(page)).toContain("mermaid");
});

test("an installed plugin starts, and its views load, only once it is needed", async ({
  page,
}) => {
  const host = `exports.activate = function () {
    textus.views.registerCodeBlock("shout", {
      render: function (block, webview) { webview.html = "<p>" + block.source + "</p>"; },
    });
  };`;
  const entry = {
    id: "test.shout",
    dir: "/plugins/test.shout",
    manifest: JSON.stringify({
      id: "test.shout",
      name: "Shout",
      version: "1.0.0",
      publisher: "test",
      description: "Draws shout blocks.",
      engines: { textus: "^1.3.0" },
      main: "host.js",
      contributes: { codeBlocks: [{ language: "shout" }] },
    }),
    dev: false,
    files: { "host.js": host },
  };
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: [] } },
    };
    w.__devFs = {
      "/work/plain.md": "# Plain\n\nNo blocks here.\n",
    };
  }, entry);
  await openApp(page, { settings: { language: "en" } });
  const open = (path: string) =>
    page.evaluate(
      (p) =>
        (
          window as unknown as {
            __devEmitTauriEvent: (n: string, payload: unknown) => void;
          }
        ).__devEmitTauriEvent("menu-open-recent", p),
      path,
    );
  await open("/work/plain.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator("h1")).toContainText("Plain");
  // Idle, with Settings warmed: the plugin is known, but nothing of it runs.
  await expect.poll(() => loaded(page)).toContain("settings");
  const before = await loaded(page);
  expect(before).not.toContain("plugin-webviews");
  expect(before).not.toContain("plugin-broker");
  expect(before.filter((name) => name.startsWith("plugin:"))).toEqual([]);

  // A block in its language: now its view loads and the plugin starts.
  await emit(page, "menu-new-file");
  await pasteMarkdown(page, "```shout\nhello\n```\n\nEnd.");
  await expect(
    page.frameLocator(".plugin-code-block iframe").first().locator("p"),
  ).toHaveText("hello");
  const after = await loaded(page);
  expect(after).toContain("plugin-webviews");
  expect(after).toContain("plugin:test.shout");
});
