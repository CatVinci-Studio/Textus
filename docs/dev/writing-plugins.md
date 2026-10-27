# Writing a plugin

A Textus plugin is a folder: a manifest, `textus-plugin.json`, and its
JavaScript. Its code runs in a sandboxed frame that reaches nothing of the
app or your files except through `textus`, the plugin API, and every call
is checked against the permissions the user granted. What a plugin shows
it shows in lists and dialogs Textus draws, or in webviews - frames of its
own HTML - as VS Code's extensions do.

This page goes from a first plugin to a published one:

1. [Getting started](#getting-started) - a plugin that runs, in five minutes.
2. [The guide](#the-manifest) - the manifest, permissions, and the API by
   what you want to do.
3. [The reference](plugin-reference.md) - every call, generated from
   [textus.d.ts](textus.d.ts), the one source of truth for the API.
4. [Publishing](#publishing) - your plugin in its own repository, and
   listed in Textus.

No plugin comes with Textus. The official ones live in
[CatVinci-Studio/textus-plugins](https://github.com/CatVinci-Studio/textus-plugins)
and are the best examples: Tasks is a sidebar list over the folder, the
PDF Viewer a file editor, Zotero a hover card and a completion, Vim a way
of typing. The design behind the system is
[docs/design/plugins.md](../design/plugins.md).

## Getting started

1. Start from the template: copy
   [`template/`](https://github.com/CatVinci-Studio/textus-plugins/tree/main/template)
   from textus-plugins. It is a working plugin: a command and a sidebar
   list, in English and Chinese.
2. In Textus, **Settings › Extensions › Plugins › Install a plugin › Load a
   plugin folder…**, and choose the folder. It is listed under Installed,
   marked _development_; turn it on.
3. Change `host.js` and save: a folder you loaded is read again as it
   changes. Its page in Settings shows what it logged (`ctx.log`).

Or ask Textus AI: **Settings › Extensions › Plugins › Make your own**, or
"a plugin that …" in **Create** mode, writes one you can install from the
reply and change in the next message.

### A script: a plugin in one file

For something small, skip the folder and the manifest: put a `.js` file in
the scripts folder (**Install a plugin › Open Scripts Folder**, in the
global config folder), with what a manifest would say in a comment at its
top:

```js
// ==TextusScript==
// @name        Word Count
// @description Counts the words of the document in front.
// @permission  editor.read
// @command     count Count Words
// ==/TextusScript==
exports.activate = function () {
  textus.commands.register("local.word-count.count", async function () {
    const text = (await textus.editor.getText()) ?? "";
    textus.ui.notice(`${text.split(/\s+/).filter(Boolean).length} words`);
  });
};
```

Its id is `local.<file name>` unless `@id` gives one; `@command <name>
<title>` adds `<id>.<name>`; `@permission` and `@command` can repeat. A
script is listed under **Made by you**, starts off, asks for its
permissions like any plugin, runs once Textus has started, and is read
again when it changes. Uninstalling it moves the file to the Trash.

## The manifest

```jsonc
{
  "id": "jane.word-count", // publisher.name, lowercase and dashes
  "name": "%name%", // a %key% is looked up in l10n
  "version": "0.1.0",
  "publisher": "jane",
  "author": "Jane Doe", // on its card; the publisher where there is none
  "description": "%description%",
  "icon": "icon.svg",
  "license": "MIT",
  "repository": "https://github.com/jane/textus-word-count",
  "engines": { "textus": ">=1.3.0-beta.2" }, // the plugin API 1.0
  "main": "host.js", // or ["shared.js", "host.js"], run in order
  "permissions": ["editor.read"],
  "contributes": {
    "commands": [{ "command": "jane.word-count.count", "title": "%count%" }],
    "keybindings": [{ "command": "jane.word-count.count", "key": "mod+alt+w" }],
    "menus": {
      "editor/context": [
        { "command": "jane.word-count.count", "when": "editorHasSelection" },
      ],
      "app/plugins": [{ "command": "jane.word-count.count" }],
    },
  },
  "l10n": {
    "en": { "name": "Word Count", "description": "…", "count": "Count Words" },
    "zh": { "name": "字数", "description": "…", "count": "统计字数" },
  },
}
```

- Every id a plugin contributes - commands, views, sidebar tabs, file
  editors - starts with the plugin's own id and a dot.
- A string the user sees may be `%key%`, looked up in `l10n` for the
  interface's language, then its base language (`zh` for `zh-Hant`), then
  English. The code reads the same table with `textus.l10n.t(key,
...args)`, a webview with `api.t(key, ...args)`; `{0}`, `{1}`… are the
  arguments. Textus speaks `en`, `zh`, `zh-Hant`, `ja`, `ko`, `es`, `fr`,
  `de`, `ru` and `pt`.
- The manifest has a [JSON Schema](textus-plugin.schema.json):
  `"$schema": "https://raw.githubusercontent.com/CatVinci-Studio/Textus/main/docs/dev/textus-plugin.schema.json"`.

### When it starts

A plugin costs nothing until it is needed. Textus reads its manifest and
puts its commands, menus and tabs in place; its code starts the first time
one of them is used - its command run, its tab opened, its code block in
sight, a `textus://` link for it. `activationEvents` starts it earlier:

| Event               | Starts it                                                        |
| ------------------- | ---------------------------------------------------------------- |
| `onStartupFinished` | once the window is idle (for a status item, a background watch)  |
| `onEditor`          | once a document is open, when the window is idle (decorations)   |
| `onHover`           | when the pointer first rests on a link (a plugin of hover cards) |

What a plugin draws loads lazily too: lists, webviews and code blocks are
made when they are first shown.

### What `contributes` takes

| Key             | What it adds                                                                                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`      | Commands: `{ command, title }`.                                                                                                                                                                                                                                                                                        |
| `keybindings`   | A shortcut for a command, as Settings writes them (`mod+alt+w`). Textus's own shortcuts win a clash; the user can change or clear it in Settings › Shortcuts.                                                                                                                                                          |
| `menus`         | `editor/context` (the editor's right-click menu), `editor/slash` (offered when a word starts with `/`), `file/context` (a file's in the sidebar), `tab/context` (a tab's), `view/title` (buttons at the top of a sidebar view, with an `icon`), `app/plugins` (the Plugins menu), `app/tray` (background mode's icon). |
| `sidebarTabs`   | `{ id, title, type: "list" \| "webview", icon }`: a sidebar tab. A list is drawn by Textus from `views.registerList`; a webview is the plugin's page. The icon is an SVG drawn in the text colour.                                                                                                                     |
| `views`         | `{ id, title, type }`: the same, opened in a tab of its own (`textus.layout.openView`).                                                                                                                                                                                                                                |
| `customEditors` | `{ viewType, displayName, filenamePatterns: ["*.pdf"], priority }`: a file type opened in the plugin's tab instead of as a document.                                                                                                                                                                                   |
| `codeBlocks`    | `{ language, title }`: fenced blocks in that language drawn by the plugin (`views.registerCodeBlock`). Textus's own languages (mermaid, math…) can't be taken.                                                                                                                                                         |
| `completions`   | `{ id, where: "math" \| "text" \| "any", pattern }`: completions as you type when what is before the caret matches `pattern` (`editor.registerCompletion`).                                                                                                                                                            |
| `aiTools`       | `{ name, description, parameters }`: tools Textus AI can call (`ai.registerTool`); `parameters` is a JSON schema.                                                                                                                                                                                                      |
| `links`         | `{ pattern, command }`: web links Ctrl/Cmd+clicked in a document whose URL matches `pattern` run `command` with the URL.                                                                                                                                                                                               |
| `settings`      | Rows on the plugin's page in Settings, drawn as Textus's own: `{ key, type, default, title, description?, group?, when? }`. See [Settings of every kind](#settings-of-every-kind).                                                                                                                                     |
| `settingsPage`  | `{ title }`: a page of the plugin's own under its settings, a webview.                                                                                                                                                                                                                                                 |

A menu item's `when` is a small expression over the moment it is shown:
`editorHasSelection`, `resourceExtname == .pdf`, `view == jane.tasks.list`,
`isMac`, joined with `&&`, `||` and `!`.

## Permissions

A plugin asks for these in `permissions`; the user grants them when
turning it on, or leaves it off, and can take each back later.

| Permission       | Lets the plugin                                                                        |
| ---------------- | -------------------------------------------------------------------------------------- |
| `editor.read`    | read the document in front: its text, selection, blocks and outline                    |
| `editor.write`   | change it at once, each change one undo step                                           |
| `editor.propose` | suggest changes to it, shown as Textus AI's are, accepted or rejected by the user      |
| `editor.input`   | take the editor's keys and move, select and edit with them (Vim, Emacs)                |
| `files.read`     | list, find and read files in the open folder, and what Textus knows of them (metadata) |
| `files.write`    | create, change, rename and trash files in the open folder                              |
| `clipboard`      | read and write the clipboard                                                           |
| `project.data`   | keep its own data in the open folder, in `.textus/plugins/<id>/`                       |
| `ai.tools`       | give Textus AI tools to call                                                           |
| `network:<host>` | fetch from that host over HTTPS (`*.example.com`, `host:port`, `*` for the open web)   |

Ask for what the plugin's purpose explains, and no more: each permission
is shown to the user, and a listing in Textus asks why for the broad ones.
Files are reached only inside the open folder, never the app's own; plain
HTTP goes only to this computer (`network:localhost:23119`).

## The code

`host.js` runs as a CommonJS module with `textus` in scope. Put
`/// <reference path="textus.d.ts" />` at its top (copy
[textus.d.ts](textus.d.ts) beside it) and your editor completes every
call.

```js
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.commands.register("jane.word-count.count", async () => {
      const selection = await textus.editor.getSelection();
      if (!selection?.text) return textus.ui.message(textus.l10n.t("nothing"));
      const words = selection.text.split(/\s+/).filter(Boolean).length;
      await textus.ui.notice(textus.l10n.t("words", words));
    }),
  );
};
```

- `activate(ctx)` registers what the manifest declares. What it pushes to
  `ctx.subscriptions` - and everything it registered - is taken back when
  the plugin stops; `exports.deactivate` runs then, if there is one.
- Every call that reaches Textus returns a promise. Every `register…` and
  `on…` returns a Disposable (`dispose()`).
- Lines are counted from 0. A place is a `Location`: `{ path, line,
heading, block, text, page }` - enough of it to find the spot again.
- `ctx.plugin` is the plugin itself (`id`, `version`, `readText(path)` of
  its own files); `ctx.log.info/warn/error` show on its page in Settings.

The rest of this section goes by what you want to do. The
[reference](plugin-reference.md) has every call and type.

### Commands and dialogs - `commands`, `ui`

`commands.register(id, run)` for a command of the manifest's;
`commands.execute(id, ...args)` runs any command - Textus's own
(`textus.save`, `textus.closeTab` with `{ save: true }`) or another
plugin's. `ui` draws Textus's own dialogs: `message`, `notice` (a note
that goes by itself), `confirm`, `input`, `pick` (one or several of a
list), `form` (a few fields at once), `withProgress` (a bar with Cancel)
and `statusItem` (a short status in the window bar that runs a command
when clicked).

### The document in front - `editor`

- Read it: `getText()`, `getPath()`, `getSelection()`, `getOutline()`,
  and `getBlocks()` - its blocks as Textus AI is shown them, each with an
  `id` (a hash of its Markdown) and a `kind`.
- Change it: `insertText(text)`, `replaceSelection(text)`, or
  `edit(change)` (`editor.write`) - at once, one undo step each.
  `propose(change, { reason })` (`editor.propose`) shows the change for
  the user to accept or reject, as Textus AI's are. A change is placed by
  block: `{ action: "replace", block, text }`, `insert_after`,
  `insert_before`, `delete`, or `append` / `insert_at_cursor` /
  `replace_selection` without one; `anchor` quotes a few words inside the
  block to change only those. Read the blocks, then change them: an id
  from before an edit finds nothing rather than the wrong block.
- Mark it: `registerDecorations({ decorate(blocks) })` is asked for the
  blocks in sight once typing pauses, and answers marks - a highlight, an
  underline, muted text or a badge - on a block or the `anchor` words in
  it. Start it with `onEditor`.
- Help with it: `registerCompletion(id, provider)` for completions as you
  type, `registerHover({ provideHover(target) })` for a card over a link,
  a wikilink or a citation.
- Follow it: `onDidChangeActive`, `onDidChange` (once typing pauses),
  `onDidChangeSelection`; `reveal(location)` scrolls to a place.

### What a plugin shows - `views`

- **A list** (`registerList(id, provider)`) for anything that is rows:
  tasks, search results, a reading list. Textus draws it - groups,
  checkboxes, badges, a filter field, right-click actions, the keyboard -
  and an item with a `location` opens it when clicked. `refresh()` asks
  again; `setMessage(text)` puts a line over it.
- **A webview** (`registerWebview(id, { resolve(webview) })`) when the
  plugin draws something of its own: a graph, a board. See
  [Webviews](#webviews).
- **A file editor** (`registerFileEditor(viewType, { resolve(file, webview,
{ target }) })`) for a file type: the PDF Viewer, the Word reader.
  `file.readFile()` / `readText()` / `writeText()`, and
  `file.onDidRequestReveal` for a link to a place in a file already open.
- **A code block** (`registerCodeBlock(language, { render(block, webview) })`)
  for fenced blocks in its language: drawn below the block, which hides
  until the caret goes in; `block.onDidChange` hears the source change and
  `block.setSource(text)` (`editor.write`) changes it. What follows the
  language on the fence is `block.meta`: ` ```chart height=300
title="Sales" legend` gives `{ height: "300", title: "Sales",
legend: "true" }`. See [Code blocks in an export](#code-blocks-in-an-export).

### Tabs and panes - `layout`

`open(path or location, { where })` opens a file - `where: "beside"` in
the pane beside the one in front, splitting the window if it isn't -
`openView(id)`, `openWebPage(url)`, `openUntitled(text)` and
`openExternal(url)`. `tabs()`, `activeTab()` and `split()` say what is
open; `onDidChangeActiveTab` and `onDidChangeLayout` follow it.

### The folder - `files`, `metadata`

- `files` (`files.read` / `files.write`): `root()`, `list(dir)`,
  `find(glob)`, `stat`, `readText` / `writeText`, `read` / `write` for
  bytes, `create` (fails if the file is there), `rename(from, to, {
updateLinks: true })` (links to it follow), `trash`, `createFolder`.
- `files.process(path, text => newText)` changes a file safely: open in a
  tab, the change goes into its editor as one undo step; on disk, it is
  written only if nothing changed it since it was read. Use it for any
  read-change-write.
- `files.frontmatter.get(path)` / `update(path, fm => ({ ...fm, done: true }))`, and
  `files.onWillSave(({ path, text }) => newText)` to change a document
  just before it is saved (a `modified` date); `onDidSave`, `onDidCreate`,
  `onDidChange`, `onDidRename`, `onDidDelete`, `onDidChangeRoot`.
- `metadata` (`files.read`): what Textus knows of each document - its
  headings, links, tags, tasks and front matter - built once and kept up
  to date: `get(path)`, `all()`, `backlinks(path)`, `resolveLink(link,
from)`, `tags()`, `tasks()`, `search(query)`, `onDidChange`. Read this
  instead of reading every file.

### Data, secrets and settings

- `ctx.storage.global` (in Textus's config folder, for every project) and
  `ctx.storage.project` (`project.data`, in the open folder's
  `.textus/plugins/<id>/`, so it travels with the project): `get`, `set`,
  `delete`, `keys`, and files of the plugin's own - `readText`,
  `writeText`, `files`, `deleteFile`. 50 MB each; no plugin reaches
  another's. Uninstalling a plugin moves its global data to the Trash.
- `ctx.storage.document(path)`: `get`, `set`, `delete`, `keys` for one
  document - a diagram's zoom, a bookmark. Kept with the plugin's global
  data, it follows the document when it is renamed or moved, in the file
  tree or by a plugin.
- `ctx.secrets.get(key)` / `set(key, value)`: tokens, kept apart from
  settings, never synced, exported or shown.
- `textus.settings.get(key)` / `set(key, value)` / `onDidChange`: the
  manifest's `settings`, as the user set them for the project or for
  every document.

#### Settings of every kind

| `type`    | Drawn as                     | `default`                     | Also                          |
| --------- | ---------------------------- | ----------------------------- | ----------------------------- |
| `boolean` | a switch                     | `true` / `false`              |                               |
| `string`  | a field                      | a string                      | `multiline: true`             |
| `number`  | a number field               | a number                      | `min`, `max`                  |
| `enum`    | a menu                       | one of its `options`' `value` | `options: [{ value, label }]` |
| `color`   | a colour picker              | `"#rrggbb"`                   |                               |
| `list`    | a box of lines, one per item | a list of strings             |                               |
| `button`  | a button                     | none                          | `command` it runs             |

`group` puts a heading over a setting and the ones after it, until
another group is named. `when` shows a setting only while another one is
so: `"legend"` (on, or a list with anything in it), `"!legend"`,
`"style == dark"`, `"style != dark"`.

### The rest

- `net.fetch(url, { method, headers, body })` (`network:<host>`).
- `env`: `language`, `platform`, `theme` and their changes,
  `readClipboard` / `writeClipboard` (`clipboard`).
- `ai.registerTool(name, run)` (`ai.tools`): runs one of the manifest's
  `aiTools` when Textus AI calls it, answering text for the model.
- `plugins.get(id)`: what another plugin's `activate` returned - its functions, callable from here.
- `uri.registerHandler(fn)`: `textus://<plugin id>/<path>?<query>` links
  from a browser or another app, for "send to Textus" buttons and links
  back from other tools. The plugin starts for them if it must.
  `textus://command/<command id>?<query>` runs any command - Textus asks
  the user first, and the command gets the query as its argument.
- `editor.keys` (`editor.input`): for a way of typing (Vim, Emacs) -
  `capture`, `onKey` and `exec(op)`; see the Vim plugin.
- `export.onWillExport(fn)` (`editor.read`): an HTML or PDF export's
  page before it is written - return `{ css }` to add styles (numbered
  headings, a print footer) or `{ html }` to change its content. Scripts
  in it are taken out. A code block's picture comes from its page instead
  ([Code blocks in an export](#code-blocks-in-an-export)).

## Webviews

A webview is a sandboxed frame of HTML the plugin sets:

```js
textus.views.registerWebview("jane.board.view", {
  async resolve(webview) {
    webview.onDidReceiveMessage((message) => {
      if (message.type === "hello") webview.postMessage({ type: "hi" });
    });
    webview.html = await ctx.plugin.readText("board.html");
  },
});
```

```html
<link rel="stylesheet" href="textus-resource:board.css" />
<button id="hello">Hello</button>
<script>
  const api = acquireTextusApi();
  api.onMessage((m) => console.log(m.type));
  document.getElementById("hello").onclick = () =>
    api.postMessage({ type: "hello" });
</script>
```

- `textus-resource:<path>` names one of the plugin's files
  (`webview.asWebviewUri(path)` writes the same).
- A webview has no network and no storage of the browser's: it asks its
  plugin, with `postMessage`. `api.getState()` / `api.setState(value)`
  keep a little state while Textus runs.
- The theme's colours and sizes are CSS variables (`--bg`,
  `--editor-text`, `--chrome-accent`, `--border-color`, `--font-sans`,
  `--text-sm`, `--space-3`, …) that follow the theme and dark mode;
  buttons, inputs, `.toolbar`, `.list` and `.empty` look as Textus's own
  without any CSS of yours.
- Motion is Textus's too: `animation: motion-enter var(--dur-medium)
var(--ease-out) backwards` for a part arriving, `motion-exit` for one
  leaving, a `motion-cascade` container for items one after another.
  With the system's Reduce motion they become fades. Animate only
  `opacity` and `transform`.
- A code block's frame grows with its page; others fill their place.

### Code blocks in an export

A page can't go into a PDF, a Word file or an HTML page, so an export asks
each code block's page for a picture of itself with `api.onExport`: an
SVG's markup or an image's `data:` URL, drawn for the exported page's
`theme` ("light" for paper). The picture takes the drawing's place; a page
that gives none exports as the block's source.

```html
<div id="chart"></div>
<script src="textus-resource:lib/chart.min.js"></script>
<script>
  const api = acquireTextusApi();
  const chart = drawChart(document.getElementById("chart"));
  api.onExport(({ theme }) => chart.toSvg({ dark: theme === "dark" }));
</script>
```

Textus asks once the page has loaded (its scripts included), and waits a
few seconds for an answer.

## What a plugin can't do

Change how the editor itself works (its schema, its rendering), read
another plugin's data, run native code, or reach the network or files
beyond what it was granted. A plugin that stops answering, or throws more
than ten errors a minute, is turned off and the user is told.

## Its README

Put a `README.md` beside the manifest - and `README.zh.md`, `README.ja.md`
and so on for other languages - saying in a few lines what the plugin does
and how to reach it. **Get more** shows it on the plugin's page before it
is installed, and its page in Settings shows it after; Textus picks the
reader's language, English otherwise. The manifest's `icon` (an SVG or PNG)
is drawn beside its name on a tile of its own.

## Screenshots

Pictures of the plugin at work go in `screenshots/` beside its manifest,
PNGs in the order to show them. They aren't packed with the plugin: the
catalog lists them, and Get more shows the first on the plugin's card. Keep
them light - a window of about 1200 px, cropped to what the plugin does.

## Publishing

1. On the plugin's page in Settings (or the chat card of one Textus AI
   wrote), choose **Export for Publishing…**: your name as its publisher,
   and a folder. You get the plugin laid out as a repository - its id
   under your name, a README, an MIT LICENSE, a `.gitignore` and a release
   workflow.
2. Make that folder a GitHub repository and push a version tag
   (`git tag v0.1.0 && git push origin v0.1.0`). The workflow zips the
   tagged files as `<id>-<version>.zip` and publishes a release; anyone
   can install it with **Install from file…**.
3. To have it in **Get more** for everyone, open a pull request to
   textus-plugins adding `community/<id>.json` - your repository and the
   version. A review runs on it (the zip is your tagged source, byte for
   byte; its permissions; its code; what comes with it) and a maintainer
   tries it. [LISTING.md](https://github.com/CatVinci-Studio/textus-plugins/blob/main/LISTING.md)
   has the rules.

A new version is a new tag, and a pull request changing `version` in the
same file. A published version never changes.
