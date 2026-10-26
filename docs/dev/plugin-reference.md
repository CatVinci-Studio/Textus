# Plugin API reference

Made from [textus.d.ts](textus.d.ts) by `scripts/plugin-reference.mjs` -
change that file, then run the script; don't edit this page. How the
parts fit together is in [Writing a plugin](writing-plugins.md).

`textus` is a `Textus.Api`; `activate` is given a `PluginContext`;
a webview's page has `acquireTextusApi()`, a `WebviewApi`.

## Disposable

| Member            |     |
| ----------------- | --- |
| `dispose(): void` |     |

## Event

Listens; the Disposable stops listening.

```ts
type Event<T> = (listener: (e: T) => void) => Disposable;
```

## Location

A place in the folder: a file, and where in it. Used to open things, by links, search results, tasks and list items.

- `block`: a block id of the document as it is now (editor.getBlocks, metadata) - for "read it, then change it", as Textus AI's edits are. An id is the hash of the block's Markdown: an edited block has a new one, and an old id finds nothing rather than the wrong block.

- For a place kept for later (a link back from a PDF excerpt), give `heading` and `text` (a few words of it): Textus finds the words, then falls back to the heading, then to `line`.

- `page`: a page of a PDF; `fragment`: anything after `#` a file editor understands, passed to it as is.

| Member              |     |
| ------------------- | --- |
| `path: string`      |     |
| `line?: number`     |     |
| `heading?: string`  |     |
| `block?: string`    |     |
| `text?: string`     |     |
| `page?: number`     |     |
| `fragment?: string` |     |

## Where

Where something opens: a tab of its own (the default), the pane beside the one in front (splitting the window if it isn't), or in place of the tab in front.

```ts
type Where = "tab" | "beside" | "current";
```

## PluginContext

What `exports.activate` is given.

| Member                                                              |                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readonly subscriptions: Disposable[]`                              |                                                                                                                                                                                      |
| `readonly plugin: PluginInfo`                                       |                                                                                                                                                                                      |
| `readonly storage: { global: StoragePlace; project: StoragePlace }` | Two places of the plugin's own: `global` for every folder, in Textus's config folder; `project` in the open folder's .textus/plugins/<id>/ (needs project.data).                     |
| `readonly secrets: Secrets`                                         | Secrets (API tokens): kept as Textus keeps its API keys, in a file only the user can read, apart from settings and storage - never synced, exported or shown. The plugin's own only. |
| `readonly log: Log`                                                 | Shown in the plugin's page in Settings › Extensions › Plugins.                                                                                                                       |

## PluginInfo

| Member                                        |                                |
| --------------------------------------------- | ------------------------------ |
| `readonly id: string`                         |                                |
| `readonly version: string`                    |                                |
| `readFile(path: string): Promise<Uint8Array>` | One of the plugin's own files. |
| `readText(path: string): Promise<string>`     |                                |

## StoragePlace

| Member                                                 |                                |
| ------------------------------------------------------ | ------------------------------ |
| `get(key: string): Promise<unknown>`                   |                                |
| `set(key: string, value: unknown): Promise<void>`      | `undefined` or `null` deletes. |
| `delete(key: string): Promise<void>`                   |                                |
| `keys(): Promise<string[]>`                            |                                |
| `readText(path: string): Promise<string>`              |                                |
| `writeText(path: string, text: string): Promise<void>` |                                |
| `files(): Promise<string[]>`                           |                                |
| `deleteFile(path: string): Promise<void>`              |                                |

## Secrets

| Member                                           |     |
| ------------------------------------------------ | --- |
| `get(key: string): Promise<string \| null>`      |     |
| `set(key: string, value: string): Promise<void>` |     |
| `delete(key: string): Promise<void>`             |     |

## Log

| Member                            |     |
| --------------------------------- | --- |
| `info(...args: unknown[]): void`  |     |
| `warn(...args: unknown[]): void`  |     |
| `error(...args: unknown[]): void` |     |

## Api

| Member               |     |
| -------------------- | --- |
| `env: Env`           |     |
| `l10n: L10n`         |     |
| `commands: Commands` |     |
| `ui: Ui`             |     |
| `layout: Layout`     |     |
| `views: Views`       |     |
| `editor: Editor`     |     |
| `files: Files`       |     |
| `metadata: Metadata` |     |
| `net: Net`           |     |
| `settings: Settings` |     |
| `ai: Ai`             |     |
| `plugins: Plugins`   |     |
| `uri: Uri`           |     |

## Env

| Member                                                        |                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `readonly language: string`                                   | Textus's UI language ("en", "zh", "zh-Hant", ...).    |
| `readonly appVersion: string`                                 |                                                       |
| `readonly apiVersion: string`                                 | This API's version: "1.0".                            |
| `readonly platform: "macos" \| "windows" \| "linux" \| "ios"` |                                                       |
| `readonly theme: "light" \| "dark"`                           |                                                       |
| `onDidChangeTheme: Event<"light" \| "dark">`                  |                                                       |
| `onDidChangeLanguage: Event<string>`                          |                                                       |
| `readClipboard(): Promise<string>`                            | Plain text on the system clipboard (needs clipboard). |
| `writeClipboard(text: string): Promise<void>`                 |                                                       |

## L10n

| Member                                       |                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `t(key: string, ...args: unknown[]): string` | A string of the manifest's `l10n` in the UI language; "{0}", "{1}"... are `args`. |

## Commands

| Member                                                                                                |                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `register(id: string, run: (...args: unknown[]) => unknown): Disposable`                              | A command of the manifest's `contributes.commands`, or one of the plugin's own beyond them (`<plugin id>.<name>`). |
| `registerEditorCommand(id: string, run: (editor: Editor, ...args: unknown[]) => unknown): Disposable` | A command that works on the document in front: only offered with a document open, and given the editor.            |
| `execute(id: string, ...args: unknown[]): Promise<unknown>`                                           | A command of Textus's ("textus.save", "textus.closeTab") or of a plugin's.                                         |

## Ui

| Member                                                                                                                                                       |                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notice(text: string, options?: { tone?: Tone }): Promise<void>`                                                                                             | A short note at the bottom of the window that goes by itself.                                                                                                                    |
| `message(text: string, options?: { tone?: Tone }): Promise<void>`                                                                                            | A box with one button; resolves when it is closed.                                                                                                                               |
| `confirm(text: string, options?: { okLabel?: string; danger?: boolean }): Promise<boolean>`                                                                  |                                                                                                                                                                                  |
| `input(options?: { prompt?: string; value?: string; placeholder?: string; }): Promise<string \| null>`                                                       |                                                                                                                                                                                  |
| `pick(items: (string \| PickItem)[], options?: { placeholder?: string; multiple?: boolean }): Promise<unknown>`                                              | The picked item's `value` (its label without one), or null. With `multiple`, the picked values, or null.                                                                         |
| `form(options: { title?: string; okLabel?: string; fields: FormField[]; }): Promise<Record<string, unknown> \| null>`                                        | A small form: the values by key, or null when cancelled.                                                                                                                         |
| `withProgress<T>(title: string, task: (report: (progress: { fraction?: number; message?: string }) => void, signal: AbortSignal) => Promise<T>): Promise<T>` | Shows `title` with a progress bar while `task` runs; `report` moves it (0 to 1) and changes its line; `signal` aborts when the user cancels. Resolves with what `task` resolves. |
| `statusItem(id: string, item: StatusItem): StatusItemHandle`                                                                                                 | An item in the status bar; `update` changes it.                                                                                                                                  |

## Tone

```ts
type Tone = "info" | "warning" | "error";
```

## PickItem

| Member                 |     |
| ---------------------- | --- |
| `label: string`        |     |
| `description?: string` |     |
| `detail?: string`      |     |
| `value?: unknown`      |     |
| `picked?: boolean`     |     |

## FormField

```ts
type FormField =
  | {
      key: string;
      type: "text" | "multiline";
      label: string;
      value?: string;
      placeholder?: string;
    }
  | { key: string; type: "number"; label: string; value?: number }
  | { key: string; type: "boolean"; label: string; value?: boolean }
  | {
      key: string;
      type: "choice";
      label: string;
      value?: string;
      options: { value: string; label: string }[];
    };
```

## StatusItem

| Member             |                         |
| ------------------ | ----------------------- |
| `text: string`     |                         |
| `tooltip?: string` |                         |
| `command?: string` | Run when it is clicked. |

## StatusItemHandle

| Member                                    |     |
| ----------------------------------------- | --- |
| `update(item: Partial<StatusItem>): void` |     |

## Layout

| Member                                                                                                  |                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(target: string \| Location, options?: { where?: Where; asDocument?: boolean }): Promise<void>`    | A file - a document, or a file a plugin's editor opens - at the location given. Needs files.read, except for the file a view of the plugin's shows. |
| `openView(viewId: string, options?: { where?: Where; title?: string; state?: unknown }): Promise<void>` | One of the plugin's views (`contributes.views` with `"type": "webview"` or `"list"`) in a tab.                                                      |
| `openWebPage(url: string, options?: { where?: Where; title?: string }): Promise<void>`                  | A web page in a tab, for a host the plugin was granted.                                                                                             |
| `openUntitled(text: string, options?: { where?: Where; title?: string }): Promise<void>`                | A new document, not yet saved.                                                                                                                      |
| `openExternal(url: string): Promise<void>`                                                              | In the system's browser.                                                                                                                            |
| `activeTab(): Promise<TabInfo \| null>`                                                                 |                                                                                                                                                     |
| `tabs(): Promise<TabInfo[]>`                                                                            |                                                                                                                                                     |
| `split(): Promise<{ direction: "row" \| "column" \| null; panes: string[]; }>`                          | Two panes side by side ("row") or one above the other ("column"), and the tab each shows; or one.                                                   |
| `onDidChangeActiveTab: Event<TabInfo \| null>`                                                          |                                                                                                                                                     |
| `onDidChangeLayout: Event<void>`                                                                        |                                                                                                                                                     |

## TabInfo

| Member                                          |                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `id: string`                                    |                                                                          |
| `title: string`                                 |                                                                          |
| `kind: "document" \| "file" \| "view" \| "web"` | A document, a file a plugin's editor shows, a plugin's view, a web page. |
| `path: string \| null`                          |                                                                          |
| `plugin?: string`                               | For a view or a file editor: which plugin's, and which.                  |
| `view?: string`                                 |                                                                          |

## Views

| Member                                                                                                                                                                     |                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerList(id: string, provider: ListProvider): ListView`                                                                                                               | A list or tree drawn by Textus - in a sidebar tab or a view of `"type": "list"` - from the items the provider gives.                                                                |
| `registerWebview(id: string, provider: { resolve(webview: Webview, context: { state: unknown }): void \| Promise<void>; }): Disposable`                                    | A page of the plugin's own: a sidebar tab, or a view of `"type": "webview"`.                                                                                                        |
| `registerFileEditor(viewType: string, provider: { resolve(file: OpenFile, webview: Webview, context: { target: Location \| null }): void \| Promise<void>; }): Disposable` | Files of a type opened by the plugin (`contributes.customEditors`): a PDF, a Word document, a board.                                                                                |
| `registerCodeBlock(language: string, provider: { render(block: CodeBlock, webview: Webview): void \| Promise<void>; }): Disposable`                                        | Code blocks of a language (`contributes.codeBlocks`) drawn by the plugin in the document: `tasks, `chart. Asked only for the blocks in sight; the block's source stays in the file. |
| `registerSettingsPage(provider: { resolve(webview: Webview): void \| Promise<void>; }): Disposable`                                                                        | The plugin's page in Settings (`contributes.settingsPage`).                                                                                                                         |

## ListProvider

| Member                                                              |                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `items(parent?: ListItem): ListItem[] \| Promise<ListItem[]>`       | The items at the top, or under `parent` (one with `children`).                                                              |
| `onSelect?(item: ListItem): void \| Promise<void>`                  | An item clicked or Enter on it: by default, its `location` opens and its `command` runs.                                    |
| `onCheck?(item: ListItem, checked: boolean): void \| Promise<void>` | Its checkbox ticked or unticked.                                                                                            |
| `filterPlaceholder?: string`                                        | What the field over the list says; without it, there is no field. The list filters itself by label, description and detail. |
| `emptyText?: string`                                                | Shown when there are no items.                                                                                              |

## ListItem

| Member                                                                           |                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id?: string`                                                                    | Kept across refreshes: an open item stays open, a selected one selected.                                                 |
| `label: string`                                                                  |                                                                                                                          |
| `description?: string`                                                           |                                                                                                                          |
| `detail?: string`                                                                |                                                                                                                          |
| `group?: string`                                                                 | A group's heading above the items that share it.                                                                         |
| `icon?: string`                                                                  | One of the app's icons ("file", "folder", "task", "link", "tag", "calendar", "clock", "star") or an SVG of the plugin's. |
| `checkbox?: boolean`                                                             |                                                                                                                          |
| `badge?: { text: string; tone?: "accent" \| "warning" \| "danger" \| "muted"; }` | A small mark after the label: "due", "overdue", "new".                                                                   |
| `location?: Location`                                                            |                                                                                                                          |
| `command?: { id: string; args?: unknown[] }`                                     |                                                                                                                          |
| `children?: boolean`                                                             | Items under it, asked for when it is opened.                                                                             |
| `actions?: { label: string; command: string; args?: unknown[] }[]`               | Right-click actions.                                                                                                     |
| `data?: unknown`                                                                 | Anything of the plugin's; given back as is.                                                                              |

## ListView

| Member                           |                                                 |
| -------------------------------- | ----------------------------------------------- |
| `refresh(): void`                | Asks the provider again.                        |
| `setMessage(text: string): void` | A line over the list ("12 tasks"); "" for none. |

## Webview

A page of the plugin's.

| Member                                         |                                              |
| ---------------------------------------------- | -------------------------------------------- |
| `readonly id: string`                          |                                              |
| `html: string`                                 |                                              |
| `postMessage(message: unknown): Promise<void>` |                                              |
| `onDidReceiveMessage: Event<unknown>`          |                                              |
| `onDidDispose: Event<void>`                    |                                              |
| `asWebviewUri(path: string): string`           | A file of the plugin's, for the page's HTML. |
| `setTitle(title: string): Promise<void>`       |                                              |

## OpenFile

The file a file editor was opened on.

| Member                                   |                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `readonly path: string`                  |                                                                                    |
| `readonly fileName: string`              |                                                                                    |
| `readFile(): Promise<Uint8Array>`        |                                                                                    |
| `readText(): Promise<string>`            |                                                                                    |
| `writeText(text: string): Promise<void>` | Needs files.write.                                                                 |
| `onDidRequestReveal: Event<Location>`    | Asked to show another place in it (a link to `#page=12` clicked while it is open). |

## CodeBlock

A code block the plugin draws.

| Member                                        |                                                             |
| --------------------------------------------- | ----------------------------------------------------------- |
| `readonly language: string`                   |                                                             |
| `readonly source: string`                     |                                                             |
| `readonly path: string \| null`               | The document it is in.                                      |
| `readonly block: string`                      |                                                             |
| `onDidChange: Event<string>`                  | The block's source changed (typed, undone); the page stays. |
| `setSource(source: string): Promise<boolean>` | Replaces its source (needs editor.write), one undo step.    |

## Editor

| Member                                                                                                                         |                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getPath(): Promise<string \| null>`                                                                                           | Its path; null for an unsaved one, and with no document.                                                                                                                                   |
| `getText(): Promise<string \| null>`                                                                                           | Its Markdown (editor.read).                                                                                                                                                                |
| `getSelection(): Promise<{ text: string; markdown: string \| null } \| null>`                                                  |                                                                                                                                                                                            |
| `getBlocks(): Promise<Block[] \| null>`                                                                                        | Its blocks as Textus AI is shown them (editor.read).                                                                                                                                       |
| `getOutline(): Promise< { level: number; text: string; line: number }[] \| null >`                                             |                                                                                                                                                                                            |
| `edit(changes: Change \| Change[]): Promise<boolean>`                                                                          | Changes it at once, as one undo step (editor.write). False when a change can't be placed (a block id from before an edit).                                                                 |
| `insertText(text: string): Promise<boolean>`                                                                                   | At the caret, or in place of the selection (editor.write).                                                                                                                                 |
| `replaceSelection(text: string): Promise<boolean>`                                                                             |                                                                                                                                                                                            |
| `propose(change: Change, options?: { reason?: string }): Promise<boolean>`                                                     | Shown as a proposal the user accepts or rejects, as Textus AI's are (editor.propose).                                                                                                      |
| `reveal(location: Omit<Location, "path"> & { path?: string }): Promise<boolean>`                                               | Scrolls to a place in it and puts the caret there.                                                                                                                                         |
| `registerCompletion(id: string, provider: CompletionProvider): Disposable`                                                     | Completions as you type, for one of `contributes.completions` (editor.read): asked when what is before the caret matches its `pattern`. `insert` replaces the match; `$0` marks the caret. |
| `registerHover(provider: { provideHover(target: HoverTarget): HoverCard \| null \| Promise<HoverCard \| null>; }): Disposable` | A card for what the pointer rests on (editor.read).                                                                                                                                        |
| `registerDecorations(provider: { decorate(blocks: Block[]): Decoration[] \| Promise<Decoration[]>; }): Disposable`             | Marks over the text (editor.read), asked for the blocks in sight and again when they change.                                                                                               |
| `onDidChangeActive: Event<{ path: string \| null }>`                                                                           | Another document came to the front (or none).                                                                                                                                              |
| `onDidChange: Event<{ path: string \| null }>`                                                                                 | Its text changed: once typing pauses, not on every key.                                                                                                                                    |
| `onDidChangeSelection: Event<{ text: string }>`                                                                                |                                                                                                                                                                                            |
| `keys: EditorKeys`                                                                                                             | The keyboard, for plugins that are a way of typing - Vim, Emacs (editor.input).                                                                                                            |

## Block

| Member                                                                                                                                                            |     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `id: string`                                                                                                                                                      |     |
| `kind: \| "paragraph" \| "heading" \| "list" \| "quote" \| "code" \| "math" \| "table" \| "rule" \| "picture" \| "html" \| "footnote" \| "definition" \| "other"` |     |
| `markdown: string`                                                                                                                                                |     |

## Change

One change, placed by block ids as Textus AI's are. Without `block`, `insert_at_cursor`, `replace_selection` and `append` need none. `anchor`: a few words inside the block, for part of it.

| Member                                                                                                                           |     |
| -------------------------------------------------------------------------------------------------------------------------------- | --- |
| `action: \| "replace" \| "replace_selection" \| "insert_before" \| "insert_after" \| "delete" \| "append" \| "insert_at_cursor"` |     |
| `text?: string`                                                                                                                  |     |
| `block?: string`                                                                                                                 |     |
| `lastBlock?: string`                                                                                                             |     |
| `anchor?: string`                                                                                                                |     |

## CompletionProvider

| Member                                                                                                                                                                       |     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `provideCompletions(context: { text: string; match: string; inMath: boolean; }): \| CompletionItem[] \| null \| undefined \| Promise<CompletionItem[] \| null \| undefined>` |     |

## CompletionItem

| Member            |     |
| ----------------- | --- |
| `label: string`   |     |
| `insert: string`  |     |
| `detail?: string` |     |

## HoverTarget

```ts
type HoverTarget =
  | { type: "document"; path: string; heading: string | null }
  | { type: "link"; url: string }
  | { type: "citation"; key: string };
```

## HoverCard

| Member                  |                                   |
| ----------------------- | --------------------------------- |
| `title: string \| null` |                                   |
| `markdown: string`      | Markdown, shown without pictures. |

## Decoration

A mark over some of a block's text: the words `anchor` (all of the block without it).

| Member                                                    |                                         |
| --------------------------------------------------------- | --------------------------------------- |
| `block: string`                                           |                                         |
| `anchor?: string`                                         |                                         |
| `style: "highlight" \| "underline" \| "muted" \| "badge"` |                                         |
| `tone?: "accent" \| "warning" \| "danger" \| "success"`   |                                         |
| `text?: string`                                           | For "badge": its text, after the words. |
| `tooltip?: string`                                        |                                         |

## EditorKeys

| Member                                                                               |                                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `capture(capture: { mode: "all" \| "some"; keys: string[] } \| null): Promise<void>` | Takes the editor's keys: "all" but the app's shortcuts, or "some" - only `keys`. null gives them back. |
| `onKey: Event<string>`                                                               |                                                                                                        |
| `exec(op: EditorOp): Promise<EditorOpResult>`                                        |                                                                                                        |

## EditorOp

```ts
type EditorOp =
  | {
      op: "move";
      unit: string;
      count?: number;
      select?: boolean;
      visual?: boolean;
      char?: string;
      forward?: boolean;
      till?: boolean;
    }
  | { op: "selectLines"; count?: number }
  | { op: "visualStart" }
  | { op: "delete"; copy?: boolean }
  | { op: "deleteLines"; count?: number }
  | { op: "copy" }
  | { op: "copyLines"; count?: number }
  | { op: "deleteChars"; count?: number; back?: boolean }
  | { op: "insertText"; text: string }
  | { op: "pasteLines"; text: string; above?: boolean }
  | { op: "openLine"; above?: boolean }
  | { op: "replaceChar"; char: string }
  | { op: "collapse"; to?: "head" | "start" | "end" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "cursor"; style: "bar" | "block" }
  | { op: "flash"; query: string }
  | { op: "flashJump"; label: string; select?: boolean; extend?: boolean }
  | { op: "flashClear" };
```

## EditorOpResult

| Member            |     |
| ----------------- | --- |
| `text?: string`   |     |
| `labels?: number` |     |
| `empty: boolean`  |     |

## Files

| Member                                                                                                                |                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `root(): Promise<string \| null>`                                                                                     |                                                                                                                                                                                                                                                                                      |
| `list(dir?: string): Promise<FileEntry[]>`                                                                            |                                                                                                                                                                                                                                                                                      |
| `find(glob?: string): Promise<{ path: string; rel: string }[]>`                                                       | The files whose path in the folder matches `glob` ("**\/_.md", "Daily/_.md"); every document without one.                                                                                                                                                                            |
| `stat(path: string): Promise<FileEntry \| null>`                                                                      |                                                                                                                                                                                                                                                                                      |
| `read(path: string): Promise<Uint8Array>`                                                                             |                                                                                                                                                                                                                                                                                      |
| `readText(path: string): Promise<string>`                                                                             |                                                                                                                                                                                                                                                                                      |
| `write(path: string, data: Uint8Array \| ArrayBuffer \| string): Promise<void>`                                       |                                                                                                                                                                                                                                                                                      |
| `writeText(path: string, text: string): Promise<void>`                                                                |                                                                                                                                                                                                                                                                                      |
| `create(path: string, text?: string): Promise<void>`                                                                  | A new file; fails if one is there.                                                                                                                                                                                                                                                   |
| `process(path: string, change: (text: string) => string): Promise<string>`                                            | Reads, changes and writes a file without losing anything: open in a tab, the change goes into its editor as one undo step; on disk, it is written only if the file is unchanged since it was read (and `change` is run again otherwise). Return the text unchanged to write nothing. |
| `rename(from: string, to: string, options?: { updateLinks?: boolean }): Promise<void>`                                | With `updateLinks`, links to it in the folder's documents follow.                                                                                                                                                                                                                    |
| `trash(path: string): Promise<void>`                                                                                  | To the system's Trash, never deleted for good.                                                                                                                                                                                                                                       |
| `createFolder(path: string): Promise<void>`                                                                           |                                                                                                                                                                                                                                                                                      |
| `frontmatter: Frontmatter`                                                                                            |                                                                                                                                                                                                                                                                                      |
| `onDidCreate: Event<{ path: string }>`                                                                                |                                                                                                                                                                                                                                                                                      |
| `onDidChange: Event<{ path: string }>`                                                                                |                                                                                                                                                                                                                                                                                      |
| `onDidRename: Event<{ from: string; to: string }>`                                                                    |                                                                                                                                                                                                                                                                                      |
| `onDidDelete: Event<{ path: string }>`                                                                                |                                                                                                                                                                                                                                                                                      |
| `onWillSave(listener: (e: { path: string; text: string; }) => string \| void \| Promise<string \| void>): Disposable` | A document is about to be saved: return its text changed to save that instead (within a second; files.write).                                                                                                                                                                        |
| `onDidSave: Event<{ path: string; text: string }>`                                                                    |                                                                                                                                                                                                                                                                                      |
| `onDidChangeRoot: Event<{ path: string \| null }>`                                                                    |                                                                                                                                                                                                                                                                                      |

## FileEntry

| Member                       |     |
| ---------------------------- | --- |
| `name: string`               |     |
| `path: string`               |     |
| `rel: string`                |     |
| `isDir: boolean`             |     |
| `size: number`               |     |
| `modifiedMs: number \| null` |     |

## Frontmatter

| Member                                                                                                                   |                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `get(path: string): Promise<Record<string, unknown>>`                                                                    | The YAML at the top of a document, as an object; {} for none.     |
| `update(path: string, change: (frontmatter: Record<string, unknown>) => Record<string, unknown> \| void): Promise<void>` | Changes it through files.process; the rest of the file untouched. |

## Metadata

| Member                                                                                                                                                    |                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `get(path: string): Promise<DocumentMetadata \| null>`                                                                                                    |                                                                                          |
| `all(): Promise<DocumentMetadata[]>`                                                                                                                      | Every document, without its blocks: titles, links and tags - what a graph is drawn from. |
| `backlinks(path: string): Promise<{ path: string; line: number; text: string }[]>`                                                                        | The documents linking to `path`, with where.                                             |
| `resolveLink(link: string, from: string): Promise<string \| null>`                                                                                        | Where a link written in `from` goes: a [[wiki link]] or a relative path; null for none.  |
| `tags(): Promise<{ tag: string; count: number }[]>`                                                                                                       |                                                                                          |
| `tasks(filter?: { done?: boolean; path?: string; tag?: string; }): Promise<Task[]>`                                                                       |                                                                                          |
| `search(query: string, options?: { limit?: number }): Promise<{ hits: (Location & { rel: string; line: number; text: string })[]; truncated: boolean; }>` | The documents' lines holding `query`, ignoring case.                                     |
| `onDidChange: Event<{ paths: string[] }>`                                                                                                                 | Documents were added, changed or removed.                                                |

## DocumentMetadata

| Member                                                                               |                                               |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `path: string`                                                                       |                                               |
| `rel: string`                                                                        |                                               |
| `title: string`                                                                      | The first heading's text, or the file's name. |
| `frontmatter: Record<string, unknown>`                                               |                                               |
| `headings: { level: number; text: string; line: number }[]`                          |                                               |
| `links: { target: string; resolved: string \| null; line: number; text: string; }[]` |                                               |
| `tags: string[]`                                                                     |                                               |
| `tasks: Task[]`                                                                      |                                               |
| `blocks?: { id: string; kind: Block["kind"]; line: number }[]`                       | Only from `get`.                              |
| `modifiedMs: number \| null`                                                         |                                               |

## Task

| Member                |                                       |
| --------------------- | ------------------------------------- |
| `text: string`        |                                       |
| `done: boolean`       |                                       |
| `due: string \| null` | From 📅 2026-11-01 or due:2026-11-01. |
| `tags: string[]`      |                                       |
| `path: string`        |                                       |
| `line: number`        |                                       |
| `location: Location`  |                                       |

## Net

| Member                                                                                                                                                                                                                                                                                       |                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array \| ArrayBuffer \| string; }): Promise<{ status: number; ok: boolean; headers: Record<string, string>; bytes(): Promise<Uint8Array>; text(): Promise<string>; json(): Promise<unknown>; }>` | HTTPS to the hosts granted (`network:<host>`); no cookies. |

## Settings

| Member                                                |                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `get(key: string): Promise<unknown>`                  | The project's value, else the general one, else the manifest's default. |
| `set(key: string, value: unknown): Promise<void>`     | One of the plugin's own settings, for every folder.                     |
| `onDidChange: Event<{ key: string; value: unknown }>` |                                                                         |

## Ai

Tools for Textus AI (ai.tools): each one named in the manifest's contributes.aiTools, run here when the model calls it.

| Member                                                                                                                 |     |
| ---------------------------------------------------------------------------------------------------------------------- | --- |
| `registerTool(name: string, run: (args: Record<string, unknown>) => string \| Promise<string> \| unknown): Disposable` |     |

## Plugins

| Member                                                                                              |                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get<T = Record<string, (...args: unknown[]) => Promise<unknown>>>(id: string): Promise<T \| null>` | What another plugin's `activate` returned, its functions callable from here (their arguments and answers as JSON); starts it if it isn't running. null when it isn't installed or turned on. |

## Uri

| Member                                                                                                                   |                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `registerHandler(handler: (uri: { path: string; query: Record<string, string>; }) => void \| Promise<void>): Disposable` | Links `textus://<plugin id>/<path>?<query>` opened from outside Textus (a browser, another app). |

## WebviewApi

| Member                                                  |     |
| ------------------------------------------------------- | --- |
| `readonly language: string`                             |     |
| `t(key: string, ...args: unknown[]): string`            |     |
| `postMessage(message: unknown): void`                   |     |
| `onMessage(fn: (message: unknown) => void): Disposable` |     |
| `getState(): unknown`                                   |     |
| `setState<T>(state: T): T`                              |     |
