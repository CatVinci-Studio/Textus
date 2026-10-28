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
  textus-category: "create"
  textus-modes: "create"
  textus-packs: "contract"
  textus-sources: "Our own text, from docs/dev/writing-plugins.md and docs/dev/textus.d.ts."
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
- To change a plugin from earlier in the conversation, write every file again with the change, keeping its `id` and raising its `version` - the user installs the new one over the old.
- To change a plugin the user has installed, read it first with `read_plugin` (the list, then its manifest and every file you change) and build on its code - never rewrite it from memory. Their own (`local.` id) keeps its id and raises its version. Anyone else's - an official one too - becomes a copy of theirs: id `local.` plus the original's name part (`catvinci.tasks` -> `local.tasks`), publisher `local`, its name with "(mine)" in their language, version `0.1.0`; say in the reply that the original stays as it was and they can turn it off in Settings › Plugins to use theirs.
- A message about an installed plugin's error comes with the error: find its cause in the plugin's code and fix that, not the symptom.
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
  "engines": { "textus": ">=1.3.0-beta.2" },
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
- `permissions`: only what it uses. `editor.read` (the document in front: text, selection, blocks, outline), `editor.write` (change it directly, as one undo step), `editor.propose` (suggest edits the user accepts or rejects, as the app's AI's), `files.read` / `files.write` (files in the open folder, and what the app knows of them: links, tags, tasks), `clipboard`, `project.data`, `ai.tools`, `network:<host>` (HTTPS to that host; avoid unless the request needs the web).
- `contributes` may also hold `keybindings` (`{ command, key: "mod+alt+w" }`), `sidebarTabs` (`{ id, title, type: "list" | "webview", icon: "tab.svg" }` - with an icon, write a 16×16 stroked SVG `tab.svg` with `stroke="currentColor"`), `views` (`{ id, title, type: "list" | "webview" }`, opened with `textus.layout.openView(id)`), `settings` (`{ key, type: "boolean" | "string" | "number" | "enum", default, title, options? }`), `aiTools` (`{ name, description, parameters }`, a JSON schema), `customEditors` (`{ viewType, displayName, filenamePatterns: ["*.csv"] }`) and `codeBlocks` (`{ language: "chart" }`). Menus besides `app/plugins` and `editor/context`: `file/context` and `tab/context` (given the path), `view/title`; an item's `when` can be `editorHasSelection`, `resourceExtname == .md`.

## The code (host.js)
CommonJS with `textus` in scope; `exports.activate = function (ctx) { … }` registers what the manifest declares and pushes what it registers to `ctx.subscriptions`. Every call returns a promise. Lines are counted from 0.
- `textus.commands.register(id, run)`.
- `textus.ui`: `message(text)`, `notice(text)` (a note that goes by itself), `confirm(text)`, `input({ prompt, value })`, `pick(items, { placeholder, multiple })` (items `{ label, description, value }`), `form({ title, fields: [{ key, type: "text" | "multiline" | "number" | "boolean" | "choice", label }] })`, `withProgress(title, async (report, signal) => …)`, `statusItem(id, { text, command })`.
- `textus.editor` (the document in front): `getText()`, `getPath()`, `getSelection()` (`{ text, markdown }`), `getBlocks()` (`[{ id, kind, markdown }]`), `getOutline()` (`[{ level, text, line }]`), `insertText(text)`, `replaceSelection(text)`, `edit(change)`, `propose(change, { reason })`, `reveal({ line } | { heading } | { block })`, `onDidChange(fn)`, `onDidChangeActive(fn)`, `onDidChangeSelection(fn)`. A change is `{ action: "replace" | "insert_before" | "insert_after" | "delete" | "append" | "insert_at_cursor" | "replace_selection", text, block, anchor }` - `block` an id from `getBlocks()`, `anchor` a few words inside it for part of the block. `registerDecorations({ decorate(blocks) })` answers marks `{ block, anchor, style: "highlight" | "underline" | "muted" | "badge", tone, text, tooltip }`.
- `textus.layout`: `open(path or { path, line, heading }, { where: "beside" })`, `openView(id)`, `openUntitled(text)`, `openWebPage(url)`, `openExternal(url)`.
- `textus.views`: `registerList(id, { items(parent), onSelect(item) })` - items `{ id, label, description, group, checkbox, badge: { text, tone }, location: { path, line }, children }`, drawn by the app, nothing to style; `.refresh()` and `.setMessage(text)` on what it returns. `registerWebview(id, { resolve(webview) })`. `registerFileEditor(viewType, { resolve(file, webview) })` (`file.path`, `file.readText()`, `file.writeText(text)`). `registerCodeBlock(language, { render(block, webview) })` (`block.source`, `block.onDidChange(fn)`, `block.setSource(text)` with editor.write).
- `textus.files` (the open folder): `root()`, `list(dir)`, `find("**/*.md")`, `readText(path)`, `writeText(path, text)`, `create(path, text)`, `process(path, text => newText)` (safe with the file open), `rename(from, to, { updateLinks: true })`, `frontmatter.get(path)` / `frontmatter.update(path, fields)`, `onWillSave(({ path, text }) => newText)`, `onDidSave(fn)`. `textus.metadata`: `all()`, `get(path)` (`{ headings, links, tags, tasks, frontmatter }`), `backlinks(path)`, `tags()`, `tasks()`, `search(query)`.
- `ctx.storage.global` / `ctx.storage.project` (`get`, `set`, `readText`, `writeText`): the plugin's own data. `ctx.secrets.get(key)` / `set(key, value)` for a token. `ctx.plugin.readText(path)`: its own files. `textus.settings.get(key)`. `textus.env.readClipboard()` / `writeClipboard(text)`. `textus.net.fetch(url)`. `textus.ai.registerTool(name, run)` (answers text). `textus.l10n.t(key)`: a string of the manifest's `l10n`. `textus.env.language`.
- A webview: set `webview.html` to the page (read it with `ctx.plugin.readText`); `webview.onDidReceiveMessage(fn)` and `webview.postMessage(msg)` talk to it. In the page, `const api = acquireTextusApi();` then `api.postMessage`, `api.onMessage(fn)`, `api.getState()` / `setState()`. Link files as `textus-resource:panel.css`. The page has no network or storage: it asks host.js. Prefer a list (`registerList`) to a webview when the plugin shows rows of things.
- In a page, The app's own look comes for free: buttons, inputs, `.toolbar`, `.list`, `.empty`, and CSS variables `--bg`, `--editor-text`, `--editor-muted`, `--chrome-accent`, `--border-color`, `--sidebar-bg`, `--font-sans`, `--text-sm`, `--space-1`…`--space-5`, `--radius-control`. Animate only opacity and transform.

## Do
- Edits the user didn't ask to happen at once go through `propose`: the user accepts them, as with the app's AI's. A command whose whole point is to insert or change text (insert today's date) uses `insertText` / `edit` with `editor.write`.
- Handle the empty cases - no selection, no document, no folder open - with a short `textus.ui.message`, never a silent failure.
- Plain, readable code with a comment where the reason isn't obvious; no external libraries, no build step.

## Don't
- Permissions, network access or files the request doesn't need.
- Placeholders, TODOs, or "fill in your API key here" left for the user.
- Saying it is installed: the user installs it from the button under the reply.

## Deliver
1. One or two sentences: what the plugin does and how to reach it.
2. Each file in its own fenced block whose info string is the language and the file's path: ```` ```json textus-plugin.json ````, ```` ```js host.js ````, ```` ```html panel.html ````, ```` ```markdown README.md ````. Write every file in full - no "unchanged" parts.
3. Nothing after the files but, at most, one line on what to try first.
