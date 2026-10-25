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
  textus-category: "format"
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
- A plugin can't change the editor itself, draw over the document, run native code, or reach files outside the open folder. When the request needs one of those, say so and offer what a plugin can do.

## Files
- `textus-plugin.json` (the manifest), `host.js` (the code), `USAGE.md` (a short guide in the user's language: what it does, how to reach it, 3-5 bullets - the app opens it once installed). A panel or view adds its `.html` (and `.css`/`.js` if long).
- Keep the whole plugin small: a few KB.

## The manifest
```json
{
  "id": "local.word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "publisher": "local",
  "author": "the app's AI",
  "description": "Counts the words of the selection.",
  "engines": { "textus": "^1.3.0" },
  "main": "host.js",
  "permissions": ["document.read"],
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
- `permissions`: only what it uses. `document.read` (the document in front, its path, selection), `document.propose` (suggest edits, shown as the app's AI's, accepted or rejected by the user), `workspace.read` / `workspace.write` (files in the open folder), `clipboard`, `project.data`, `ai.tools`, `network:<host>` (HTTPS to that host; avoid unless the request needs the web).
- `contributes` may also hold `keybindings` (`{ command, key: "mod+alt+w" }`), `sidebarTabs` (`{ id, title, icon: "tab.svg" }` - then write a 16×16 stroked SVG `tab.svg` with `stroke="currentColor"`), `views` (`{ id, title }`, opened with `textus.window.openView(id)`), `settings` (`{ key, type: "boolean" | "string" | "number" | "enum", default, title, options? }`), `aiTools` (`{ name, description, parameters }`, a JSON schema) and `customEditors` (`{ viewType, displayName, filenamePatterns: ["*.csv"] }`).

## The code (host.js)
CommonJS with `textus` in scope; `exports.activate = function () { … }` registers what the manifest declares. Every call returns a promise.
- `textus.commands.registerCommand(id, run)`.
- `textus.window`: `showMessage(text)`, `showInput({ prompt, value })`, `showQuickPick(items, { placeholder })` (items `{ label, value }`), `openFile(path)`, `openUntitled(text)`, `openView(id)`, `setStatusItem(id, { text, command })`, `registerWebviewViewProvider(id, { resolveWebviewView(webview) })`, `registerCustomEditorProvider(viewType, { resolveCustomEditor(document, webview) })` (`document.readText()`, `writeText(text)`, `path`).
- `textus.document`: `getText()`, `getPath()`, `getSelection()` (`{ text, markdown }`), `getOutline()` (`[{ level, text, line }]`), `proposeEdit({ action: "insert_at_cursor" | "replace_selection" | "append", text, reason })`, `onDidChangeActive(fn)`.
- `textus.workspace`: `rootPath()`, `readDocuments()` (`{ documents: [{ path, rel, text }] }`), `search(query, { limit })`, `readText(path)`, `writeText(path, text)`, `list(path)`, `onDidSaveDocument(fn)`.
- `textus.storage.get(key)` / `set(key, value)`: the plugin's own data. `textus.settings.get(key)`. `textus.clipboard.readText()` / `writeText(text)`. `textus.net.fetch(url)`. `textus.ai.registerTool(name, run)` (answers text). `textus.plugin.readText(path)`: its own files. `textus.env.language`.
- A webview: set `webview.html` to the page (read it with `textus.plugin.readText`); `webview.onDidReceiveMessage(fn)` and `webview.postMessage(msg)` talk to it. In the page, `const api = acquireTextusApi();` then `api.postMessage`, `api.onMessage(fn)`, `api.getState()` / `setState()`. Link files as `textus-resource:panel.css`. The page has no network or storage: it asks host.js.
- In a page, The app's own look comes for free: buttons, inputs, `.toolbar`, `.list`, `.empty`, and CSS variables `--bg`, `--editor-text`, `--editor-muted`, `--chrome-accent`, `--border-color`, `--sidebar-bg`, `--font-sans`, `--text-sm`, `--space-1`…`--space-5`, `--radius-control`. Animate only opacity and transform.

## Do
- Edits to the document go through `proposeEdit`: the user accepts them, as with the app's AI's.
- Handle the empty cases - no selection, no document, no folder open - with a short `showMessage`, never a silent failure.
- Plain, readable code with a comment where the reason isn't obvious; no external libraries, no build step.

## Don't
- Permissions, network access or files the request doesn't need.
- Placeholders, TODOs, or "fill in your API key here" left for the user.
- Saying it is installed: the user installs it from the button under the reply.

## Deliver
1. One or two sentences: what the plugin does and how to reach it.
2. Each file in its own fenced block whose info string is the language and the file's path: ```` ```json textus-plugin.json ````, ```` ```js host.js ````, ```` ```html panel.html ````, ```` ```markdown USAGE.md ````. Write every file in full - no "unchanged" parts.
3. Nothing after the files but, at most, one line on what to try first.
