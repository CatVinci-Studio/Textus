import { expect, test, type Page } from "@playwright/test";
import { devDisk, emit, openApp } from "./helpers";
import { openPath } from "./plugin-helpers";

const TEX =
  "\\documentclass{article}\r\n% a comment\r\n\\section{Intro}\r\nSee [x](a%20b) and **this**.";
const BIB = "@article{knuth1984,\n  title = {Literate {P}rogramming},\n}\n";

/** A disk with a LaTeX and a BibTeX file; with `plugin`, one that edits
 *  both as text, BibTeX from its own grammar. */
async function withTexFiles(page: Page, plugin: boolean) {
  const manifest = {
    id: "local.tex",
    name: "Test TeX",
    version: "1.0.0",
    publisher: "local",
    engines: { textus: ">=1.4.0" },
    main: "host.js",
    activationEvents: ["onStartupFinished"],
    permissions: ["editor.read", "files.write"],
    contributes: {
      textFiles: [
        { extensions: ["tex"], language: "latex" },
        { extensions: ["bib"], language: "bibtex" },
      ],
      codeLanguages: [{ id: "bibtex", path: "bibtex.json" }],
    },
  };
  // A Markdown tool's habits: it rewrites on save and underlines every
  // block. Neither may reach a text file.
  const host = `exports.activate = function () {
    textus.files.onWillSave(function (e) { return e.text.split("**").join("__"); });
    textus.editor.registerDiagnostics("all", {
      check: function (blocks) {
        return blocks.map(function (b) { return { block: b.id, severity: "warning", message: "Markdown rule" }; });
      },
    });
  };`;
  const grammar = {
    rules: [
      { token: "keyword", match: "@[a-z]+" },
      { token: "attribute", match: "[a-z]+(?=\\s*=)" },
    ],
  };
  await page.addInitScript(
    ({ manifest, grammar, host, plugin, files }) => {
      if (window.top !== window) return;
      const w = window as unknown as Record<string, unknown>;
      w.__devFs = files;
      if (!plugin) return;
      w.__devPlugins = [
        {
          id: manifest.id,
          dir: `/plugins/${manifest.id}`,
          manifest: JSON.stringify(manifest),
          dev: false,
          files: { "bibtex.json": JSON.stringify(grammar), "host.js": host },
        },
      ];
      w.__devPluginState = {
        allOn: true,
        plugins: {
          [manifest.id]: {
            enabled: true,
            granted: ["editor.read", "files.write"],
          },
        },
      };
    },
    {
      manifest,
      grammar,
      host,
      plugin,
      files: {
        "/work/paper.tex": TEX,
        "/work/refs.bib": BIB,
        "/work/notes.md": "Some notes.\n",
      },
    },
  );
  await openApp(page);
}

const source = (page: Page) =>
  page.locator('[data-active-tab="true"] .source-view .cm-content');

test("a text file that isn't a document shows as its own text, read-only, whatever the window's view", async ({
  page,
}) => {
  await withTexFiles(page, false);
  await openPath(page, "/work/paper.tex");
  await expect(source(page)).toBeVisible();
  // Its lines as written, nothing read as Markdown.
  await expect(source(page).locator(".cm-line")).toHaveCount(4);
  await expect(source(page)).toContainText("**this**");
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toHaveCount(0);
  await expect(source(page)).toHaveAttribute("aria-readonly", "true");
});

test("a type a plugin takes is edited as text, coloured, and saved exactly as typed", async ({
  page,
}) => {
  await withTexFiles(page, true);
  // The plugin is at work on a document.
  await openPath(page, "/work/notes.md");
  await expect(
    page.locator('[data-active-tab="true"] .plugin-issue'),
  ).not.toHaveCount(0);
  await openPath(page, "/work/refs.bib");
  await expect(source(page)).toBeVisible();
  // Coloured from the plugin's grammar.
  await expect(
    source(page).locator(".cm-line").first().locator("span").first(),
  ).toHaveText("@article");

  await openPath(page, "/work/paper.tex");
  await expect(source(page).locator(".cm-line")).toHaveCount(4);
  await expect(source(page)).not.toHaveAttribute("aria-readonly", "true");
  await source(page).locator(".cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await emit(page, "menu-save-file");
  await expect
    .poll(async () => (await devDisk(page))["/work/paper.tex"])
    .toBe(`${TEX}!`);
  await expect(
    page.locator('[data-active-tab="true"] .plugin-issue'),
  ).toHaveCount(0);
});
