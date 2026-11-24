import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { pluginsCheckout } from "../vite.dev-plugins";
import { emit, mockInvoke, openApp, settled, sourceOf } from "./helpers";
import {
  hasPlugin,
  minimalDocx,
  minimalPdf,
  openPath,
  openWithPlugins,
  pluginRuns,
  PNG,
  tabFrame,
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
  // A card's checkbox sits on its title's first line, centred on it.
  await page.locator(".tab-pill", { hasText: "board.md" }).click();
  const off = await tabFrame(page)
    .locator(".card")
    .first()
    .evaluate((card) => {
      const box = card.querySelector(".ui-check")!.getBoundingClientRect();
      const text = card.querySelector(".card-text")!;
      const line = parseFloat(getComputedStyle(text).lineHeight);
      const top = text.getBoundingClientRect().top;
      return box.top + box.height / 2 - (top + line / 2);
    });
  expect(Math.abs(off)).toBeLessThanOrEqual(1);
});

test("an Obsidian Excalidraw note is drawn and edited, saved as it was kept", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.excalidraw"), "no plugins checkout");
  const scene = {
    type: "excalidraw",
    version: 2,
    elements: [
      {
        id: "t1",
        type: "text",
        x: 40,
        y: 40,
        width: 80,
        height: 25,
        text: "Hello",
        originalText: "Hello",
        fontSize: 20,
        fontFamily: 5,
        version: 1,
        versionNonce: 1,
      },
    ],
    appState: {},
    files: {},
  };
  const path = "/work/notes/sketch.excalidraw.md";
  await openWithPlugins(page, {
    plugins: { "catvinci.excalidraw": permissions("catvinci.excalidraw") },
    folder: {
      [path]: [
        "---",
        "excalidraw-plugin: parsed",
        "---",
        "# Excalidraw Data",
        "## Text Elements",
        "Hello ^t1",
        "",
        "%%",
        "## Drawing",
        "```json",
        JSON.stringify(scene),
        "```",
        "%%",
      ].join("\n"),
    },
  });
  await openPath(page, path);
  const frame = tabFrame(page);
  const canvas = frame.locator("canvas.interactive");
  // Shown once its fonts are in, or given up on where none are served.
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  // A rectangle drawn with Excalidraw's own tool.
  await frame.locator('label:has([data-testid="toolbar-rectangle"])').click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 300, { steps: 5 });
  await page.mouse.up();
  const saved = () =>
    page.evaluate(
      (p) =>
        (window as unknown as { __devFs: Record<string, string> }).__devFs[p],
      path,
    );
  await expect.poll(saved).toContain('"type": "rectangle"');
  const text = await saved();
  expect(text).toMatch(/^---\nexcalidraw-plugin: parsed\n---\n/);
  expect(text).toContain("## Text Elements\nHello ^t1\n");
  expect(text).toContain("## Drawing\n```json\n");
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

test("a plugin's code language is coloured in the editor and source mode, by any of its names, and offered in the language menu", async ({
  page,
}) => {
  const manifest = {
    id: "example.cisco",
    name: "Cisco",
    version: "0.1.0",
    publisher: "example",
    engines: { textus: ">=1.4.6" },
    contributes: {
      codeLanguages: [{ id: "cisco", aliases: ["ios"], path: "cisco.json" }],
    },
  };
  const grammar = JSON.stringify({
    flags: "i",
    rules: [
      { token: "comment", match: "^\\s*!.*" },
      { token: "keyword", match: "\\b(?:interface|shutdown)\\b" },
    ],
  });
  await page.addInitScript(
    ({ manifest, grammar }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: `/plugins/${manifest.id}`,
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "cisco.json": grammar },
        },
      ];
      w.__devFs = {
        "/work/r1.md": "```IOS\n! core\ninterface Gi0/1\n shutdown\n```\n",
      };
      w.__devPluginState = {
        allOn: true,
        plugins: { [manifest.id]: { enabled: true, granted: [] } },
      };
    },
    { manifest, grammar },
  );
  await openApp(page);
  await openPath(page, "/work/r1.md");
  const code = page.locator('[data-active-tab="true"] .ProseMirror pre code');
  await expect(code.locator(".token.keyword")).toHaveText([
    "interface",
    "shutdown",
  ]);
  await expect(code.locator(".token.comment")).toHaveText("! core");
  const picker = page.locator(".code-block-language-select").first();
  await page.locator(".code-block-wrapper").first().hover();
  await picker.click();
  await expect(
    page.locator(".code-language-menu [role=option]", { hasText: /^cisco$/ }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  // Source mode reads the same grammar: the keyword a token of its own.
  await emit(page, "menu-toggle-source-mode");
  const line = page.locator('[data-active-tab="true"] .source-view .cm-line', {
    hasText: "interface Gi0/1",
  });
  await expect(line.locator("span", { hasText: /^interface$/ })).toHaveCount(1);
});

test("a plugin's page is in the UI's language, and changes with it; a board's list moves by its head", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.kanban"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: { "catvinci.kanban": permissions("catvinci.kanban") },
    folder: {
      "/work/notes/board.md":
        "---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] Outline\n\n## Done\n\n- [x] Title\n",
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
  // The page kit's reorder: Done's head pulled before Todo.
  const heads = frame.locator(".list-head");
  const todo = (await heads.nth(0).boundingBox())!;
  const done = (await heads.nth(1).boundingBox())!;
  await page.mouse.move(done.x + 8, done.y + done.height / 2);
  await page.mouse.down();
  for (let x = done.x + 8; x > todo.x - 20; x -= 20)
    await page.mouse.move(x, done.y + done.height / 2);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devFs: Record<string, string> }).__devFs[
            "/work/notes/board.md"
          ],
      ),
    )
    .toMatch(/## Done[\s\S]*## Todo/);
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

test("a plugin's page asked for beside, with no room for it, opens as a tab and nothing is said", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.mdx"), "no plugins checkout");
  await page.setViewportSize({ width: 360, height: 700 });
  await openWithPlugins(page, {
    plugins: { "catvinci.mdx": permissions("catvinci.mdx") },
    folder: { "/work/notes/page.mdx": "# Hello\n\nSome words.\n" },
  });
  await openPath(page, "/work/notes/page.mdx");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("Some words");
  await editor.locator("p").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Preview MDX" }).click();
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  await expect(page.locator(".tab-pill-active")).not.toContainText("page.mdx");
  // Read once: a notice goes by itself after a while.
  await page.waitForTimeout(300);
  expect(await page.locator(".notice").count()).toBe(0);
  // Alone in front, it still draws the document it was asked for from.
  await expect(tabFrame(page).locator("body")).toContainText("Some words");
});

test("a plugin's block is on the page as a table is, its edge shown only while pointed at", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.function-plot"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: {
      "catvinci.function-plot": permissions("catvinci.function-plot"),
    },
    folder: {
      "/work/notes/plot.md": "# Plot\n\n```function-plot\ny = x^2\n```\n",
    },
  });
  await openPath(page, "/work/notes/plot.md");
  const block = page.locator('[data-active-tab="true"] .plugin-code-block');
  await expect(block.locator(".plugin-webview-frame")).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(block).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(block).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await block.hover();
  await expect(block).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
});

test("a plugin's block opened again starts at its page's height, not growing to it", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.function-plot"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: {
      "catvinci.function-plot": permissions("catvinci.function-plot"),
    },
    folder: {
      "/work/notes/plot.md": "# Plot\n\n```function-plot\ny = x^2\n```\n",
      "/work/notes/other.md": "# Other\n",
    },
  });
  // Another tab, so closing the block's leaves the window open.
  await openPath(page, "/work/notes/other.md");
  await openPath(page, "/work/notes/plot.md");
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  const frame = page.locator(
    '[data-active-tab="true"] .plugin-code-block .plugin-webview-frame',
  );
  await expect(frame).toBeVisible();
  // The page has said how tall it is.
  await expect
    .poll(() => frame.evaluate((f) => (f as HTMLElement).style.height))
    .not.toBe("");
  const height = await frame.evaluate((f) => f.getBoundingClientRect().height);
  await emit(page, "menu-close-tab");
  await expect(frame).toHaveCount(0);
  // Every frame's height of the block from the moment it is there again,
  // until its page is in it and its height has held for a while.
  const seen = page.evaluate(
    () =>
      new Promise<number[]>((done) => {
        const heights: number[] = [];
        let held = 0;
        const sample = () => {
          const holder = document.querySelector(
            '[data-active-tab="true"] .plugin-code-holder',
          );
          const height = holder?.getBoundingClientRect().height;
          if (height !== undefined) {
            const same = height === heights[heights.length - 1];
            held = same && holder!.querySelector("iframe") ? held + 1 : 0;
            heights.push(height);
          }
          if (held >= 30 || heights.length > 600) done(heights);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await openPath(page, "/work/notes/plot.md");
  const heights = await seen;
  expect(heights.length).toBeGreaterThan(0);
  expect(heights.filter((h) => Math.abs(h - height) > 1)).toEqual([]);
});

test("a block whose plugin asks for no frame, a base, shows no edge when pointed at, only its source button", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.database"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: { "catvinci.database": permissions("catvinci.database") },
    folder: {
      "/work/notes/Plan.md":
        "# Plan\n\n```base\nviews:\n  - type: table\n    name: Table\n```\n",
      "/work/notes/One.md": "---\ndue: 2026-11-23\n---\n",
    },
  });
  await openPath(page, "/work/notes/Plan.md");
  const block = page.locator('[data-active-tab="true"] .plugin-code-block');
  await expect(block.locator(".plugin-webview-frame")).toBeVisible();
  await block.hover();
  await expect(block.locator(".plugin-code-edit")).toHaveCSS("opacity", "1");
  await expect(block).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
});

test("a database's column heads centre their icon on their name, a Chinese one too", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.database"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: { "catvinci.database": permissions("catvinci.database") },
    folder: {
      "/work/notes/Plan.md":
        "# Plan\n\n```base\nfilters:\n  and:\n    - file.inFolder(this.file.folder)\n    - file.path != this.file.path\nviews:\n  - type: table\n    name: Table\n    order: [file.name, due]\n```\n",
      "/work/notes/One.md": "---\ndue: 2026-11-23\n---\n",
    },
    language: "zh",
  });
  await openPath(page, "/work/notes/Plan.md");
  const heads = page
    .frameLocator(
      '[data-active-tab="true"] .plugin-code-block .plugin-webview-frame',
    )
    .locator("th[data-key]");
  await expect(heads.first()).toContainText("页面");
  for (const head of await heads.all()) {
    const off = await head.evaluate((th) => {
      const text = [...th.childNodes].find((n) => n.nodeType === 3)!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const name = range.getBoundingClientRect();
      const icon = th.querySelector(".tx-icon")!.getBoundingClientRect();
      return name.top + name.height / 2 - (icon.top + icon.height / 2);
    });
    expect(Math.abs(off)).toBeLessThanOrEqual(1.5);
  }
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("a drawing's source button shows once the block is tapped, not over it all the time", async ({
    page,
  }) => {
    test.skip(!hasPlugin("catvinci.function-plot"), "no plugins checkout");
    await openWithPlugins(page, {
      plugins: {
        "catvinci.function-plot": permissions("catvinci.function-plot"),
      },
      folder: {
        "/work/notes/plot.md": "# Plot\n\n```function-plot\ny = x^2\n```\n",
      },
    });
    await openPath(page, "/work/notes/plot.md");
    const block = page.locator('[data-active-tab="true"] .plugin-code-block');
    const button = block.locator(".plugin-code-edit");
    await expect(block.locator(".plugin-webview-frame")).toBeVisible();
    await expect(button).toHaveCSS("opacity", "0");
    await block.locator(".plugin-webview-frame").tap();
    await expect(button).toHaveCSS("opacity", "1");
  });
});

test("a plugin reads the document in front as a save would write it", async ({
  page,
}) => {
  const file = "---\ntitle: Notes\n---\n# Notes\n\nFirst  line.\n";
  await page.addInitScript((f) => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/fm.md": f,
    };
  }, file);
  await openApp(page, { settings: { language: "en" } });
  await openPath(page, "/work/fm.md");
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("First");
  // Read once the editor is built: before, it has no text to give.
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        const bridge = await import(/* @vite-ignore */ url);
        return bridge.getActiveDocument()?.text();
      }, "/src/plugins/app-bridge.ts"),
    )
    .toBe(file);
});

test("a plugin reads the document and hears it change in Source Mode and Source and Preview", async ({
  page,
}) => {
  const manifest = {
    id: "example.reader",
    name: "Reader",
    version: "0.1.0",
    publisher: "example",
    engines: { textus: ">=1.3.12" },
    main: "host.js",
    activationEvents: ["onStartupFinished"],
    permissions: ["editor.read"],
  };
  // Each change it hears, with the path and text it then reads.
  const host = `exports.activate = function (ctx) {
    var seen = [];
    textus.editor.onDidChange(async function () {
      seen.push({ path: await textus.editor.getPath(), text: await textus.editor.getText() });
      await ctx.storage.global.set("seen", seen);
    });
  };`;
  await page.addInitScript(
    ({ manifest, host }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: `/plugins/${manifest.id}`,
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "host.js": host },
        },
      ];
      w.__devFs = { "/work/slides.md": "# Slides\n" };
      w.__devPluginState = {
        allOn: true,
        plugins: {
          [manifest.id]: { enabled: true, granted: manifest.permissions },
        },
      };
    },
    { manifest, host },
  );
  await openApp(page, { settings: { language: "en" } });
  await openPath(page, "/work/slides.md");
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Slides");
  const lastSeen = () =>
    page.evaluate(() => {
      const stores = (window as unknown as Record<string, unknown>)
        .__devPluginStore as
        Record<string, { kv: Record<string, unknown> }> | undefined;
      const seen = stores?.["example.reader|global|"]?.kv.seen as
        { path: string | null; text: string | null }[] | undefined;
      return seen?.at(-1) ?? null;
    });
  const source = page.locator('[data-active-tab="true"] .cm-content');
  for (const [toggle, typed] of [
    ["menu-toggle-source-mode", "one"],
    ["menu-toggle-split-view", "two"],
  ]) {
    await emit(page, toggle);
    await source.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(typed);
    await expect.poll(lastSeen).toEqual({
      path: "/work/slides.md",
      text: expect.stringContaining(typed),
    });
  }
  // Changed in place as an open document, as files.process does.
  await page.evaluate(async (url) => {
    const open = (await import(/* @vite-ignore */ url)).openDocumentAt(
      "/work/slides.md",
    );
    open.replaceText(`${open.text()}\n\nmore`, open.revision());
  }, "/src/registry/open-documents.ts");
  await expect(source).toContainText("more");
  // Back in the rendered view, it alone answers.
  await emit(page, "menu-toggle-split-view");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("more");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" three");
  await expect.poll(lastSeen).toEqual({
    path: "/work/slides.md",
    text: expect.stringMatching(/one[\s\S]*two[\s\S]*more three/),
  });
});

test("Git marks the blocks changed since the last commit in the margin", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.git"), "no plugins checkout");
  await page.addInitScript(() => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      {
        plugin_git_status: {
          branch: "main",
          changes: [
            { path: "/work/notes/a.md", state: "modified", staged: false },
          ],
        },
        plugin_git_log: [
          {
            hash: "abc1234",
            at: 0,
            author: "A",
            subject: "s",
            path: "/work/notes/a.md",
          },
        ],
        plugin_git_show: "# A\n\nKept paragraph.\n",
      };
  });
  await openWithPlugins(page, {
    plugins: { "catvinci.git": permissions("catvinci.git") },
    folder: {
      "/work/notes/a.md": "# A\n\nKept paragraph.\n\nNew paragraph.\n",
    },
  });
  await openPath(page, "/work/notes/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const marks = editor.locator(".plugin-gutter");
  await expect(marks).toHaveCount(1);
  await expect(
    editor.locator("p", { hasText: "New paragraph" }).locator(".plugin-gutter"),
  ).toHaveAttribute(
    "aria-label",
    "Changed since the last commit. Click to commit.",
  );
});

test("a plugin's slip is underlined, explained on the slip card, and fixed from it", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.markdown-lint"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: {
      "catvinci.markdown-lint": permissions("catvinci.markdown-lint"),
    },
    folder: { "/work/notes/a.md": "# A\n\n## Notes:\n\nText\n" },
  });
  await openPath(page, "/work/notes/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const slip = editor.locator(".plugin-issue");
  await expect(slip).toHaveCount(1);
  // Counted in the document's corner; its list takes the caret there.
  const count = page.locator(".slip-count");
  await expect(count).toHaveText("1 problem");
  await count.click();
  await page.getByRole("menuitem", { name: /^Tidy: MD026/ }).click();
  await expect(page.locator(".grammar-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await slip.hover();
  const card = page.locator(".grammar-popover");
  await expect(card.locator(".grammar-kind")).toHaveText("Tidy");
  await expect(card).toContainText("MD026");
  await card.locator(".grammar-popover-apply").click();
  await expect(slip).toHaveCount(0);
  await expect.poll(() => sourceOf(page)).toBe("# A\n\n## Notes\n\nText");
});

test("a slip picked from the list off screen is scrolled to, its card staying open until the page is scrolled", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.markdown-lint"), "no plugins checkout");
  const lines = Array.from({ length: 80 }, (_, i) => `Line ${i}.`);
  await openWithPlugins(page, {
    plugins: {
      "catvinci.markdown-lint": permissions("catvinci.markdown-lint"),
    },
    folder: {
      "/work/notes/a.md": `# A\n\n## Notes:\n\n${lines.join("\n\n")}\n`,
    },
  });
  await openPath(page, "/work/notes/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const slip = editor.locator(".plugin-issue");
  await expect(slip).toHaveCount(1);
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  // Just past it: still among the blocks near enough to be asked about
  // again (rest-asking's AROUND), so it stays in the list once the page rests.
  await slip.evaluate((el) => {
    const s = el.closest(".editor-scroll")!;
    s.scrollBy(
      0,
      el.getBoundingClientRect().bottom - s.getBoundingClientRect().top + 100,
    );
  });
  await expect(slip).not.toBeInViewport();
  await settled(page);
  await page.locator(".slip-count").click();
  await page.getByRole("menuitem", { name: /^Tidy: MD026/ }).click();
  await expect(slip).toBeInViewport();
  await settled(page);
  const card = page.locator(".grammar-popover");
  await expect(card).toBeVisible();
  // The reader scrolling on: the card no longer points at its words.
  await scroller.evaluate((s) => s.scrollBy(0, 200));
  await expect(card).toBeHidden();
});

test("a plugin's inline syntax is shown as it means, its source back under the caret", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {},
    folder: {
      "/work/a.md":
        "Who? ||the butler|| it was.\n\nRead {漢字|かんじ} and `||code||`.\n",
    },
  });
  await openPath(page, "/work/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  // As the plugin host does it, through the dev server's own module.
  await page.evaluate(async () => {
    const path = "/src/plugins/contributions/syntax.ts";
    const { addSyntax } = await import(/* @vite-ignore */ path);
    addSyntax("example\nspoiler", {
      pattern: "\\|\\|(?<text>[^|]+)\\|\\|",
      style: "spoiler",
    });
    addSyntax("example\nruby", {
      pattern: "\\{(?<text>[^{}|]+)\\|(?<note>[^{}|]+)\\}",
      style: "ruby",
    });
  });
  const spoiler = editor.locator(".plugin-syntax-spoiler");
  await expect(spoiler).toHaveCount(1);
  await expect(spoiler).toHaveText("the butler");
  await expect(editor.locator(".plugin-syntax-ruby")).toHaveAttribute(
    "data-ruby",
    "かんじ",
  );
  // Nothing in code; the text is as written.
  await expect(editor.locator("code .plugin-syntax")).toHaveCount(0);
  await expect
    .poll(() => sourceOf(page))
    .toBe("Who? ||the butler|| it was.\n\nRead {漢字|かんじ} and `||code||`.");
  await expect(editor.locator(".plugin-syntax-hidden").first()).toBeHidden();
  await spoiler.click();
  await expect(spoiler).toHaveClass(/is-touched/);
  await expect(editor.locator(".plugin-syntax-source")).toHaveCount(2);
});

test("a database shown as another plugin's view: the timeline's rows in date order, one opening on a click", async ({
  page,
}) => {
  test.skip(
    !hasPlugin("catvinci.database") || !hasPlugin("catvinci.timeline"),
    "no plugins checkout",
  );
  await openWithPlugins(page, {
    plugins: {
      "catvinci.database": permissions("catvinci.database"),
      "catvinci.timeline": permissions("catvinci.timeline"),
    },
    folder: {
      "/work/notes/launch.md": "---\ndue: 2026-11-20\n---\n\nLaunch day\n",
      "/work/notes/plan.md": "---\ndue: 2026-11-01\n---\n\nThe plan\n",
      "/work/notes/tasks.base":
        "views:\n  - type: catvinci.timeline#timeline\n    name: Timeline\n",
    },
  });
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__devPickFolder = "/work";
  });
  await emit(page, "menu-open-folder");
  await expect(page.locator(".tree-row").first()).toBeVisible();
  await openPath(page, "/work/notes/tasks.base");
  const rows = tabFrame(page).locator(".plugin-view [data-row]");
  await expect(rows).toHaveCount(2);
  await expect(rows).toHaveText([/plan/, /launch/]);
  await rows.first().click();
  await expect(page.locator(".tab-pill").last()).toContainText("plan.md");
});

test("a folder a plugin opens as one document: one row in the sidebar, its text in a tab named after it", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.textbundle"), "no plugins checkout");
  await openWithPlugins(page, {
    plugins: { "catvinci.textbundle": [] },
    folder: {
      "/work/Trip.textbundle/text.md": "# Trip\n\nThe road north.\n",
      "/work/Trip.textbundle/info.json": "{}",
      "/work/notes.md": "Notes\n",
    },
  });
  test.skip(
    !(await pluginRuns(page, "catvinci.textbundle")),
    "made for the next version",
  );
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__devPickFolder = "/work";
  });
  await emit(page, "menu-open-folder");
  const bundle = page.locator('.tree-row[data-path="/work/Trip.textbundle"]');

  await expect(bundle).toHaveClass(/tree-row-file/);
  await bundle.dblclick();
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("The road north.");
  await expect(page.locator(".tab-pill").last()).toContainText(
    "Trip.textbundle",
  );
  await expect(bundle).toHaveClass(/tree-row-active/);
  // Nothing inside it is listed on its own.
  await expect(page.locator('.tree-row[data-path$="info.json"]')).toHaveCount(
    0,
  );
  // Renamed in the sidebar, the whole folder goes, its tab with it.
  await bundle.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Journey.textbundle");
  await page.keyboard.press("Enter");
  await expect(
    page.locator('.tree-row[data-path="/work/Journey.textbundle"]'),
  ).toHaveClass(/tree-row-active/);
  await expect(page.locator(".tab-pill").last()).toContainText(
    "Journey.textbundle",
  );
});

/** A plugin giving one file icon theme, "Test Icons" (`local.icons#test`):
 *  Markdown files and a docs folder, Markdown in another icon when light. */
async function withIconTheme(page: Page) {
  const svg = (color: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="${color}"/></svg>`;
  const manifest = {
    id: "local.icons",
    name: "Test Icons",
    version: "1.0.0",
    publisher: "local",
    engines: { textus: ">=1.4.0" },
    permissions: [],
    contributes: {
      fileIconThemes: [{ id: "test", label: "Test Icons", path: "theme.json" }],
    },
  };
  const theme = {
    iconDefinitions: {
      md: { iconPath: "icons/md.svg" },
      mdLight: { iconPath: "icons/md-light.svg" },
      docs: { iconPath: "icons/docs.svg" },
    },
    fileExtensions: { md: "md" },
    folderNames: { docs: "docs" },
    light: { fileExtensions: { md: "mdLight" } },
  };
  await page.addInitScript(
    ({ manifest, files }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: `/plugins/${manifest.id}`,
          manifest: JSON.stringify(manifest),
          dev: false,
          files,
        },
      ];
      w.__devFs = { "/work/notes.md": "# Notes\n", "/work/docs/a.md": "A\n" };
      w.__devPluginState = {
        allOn: true,
        plugins: { [manifest.id]: { enabled: true, granted: [] } },
      };
      w.__devPickFolder = "/work";
    },
    {
      manifest,
      files: {
        "theme.json": JSON.stringify(theme),
        "icons/md.svg": svg("red"),
        "icons/md-light.svg": svg("green"),
        "icons/docs.svg": svg("blue"),
      },
    },
  );
}

test("a plugin's file icon theme, picked in Settings, draws the sidebar's icons until Default is picked again", async ({
  page,
}) => {
  await withIconTheme(page);
  await openApp(page);
  await emit(page, "menu-open-folder");
  const note = page.locator('.tree-row[data-path="/work/notes.md"] .tree-icon');
  const docs = page.locator('.tree-row[data-path="/work/docs"] .tree-icon');
  await expect(note).toHaveJSProperty("tagName", "svg");

  // Settings takes the sidebar; the rail's Files brings the tree back.
  const pick = async (option: string) => {
    await emit(page, "menu-settings");
    await page.getByRole("button", { name: "外观" }).first().click();
    await page.getByRole("combobox", { name: "文件图标" }).click();
    await page.getByRole("option", { name: option }).click();
    await page.getByRole("button", { name: "文件树" }).click();
  };
  await pick("Test Icons");
  await expect(note).toHaveJSProperty("tagName", "IMG");
  await expect(note).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await expect(docs).toHaveJSProperty("tagName", "IMG");

  await pick("默认");
  await expect(note).toHaveJSProperty("tagName", "svg");
  await expect(docs).toHaveJSProperty("tagName", "svg");
});

test("a file icon theme chosen before the window opens draws as soon as its plugin loads, light and dark", async ({
  page,
}) => {
  await withIconTheme(page);
  await openApp(page, { settings: { fileIconTheme: "local.icons#test" } });
  await emit(page, "menu-open-folder");
  const note = page.locator('.tree-row[data-path="/work/notes.md"] .tree-icon');
  await expect(note).toHaveJSProperty("tagName", "IMG");
  const light = await note.getAttribute("src");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(note).not.toHaveAttribute("src", light!);
  await expect(note).toHaveJSProperty("tagName", "IMG");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(note).toHaveAttribute("src", light!);
});
