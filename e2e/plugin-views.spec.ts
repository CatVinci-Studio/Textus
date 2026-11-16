import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
import { mockInvoke, openApp } from "./helpers";
import {
  hasPlugin,
  minimalDocx,
  minimalPdf,
  openPath,
  openWithPlugins,
  PNG,
} from "./plugin-helpers";

// The official plugins' files open as tabs, one after another, each page
// drawn - none left showing that its page couldn't be made.

const FILES: [plugin: string, file: string][] = [
  ["catvinci.kanban", "board.md"],
  ["catvinci.canvas", "map.canvas"],
  ["catvinci.pdf-viewer", "doc.pdf"],
  ["catvinci.image-viewer", "pic.png"],
  ["catvinci.word-reader", "letter.docx"],
  ["catvinci.database", "tasks.base"],
];

const permissions = (id: string): string[] =>
  JSON.parse(
    readFileSync(
      join(pluginsCheckout()!, "plugins", id, "textus-plugin.json"),
      "utf8",
    ),
  ).permissions ?? [];

test("each official plugin's file opens in a tab of its own, drawn", async ({
  page,
}) => {
  test.skip(!FILES.every(([id]) => hasPlugin(id)), "no plugins checkout");
  await page.setViewportSize({ width: 1280, height: 760 });
  await openWithPlugins(page, {
    plugins: Object.fromEntries(FILES.map(([id]) => [id, permissions(id)])),
    folder: {
      "/work/notes/board.md":
        "---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] Outline\n",
      "/work/notes/map.canvas": JSON.stringify({
        nodes: [
          {
            id: "a",
            type: "text",
            text: "Idea",
            x: 0,
            y: 0,
            width: 200,
            height: 80,
          },
        ],
        edges: [],
      }),
      "/work/notes/tasks.base": "views:\n  - type: table\n    name: Table\n",
    },
    binary: {
      "/work/notes/doc.pdf": minimalPdf("Hello"),
      "/work/notes/pic.png": PNG,
      "/work/notes/letter.docx": await minimalDocx("First paragraph."),
    },
  });
  for (const [, file] of FILES) {
    await openPath(page, `/work/notes/${file}`);
    await expect(page.locator(".tab-pill").last()).toContainText(file);
  }
  await expect(page.locator(".tab-pill")).toHaveCount(FILES.length);
  // Every page asked for in turn: none says it couldn't be made.
  for (const [, file] of FILES) {
    await page.locator(".tab-pill", { hasText: file }).click();
    await expect(
      page.locator('[data-active-tab="true"] .plugin-webview-frame'),
    ).toBeVisible();
    // Its page starts where its island's sheet does: no band over it.
    const gap = await page
      .locator('[data-active-tab="true"] .plugin-webview-frame')
      .evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          el.closest("[data-active-tab]")!.getBoundingClientRect().top,
      );
    expect(gap).toBeLessThanOrEqual(1);
  }
  await expect(page.locator(".plugin-webview-problem")).toHaveCount(0);
});

test("a text file no plugin opens shows read-only, not as Markdown to rewrite", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/work/all.base": "views:\n  - type: table\n    name: All\n",
    };
  });
  await openApp(page);
  // No catalog: no plugin to offer for it.
  await mockInvoke(page, { plugin_catalog: [], plugin_catalog_cached: [] });
  await openPath(page, "/work/all.base");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("views");
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

test("a plugin's page is in the UI's language, and changes with it", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.kanban"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: { "catvinci.kanban": permissions("catvinci.kanban") },
    folder: {
      "/work/notes/board.md":
        "---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] Outline\n",
    },
  });
  await openPath(page, "/work/notes/board.md");
  const frame = page.frameLocator(
    '[data-active-tab="true"] .plugin-webview-frame',
  );
  await expect(frame.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate(() => {
    const key = "catvinci-settings";
    const next = JSON.stringify({
      ...JSON.parse(localStorage.getItem(key) ?? "{}"),
      language: "de",
    });
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }));
  });
  await expect(frame.locator("html")).toHaveAttribute("lang", "de");
});

test("a plugin's sidebar list keeps a short count beside its label", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.tags"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: { "catvinci.tags": permissions("catvinci.tags") },
    folder: {
      "/work/notes/a.md": "# A\n\n#planning-notes and #project\n",
      "/work/notes/b.md": "# B\n\n#project\n",
    },
  });
  await openPath(page, "/work/notes/a.md");
  await page.getByRole("button", { name: "Tags", exact: true }).click();
  const rows = page.locator(".plugin-list-text");
  await expect(rows.first()).toBeVisible();
  const tops = await rows.evaluateAll((all) =>
    all.map((row) => {
      const top = (sel: string) =>
        Math.round(row.querySelector(sel)!.getBoundingClientRect().top);
      return [top(".plugin-list-label"), top(".plugin-list-description")];
    }),
  );
  for (const [label, count] of tops) expect(count).toBe(label);
  // Its words given as the manifest's keys follow the UI language.
  const said = (lang: string) =>
    JSON.parse(
      readFileSync(
        join(pluginsCheckout()!, "plugins/catvinci.tags/textus-plugin.json"),
        "utf8",
      ),
    ).l10n[lang].filter;
  const field = page.locator(".plugin-list input");
  await expect(field).toHaveAttribute("placeholder", said("en"));
  await page.evaluate(() => {
    const key = "catvinci-settings";
    const next = JSON.stringify({
      ...JSON.parse(localStorage.getItem(key) ?? "{}"),
      language: "de",
    });
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }));
  });
  await expect(field).toHaveAttribute("placeholder", said("de"));
});
