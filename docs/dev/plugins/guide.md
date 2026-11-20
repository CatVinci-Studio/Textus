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
3. [The reference](reference.md) - every call, generated from
   [textus.d.ts](../textus.d.ts), the one source of truth for the API.
4. [Publishing](publishing.md) - your plugin in its own repository, and
   listed in Textus.

No plugin comes with Textus. The official ones live in
[CatVinci-Studio/textus-plugins](https://github.com/CatVinci-Studio/textus-plugins)
and are the best examples: Tasks is a sidebar list over the folder, the
PDF Viewer a file editor, Zotero a hover card and a completion, Vim a way
of typing.

## Getting started

1. Start from an example in textus-plugins'
   [`examples/`](https://github.com/CatVinci-Studio/textus-plugins/tree/main/examples):
   `hello` (a command and a sidebar list), `page` (a sidebar page of its
   own), `code-block`, `ai-tool`, and from API 1.8 `ai-model` (the user's
   model, grey-text completion), `export-format` (a format in File ›
   Export, a right-click item) and `syntax` (inline syntax, snippets, a
   walkthrough). In a clone of that repository,
   `node packages/create-textus-plugin/index.mjs my-plugin --from page --id jane.my-plugin`
   copies one with your id; `node packages/textus-plugin/cli.mjs check my-plugin`
   says what Textus would refuse or ignore in it. `packages/textus-plugin`
   also has the API's types and a stand-in Textus for unit tests
   (`test.mjs`); see [Testing](testing.md).
2. In Textus, **Settings › Extensions › Plugins**, the **More** (…) menu ›
   **Load a plugin folder…**, and choose the folder. It is listed under Installed,
   marked _development_; turn it on.
3. Change `host.js` and save: a folder you loaded is read again as it
   changes. Its page in Settings shows what it logged (`ctx.log`).

Or ask Textus AI: "a plugin that …" in **Create** mode writes one you can
install from the reply and change in the next message.

### A script: a plugin in one file

For something small, skip the folder and the manifest: put a `.js` file in
the scripts folder (the same **More** menu › **Open Scripts Folder**, in
the global config folder), with what a manifest would say in a comment at its
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
  "platforms": ["desktop", "ios"], // where it runs; the catalog needs it
  "activationEvents": [], // when to start before it is used (below)
  "permissions": ["editor.read"],
  // "background": "jobs.js", // scheduled jobs' code (On a schedule)
  // "requires": [{ "setting": "runInBackground", "reason": "%why%" }],
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
  English, then any language that has it. The code reads the same table with `textus.l10n.t(key,
...args)`, a webview with `api.t(key, ...args)`; `{0}`, `{1}`… are the
  arguments. Textus speaks `en`, `zh`, `zh-Hant`, `ja`, `ko`, `es`, `fr`,
  `de`, `ru` and `pt`.
- The manifest has a [JSON Schema](../textus-plugin.schema.json):
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

What a plugin's code registers - an export format, an inline completion
source, a history source, a context-menu provider, a block type - is there
only once the code runs: such a plugin starts with `onStartupFinished`.

What a plugin draws loads lazily too: lists, webviews and code blocks are
made when they are first shown.

### What `contributes` takes

| Key               | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`        | Commands: `{ command, title }`; with `runs: { command: "textus.…", args }` one runs a Textus command with those arguments, no code needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `keybindings`     | A shortcut for a command, as Settings writes them (`mod+alt+w`). Textus's own shortcuts win a clash; the user can change or clear it in Settings › Shortcuts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `menus`           | `editor/context` (the editor's right-click menu), `editor/slash` (offered when a word starts with `/`), `file/context` (a file's in the sidebar), `tab/context` (a tab's), `view/title` (buttons at the top of a sidebar view, with an `icon`), `floating/context` (a floating view's right-click menu, first in it; `when: "view == …"` picks the view), `app/plugins` (the Plugins menu), `app/tray` (background mode's icon).                                                                                                                                                                                                                     |
| `blockMenu`       | `true`: the `/` menu lists Textus's own blocks (the Format menu's) while the plugin is on - as Quick Insert does. A plugin adds a block of its own with `editor/slash` or `editor.registerBlockType` (API 1.8).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `snippets`        | `{ label, body, keywords? }`: Markdown the `/` menu puts in at the caret, no code needed; `$0` marks where the caret lands. A one-line snippet goes in as text, a longer one as blocks. From API 1.8.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sidebarTabs`     | `{ id, title, type: "list" \| "webview", icon }`: a sidebar tab. A list is drawn by Textus from `views.registerList`; a webview is the plugin's page. The icon is an SVG drawn in the text colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `views`           | `{ id, title, type }`: the same, opened in a tab of its own (`textus.layout.openView`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `customEditors`   | `{ viewType, displayName, filenamePatterns: ["*.pdf"], frontMatter: ["kanban-plugin"], priority }`: a file type opened in the plugin's tab instead of as a document. `frontMatter` (from 1.3.10) claims Markdown documents whose front matter has one of the keys; `filenamePatterns` may then be left out.                                                                                                                                                                                                                                                                                                                                          |
| `documentTypes`   | `{ extensions: ["qmd"], keep: { blockStarts: [":::"], braces: true, jsx: false } }`: a file type opened as a document in Textus's own editor. `keep` names what of its syntax is shown as source and saved exactly as written: paragraphs starting with one of `blockStarts` (with the blocks after while a bracket is open), `{…}` with `braces`, JSX tags with `jsx`. Turned off, the plugin's files open read-only as text. Textus's own types (md, markdown, mdx, txt, text) can't be taken. From 1.4.3.                                                                                                                                         |
| `folderDocuments` | `[{ extension: "textbundle", documents: ["text.md"] }]`: a folder with this extension shows in the sidebar as one document and opens the first of `documents` found inside it, its tab named after the folder. From 1.4.6.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `codeBlocks`      | `{ language, title, frame, size }`: fenced blocks in that language drawn by the plugin (`views.registerCodeBlock`), in a box like a figure, or on the page with `frame: "none"`. With `size: "interface"` the block draws at the interface's text size instead of the document's and its zoom, for an overview (a table, a board) that shows more as the column widens. Textus's own languages (mermaid, math…) can't be taken.                                                                                                                                                                                                                      |
| `suggestFor`      | `["wikilinks"]`: what a document can hold that the plugin works with. An official one is suggested, once, for a document that holds it while no installed plugin does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `completions`     | `{ id, where: "math" \| "text" \| "any", pattern, title }`: completions as you type when what is before the caret matches `pattern` (`editor.registerCompletion`), grouped under `title` in the `/` panel. Needs `editor.read`.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `aiTools`         | `{ name, description, parameters }`: tools Textus AI can call (`ai.registerTool`); `parameters` is a JSON schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `embeds`          | `{ id, targets: ["note", "heading", "block"] }`: `![[…]]` embeds of those kinds drawn read-only from the Markdown `views.registerEmbed(id)` gives. Needs `files.read` (or `files.write`).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `hovers`          | `["document", "link", "citation"]`: the hover cards the plugin gives (`editor.registerHover`). One plugin answers each kind: the first turned on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `links`           | `{ pattern, command }`: web links Ctrl/Cmd+clicked in a document whose URL matches `pattern` run `command` with the URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `statusItems`     | `{ id, text, tooltip?, command? }`: statuses in the window bar shown while the plugin is on, before its code starts; its `ui.statusItem(id, …)` takes one over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `settings`        | Rows on the plugin's page in Settings, drawn as Textus's own: `{ key, type, default, title, description?, group?, when? }`. See [Settings of every kind](#settings-of-every-kind).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `settingsPage`    | `{ title }`: a page of the plugin's own under its settings, a webview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `walkthroughs`    | `{ title, steps: [{ title, description?, command? }] }`: first steps shown on the plugin's page in Settings while it is on, each with a button for its command (one of `commands`). Never a popup. From API 1.8.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `floatingViews`   | `{ id, title, width, height, place }`: a small transparent page that floats over the desktop or in Textus's window (`place`: `"either"`, `"desktop"`, `"window"`), shown with `layout.openFloating`. It opens in the window unless `place` is `"desktop"`. Its page is looked at, not clicked: the user drags it anywhere, resizes it in proportion from its top corner (0.6× to 1.4×, so lay the page out to its viewport) and folds, closes or moves it from its right-click menu. `side` in its state says which half it sits in. From 1.3.6.                                                                                                     |
| `agents`          | `{ id, name, command, args, env, setup, provider }`: an AI agent on the user's computer that speaks the [Agent Client Protocol](https://agentclientprotocol.com) on stdio (Claude Agent, Codex, Gemini CLI…), offered in Textus AI's model menu under Agents. Textus starts `command` itself, found on the PATH a terminal would have; `{pluginDir}` in `args` and `env` is the plugin's folder; `setup` says how to install it and sign in, shown when it can't start; `provider` names whose models it runs (`"anthropic"`, `"openai"`), what `ai.onDidChangeState` tells other plugins while it works. Needs `agents`; desktop only. From 1.3.13. |

A menu item's `when` is a small expression over the moment it is shown:
`documentOpen`, `folderOpen`, `editorHasSelection`, `fileExtension == .pdf`,
`resourceFilename == notes.md`, `resourcePath`, `view == jane.tasks.list`,
`isMac`, `resourceIsFolder` (a file menu item opened on a folder, from
1.4.1), and from 1.6 the plugin's own keys set with
`textus.commands.setContext("jane.focus.on", true)`; joined with `&&`, `||`
and `!`.

## Permissions

A plugin asks for these in `permissions`; the user grants them when
turning it on, or leaves it off, and can take each back later.

| Permission       | Lets the plugin                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `editor.read`    | read the document in front: its text, selection, blocks and outline; also completions                               |
| `editor.write`   | change it at once, each change one undo step                                                                        |
| `editor.propose` | suggest changes to it, shown as Textus AI's are, accepted or rejected by the user                                   |
| `editor.input`   | take the editor's keys and move, select and edit with them (Vim, Emacs)                                             |
| `files.read`     | list, find and read files in the open folder, and what Textus knows of them (metadata)                              |
| `files.write`    | create, change, rename and trash files in the open folder (reading them comes with it)                              |
| `clipboard`      | read and write the clipboard                                                                                        |
| `project.data`   | keep its own data in the open folder, in `.textus/plugins/<id>/`                                                    |
| `ai.tools`       | give Textus AI tools to call                                                                                        |
| `ai.model`       | ask the user's writing model; the user says yes on the first call, 100,000 tokens a month (API 1.8, preview)        |
| `comments`       | read and leave notes in a document's margin, with `files.read` for the file (API 1.8, preview)                      |
| `notifications`  | show system notifications, at once or on a schedule (API 1.1)                                                       |
| `background`     | run its `background` code on a schedule, also with every window closed (API 1.1)                                    |
| `agents`         | run the AI agents it names in `contributes.agents` (programs on this computer; 1.3.13)                              |
| `appearance`     | change Textus's colours: a palette over the theme, the frame a gradient (API 1.6)                                   |
| `git.commit`     | commit files of the open folder with the user's git (1.4.3; reading Git history is `files.read`)                    |
| `ssh`            | reach servers through the user's own ssh, SFTP only, each host allowed once by the user (API 1.9, desktop, preview) |
| `network:<host>` | fetch from that host over HTTPS (`*.example.com`, `host:port`, `*` for the open web)                                |
| `hidden:<path>`  | read that hidden file of the open folder, named from its top: `hidden:.vitepress/config.ts` (1.4.3)                 |

Ask for what the plugin's purpose explains, and no more: each permission
is shown to the user, and a listing in Textus asks why for the broad ones.
Files are reached only inside the open folder, never the app's own; plain
HTTP goes only to this computer (`network:localhost:23119`). Files and
folders whose names start with "." are shut to plugins but for `.textus`,
Obsidian's shared settings, `.gitignore`, `.git/HEAD` and those a plugin
names with `hidden:`, read only; `.git`, `.env`, `.ssh`, keys and other
plugins' storage can't be named.

## The code

`host.js` runs as a CommonJS module with `textus` in scope. Put
`/// <reference path="textus.d.ts" />` at its top (copy
[textus.d.ts](../textus.d.ts) beside it) and your editor completes every
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
[reference](reference.md) has every call and type.

### Commands and dialogs - `commands`, `ui`

`commands.register(id, run)` for a command of the manifest's;
`commands.execute(id, ...args)` runs a command - Textus's own
(`textus.save`, `textus.closeTab` with `{ save: true }`), yours, or one
another plugin lists in its manifest, with the permission
`commands:<that plugin's id>`. `textus.offerPlugin` with `{ id }` suggests an official
plugin that works well with yours - the user decides, and it resolves
whether that plugin is on (best from something the user does; never
await it in `activate`, which has 10 seconds). `ui` draws Textus's own
dialogs: `message`, `notice` (a note that goes by itself), `confirm`,
`input`, `pick` (one or several of a list), `form` (a few fields at once),
`withProgress` (a bar with Cancel) and `statusItem` (a short status in
the window bar that runs a command when clicked; one declared in
`contributes.statusItems` shows without starting the plugin).

### The document in front - `editor`

- Read it: `getText()`, `getPath()`, `getSelection()`, `getOutline()`,
  and `getBlocks()` - its blocks as Textus AI is shown them, each with an
  `id` (a hash of its Markdown) and a `kind`. From API 1.8 `getCursor()`
  gives where the caret is, as a `Location` (`{ path, line, ch }`).
- Change it: `insertText(text)`, `replaceSelection(text)`, or
  `edit(change)` (`editor.write`) - at once, one undo step each.
  `propose(change, { reason })` (`editor.propose`) shows the change for
  the user to accept or reject, as Textus AI's are. A change is placed by
  block: `{ action: "replace", block, text }`, `insert_after`,
  `insert_before`, `delete`, or `append` / `insert_at_cursor` /
  `replace_selection` without one; `anchor` quotes a few words inside the
  block to change only those. Read the blocks, then change them: an id
  from before an edit finds nothing rather than the wrong block.
- Mark it: `registerDecorations({ decorate(blocks, document) })` is asked
  for the blocks in sight once typing pauses, with the whole `document`
  they're of (it can be beside the one in front; from API 1.8 with its
  `path`), and answers marks - a
  highlight, an underline, muted text or a badge - on a block or the
  `anchor` words in it. From API 1.8 a `"gutter"` mark sits in the margin
  right of a block (a dot, a character or the plugin's SVG), and with a
  `command` a click runs it. Start it with `onEditor`.
- Check it: from API 1.8 `registerDiagnostics(id, { check(blocks,
document) })` answers slips for the blocks in sight - `{ block, anchor,
severity, message, fix }` - within 200 ms. Textus underlines them in the
  severity's colour and explains each on the grammar check's card, with
  Apply for a `fix` and Ignore; the text changes only when the user
  applies one.
- Show a syntax of your own: from API 1.8 (preview) `registerSyntax(id,
{ pattern, style, tone })` shows matches of an inline syntax as they
  mean - `||a spoiler||` covered, `{漢字|かんじ}` with its reading above.
  The pattern's `text` group is styled (`"highlight"`, `"underline"`,
  `"muted"`, `"spoiler"`, `"ruby"` with the `note` group above it) and the
  rest of a match hides until the caret is in it. The text stays as
  written - an export keeps it - and code is left alone. No permission.
- Help with it: `registerCompletion(id, provider)` for completions as you
  type, `registerHover({ provideHover(target) })` for a card over a link,
  a wikilink or a citation.
- Add a block: from API 1.8 `registerBlockType(id, { label, keywords,
insert })` puts a block in the `/` menu; `insert()` writes it at the
  caret. `blockTypes()` lists every plugin's. Right-click items come from
  `ui.registerContextMenu(fn)`, worked out as the menu opens.
- Follow it: `onDidChangeActive`, `onDidChange` (once typing pauses),
  `onDidChangeSelection`; `reveal(location)` scrolls to a place. From API
  1.1 `onDidChange` says who made the change, `source`: `"user"` (typing,
  pasting, the keyboard), `"ai"` (an accepted Textus AI proposal, a
  completion, a grammar fix), `"disk"` (the file changed and was read
  again), `"plugin"` (this API) or `"history"` (undo and redo). With
  several since the last event, `"user"` wins. `files.onDidSave` says
  whether a save was `trigger: "manual"` or `"auto"`.

### What a plugin shows - `views`

- **A list** (`registerList(id, provider)`) for anything that is rows:
  tasks, search results, a reading list. Textus draws it - groups,
  checkboxes, badges, a filter field, right-click actions, the keyboard -
  and an item with a `location` opens it when clicked. `refresh()` asks
  again; `setMessage(text)` puts a line over it.
- **A webview** (`registerWebview(id, { resolve(webview) })`) when the
  plugin draws something of its own: a graph, a board. See
  [Webviews](pages.md#webviews).
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
legend: "true" }`. See [Code blocks in an export](pages.md#code-blocks-in-an-export).

### Tabs and panes - `layout`

`open(path or location, { where })` opens a file - `where: "beside"` in
the pane beside the one in front, splitting the window if it isn't -
`openView(id)`, `showSidebarTab(id)` (opens the sidebar on a tab: a
plugin's sidebar tab id, `tree` or `outline`; from 1.3.10),
`openWebPage(url)`, `openUntitled(text)` and
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
  `onDidChange`, `onDidRename`, `onDidDelete`, `onDidChangeRoot`, and from
  API 1.8 `onDidChangeOnDisk` for a change made outside Textus.
- `metadata.setTask(location, status)` (`files.write`, API 1.8) sets a
  task's box (`" "`, `"x"`, `"-"`...) where it is, in its editor when open.
  `text.parseYaml` / `stringifyYaml` read and write YAML as front matter
  does.
- `history` (`files.read`, API 1.8): past versions kept besides Textus's
  own. `registerSource(id, { label, versions(path), read(path, version)
})` offers a source (Git, a sync service); `sources()`, `versions(source,
path)` and `read(source, path, version)` read every plugin's, as Version
  History does.
- `metadata` (`files.read`): what Textus knows of each document - its
  headings, links, tags, tasks and front matter - built once and kept up
  to date: `get(path)`, `all()`, `backlinks(path)`, `resolveLink(link,
from)`, `tags()`, `tasks()`, `search(query)`, `onDidChange`. Read this
  instead of reading every file.

### Data, secrets and settings

- `ctx.storage.global` (in Textus's config folder, for every project) and
  `ctx.storage.project` (`project.data`, in the open folder's
  `.textus/plugins/<id>/`, so it travels with the project; with no folder
  open, a hidden folder in Textus's config folder, so the plugin works
  without one): `get`, `set`, `delete`, `keys`, and files of the plugin's
  own - `readText`, `writeText`, `files`, `deleteFile`. 50 MB each; no
  plugin reaches another's. Uninstalling a plugin moves its global data,
  and what it kept with no folder open, to the Trash.
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

### On a schedule - `schedule`, `notify`, `app` (API 1.1)

A plugin can ask Textus to do something later - remind the user, sync -
without keeping code running. Textus keeps the job (it survives a
restart) and fires it on time while it runs: with a window open, or with
none in background mode (Settings › General › Keep running in the
background; on macOS also until Textus is quit). The first time a
plugin sets a job with background mode off, Textus says so and offers to
turn it on.

```js
// Every morning at nine, a notification that opens the journal.
await textus.schedule.set("morning", {
  daily: "09:00", // or at: "2026-11-02T09:00", or every: "1h" (15m at least)
  catchUp: "once", // a time missed while Textus wasn't running: once, or "skip"
  notify: {
    title: "Morning pages",
    body: "Three pages before anything else.",
    open: { path: "journal.md", line: 0 }, // needs files.read
  },
});
await textus.schedule.list(); // [{ id: "morning", daily: "09:00", nextDue, ... }]
await textus.schedule.clear("morning");
await textus.notify.show({ title: "Exported", body: "notes.pdf" }); // now
```

- `notify` needs `notifications`; `open.path` is a file of the open folder
  (relative to it, or absolute inside it) and needs `files.read`. A click
  on the notification brings Textus up with it open at `open.line`
  (counted from 0, as `metadata` counts lines). macOS asks the user to
  allow notifications the first time.
- `run: "sync"` calls `exports.sync(job, ctx)` in the manifest's
  `background` file (`"background": "background.js"`, needs the
  `background` permission). It runs in a sandboxed frame of its own for
  at most 30 seconds, with `files` (in the folder open when the job was
  set), `net`, `settings.get`, `schedule`, `notify`, `app` and `ctx`'s
  storage, secrets and log - no editor, UI, layout, views or commands.
  The plugin's `main` code isn't started for it.
- A plugin turned off keeps its jobs, paused; uninstalled, they go. A
  plugin keeps at most 32.
- `app.onDidActivity` says the user typed (once typing pauses) or saved
  by hand, with nothing of the document, and needs no permission;
  `ai.state()` and `ai.onDidChangeState` say what Textus AI is doing
  (`idle`, `thinking`, `writing`, `proposing`) and with which service and
  model, never what is said. Both from 1.3.6, for a status light or a desk
  pet.
- `app.state` is `"active"` (a Textus window has the focus), `"inactive"`
  (windows open, none focused) or `"background"` (none open);
  `app.onDidChangeState` follows it.
- Check `textus.env.apiVersion` (`"1.1"`) before using these, or set
  `engines.textus` to `">=1.3.0-beta.8"`: Textus doesn't offer a plugin to
  a version it doesn't fit.

### Colours - `appearance` (API 1.6)

A plugin with the `appearance` permission lays a palette over whichever
theme is on: the page (`--doc-bg`, `--doc-text`, `--doc-accent`,
`--doc-mark`…), the interface (`--ui-bg`, `--ui-text`, `--ui-accent`), the
tones, and the frame round the pages, which may be a gradient
(`--ui-frame-paint`). Borders, hovers and the rest follow from these. Text
is kept readable, the user's Custom CSS still wins, and turning the plugin
off puts the theme back. A whole palette, light and dark apart:

```js
exports.activate = async function (ctx) {
  ctx.subscriptions.push(
    await textus.appearance.setColors(
      {
        "--ui-frame-paint": "linear-gradient(170deg, #6ec5e6, #f6cde1)",
        "--doc-accent": "#0b7fa3",
        "--doc-mark": "#ef8fbb",
      },
      { scheme: "light" },
    ),
    await textus.appearance.setColors(
      {
        "--ui-frame-paint": "linear-gradient(170deg, #0f3346, #3b2440)",
        "--doc-accent": "#5fd0ec",
        "--doc-mark": "#f3a3c7",
      },
      { scheme: "dark" },
    ),
  );
};
```

`appearance.colors()` reads the colours as the window shows them now, and
`appearance.onDidChange` tells of another theme, scheme or plugin's
colours - for a palette that depends on the theme underneath. Set
`engines.textus` to `">=1.4.2"`.

### Git history - `textus.git` (API 1.7)

On the desktop, with git installed and the folder in a repository,
`git.status()` gives the branch and the changed files, `git.log(path)` a
file's commits through renames, and `git.show(hash, path)` the file as a
commit had it; these need `files.read`. `git.commit(message, paths)`
commits those files' changes only, through the user's own git (hooks,
signing), and needs `git.commit`. Hidden files stay out, and nothing
pushes, pulls or switches branches. Elsewhere `status()` is `null`. Set
`engines.textus` to `">=1.4.3"`.

### Margin notes - `textus.comments` (API 1.8, preview)

The notes the user sees in a document's margin, theirs and plugins':
`comments.list(path)` gives `{ id, text, comment, author }` (the words a
note is on; `author` is the plugin's name, null for the writer's own),
`comments.add({ path, text }, comment)` puts one on the first place those
words of one paragraph are and answers its id, signed with the plugin's
name, and `comments.resolve(path, id)` takes one away. `onDidChange`
says whose notes changed. While the document is open they change in its
editor, at once; else in the file Textus keeps them in. It needs
`comments` and `files.read`.

### The rest

- `net.fetch(url, { method, headers, body })` (`network:<host>`).
- `path` (API 1.8, no permission): `join`, `normalize`, `dirname`,
  `basename`, `extname` and `relative`, with "/" between parts on every
  system - use them instead of a path helper of your own.
- `env`: `language`, `platform`, `theme` and their changes,
  `readClipboard` / `writeClipboard` (`clipboard`).
- `export.registerFormat(id, { label, extension, export })` (1.8): a format
  in File › Export. `export({ markdown, html, path })` answers the file's
  text or bytes; Textus asks where and writes it.
- `ai.registerTool(name, run)` (`ai.tools`): runs one of the manifest's
  `aiTools` when Textus AI calls it, answering text for the model.
- `ai.complete({ system, prompt })` (`ai.model`, 1.8 preview): the user's
  writing model's answer; `messages: [{ role, content }]` for a conversation.
  The first call asks the user, and each plugin has 100,000 tokens a month
  before the user is asked again. `ai.available()` says whether it can be
  asked (Textus AI on). `ai.stream(request, onText)` (API 1.9) is the same
  call with the answer handed to `onText` piece by piece as it is written.
  Both take `{ signal }` last (API 1.9): stop the call when its panel
  closes, so the plugin's tokens aren't spent on an answer no one reads.
- `views.registerDatabaseView(id, { label, icon, render(data) })` (API 1.9):
  another way to show a database's rows, offered beside the database
  plugin's own views. `render` gets `{ rows: [{ path, name, props }],
columns, types, group, date }` and answers HTML, shown without scripts or
  `<style>`; an element with `data-row="<path>"` opens that row. The plugin
  that draws databases lists them with `views.databaseViews()` and draws one
  with `views.renderDatabaseView(id, data)`. [A database view, step by
  step](#a-database-view-step-by-step) builds one.
- `ssh` (`ssh`, API 1.9 preview, desktop): `hosts()` from `~/.ssh/config`,
  `connect(host)` → a session (the user is asked once per host), `home`,
  `list`, `read` / `readText`, `write`, `create`, `rename`, `delete`,
  `close`. The user's own ssh runs SFTP only; an unknown host key or a
  password ends the link with words saying what to do.
- `files.registerProvider(scheme, provider)` (API 1.9, preview): paths of
  the plugin's own scheme (`ssh://host/home/me`) read and written by the
  plugin - `list`, `readText`, `read`, `writeText`, `create`,
  `rename`, `move`, `delete` - so a folder it serves opens in the sidebar
  and its documents in tabs. `files.openFolder(url)` opens one of its
  folders as the window's folder. Pictures can't be pasted into such a
  folder yet.
- `files.registerConventionReader(id, { label, marker, notes, read })`
  (`files.read`, API 1.9): reads the folder conventions of an app Textus
  doesn't read itself. The app finds `marker` (e.g. `logseq/config.edn`)
  in the open folder and above it and hands `read({ root, text })` the
  file's text once; the answer (`linkStyle`, `attachments`, `daily`,
  `newNotes`...) is offered to the user like any other app's settings.
- `ai.registerInlineCompletion(id, { label, provide })` (`editor.read`, 1.8
  preview): grey text after the caret when typing pauses, from
  `provide({ before, after, path })`. One source at a time, picked by the
  user in Settings › Textus AI › Writing assist.
- `plugins.get(id)`: what another plugin's `activate` returned - its functions, callable from here.
- `uri.registerHandler(fn)`: `textus://<plugin id>/<path>?<query>` links
  from a browser or another app, for "send to Textus" buttons and links
  back from other tools. The plugin starts for them if it must.
  `textus://command/<command id>?<query>` runs any command - Textus asks
  the user first, and the command gets the query as its argument.
- `editor.keys` (`editor.input`): for a way of typing (Vim, Emacs) -
  `capture`, `onDidPressKey` and `exec(op)`; see the Vim plugin.
- `export.onWillExport(fn)` (`editor.read`): an HTML or PDF export's
  page before it is written - return `{ css }` to add styles (numbered
  headings, a print footer) or `{ html }` to change its content. Scripts
  in it are taken out. A code block's picture comes from its page instead
  ([Code blocks in an export](pages.md#code-blocks-in-an-export)).

### A streamed AI answer for a selection

This command asks the user's writing model to summarise the selected text
and streams the answer into a page. Closing the page aborts the request.
The Scripts Folder format can declare commands and permissions in one
JavaScript file, but it cannot declare a view. For this example, make a
plugin folder with one `host.js` file and this manifest.

In an empty folder, `selection-summary`, write `textus-plugin.json`:

```json
{
  "id": "jane.selection-summary",
  "name": "Selection Summary",
  "version": "0.1.0",
  "publisher": "jane",
  "description": "Summarises the selected text with the writing model.",
  "engines": { "textus": ">=1.4.6" },
  "main": "host.js",
  "permissions": ["editor.read", "ai.model"],
  "contributes": {
    "commands": [
      {
        "command": "jane.selection-summary.summarise",
        "title": "Summarise Selection"
      }
    ],
    "views": [
      {
        "id": "jane.selection-summary.result",
        "title": "Selection Summary",
        "type": "webview"
      }
    ]
  }
}
```

Then write `host.js`:

```js
const command = "jane.selection-summary.summarise";
const resultView = "jane.selection-summary.result";

exports.activate = function () {
  textus.views.registerWebview(resultView, {
    async resolve(webview, { state }) {
      const controller = new AbortController();
      webview.onDidDispose(() => controller.abort());

      webview.onDidReceiveMessage((message) => {
        if (message?.type === "ready") start();
      });

      webview.html = `<!doctype html>
<meta charset="utf-8">
<main>
  <h1>Selection Summary</h1>
  <pre id="answer">Starting…</pre>
</main>
<script>
  const api = acquireTextusApi();
  const answer = document.getElementById("answer");
  api.onMessage((message) => {
    if (message?.type === "text") answer.textContent += message.text;
    if (message?.type === "error") answer.textContent = message.text;
  });
  api.postMessage({ type: "ready" });
</script>`;

      let started = false;
      async function start() {
        if (started || controller.signal.aborted) return;
        started = true;
        const selectedText =
          state && typeof state.text === "string" ? state.text : "";
        try {
          await textus.ai.stream(
            {
              system: "Summarise the selected text clearly and briefly.",
              prompt: selectedText,
            },
            (text) => {
              void webview
                .postMessage({ type: "text", text })
                .catch(() => {});
            },
            { signal: controller.signal },
          );
        } catch (error) {
          if (error?.name !== "AbortError") {
            void webview
              .postMessage({ type: "error", text: String(error) })
              .catch(() => {});
          }
        }
      }
    },
  });

  textus.commands.register(command, async () => {
    if (!(await textus.ai.available())) {
      await textus.ui.message("Turn on Textus AI before asking for a summary.");
      return;
    }
    const selection = await textus.editor.getSelection();
    if (!selection?.text.trim()) {
      await textus.ui.message("Select some text to summarise.");
      return;
    }
    await textus.layout.openView(resultView, {
      state: { text: selection.text },
    });
  });
};
```

The page sends `ready` after its message listener is set up, so the first
streamed piece is not lost while it loads. The `onDidDispose` handler aborts
the model call when the user closes the result tab. Install the folder with
**Settings › Extensions › Plugins › More (…) › Load a plugin folder…**,
then run **Summarise Selection** from the command palette on selected text.

## A database view, step by step

A database view draws a base's rows in a layout of its own, offered beside
the table, board and other views of Wiki (`catvinci.database`), the plugin
that draws bases. This one shows each row as a card that opens the row's
note. It needs Textus `1.4.6` (API 1.9) and Wiki `0.8.0`; the
Timeline plugin's
[database-view.js](https://github.com/CatVinci-Studio/textus-plugins/blob/main/plugins/catvinci.timeline/database-view.js)
is a larger one.

### 1. The manifest

In an empty folder, `cards`, write `textus-plugin.json`:

```json
{
  "id": "jane.cards",
  "name": "Cards",
  "version": "0.1.0",
  "publisher": "jane",
  "description": "A base's rows as cards.",
  "engines": { "textus": ">=1.4.6" },
  "main": "host.js",
  "platforms": ["desktop", "ios"],
  "activationEvents": ["onStartupFinished"]
}
```

A database view needs no permission: Textus gives it the rows of the
base the user shows it in, and only then. Its code has to run before Wiki
asks which views there are, so it starts with `onStartupFinished`, and it
needs no `contributes`.

### 2. Register the view

Write `host.js` beside it:

```js
exports.activate = function (ctx) {
  ctx.subscriptions.push(
    textus.views.registerDatabaseView("cards", {
      label: "Cards",
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="3" width="12" height="10" rx="2"/></svg>',
      render: (data) => cardsHtml(data),
    }),
  );
};
```

- `"cards"` is the view's own id. Textus names it `jane.cards#cards`,
  and a base keeps that as the view's `type`.
- `label` is its name in Wiki's view menus (`textus.l10n.t` gives it in
  the user's language). `icon`, an SVG's markup in the text's colour, is
  optional; Wiki doesn't show it yet.
- `render` is asked each time the base shows the view, and has five seconds
  to answer.

### 3. The rows it gets

`render` gets the rows as the view has them, filtered and sorted:

```js
{
  rows: [
    { path: "notes/plan.md", name: "plan", props: { due: "2026-11-01", status: "Doing" } },
  ],
  columns: ["status", "due"], // the properties the view shows, in order
  types: { status: "text", due: "date" }, // each property's type
  group: "status", // the property it is grouped by, when it is
  date: "due", // the property its dates come from, when it has one
}
```

`path` is the note's path in the open folder, and `name` its name without
`.md`.

### 4. The HTML it answers

Add the drawing to `host.js`:

```js
const ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

function cardsHtml(data) {
  if (!data.rows.length) return "<p>No rows.</p>";
  const cards = data.rows.map((row) => {
    const props = data.columns
      .filter((key) => row.props[key] != null && row.props[key] !== "")
      .map(
        (key) =>
          `<div style="font-size:0.85em;color:var(--ui-muted)">${escapeHtml(key)}: ${escapeHtml(row.props[key])}</div>`,
      );
    return (
      `<div data-row="${escapeHtml(row.path)}" style="padding:0.6em 0.8em;border:1px solid var(--ui-border);border-radius:8px;cursor:pointer">` +
      `<div style="font-weight:600">${escapeHtml(row.name)}</div>${props.join("")}</div>`
    );
  });
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(12em,1fr));gap:0.75em;margin-top:0.75em">${cards.join("")}</div>`;
}
```

- Textus takes scripts, event attributes (`onclick`) and `<style>` out of
  the HTML before Wiki shows it, so it is styled inline, with the page's
  colours: `--ui-muted`, `--ui-border`.
- Every name and value is escaped: they are the user's text.
- An element with `data-row` set to a row's `path` opens that note when
  clicked; no script is needed for it.

### 5. Try it

1. In **Settings › Extensions › Plugins**, install Wiki from **Available**,
   then **More** › **Load a plugin folder…** and choose `cards`. Turn it on.
2. Open a folder with a few notes that have front matter, and a `.base`
   file among them:

   ```yaml
   views:
     - type: table
       name: Table
   ```

3. Open the `.base` file, click **+** after its view tabs and choose
   **Cards**. The cards show the notes; click one to open it.

## What a plugin can't do

Change how the editor itself works (its schema, its rendering), read
another plugin's data, run native code (an agent in `contributes.agents`
is a program Textus starts and talks to, not code in the plugin), or reach the network or files
beyond what it was granted. A plugin that stops answering, or throws more
than ten errors a minute, is turned off and the user is told.

## On iPhone and iPad

Plugins run on iOS as on the desktop, from the same catalog, with the same
API; `textus.env.platform` is `"ios"`. Android runs the plugins made for
iOS (`"platforms"` with `"ios"`), with `textus.env.platform` `"android"`.
What differs is room and what the system allows:

- A phone is a narrow window: a sidebar view is a tab in a drawer about
  320px wide, and there is no hover or right-click. Keep a view usable by
  touch at that width, with targets of 44px.
- The commands of `app/plugins` are under Plugins in the title row's menu.
  There is no tray (`app/tray`) and no background mode: `background` code
  and schedules run on the desktop only.
- **Say where your plugin runs.** Name `platforms` in every manifest (the
  catalog requires it); one left without it is offered everywhere. One that can't work on iOS (it needs a program on the
  computer such as Zotero or a local server, or opens any web page) sets
  `"platforms": ["desktop"]`, and Textus on iOS neither lists nor loads it.
  A plugin that works in the background, with `background` code or
  `requires` Keep running in the background (`runInBackground`), is
  desktop-only by default, and naming `ios` beside it is an error. Check a
  plugin you offer on iOS in a phone-sized window, or the simulator, before
  you publish.
- Files a user opens from the Files app are reached through iOS's own
  grants; a plugin reads them through `files` like any other.

## More

- [Pages](pages.md): webviews, Textus's controls and styles on them, dragging, floating views.
- [Permissions](permissions.md): what each one allows, and what needs which.
- [Versions](versions.md): which Textus each part of the API needs.
- [Testing](testing.md) and [Publishing](publishing.md).
- [The reference](reference.md): every call, made from [textus.d.ts](../textus.d.ts).
