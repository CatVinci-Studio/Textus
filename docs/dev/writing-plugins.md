# Writing a plugin

A Textus plugin is a folder: a manifest, `textus-plugin.json`, and its
JavaScript. Its code runs in a sandboxed frame that reaches nothing of the
app or your files except through `textus`, the API below, and every call
is checked against the permissions the user granted. What a plugin draws
it draws in webviews, frames of its own HTML, as VS Code's extensions do.

No plugin comes with Textus. The official ones live in their own
repository, [CatVinci-Studio/textus-plugins](https://github.com/CatVinci-Studio/textus-plugins),
and Settings › Plugins › **Get plugins** installs them from its catalog.
They are plugins like any other and the best examples: the Image Viewer
is the smallest custom editor, Quick Notes a sidebar tab, Tasks a plugin
that reads and writes the folder. The design behind all of this is
[docs/design/plugins.md](../design/plugins.md).

## Trying one

1. Make a folder with a `textus-plugin.json` and a `host.js`.
2. Settings › Plugins › Install a plugin › **Load a plugin folder…**, and
   choose it. It is listed under Installed, marked _development_.
3. Turn it on. Its card opens its page; **Reload** there reads it again
   after you change it.

To share it, zip the folder and name the file `<id>.textusplugin`;
**Install from file…** installs that.

## The manifest

```jsonc
{
  "id": "yourname.word-count", // publisher.name, lowercase
  "name": "Word Count",
  "version": "1.0.0",
  "publisher": "yourname",
  "author": "Your Name", // shown on its card; the publisher where there is none
  "description": "Counts the words of the selection.",
  "icon": "icon.svg",
  "engines": { "textus": "^1.3.0" },
  "main": "host.js", // or ["shared.js", "host.js"], run in order
  "activationEvents": [], // ["onStartupFinished"] to start with Textus
  "permissions": ["document.read"],
  // A Textus setting it needs on to do all it does; turning the plugin on
  // offers to turn it on, and its page says whether it is.
  "requires": [{ "setting": "runInBackground", "reason": "%whyBackground%" }],
  "contributes": {
    "commands": [
      { "command": "yourname.word-count.count", "title": "Count Words" },
    ],
    "keybindings": [
      { "command": "yourname.word-count.count", "key": "mod+alt+w" },
    ],
    "menus": {
      "editor/context": [
        {
          "command": "yourname.word-count.count",
          "when": "editorHasSelection",
        },
      ],
      "app/plugins": [{ "command": "yourname.word-count.count" }],
    },
  },
  "l10n": { "zh": { "...": "..." } },
}
```

- Every id a plugin contributes - commands, views, sidebar tabs, custom
  editors - starts with the plugin's own id and a dot.
- A string the user sees may be `%key%`, looked up in `l10n` for the
  interface's language, then English.
- A plugin starts the first time something it adds is used - its command
  run, its tab opened - and not before, unless it asks for
  `onStartupFinished`.

What `contributes` takes:

| Key             | What it adds                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`      | Commands: `{ command, title }`.                                                                                                                                                                                                                           |
| `keybindings`   | A shortcut for a command, as Settings writes them (`mod+alt+w`). Textus's own shortcuts win a clash.                                                                                                                                                      |
| `menus`         | `editor/context` (the editor's right-click menu; `when: "editorHasSelection"`), `app/plugins` (the Plugins menu) and `app/tray` (the menu of background mode's tray or menu-bar icon: there with every window closed, it opens one and runs the command). |
| `sidebarTabs`   | `{ id, title, icon }`: a sidebar tab whose panel is a webview. The icon is an SVG, drawn in the text colour.                                                                                                                                              |
| `views`         | `{ id, title }`: a view the plugin opens in a tab of its own (`textus.window.openView`).                                                                                                                                                                  |
| `customEditors` | `{ viewType, displayName, filenamePatterns: ["*.pdf"] }`: a file type opened in the plugin's tab instead of as a document.                                                                                                                                |
| `settings`      | `{ key, type: boolean \| string \| number \| enum, default, title, description?, options? }`: rows on the plugin's page in Settings, drawn as Textus's own.                                                                                               |
| `settingsPage`  | `{ title }`: a page of the plugin's own under its settings, a webview.                                                                                                                                                                                    |

## Permissions

A plugin asks for these in `permissions`; the user grants them all when
turning it on, or leaves it off, and can take each back later.

| Permission         | Lets the plugin                                                                 |
| ------------------ | ------------------------------------------------------------------------------- |
| `document.read`    | read the document in front, its path and selection                              |
| `document.propose` | suggest edits to it, shown as Textus AI's are, accepted or rejected by the user |
| `workspace.read`   | list, find and read files in the open folder                                    |
| `workspace.write`  | create and change files in the open folder                                      |
| `clipboard`        | read and write the clipboard                                                    |
| `network:<host>`   | fetch from that host over HTTPS (`*.example.com`, `host:port`, `*` for any)     |

A plugin never writes a document by itself: an edit is a proposal. Files
are read and written only inside the open folder, never the app's own;
plain HTTP goes only to this computer (`network:localhost:23119`).

## The `textus` API

`host.js` runs as a CommonJS module, with `textus` in scope:

```js
exports.activate = function () {
  textus.commands.registerCommand("yourname.word-count.count", async () => {
    const selection = await textus.document.getSelection();
    const words = selection.text.split(/\s+/).filter(Boolean).length;
    await textus.window.showMessage(words + " words");
  });
};
```

Every call returns a promise. By namespace:

- `textus.commands` - `registerCommand(id, run)`, `executeCommand(id, ...args)`
  (any command: the app's, or another plugin's). Textus's
  `textus.openAsDocument(path)` opens a file as a document even where a
  plugin opens that type.
- `textus.window` -
  - `showMessage(text, { tone })`, `showInput({ prompt, value })` (the
    text, or null), `showQuickPick(items, { placeholder })` (the chosen
    item's `value`, or null);
  - `openFile(path, { heading })`, `openUntitled(text)`, `openView(id,
{ title, state })`, `openWebPage(url)` (a web page in a tab, with its
    own origin and cookies; needs `network:` for its host),
    `openExternal(url)` (the browser);
  - `setStatusItem(id, { text, tooltip?, command? })`: a short status in
    the window bar beside the word count, which runs `command` when
    clicked; its `dispose()`, or the plugin stopping, takes it away;
  - `registerWebviewViewProvider(id, { resolveWebviewView(webview, { state }) })`
    for a sidebar tab or a view, `registerCustomEditorProvider(viewType,
{ resolveCustomEditor(document, webview) })`, `registerSettingsPage({
resolveSettingsPage(webview) })`.
- `textus.document` - `getText()`, `getPath()`, `getSelection()` (`{ text,
markdown }`), `getOutline()` (its headings: `[{ level, text, line }]`),
  `proposeEdit({ action, text, anchor?, reason? })`
  (actions: `insert_at_cursor`, `replace_selection`, `append`, `replace`,
  `insert_before`, `insert_after`, `delete`), `onDidChangeActive(fn)`.
- `textus.workspace` - `rootPath()`, `list(path)`, `findDocuments()`,
  `readFile(path)` (bytes), `readText(path)`, `writeText(path, text)`,
  `writeFile(path, bytes)`, `rename(from, to)`, `trash(path)` (to the
  system Trash, never deleted for good), `createFolder(path)`,
  `onDidSaveDocument(fn)` (`{ path, text }`),
  `onDidChangeRoot(fn)`.
- `textus.net` - `fetch(url, { method, headers, body })`: a response with
  `status`, `ok`, `headers`, `text()`, `json()`, `bytes()`.
- `textus.storage` - `get(key)`, `set(key, value)`: the plugin's own, up to
  50 MB, `null` deletes.
- `textus.settings` - `get(key)` (the user's value or the manifest's
  default), `onDidChange(fn)`.
- `textus.clipboard` - `readText()`, `writeText(text)`.
- `textus.plugin` - `id`, `version`, `readFile(path)`, `readText(path)`:
  the plugin's own files.
- `textus.env` - `language`, `appVersion`, `platform`, `theme` (`light` or
  `dark`), `onDidChangeTheme(fn)`, `onDidChangeLanguage(fn)`.

Every `register…` and `on…` returns `{ dispose() }`.

## Webviews

A webview is a sandboxed frame of HTML the plugin sets:

```js
resolveWebviewView: async function (webview) {
  webview.onDidReceiveMessage((message) => {
    if (message.type === "hello") webview.postMessage({ type: "hi" });
  });
  webview.html = await textus.plugin.readText("panel.html");
}
```

```html
<link rel="stylesheet" href="textus-resource:panel.css" />
<button id="hello">Hello</button>
<script>
  const api = acquireTextusApi();
  api.onMessage((m) => console.log(m.type));
  document.getElementById("hello").onclick = () =>
    api.postMessage({ type: "hello" });
</script>
<script src="textus-resource:panel.js"></script>
```

- `textus-resource:<path>` names one of the plugin's files; Textus puts
  the file in its place (`webview.asWebviewUri(path)` writes the same).
- A webview has no network and no storage of the browser's: what it needs
  it asks its plugin for, with `postMessage`. `api.getState()` and
  `api.setState(value)` keep a little state while Textus runs, so a panel
  closed and opened again can pick up where it was.
- The theme's colours and sizes are CSS variables (`--bg`,
  `--editor-text`, `--chrome-accent`, `--border-color`, `--sidebar-bg`,
  `--font-sans`, `--text-sm`, `--space-3`, …) that follow the theme and
  dark mode, and buttons, inputs, `.toolbar`, `.list` and `.empty` look as
  they do in Settings without any CSS of yours.
- `api.language` is the interface's language.

## What a plugin can't do

Change the editor itself (its schema, keys, rendering), draw over the
document, read another plugin's data, run native code, or reach the
network or files beyond what it was granted. A plugin that stops
answering, or throws more than ten errors a minute, is turned off and the
user is told.

## Publishing

To give a plugin to someone, zip its folder; they install it with
**Install from file…**. The official plugins are published from
[textus-plugins](https://github.com/CatVinci-Studio/textus-plugins): a
push to its main branch packages each new version as a release of its
own and rebuilds the catalog Textus reads, and Textus checks every
package against the catalog's SHA-256 before it installs it. A plugin
from the catalog by CatVinci Studio is marked Official. A way to list
your own plugins there is coming with the plugin market.
