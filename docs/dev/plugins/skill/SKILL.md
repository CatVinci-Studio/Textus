---
name: textus-plugin
description: >-
  Writes plugins for Textus, the Markdown editor and writing app: commands,
  menus, sidebar lists and pages, code blocks, file viewers, floating views,
  tools for Textus AI. Use when asked to make, change or fix a Textus plugin,
  or to explain its API (textus.d.ts, textus-plugin.json).
license: MIT
---

# Writing a Textus plugin

A plugin is a folder: `textus-plugin.json` (the manifest), `host.js` (its
code), any pages it draws (`*.html`, `*.css`, `*.js`) and a `README.md`.
The code runs in a hidden, sandboxed frame and reaches Textus only through
the `textus` object; pages are sandboxed frames that talk to the code with
messages. The full API is in [references/textus.d.ts](references/textus.d.ts)
(read the parts you use) and [references/reference.md](references/reference.md).

## The manifest

```json
{
  "id": "jane.word-count",
  "name": "Word Count",
  "version": "0.1.0",
  "publisher": "jane",
  "description": "Counts the words of the document in front.",
  "engines": { "textus": ">=1.3.10" },
  "platforms": ["desktop", "ios"],
  "main": "host.js",
  "permissions": ["editor.read"],
  "contributes": {
    "commands": [
      { "command": "jane.word-count.count", "title": "Count Words" }
    ],
    "menus": { "app/plugins": [{ "command": "jane.word-count.count" }] }
  }
}
```

- The `id` is `<publisher>.<name>`; every command, view and tab id starts
  with it.
- `engines.textus` is the oldest Textus with every call the code makes.
  `dates`, `templates`, `files.appSettings` and `layout.panels` need
  `">=1.3.10"`.
- `permissions` lists only what the code uses: `editor.read`,
  `editor.write`, `editor.propose`, `editor.input`, `files.read`,
  `files.write` (includes reading), `project.data`, `clipboard`,
  `notifications`, `ai.tools`, `network:<host>`. A call without its
  permission fails; a completion without `editor.read` is silently left
  out.
- A menu item's `when` reads only `editorHasSelection`, `documentOpen`,
  `folderOpen`, `fileExtension == .md`, `resourceFilename`,
  `resourcePath`, `isMac`, `view == <id>`.
- Strings go in `l10n` per language and are named `%key%` in the
  manifest; `textus.l10n.t(key)` in the code.

## The code

```js
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.commands.register("jane.word-count.count", async () => {
      const text = (await textus.editor.getText()) ?? "";
      textus.ui.notice(`${text.split(/\s+/).filter(Boolean).length} words`);
    }),
  );
};
```

- `host.js` has no DOM: anything it draws there never shows. Draw in a
  webview (`textus.views.registerWebview`) or ask Textus to draw a list
  (`"type": "list"` views and sidebar tabs).
- Files: `textus.files.*`, paths absolute or relative to the open folder;
  how the folder is written (Obsidian, Logseq…) is
  `textus.files.conventions()` - read it instead of another app's
  settings files, and `textus.files.appSettings("obsidian", file)` for the
  rest.
- Links: `textus.metadata.linkTo(to, from)` writes a link the way the
  folder does; never build `[[…]]` by hand.
- Dates and templates: `textus.dates.format(date, "YYYY-MM-DD")`,
  `textus.dates.parse(text, format)`, and
  `textus.templates.fill(text, { title, values, date, format })` fill
  Obsidian's `{{date}}`-style templates and Templater's common tags.
- Data: `ctx.storage.global` (Textus's config folder),
  `ctx.storage.project` (the open folder, needs `project.data`),
  `ctx.storage.document(path)`; settings from `contributes.settings` via
  `textus.settings.get(key)`.

## Pages

- `acquireTextusApi()` gives `postMessage`, `onMessage`, `getState`,
  `setState`, `menu(items, element)` (Textus's own menu) and `onExport`.
- Textus's look comes free: buttons and inputs, and the `tx-` classes
  (`tx-bar`, `tx-button`, `tx-icon-button`, `tx-segmented`, `tx-chip`,
  `tx-tag`, `tx-card`, `tx-table`, `tx-empty`, `tx-icon`). Colours,
  sizes and shapes only from Textus's CSS variables (`--ui-*`, `--doc-*`,
  `--text-*`, `--space-*`, `--shape-*`). Animate only opacity and
  transform.
- No HTML drag and drop (the window takes it): drag with pointer events.
- No network and no browser storage in a page: ask the code.

## Before you hand it over

- Every id the manifest declares is registered in the code; every
  permission the code needs is listed; `engines` holds the Textus it was
  written for.
- A README: `# Name`, one sentence on what it does, paragraphs on what it
  can do and how to reach it, then `## Changes`.
- A new version for every change once it is published.
