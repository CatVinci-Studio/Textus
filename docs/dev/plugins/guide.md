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

1. Start from the template: copy
   [`template/`](https://github.com/CatVinci-Studio/textus-plugins/tree/main/template)
   from textus-plugins. It is a working plugin: a command and a sidebar
   list, in English and Chinese.
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

What a plugin draws loads lazily too: lists, webviews and code blocks are
made when they are first shown.

### What `contributes` takes

| Key             | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commands`      | Commands: `{ command, title }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `keybindings`   | A shortcut for a command, as Settings writes them (`mod+alt+w`). Textus's own shortcuts win a clash; the user can change or clear it in Settings › Shortcuts.                                                                                                                                                                                                                                                                                                                                                                                    |
| `menus`         | `editor/context` (the editor's right-click menu), `editor/slash` (offered when a word starts with `/`), `file/context` (a file's in the sidebar), `tab/context` (a tab's), `view/title` (buttons at the top of a sidebar view, with an `icon`), `floating/context` (a floating view's right-click menu, first in it; `when: "view == …"` picks the view), `app/plugins` (the Plugins menu), `app/tray` (background mode's icon).                                                                                                                 |
| `sidebarTabs`   | `{ id, title, type: "list" \| "webview", icon }`: a sidebar tab. A list is drawn by Textus from `views.registerList`; a webview is the plugin's page. The icon is an SVG drawn in the text colour.                                                                                                                                                                                                                                                                                                                                               |
| `views`         | `{ id, title, type }`: the same, opened in a tab of its own (`textus.layout.openView`).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `customEditors` | `{ viewType, displayName, filenamePatterns: ["*.pdf"], frontMatter: ["kanban-plugin"], priority }`: a file type opened in the plugin's tab instead of as a document. `frontMatter` (from 1.3.10) claims Markdown documents whose front matter has one of the keys; `filenamePatterns` may then be left out.                                                                                                                                                                                                                                      |
| `codeBlocks`    | `{ language, title, frame }`: fenced blocks in that language drawn by the plugin (`views.registerCodeBlock`), in a box like a figure, or on the page with `frame: "none"`. Textus's own languages (mermaid, math…) can't be taken.                                                                                                                                                                                                                                                                                                               |
| `suggestFor`    | `["wikilinks"]`: what a document can hold that the plugin works with. An official one is suggested, once, for a document that holds it while no installed plugin does.                                                                                                                                                                                                                                                                                                                                                                           |
| `completions`   | `{ id, where: "math" \| "text" \| "any", pattern }`: completions as you type when what is before the caret matches `pattern` (`editor.registerCompletion`).                                                                                                                                                                                                                                                                                                                                                                                      |
| `aiTools`       | `{ name, description, parameters }`: tools Textus AI can call (`ai.registerTool`); `parameters` is a JSON schema.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `links`         | `{ pattern, command }`: web links Ctrl/Cmd+clicked in a document whose URL matches `pattern` run `command` with the URL.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `settings`      | Rows on the plugin's page in Settings, drawn as Textus's own: `{ key, type, default, title, description?, group?, when? }`. See [Settings of every kind](#settings-of-every-kind).                                                                                                                                                                                                                                                                                                                                                               |
| `settingsPage`  | `{ title }`: a page of the plugin's own under its settings, a webview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `floatingViews` | `{ id, title, width, height, place }`: a small transparent page that floats over the desktop or in Textus's window (`place`: `"either"`, `"desktop"`, `"window"`), shown with `layout.openFloating`. It opens in the window unless `place` is `"desktop"`. Its page is looked at, not clicked: the user drags it anywhere, resizes it in proportion from its top corner (0.6× to 1.4×, so lay the page out to its viewport) and folds, closes or moves it from its right-click menu. `side` in its state says which half it sits in. From 1.3.6. |

| `agents` | `{ id, name, command, args, env, setup, provider }`: an AI agent on the user's computer that speaks the [Agent Client Protocol](https://agentclientprotocol.com) on stdio (Claude Agent, Codex, Gemini CLI…), offered in Textus AI's model menu under Agents. Textus starts `command` itself, found on the PATH a terminal would have; `{pluginDir}` in `args` and `env` is the plugin's folder; `setup` says how to install it and sign in, shown when it can't start; `provider` names whose models it runs (`"anthropic"`, `"openai"`), what `ai.onDidChangeState` tells other plugins while it works. Needs `agents`; desktop only. From 1.3.13. |

A menu item's `when` is a small expression over the moment it is shown:
`editorHasSelection`, `fileExtension == .pdf`, `view == jane.tasks.list`,
`isMac`, joined with `&&`, `||` and `!`.

## Permissions

A plugin asks for these in `permissions`; the user grants them when
turning it on, or leaves it off, and can take each back later.

| Permission       | Lets the plugin                                                                        |
| ---------------- | -------------------------------------------------------------------------------------- |
| `editor.read`    | read the document in front: its text, selection, blocks and outline; also completions  |
| `editor.write`   | change it at once, each change one undo step                                           |
| `editor.propose` | suggest changes to it, shown as Textus AI's are, accepted or rejected by the user      |
| `editor.input`   | take the editor's keys and move, select and edit with them (Vim, Emacs)                |
| `files.read`     | list, find and read files in the open folder, and what Textus knows of them (metadata) |
| `files.write`    | create, change, rename and trash files in the open folder (reading them comes with it) |
| `clipboard`      | read and write the clipboard                                                           |
| `project.data`   | keep its own data in the open folder, in `.textus/plugins/<id>/`                       |
| `ai.tools`       | give Textus AI tools to call                                                           |
| `notifications`  | show system notifications, at once or on a schedule (API 1.1)                          |
| `background`     | run its `background` code on a schedule, also with every window closed (API 1.1)       |
| `agents`         | run the AI agents it names in `contributes.agents` (programs on this computer; 1.3.13) |
| `network:<host>` | fetch from that host over HTTPS (`*.example.com`, `host:port`, `*` for the open web)   |

Ask for what the plugin's purpose explains, and no more: each permission
is shown to the user, and a listing in Textus asks why for the broad ones.
Files are reached only inside the open folder, never the app's own; plain
HTTP goes only to this computer (`network:localhost:23119`).

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
the window bar that runs a command when clicked).

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
  `onDidChange`, `onDidRename`, `onDidDelete`, `onDidChangeRoot`.
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
  ([Code blocks in an export](pages.md#code-blocks-in-an-export)).

## What a plugin can't do

Change how the editor itself works (its schema, its rendering), read
another plugin's data, run native code (an agent in `contributes.agents`
is a program Textus starts and talks to, not code in the plugin), or reach the network or files
beyond what it was granted. A plugin that stops answering, or throws more
than ten errors a minute, is turned off and the user is told.

## On iPhone and iPad

Plugins run on iOS as on the desktop, from the same catalog, with the same
API; `textus.env.platform` is `"ios"`. What differs is room and what the
system allows:

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
