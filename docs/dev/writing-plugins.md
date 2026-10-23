# Writing a plugin

A Textus plugin is a folder: a manifest, `textus-plugin.json`, and its
JavaScript. Its code runs in a sandboxed frame that reaches nothing of the
app or your files except through `textus`, the API below, and every call
is checked against the permissions the user granted. What a plugin draws
it draws in webviews, frames of its own HTML, as VS Code's extensions do.

No plugin comes with Textus. The official ones live in their own
repository, [CatVinci-Studio/textus-plugins](https://github.com/CatVinci-Studio/textus-plugins),
and Settings › Extensions › Plugins › **Get plugins** installs them from its catalog.
They are plugins like any other and the best examples: the Image Viewer
is the smallest custom editor, Quick Notes a sidebar tab, Tasks a plugin
that reads and writes the folder. The design behind all of this is
[docs/design/plugins.md](../design/plugins.md).

## Trying one

1. Make a folder with a `textus-plugin.json` and a `host.js`.
2. Settings › Extensions › Plugins › Install a plugin › **Load a plugin folder…**, and
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
  "engines": { "textus": "^1.2.0" },
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
  interface's language, then its base language (`zh` for `zh-Hant`), then
  English. The plugin's code reads the same table with
  `textus.l10n.t(key, ...args)`, a webview with `api.t(key, ...args)`;
  `{0}`, `{1}`… in a string are the arguments. Textus speaks `en`, `zh`,
  `zh-Hant`, `ja`, `ko`, `es`, `fr`, `de`, `ru` and `pt`.
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
| `editor.input`     | take the editor's keys and move, select and edit with them (Vim, Emacs)         |
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
  plugin opens that type; `textus.save` is File › Save.
- `textus.window` -
  - `showMessage(text, { tone })`, `showInput({ prompt, value })` (the
    text, or null), `showQuickPick(items, { placeholder })` (the chosen
    item's `value`, or null);
  - `openFile(path, { heading })`, `openUntitled(text)`, `openView(id,
{ title, state })`, `openWebPage(url)` (a web page in a tab, with its
    own origin and cookies; needs `network:` for its host),
    `openExternal(url)` (the browser);
  - `splitEditor(direction)`: the document in front beside another tab
    (`"row"`, side by side) or above it (`"column"`); with one tab, a
    blank one is opened for the second pane, and already split, the panes
    turn that way. `closeSplit()` goes back to one document, and
    `layout()` says what is shown (`{ split: "row" | "column" | null,
ratio }`). The app draws the panes and the line between them; a click
    in a pane brings its tab to the front, and a tab chosen from the tab
    bar opens in the pane in front;
  - `setStatusItem(id, { text, tooltip?, command? })`: a short status in
    the window bar beside the word count, which runs `command` when
    clicked; its `dispose()`, or the plugin stopping, takes it away;
  - `registerWebviewViewProvider(id, { resolveWebviewView(webview, { state }) })`
    for a sidebar tab or a view, `registerCustomEditorProvider(viewType,
{ resolveCustomEditor(document, webview) })`, `registerSettingsPage({
resolveSettingsPage(webview) })`.
- `textus.document` - `getText()`, `getPath()`, `getSelection()` (`{ text,
markdown }`), `getOutline()` (its headings: `[{ level, text, line }]`),
  `getBlocks()` (`[{ id, markdown, kind }]`, the editor's blocks as Textus
  AI is shown them), `proposeEdit({ action, text, block?, lastBlock?,
anchor?, reason? })` (actions: `insert_at_cursor`, `replace_selection`,
  `append`, `replace`, `insert_before`, `insert_after`, `delete`; the four
  last name the block they change by its `id` - `lastBlock` for a run of
  them - and `anchor` quotes a few words inside it, left out for the whole
  block), `onDidChangeActive(fn)`.
- `textus.editor.registerHoverProvider({ provideHover(target) })` - a
  card for what the pointer rests on in the editor (needs
  `document.read`). `target` is `{ type: "document", path, heading }` (a
  Markdown link or a wikilink, found where it points), `{ type: "link",
url }` (any other link, `zotero://` among them) or `{ type: "citation",
key }` (`[@key]`); return `{ title, markdown }`, or null to let the next
  provider answer. The app draws the card beside the link, without
  pictures, and the user can pin it. Quick Preview and Zotero are
  examples.
- `textus.editor` (`editor.input`) - `captureKeys({ mode, keys })`: the
  editor's keys come to the plugin instead of typing. `mode: "all"` takes
  every key but the app's shortcuts (⌘ on a Mac, Ctrl elsewhere) unless
  `keys` names them; `mode: "some"` takes only `keys`, and typing stays
  the editor's. Keys are named as `ctrl+f`, `alt+<`, `shift+Tab`,
  `Escape`, `j` (an Option chord by the key pressed: `alt+f`, not `ƒ`);
  `captureKeys(null)` gives them back. `onKey(fn)` hears each one, and
  `exec(op)` acts on the document - only within a few seconds of a key,
  so a plugin can't edit behind the user's back. Ops: `move` (`unit`:
  `left`, `right`, `charForward`, `charBack`, `up`, `down`, `wordStart`,
  `wordEnd`, `wordBack`, `lineStart`, `lineFirstChar`, `lineEnd`,
  `lineEndInsert`, `paragraphNext`, `paragraphPrev`, `docStart`,
  `docEnd`, `findChar`; `count`, `select`), `visualStart`, `selectLines`,
  `delete`, `deleteLines`, `copy`, `copyLines`, `deleteChars`,
  `insertText`, `pasteLines`, `openLine`, `replaceChar`, `collapse`,
  `undo`, `redo`, `cursor` (`bar` or `block`), and `flash`, `flashJump`,
  `flashClear` (labels on screen to jump to). Each change is its own undo
  step; a delete or copy answers with the `text` it took. The Vim and
  Emacs plugins in textus-plugins use all of it.
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
- `textus.l10n` - `t(key, ...args)`: a string of the manifest's `l10n` in
  the interface's language.

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
- Motion is Textus's own too. A part of the panel arriving takes
  `animation: motion-enter var(--dur-medium) var(--ease-out) backwards`,
  from where `--enter-x`, `--enter-y` and `--enter-scale` say (a fade in
  place when unset); one leaving, `motion-exit var(--dur-fast)
var(--ease-in) forwards` with `--exit-x`, `--exit-y`, `--exit-scale`.
  What is about to change can be marked for a moment with the
  `motion-mark` class. The durations (`--dur-fast`, `--dur-base`,
  `--dur-medium`, `--dur-slow`), curves (`--ease-out`, `--ease-in`,
  `--ease-in-out`) and distances (`--motion-distance-sm`, `-md`) are the
  window's, so with the system's Reduce motion a plugin's moves become
  fades with the app's. Animate only `opacity` and `transform`.
- `api.language` is the interface's language, and `api.t(key, ...args)`
  a string of the manifest's `l10n` in it.

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
