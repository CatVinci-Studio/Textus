---
name: plugin
description: >-
  Makes a plugin for the app from the user's description - a command, a sidebar
  panel, a tool the app's AI can call, a file viewer - and writes all its files
  in the reply, ready to install with one click and to change in the next
  message; never edits the document. Use when asked to make, build or change
  a plugin, extension, add-on or small tool for the app (插件/扩展/小工具,
  プラグイン, 플러그인, complemento, extension, Erweiterung, плагин).
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "both"
  textus-index: "Use when asked to make, build or change a plugin, extension, add-on or small tool for the app."
  textus-category: "create"
  textus-modes: "create"
  textus-packs: ""
  textus-sources: "Our own text, from docs/dev/plugins/ and docs/dev/textus.d.ts."
  textus-aliases-en: "make-plugin, extension, add-on"
  textus-aliases-zh: "做插件, 插件, 小工具"
  textus-aliases-zh-Hant: "做外掛, 外掛, 小工具"
  textus-aliases-ja: "プラグインを作る, プラグイン"
  textus-aliases-ko: "플러그인 만들기, 플러그인"
  textus-aliases-es: "complemento, crear-complemento"
  textus-aliases-fr: "extension, créer-extension"
  textus-aliases-de: "plugin, erweiterung"
  textus-aliases-ru: "плагин, расширение"
  textus-aliases-pt: "plugin, criar-plugin"
---

# Make a plugin

## Scope
- A small, single-purpose plugin that does what the user asked, and nothing more. The document is not the material: the plugin goes in the reply, never into the document.
- When the request is too vague to build ("a plugin"), ask one question: what it should do and where they'd reach it (a command, a sidebar panel, a right-click item). Otherwise choose and say what you chose.
- To change a plugin from earlier in the conversation, take its files from that reply as they were written and write every file again with the change, keeping its `id` and raising its `version` - the user installs the new one over the old. If that reply is no longer in the conversation, read it with `read_plugin` when it is installed; otherwise ask the user to install it or paste its files - never rewrite it from memory.
- To change a plugin the user has installed, read it first with `read_plugin` (the list, then its manifest and every file you change) and build on its code - never rewrite it from memory. Their own (`local.` id) keeps its id and raises its version. Anyone else's - an official one too - becomes a copy of theirs: id `local.` plus the original's name part (`catvinci.tasks` -> `local.tasks`), publisher `local`, its name with "(mine)" in their language, version `0.1.0`; say in the reply that the original stays as it was and they can turn it off in Settings › Plugins to use theirs.
- Before you reply, call `check_plugin` with every file you wrote: it reads them as install will and says what would fail or silently do nothing (permissions, the `local.` id, `engines`, commands never registered, menu conditions the app doesn't set). Fix what it reports and check again until it reports nothing; set `engines.textus` to `">=<the version it names>"`.
- A message about an installed plugin's error comes with the error: find its cause in the plugin's code and fix that, not the symptom.
- A request to change colours, fonts or the look of the document or the app (a dark mode, a night/day switch, a reading style) is a theme, not a plugin: load the `theme` skill with `use_skill` and make a theme - themes already follow the system's light and dark. A plugin can't restyle the app.
- A plugin can mark the text (highlights, underlines, badges), draw its own fenced code blocks, add commands, menus, sidebar tabs, views, file viewers and tools for the app's AI. It can't change how the editor itself works, run native code, or reach files outside the open folder. When the request needs one of those, say so and offer what a plugin can do.

## Files
- `textus-plugin.json` (the manifest), `host.js` (the code), `README.md` (a short guide in the user's language: a line on what it does, then 3-5 bullets on how to reach and use it - its page in Settings shows it). A webview panel or view adds its `.html` (and `.css`/`.js` if long); a list needs none.
- Keep the whole plugin small: a few KB.

## The manifest
```json
{
  "id": "local.word-count",
  "name": "Word Count",
  "version": "0.1.0",
  "publisher": "local",
  "author": "the app's AI",
  "description": "Counts the words of the selection.",
  "engines": { "textus": ">=1.3.10" },
  "main": "host.js",
  "permissions": ["editor.read"],
  "contributes": {
    "commands": [{ "command": "local.word-count.count", "title": "Count Words" }],
    "menus": {
      "editor/context": [{ "command": "local.word-count.count", "when": "editorHasSelection" }],
      "app/plugins": [{ "command": "local.word-count.count" }]
    }
  }
}
```
- `id` is `local.` and a short lowercase name with dashes; `publisher` is `local`. Every id it contributes (commands, views, sidebar tabs) starts with the plugin's id and a dot.
- `name`, `description` and titles in the user's language, plainly. No `icon`.
- `permissions`: only what it uses. `editor.read` (the document in front: text, selection, blocks, outline), `editor.write` (change it directly, as one undo step), `editor.propose` (suggest edits the user accepts or rejects, as the app's AI's), `files.read` / `files.write` (files in the open folder, and what the app knows of them: links, tags, tasks; `files.write` includes reading), `clipboard`, `project.data`, `ai.tools`, `network:<host>` (HTTPS to that host; avoid unless the request needs the web).
- `contributes` may also hold `keybindings` (`{ command, key: "mod+alt+w" }` - a key the app, the editor or the system already has isn't bound, so never print it as fact in the plugin's UI), `sidebarTabs` (`{ id, title, type: "list" | "webview", icon: "tab.svg" }` - with an icon, write a 16×16 stroked SVG `tab.svg` with `stroke="currentColor"`), `views` (`{ id, title, type: "list" | "webview" }`, opened with `textus.layout.openView(id)`), `settings` (`{ key, type: "boolean" | "string" | "number" | "enum", default, title, options? }`), `aiTools` (`{ name, description, parameters }`, a JSON schema), `customEditors` (`{ viewType, displayName, filenamePatterns: ["*.csv"] }`), `codeBlocks` (`{ language: "chart" }`), `completions` (`{ id, pattern, where: "text" | "math" | "any" }`: a regex the text before the caret ends with; needs `editor.read`), `links` (`{ pattern, command }`: web links Cmd/Ctrl+clicked open with the command, given the URL), `floatingViews` (`{ id, title, width, height }`: a small page floating over the window or desktop), `settingsPage` (`{ title }`: a page of its own in Settings), `agents` (`{ id, name, command, args, setup }`: an AI agent program on the computer speaking the Agent Client Protocol, which the app starts and offers in its AI's model menu; needs the `agents` permission, desktop only, from 1.3.13) and `suggestFor` (`["wikilinks"]`: what a document holds that the plugin works with - official plugins only). Only one plugin draws a code block language, opens a file pattern by default or gives a kind of hover card at a time: the one turned on first; turned off, the next takes over. Menus besides `app/plugins` and `editor/context`: `editor/slash` (an item in the `/` panel), `file/context` and `tab/context` (given the path), `view/title`, `floating/context`, `app/tray`; an item's `when` reads `editorHasSelection`, `documentOpen`, `folderOpen`, `fileExtension == .md`, `resourceFilename`, `isMac` or `view == <id>` - nothing else.
- What 1.3.9 added (completions' new fields, `resolveNote`, `keys.capture`'s answer, `onWillSave`'s blocks, `textus.offerPlugin`) needs `"engines": { "textus": ">=1.3.9" }`, or compare `textus.env.apiVersion` as numbers first (1.2 = 1.3.9, 1.3 = 1.3.10-rc.1, 1.4 = 1.3.10). `env.onDidCopy` needs `">=1.3.10-rc.1"`; `layout.panels()` needs `">=1.3.10"`.

## The code (host.js)
It runs in a hidden, sandboxed frame of its own, not in the app's window: `document`, `window`, `localStorage` and the DOM there are the frame's, so a button, a `<style>` or a class added from host.js never shows. Everything the user sees goes through `textus` - `textus.ui` (messages, `statusItem` for a button in the window bar), commands and menus, `sidebarTabs` and `views` (a list, or a webview page for anything drawn).

CommonJS with `textus` in scope; `exports.activate = function (ctx) { … }` registers what the manifest declares and pushes what it registers to `ctx.subscriptions`. Every call returns a promise. Lines are counted from 0.
- `textus.commands`: `register(id, run)`, `registerEditorCommand(id, (editor, ...args) => …)` (offered only with a document open), `execute(id, ...args)` - the app's own too: `textus.save`, `textus.closeTab`, `textus.insertBlock` ("h1"…"h6", "paragraph", "bullet-list", "ordered-list", "task-list", "blockquote", "code-block", "math-block", "rule", "table"), and `textus.offerPlugin` with `{ id }` to suggest an official plugin on the suggestion card (resolves whether it is on; never await it in `activate`).
- `textus.ui`: `message(text)`, `notice(text, { action })` (a note that goes by itself; with `action: "Undo"` it resolves true when clicked), `confirm(text)`, `input({ prompt, value })`, `pick(items, { placeholder, multiple })` (items `{ label, description, value }`), `form({ title, fields: [{ key, type: "text" | "multiline" | "number" | "boolean" | "choice" | "date" | "color", label }] })`, `pickDate({ value })` (`YYYY-MM-DD`), `pickColor({ value })` (`#rrggbb`), `withProgress(title, async (report, signal) => …)`, `statusItem(id, { text, command })` (`.update(item)` and `.dispose()` on what it returns; every Disposable has `dispose()`).
- `textus.editor` (the document in front): `getText()`, `getPath()`, `getSelection()` (`{ text, markdown }`), `getBlocks()` (`[{ id, kind, markdown }]`), `getOutline()` (`[{ level, text, line }]`), `insertText(text)`, `replaceSelection(text)`, `edit(change)`, `propose(change, { reason })`, `reveal({ line } | { heading } | { block })`, `onDidChange(fn)` (`{ path, source }`), `onDidChangeActive(fn)`, `onDidChangeSelection(fn)`. `registerCompletion(id, { provideCompletions(context) })` for a `contributes.completions` id: `context` has `text`, `match`, `query`, `after`, `path`, `inMath`, `signal`; answer items `{ label, insert, detail, icon, keywords, replaceAfter, command }` (`$0` marks the caret) - an array you filter yourself (50 kept), or on 1.3.9 `{ items, complete: true }` (up to 20,000) that the app filters as the user types. They show in the one `/` panel, grouped by plugin. `registerHover({ provideHover(target) })` gives a card `{ title, markdown }` for `{ type: "document", path, heading }`, `{ type: "link", url }` or `{ type: "citation", key }`, for the kinds named in `contributes.hovers` (one plugin answers each kind). `keys.capture({ mode: "all" | "some", keys })` (editor.input) takes the keyboard for a way of typing (Vim): keys arrive on `keys.onKey(fn)`, `keys.exec(op)` acts; one plugin at a time - it answers false while another holds them, and `keys.capture(null)` gives yours back. A change is `{ action: "replace" | "insert_before" | "insert_after" | "delete" | "append" | "insert_at_cursor" | "replace_selection", text, block, anchor }` - `block` an id from `getBlocks()`, `anchor` a few words inside it for part of the block. `registerDecorations({ decorate(blocks) })` answers marks `{ block, anchor, style: "highlight" | "underline" | "muted" | "badge", tone, text, tooltip }`.
- `textus.layout`: `open(path or { path, line, heading })` (a tab; `{ where: "beside" }` only when the user asked for a split), `openView(id)`, `showSidebarTab(id)` (a sidebar tab shown), `openUntitled(text)`, `openWebPage(url)`, `openExternal(url)`, `activeTab()`, `tabs()`, `split()`, `onDidChangeActiveTab(fn)`, `onDidChangeLayout(fn)`, `panels()` and `onDidChangePanels(fn)` (`{ sidebar: { open, tab }, ai: { open } }`, read only). Floating views: `openFloating(id)`, `closeFloating(id)`, `floatingViews()`, `onDidChangeFloating(fn)` (stop animating while not `visible`), `onDidTouchFloating(fn)` (`poke`, `pet`, `moved`).
- `textus.views`: `registerList(id, { items(parent), onSelect(item) })` - items `{ id, label, description, group, checkbox, badge: { text, tone }, location: { path, line }, children }`, drawn by the app, nothing to style; `.refresh()` and `.setMessage(text)` on what it returns. `registerWebview(id, { resolve(webview) })`. `registerFileEditor(viewType, { resolve(file, webview) })` (`file.path`, `file.readFile()`, `file.readText()`, `file.writeText(text)`, `file.onDidRequestReveal(fn)`). `registerSettingsPage({ resolve(webview) })` for `contributes.settingsPage`. `registerEmbed(id, { provideEmbed(target) })` with `contributes.embeds: [{ id, targets: ["note", "heading", "block"] }]`: Markdown for `![[...]]` embeds, drawn read-only by the app. A list's provider may add `onCheck(item, checked)` for checkboxes and `onMove(item, target)` for rows dragged onto one another. `registerCodeBlock(language, { render(block, webview) })` (`block.source`, `block.onDidChange(fn)`, `block.setSource(text)` with editor.write).
- `textus.files` (the open folder): `root()` (null with none open), `list(dir)`, `find("**/*.md")`, `readText(path)`, `writeText(path, text)`, `create(path, text)`, `process(path, text => newText)` (safe with the file open), `stat(path)`, `conventions(path?)` (how the folder is written, whichever app made it - link style and path, `/` root, attachments, line breaks, templates folder and its date/time formats, daily, weekly and monthly notes, new notes, ignored paths; read it, never other apps' settings files), `appSettings("obsidian", "bookmarks.json")` (one of the nearest Obsidian vault's own settings files, parsed, null if none - for what conventions doesn't cover), `onDidChangeConventions(fn)`, paths may be relative to the open folder, `blockId(path, line)` (a block's `^id`, written if it had none), `rename(from, to, { updateLinks: true })`, `trash(path)` (never deleted for good), `createFolder(path)`, `frontmatter.get(path)` / `frontmatter.update(path, fields)`, `onDidCreate(fn)`, `onDidRename(fn)`, `onDidDelete(fn)`, `onDidSave(fn)`, `onDidChangeRoot(fn)` (another folder opened: refresh what it shows). `onWillSave(({ path, text, trigger, blocks }) => …)` changes a document as it is saved: return only the blocks you changed (`[{ block, markdown }]` by the ids in `blocks`) or the whole text; plugins run in id order, code, math, HTML and link definitions stay the user's, and a change that would change again on a second run is dropped. `textus.dates` (no permission): `format(date, "YYYY-MM-DD")`, `parse("07.11.2026", "DD.MM.YYYY")` → `"2026-11-07"` - Moment's tokens, as Obsidian names files; never write your own date formatting. `textus.templates.fill(text, { values, date, title, folder, format })` → `{ text, cursor, skipped }`: Obsidian's {{date}}/{{time}}/{{title}}/{{key}} and Templater's common `<% tp.* %>` tags, in the folder's formats. `textus.metadata`: `all()`, `get(path)` (`{ headings, links, tags, tasks, frontmatter, blockIds, aliases }`), `backlinks(path)`, `resolveLink(link, from)`, `resolveNote(link, from)` (where a link goes, exactly as a click takes it: `{ path, exists, kind, heading, block, alias, line }`), `linkTo(to, from, { heading, block, alias })` (the link the folder would write), `tags()`, `tasks()`, `search(query)`, `onDidChange(fn)`.
- `ctx.storage.global` / `ctx.storage.project` (`get`, `set`, `readText`, `writeText`): the plugin's own data; `set` keeps any JSON value as it is, no `JSON.stringify`. Use `global` (no permission) unless the data belongs to one folder; `project` needs `project.data`, and with no folder open it is kept in a hidden folder of the app's - both work without a folder. `ctx.storage.document(path)` keeps values for one document and follows it when it moves; each place has `keys()`, and `global`/`project` also `files()` and `deleteFile(path)`. `ctx.secrets.get(key)` / `set(key, value)` for a token. `ctx.log.info` / `warn` / `error` write to the plugin's page in Settings. `ctx.plugin.readText(path)` / `readFile(path)`: its own files. `textus.settings.get(key)`. `textus.env.readClipboard()` / `writeClipboard(text)`; `env.onDidCopy(({ text, cut }) => …)` (1.3) is told what the user copies or cuts in a document, as Markdown (clipboard). `textus.net.fetch(url)`. `textus.ai.registerTool(name, run)` (answers text); `textus.ai.state()` and `onDidChangeState(fn)` say what the app's AI is doing, never what is said. `textus.l10n.t(key)`: a string of the manifest's `l10n`. `textus.env.language`, `env.theme`, `env.onDidChangeTheme(fn)`, `env.onDidChangeLanguage(fn)`. `textus.plugins.get(id)`: another plugin's exports. `textus.export.onWillExport(({ format, html }) => ({ css, html }))` adds to an HTML or PDF export, in plugin id order. `textus.uri.registerHandler(fn)` for `textus://<id>/…` links from outside. `textus.schedule.set(id, { at | every | daily, notify, run })`, `schedule.clear(id)`, `schedule.list()` (notifications / background); `textus.notify.show({ title, body })`; `textus.app.state`, `app.onDidChangeState(fn)`, `app.onDidActivity(fn)`.
- A webview: set `webview.html` to the page (read it with `ctx.plugin.readText`); `webview.onDidReceiveMessage(fn)` and `webview.postMessage(msg)` talk to it; `webview.asWebviewUri(path)`, `webview.setTitle(title)`, `webview.onDidDispose(fn)`. In the page, `const api = acquireTextusApi();` then `api.postMessage`, `api.onMessage(fn)`, `api.getState()` / `setState()`, `api.menu(items, at)` (the app's own menu, resolving to the chosen value), `api.textItems(field)` and `api.editText(field, action)` (a text field's cut, copy, paste and the rest, for a page's own right-click menu), `api.onExport(({ theme }) => svgOrDataUrl)` (a code block's picture when the document is exported). Link files as `textus-resource:panel.css`. The page has no network or storage: it asks host.js. Prefer a list (`registerList`) to a webview when the plugin shows rows of things.
- In a page, the app's own look comes for free: buttons, inputs, `.toolbar`, `.list`, `.empty`, and the shared `tx-` controls (docs/dev/plugins/ui.md: lists, folding, zoom, pager, find, switch, select, slider, progress, calendar, board, rating); never draw your own, and CSS variables `--ui-bg`, `--ui-text`, `--ui-muted`, `--ui-accent`, `--ui-border`, `--ui-subtle`, `--font-sans`, `--text-sm`, `--space-1`…`--space-5`, `--shape-s` / `--shape-m` (corners). Animate only opacity and transform.

## Do
- Edits the user didn't ask to happen at once go through `propose`: the user accepts them, as with the app's AI's. A command whose whole point is to insert or change text (insert today's date) uses `insertText` / `edit` with `editor.write`.
- Read your host.js once more before delivering: every call is one listed here, nothing touches `document` or `window`, every permission it needs is in the manifest, every contributed id is registered in `activate`, and the storage it uses works with no folder open.
- Never make the user open a folder for the plugin to work: keep its own data (lists, notes, state) in `ctx.storage`, never in files of the folder. Only `textus.files` and `textus.metadata` need an open folder (they throw "No folder is open." without one); use them only when the request is about the folder's documents, and then check `textus.files.root()` first.
- Handle the empty cases - no selection, no document - with a short `textus.ui.message` in the user's language, never a silent failure.
- Catch where the user acted: an error a command throws is shown as its bare text, and one thrown in a webview's `onDidReceiveMessage`, a list's callbacks or an event handler reaches only the plugin's log - the click seems to do nothing. Wrap each in `try`/`catch` and say what went wrong with `textus.ui.message`; never swallow a failed read as "empty" and then write over the user's data.
- Plain, readable code with a comment where the reason isn't obvious; no external libraries, no build step.

## Don't
- Permissions, network access or files the request doesn't need.
- Placeholders, TODOs, or "fill in your API key here" left for the user.
- Saying it is installed: the user installs it from the button under the reply.

## Deliver
1. One or two sentences: what the plugin does and how to reach it.
2. Each file in its own fenced block whose info string is the language and the file's path: ```` ```json textus-plugin.json ````, ```` ```js host.js ````, ```` ```html panel.html ````, ```` ```markdown README.md ````. Write every file in full - no "unchanged" parts.
3. Nothing after the files but, at most, one line on what to try first.
