import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
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
  }
  await expect(page.locator(".plugin-webview-problem")).toHaveCount(0);
});
