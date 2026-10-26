import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Code blocks a plugin draws (textus.views.registerCodeBlock,
 * document-view/plugins/plugin-code-blocks.ts): its page below a block in its
 * language, the source hidden until the caret goes back; typing tells the
 * page (CodeBlock.onDidChange), and the page can change the source
 * (setSource, with editor.write). The fence's words after the language
 * reach it as `block.meta`, and an export puts the page's picture
 * (onExport) where the block was.
 */

const HOST = `
exports.activate = function () {
  textus.views.registerCodeBlock("shout", {
    render: function (block, webview) {
      webview.html =
        '<p id="out"></p><button id="set">Set</button>' +
        '<script>' +
        'textus.onMessage(function (m) { document.getElementById("out").textContent = m.text; });' +
        'textus.onExport(function (o) { return "<svg><text>" + o.theme + ":" + document.getElementById("out").textContent + "</text></svg>"; });' +
        'document.getElementById("set").onclick = function () { textus.postMessage("set"); };' +
        '</script>';
      var shout = function (source) {
        return source.toUpperCase() + (block.meta.mark || "");
      };
      webview.postMessage({ text: shout(block.source) });
      block.onDidChange(function (source) {
        webview.postMessage({ text: shout(source) });
      });
      webview.onDidReceiveMessage(function () {
        block.setSource("set by the page");
      });
    },
  });
};
`;

const ENTRY = {
  id: "test.shout",
  dir: "/plugins/test.shout",
  manifest: JSON.stringify({
    id: "test.shout",
    name: "Shout",
    version: "1.0.0",
    publisher: "test",
    description: "Draws shout blocks in capitals.",
    engines: { textus: "^1.3.0" },
    main: "host.js",
    permissions: ["editor.write"],
    contributes: { codeBlocks: [{ language: "shout", title: "Shout" }] },
  }),
  dev: false,
  files: { "host.js": HOST },
};

async function open(page: Page) {
  await page.addInitScript((entry) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPlugins = [entry];
    w.__devPluginState = {
      allOn: true,
      plugins: { [entry.id]: { enabled: true, granted: ["editor.write"] } },
    };
    w.__devFs = {
      "/work/a.md": "# A\n\n```shout mark=!\nhello\n```\n\nAfter.\n",
    };
  }, ENTRY);
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-recent", "/work/a.md"),
  );
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText("A");
}

const editor = '[data-active-tab="true"] .ProseMirror';

test("a plugin draws its code block, follows its source and can change it", async ({
  page,
}) => {
  await open(page);
  const frame = page
    .frameLocator(`${editor} .plugin-code-block iframe`)
    .first();
  await expect(frame.locator("#out")).toHaveText("HELLO!");
  // The source hides while the caret is elsewhere.
  await expect(page.locator(`${editor} pre`)).toBeHidden();

  // Edit Source: the caret in it, the source back; typing reaches the page.
  await page.locator(`${editor} .plugin-code-block`).hover();
  await page.getByRole("button", { name: "Edit Source" }).click();
  await expect(page.locator(`${editor} pre`)).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.type(" there");
  await expect(frame.locator("#out")).toHaveText("HELLO THERE!");

  // The page sets the source: one undo step in the document.
  await frame.locator("#set").click();
  await expect(page.locator(`${editor} pre`)).toContainText("set by the page");
  await expect(frame.locator("#out")).toHaveText("SET BY THE PAGE!");
});

/** Exports the document as HTML; the file's text, once it is written. */
async function exportHtml(page: Page): Promise<string> {
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
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/doc.html");
      if (cmd === "write_text_file") {
        w.__written = String(args?.contents ?? "");
        return Promise.resolve();
      }
      return invoke(cmd, args);
    };
    w.__devEmitTauriEvent("menu-export-html");
  });
  const written = () =>
    page.evaluate(
      () => (window as unknown as { __written?: string }).__written ?? "",
    );
  await expect.poll(written).toContain("</html>");
  return written();
}

test("an export puts the page's picture where the block was", async ({
  page,
}) => {
  await open(page);
  const frame = page
    .frameLocator(`${editor} .plugin-code-block iframe`)
    .first();
  await expect(frame.locator("#out")).toHaveText("HELLO!");
  const html = await exportHtml(page);
  const exported = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const img = doc.querySelector<HTMLImageElement>("img.drawn-block-picture");
    return {
      picture: img ? decodeURIComponent(img.src) : null,
      frames: doc.querySelectorAll("iframe").length,
    };
  }, html);
  expect(exported.picture).toContain("<text>light:HELLO!</text>");
  expect(exported.frames).toBe(0);
  // Nothing of the export is left on the page.
  await expect(page.locator("[data-export-picture]")).toHaveCount(0);
});
