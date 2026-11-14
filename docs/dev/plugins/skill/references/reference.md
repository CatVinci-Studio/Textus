# Plugin API reference

Made from [textus.d.ts](textus.d.ts) by `scripts/plugin-reference.mjs` -
change that file, then run the script; don't edit this page. How the
parts fit together is in [the guide](guide.md).

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

| Member                                                                                                      |                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readonly subscriptions: Disposable[]`                                                                      |                                                                                                                                                                                                                                                                                                                                                      |
| `readonly plugin: PluginInfo`                                                                               |                                                                                                                                                                                                                                                                                                                                                      |
| `readonly storage: { global: StoragePlace; project: StoragePlace; document(path: string): DocumentPlace; }` | Places of the plugin's own: `global` for every folder, in Textus's config folder; `project` in the open folder's .textus/plugins/<id>/ (needs project.data; with no folder open, a hidden one in Textus's config folder); `document(path)` for one document - a diagram's zoom, a bookmark - which follows the document when it is renamed or moved. |
| `readonly secrets: Secrets`                                                                                 | Secrets (API tokens): kept as Textus keeps its API keys, in a file only the user can read, apart from settings and storage - never synced, exported or shown. The plugin's own only.                                                                                                                                                                 |
| `readonly log: Log`                                                                                         | Shown in the plugin's page in Settings › Extensions › Plugins.                                                                                                                                                                                                                                                                                       |

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

## DocumentPlace

Values kept for one document.

| Member                                            |                                |
| ------------------------------------------------- | ------------------------------ |
| `get(key: string): Promise<unknown>`              |                                |
| `set(key: string, value: unknown): Promise<void>` | `undefined` or `null` deletes. |
| `delete(key: string): Promise<void>`              |                                |
| `keys(): Promise<string[]>`                       |                                |

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

| Member                   |                                                                |
| ------------------------ | -------------------------------------------------------------- |
| `env: Env`               |                                                                |
| `l10n: L10n`             |                                                                |
| `commands: Commands`     |                                                                |
| `ui: Ui`                 |                                                                |
| `layout: Layout`         |                                                                |
| `views: Views`           |                                                                |
| `editor: Editor`         |                                                                |
| `files: Files`           |                                                                |
| `metadata: Metadata`     |                                                                |
| `dates: Dates`           | From 1.3.10: no permission, nothing leaves the plugin's frame. |
| `templates: Templates`   |                                                                |
| `net: Net`               |                                                                |
| `settings: Settings`     |                                                                |
| `ai: Ai`                 |                                                                |
| `plugins: Plugins`       |                                                                |
| `uri: Uri`               |                                                                |
| `export: Export`         |                                                                |
| `schedule: Schedule`     | 1.1: jobs Textus fires on time (notifications, background).    |
| `notify: Notify`         | 1.1: system notifications (notifications).                     |
| `app: App`               | 1.1: whether Textus is in front, behind, or has no window.     |
| `appearance: Appearance` | 1.6: colours over the theme (appearance).                      |

## Env

| Member                                                        |                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readonly language: string`                                   | Textus's UI language ("en", "zh", "zh-Hant", ...).                                                                                                                                                                  |
| `readonly appVersion: string`                                 |                                                                                                                                                                                                                     |
| `readonly apiVersion: string`                                 | This API's version: "1.6" from Textus 1.4.2 ("1.5": 1.3.12-rc.1, "1.4": 1.3.10, "1.3": 1.3.10-rc.1, "1.2": 1.3.9, "1.1": 1.3.0-beta.8). Prefer engines.textus; compare it as numbers, not as text ("1.10" > "1.9"). |
| `readonly platform: "macos" \| "windows" \| "linux" \| "ios"` |                                                                                                                                                                                                                     |
| `readonly theme: "light" \| "dark"`                           |                                                                                                                                                                                                                     |
| `onDidChangeTheme: Event<"light" \| "dark">`                  |                                                                                                                                                                                                                     |
| `onDidChangeLanguage: Event<string>`                          |                                                                                                                                                                                                                     |
| `readClipboard(): Promise<string>`                            | Plain text on the system clipboard (needs clipboard).                                                                                                                                                               |
| `writeClipboard(text: string): Promise<void>`                 |                                                                                                                                                                                                                     |
| `onDidCopy: Event<{ text: string; cut: boolean }>`            | 1.3: the user copied or cut text from a document (needs clipboard): the Markdown that went on the clipboard, math source kept. Not what is copied elsewhere in Textus or in other apps.                             |

## L10n

| Member                                       |                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `t(key: string, ...args: unknown[]): string` | A string of the manifest's `l10n` in the UI language; "{0}", "{1}"... are `args`. |

## Commands

| Member                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register(id: string, run: (...args: unknown[]) => unknown): Disposable`                              | A command of the manifest's `contributes.commands`, or one of the plugin's own beyond them (`<plugin id>.<name>`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `registerEditorCommand(id: string, run: (editor: Editor, ...args: unknown[]) => unknown): Disposable` | A command that works on the document in front: only offered with a document open, and given the editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `setContext(key: string, value: string \| boolean \| null): Promise<void>`                            | From 1.6: sets a key the manifest's menu `when` clauses can read, named `<plugin id>.<name>` - `when: "jane.focus.on"`. A string or true; false, null or undefined unsets it. Gone when the plugin stops.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `execute(id: string, ...args: unknown[]): Promise<unknown>`                                           | A command of Textus's or of a plugin's. Textus's: "textus.save", "textus.closeTab" ({ save: true } closes once saved) and "textus.insertBlock" with a Format menu block at the caret - "h1" to "h6", "paragraph", "bullet-list", "ordered-list", "task-list", "blockquote", "code-block", "math-block", "rule" or "table". "textus.showFolder" with a folder's path inside the open one shows it in the sidebar, as double-clicking it does (1.3.12). "textus.offerPlugin" with { id } suggests an official plugin from the market: a card at the bottom right with its name. It never blocks editing and stays until the user acts; its permissions are still asked before it installs. Resolves true once it is installed and on (at once when it already is); false for an id the market has no official plugin for (or when the market can't be reached), for an installed plugin that can't be turned on, while another card is shown, when the install fails, on "Later", and on × - after which your plugin's offers of that plugin aren't shown again (the user can bring them back in Settings › Extensions). Don't await it in activate. From 1.3.9. |

## Ui

| Member                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notice(text: string, options?: { tone?: Tone; action?: string }): Promise<boolean>`                                                                         | A short note at the bottom of the window that goes by itself. With `action` ("Undo"), a button on it: resolves true when it was clicked before the note went, false otherwise (Textus 1.3.12).                                                                                                                                                       |
| `message(text: string, options?: { tone?: Tone }): Promise<void>`                                                                                            | A box with one button; resolves when it is closed.                                                                                                                                                                                                                                                                                                   |
| `confirm(text: string, options?: { okLabel?: string; danger?: boolean }): Promise<boolean>`                                                                  |                                                                                                                                                                                                                                                                                                                                                      |
| `input(options?: { prompt?: string; value?: string; placeholder?: string; }): Promise<string \| null>`                                                       |                                                                                                                                                                                                                                                                                                                                                      |
| `pick(items: (string \| PickItem)[], options?: { placeholder?: string; multiple?: boolean; value?: string; commands?: boolean; }): Promise<unknown>`         | The picked item's `value` (its label without one), or null. With `multiple`, the picked values, or null. `value` is the text in the box to start with. With `commands`, the items come first among the command palette's: one of the palette's runs and gives null, and Enter on text nothing matches gives `{ typed: text }` (Textus 1.3.0-beta.3). |
| `pickDate(options?: { title?: string; value?: string; }): Promise<string \| null>`                                                                           | A date picked on Textus's month calendar, as `YYYY-MM-DD`, or null when cancelled; `value` is the one picked to start with (Textus 1.3.12).                                                                                                                                                                                                          |
| `pickColor(options?: { title?: string; value?: string; }): Promise<string \| null>`                                                                          | A colour picked from the tones or typed, as `#rrggbb`, or null when cancelled (Textus 1.3.12).                                                                                                                                                                                                                                                       |
| `form(options: { title?: string; okLabel?: string; fields: FormField[]; }): Promise<Record<string, unknown> \| null>`                                        | A small form: the values by key, or null when cancelled.                                                                                                                                                                                                                                                                                             |
| `withProgress<T>(title: string, task: (report: (progress: { fraction?: number; message?: string }) => void, signal: AbortSignal) => Promise<T>): Promise<T>` | Shows `title` with a progress bar while `task` runs; `report` moves it (0 to 1) and changes its line; `signal` aborts when the user cancels. Resolves with what `task` resolves.                                                                                                                                                                     |
| `statusItem(id: string, item: StatusItem): StatusItemHandle`                                                                                                 | An item in the status bar; `update` changes it.                                                                                                                                                                                                                                                                                                      |

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
  | { key: string; type: "date"; label: string; value?: string }
  | { key: string; type: "color"; label: string; value?: string }
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

| Member                                                                                                  |                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(target: string \| Location, options?: { where?: Where; asDocument?: boolean }): Promise<void>`    | A file - a document, or a file a plugin's editor opens - at the location given. Needs files.read, except for the file a view of the plugin's shows.                                                                                                                          |
| `openView(viewId: string, options?: { where?: Where; title?: string; state?: unknown }): Promise<void>` | One of the plugin's views (`contributes.views` with `"type": "webview"` or `"list"`) in a tab.                                                                                                                                                                               |
| `showSidebarTab(id: string): Promise<void>`                                                             | Opens the sidebar on a tab: a plugin's sidebar tab id, or `tree` (Files) or `outline`. From 1.3.10.                                                                                                                                                                          |
| `openSettings(): Promise<void>`                                                                         | Opens the plugin's own page in its tab - its settings, version, permissions: where setup forms go, not a sidebar. From 1.3.13.                                                                                                                                               |
| `openWebPage(url: string, options?: { where?: Where; title?: string }): Promise<void>`                  | A web page in a tab, for a host the plugin was granted.                                                                                                                                                                                                                      |
| `openUntitled(text: string, options?: { where?: Where; title?: string }): Promise<void>`                | A new document, not yet saved.                                                                                                                                                                                                                                               |
| `openExternal(url: string): Promise<void>`                                                              | In the system's browser.                                                                                                                                                                                                                                                     |
| `activeTab(): Promise<TabInfo \| null>`                                                                 |                                                                                                                                                                                                                                                                              |
| `tabs(): Promise<TabInfo[]>`                                                                            |                                                                                                                                                                                                                                                                              |
| `split(): Promise<{ direction: "row" \| "column" \| null; panes: string[]; }>`                          | How the panes run at the outermost, side by side ("row") or one above the other ("column"), and the tab each pane shows, in reading order; or one.                                                                                                                           |
| `onDidChangeActiveTab: Event<TabInfo \| null>`                                                          |                                                                                                                                                                                                                                                                              |
| `onDidChangeLayout: Event<void>`                                                                        |                                                                                                                                                                                                                                                                              |
| `panels(): Promise<PanelsState>`                                                                        | From 1.3.10: which of the window's panels are open - the sidebar (and the tab it shows) and Textus AI's. Read only; Zen mode closes them all. A panel added later is a new key.                                                                                              |
| `onDidChangePanels: Event<PanelsState>`                                                                 |                                                                                                                                                                                                                                                                              |
| `openFloating(viewId: string): Promise<void>`                                                           | Shows one of the plugin's floating views (`contributes.floatingViews`): a small transparent page of its own size, floating where the user left it. The user moves, folds and closes it; nothing floats until the plugin opens it, usually from a command. From Textus 1.3.6. |
| `closeFloating(viewId: string): Promise<void>`                                                          |                                                                                                                                                                                                                                                                              |
| `floatingViews(): Promise<FloatingViewState[]>`                                                         | The plugin's floating views that are open.                                                                                                                                                                                                                                   |
| `onDidChangeFloating: Event<FloatingViewState>`                                                         | One of them opened, closed, folded or moved: stop animating while `visible` is false.                                                                                                                                                                                        |
| `onDidTouchFloating: Event<{ view: string; kind: "poke" \| "pet" \| "moved"; }>`                        | The user clicked one ("poke"), clicked it three times in a moment ("pet") or dragged it somewhere ("moved").                                                                                                                                                                 |

## FloatingViewState

| Member                         |                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `view: string`                 |                                                                                     |
| `open: boolean`                |                                                                                     |
| `visible: boolean`             | False while folded to a dot or closed.                                              |
| `place: "desktop" \| "window"` |                                                                                     |
| `side: "left" \| "right"`      | The half of the window or screen it sits in: a character there can face the middle. |

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

| Member                                                                                                                                                                     |                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerList(id: string, provider: ListProvider): ListView`                                                                                                               | A list or tree drawn by Textus - in a sidebar tab or a view of `"type": "list"` - from the items the provider gives.                                                                                                                               |
| `registerWebview(id: string, provider: { resolve(webview: Webview, context: { state: unknown }): void \| Promise<void>; }): Disposable`                                    | A page of the plugin's own: a sidebar tab, or a view of `"type": "webview"`.                                                                                                                                                                       |
| `registerFileEditor(viewType: string, provider: { resolve(file: OpenFile, webview: Webview, context: { target: Location \| null }): void \| Promise<void>; }): Disposable` | Files of a type opened by the plugin (`contributes.customEditors`): a PDF, a Word document, a board.                                                                                                                                               |
| `registerCodeBlock(language: string, provider: { render(block: CodeBlock, webview: Webview): void \| Promise<void>; }): Disposable`                                        | Code blocks of a language (`contributes.codeBlocks`) drawn by the plugin in the document: `tasks, `chart. Asked only for the blocks in sight; the block's source stays in the file.                                                                |
| `registerEmbed(id: string, provider: EmbedProvider): EmbedHandle`                                                                                                          | The content of `![[...]]` embeds of the kinds `contributes.embeds` names, asked only for embeds in sight; Textus draws it read-only and expands embeds inside it itself. One plugin draws each kind: the first turned on. From 1.3.9 (files.read). |
| `registerSettingsPage(provider: { resolve(webview: Webview): void \| Promise<void>; }): Disposable`                                                                        | The plugin's page in Settings (`contributes.settingsPage`).                                                                                                                                                                                        |

## EmbedProvider

| Member                                                                                                                       |                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `provideEmbed(target: EmbedTarget, context: { signal: AbortSignal }): EmbedContent \| null \| Promise<EmbedContent \| null>` | null: nothing to show (Textus shows the link's name, dimmed). |

## EmbedTarget

What `![[...]]` points at, as `metadata.resolveNote` resolves it.

| Member             |     |
| ------------------ | --- |
| `path: string`     |     |
| `heading?: string` |     |
| `block?: string`   |     |
| `alias?: string`   |     |

## EmbedContent

| Member             |                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markdown: string` | Markdown, drawn read-only. Links and pictures in it are read from `target.path`'s folder. Leave `![[...]]` in it as is: Textus draws those itself, at most 5 deep and never in a loop. |
| `title?: string`   | Shown over it, opening the source when clicked; the link's name without it.                                                                                                            |

## EmbedHandle

| Member            |                                   |
| ----------------- | --------------------------------- |
| `refresh(): void` | Asks again for every embed shown. |

## ListProvider

| Member                                                              |                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `items(parent?: ListItem): ListItem[] \| Promise<ListItem[]>`       | The items at the top, or under `parent` (one with `children`).                                                              |
| `onSelect?(item: ListItem): void \| Promise<void>`                  | An item clicked or Enter on it: by default, its `location` opens and its `command` runs.                                    |
| `onCheck?(item: ListItem, checked: boolean): void \| Promise<void>` | Its checkbox ticked or unticked.                                                                                            |
| `onMove?(item: ListItem, target: ListItem): void \| Promise<void>`  | An item dragged onto another; with it, the rows can be dragged. From 1.3.10.                                                |
| `filterPlaceholder?: string`                                        | What the field over the list says; without it, there is no field. The list filters itself by label, description and detail. |
| `emptyText?: string`                                                | Shown when there are no items.                                                                                              |

## ListItem

| Member                                                                           |                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id?: string`                                                                    | Kept across refreshes: an open item stays open, a selected one selected.                                                                                      |
| `label: string`                                                                  |                                                                                                                                                               |
| `description?: string`                                                           |                                                                                                                                                               |
| `detail?: string`                                                                |                                                                                                                                                               |
| `group?: string`                                                                 | A group's heading above the items that share it.                                                                                                              |
| `icon?: string`                                                                  | One of the app's icons ("file", "folder", "task", "link", "tag", "calendar", "clock", "star"), or any other text, such as a page's emoji, drawn in its place. |
| `checkbox?: boolean`                                                             |                                                                                                                                                               |
| `badge?: { text: string; tone?: "accent" \| "warning" \| "danger" \| "muted"; }` | A small mark after the label: "due", "overdue", "new".                                                                                                        |
| `location?: Location`                                                            |                                                                                                                                                               |
| `command?: { id: string; args?: unknown[] }`                                     |                                                                                                                                                               |
| `children?: boolean`                                                             | Items under it, asked for when it is opened.                                                                                                                  |
| `actions?: { label: string; command: string; args?: unknown[] }[]`               | Right-click actions.                                                                                                                                          |
| `data?: unknown`                                                                 | Anything of the plugin's; given back as is.                                                                                                                   |

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

| Member                                            |                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readonly language: string`                       |                                                                                                                                                               |
| `readonly source: string`                         |                                                                                                                                                               |
| `readonly meta: Readonly<Record<string, string>>` | What follows the language on its fence, read as settings: ` ```chart height=300 title="Sales" legend` is `{ height: "300", title: "Sales", legend: "true" }`. |
| `readonly path: string \| null`                   | The document it is in.                                                                                                                                        |
| `readonly block: string`                          |                                                                                                                                                               |
| `onDidChange: Event<string>`                      | Its source or meta changed (typed, undone); the page stays.                                                                                                   |
| `setSource(source: string): Promise<boolean>`     | Replaces its source (needs editor.write), one undo step.                                                                                                      |

## Editor

| Member                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPath(): Promise<string \| null>`                                                                                                               | Its path; null for an unsaved one, and with no document.                                                                                                                                                                                                                                                                                                                                                   |
| `getText(): Promise<string \| null>`                                                                                                               | Its Markdown (editor.read).                                                                                                                                                                                                                                                                                                                                                                                |
| `getSelection(): Promise<{ text: string; markdown: string \| null } \| null>`                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                            |
| `getBlocks(): Promise<Block[] \| null>`                                                                                                            | Its blocks as Textus AI is shown them (editor.read).                                                                                                                                                                                                                                                                                                                                                       |
| `getOutline(): Promise< { level: number; text: string; line: number }[] \| null >`                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                            |
| `edit(changes: Change \| Change[]): Promise<boolean>`                                                                                              | Changes it at once, as one undo step (editor.write). False when a change can't be placed (a block id from before an edit).                                                                                                                                                                                                                                                                                 |
| `insertText(text: string): Promise<boolean>`                                                                                                       | At the caret, or in place of the selection (editor.write).                                                                                                                                                                                                                                                                                                                                                 |
| `replaceSelection(text: string): Promise<boolean>`                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                            |
| `propose(change: Change, options?: { reason?: string }): Promise<boolean>`                                                                         | Shown as a proposal the user accepts or rejects, as Textus AI's are (editor.propose).                                                                                                                                                                                                                                                                                                                      |
| `reveal(location: Omit<Location, "path"> & { path?: string }): Promise<boolean>`                                                                   | Scrolls to a place in it and puts the caret there.                                                                                                                                                                                                                                                                                                                                                         |
| `registerCompletion(id: string, provider: CompletionProvider): Disposable`                                                                         | Completions as you type, for one of `contributes.completions` (editor.read): asked when what is before the caret matches its `pattern`. `insert` replaces the match; `$0` marks the caret. Shown in the / panel, grouped by plugin. 1.2: every matching provider is asked at once, and none holds up typing.                                                                                               |
| `registerHover(provider: { provideHover(target: HoverTarget): HoverCard \| null \| Promise<HoverCard \| null>; }): Disposable`                     | A card for what the pointer rests on (editor.read).                                                                                                                                                                                                                                                                                                                                                        |
| `registerDecorations(provider: { decorate(blocks: Block[], document?: { blocks: Block[] }): Decoration[] \| Promise<Decoration[]>; }): Disposable` | Marks over the text (editor.read), asked for the blocks in sight and again when they change. 1.4.1: `document` is the whole document those blocks are of, which can be one beside the document in front; read it rather than `getBlocks`.                                                                                                                                                                  |
| `onDidChangeActive: Event<{ path: string \| null }>`                                                                                               | Another document came to the front (or none).                                                                                                                                                                                                                                                                                                                                                              |
| `onDidChange: Event<{ path: string \| null; source: ChangeSource }>`                                                                               | Its text changed: once typing pauses, not on every key. 1.1: `source` says who changed it - "user" (typing, pasting, the keyboard), "ai" (Textus AI: an accepted proposal, a completion, a grammar fix), "disk" (the file changed and was read again), "plugin" (a plugin through this API) or "history" (undo, redo). When several did since the last event, "user" wins, then history, ai, plugin, disk. |
| `onDidChangeSelection: Event<{ text: string }>`                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                            |
| `keys: EditorKeys`                                                                                                                                 | The keyboard, for plugins that are a way of typing - Vim, Emacs (editor.input).                                                                                                                                                                                                                                                                                                                            |

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

| Member                                                                                                                                                                           |     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `provideCompletions(context: CompletionContext): \| CompletionItem[] \| CompletionList \| null \| undefined \| Promise<CompletionItem[] \| CompletionList \| null \| undefined>` |     |

## CompletionContext

| Member                 |                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `text: string`         | Before the caret, in its paragraph or formula.                                                                                    |
| `match: string`        | The part `pattern` matched, which an item replaces.                                                                               |
| `inMath: boolean`      |                                                                                                                                   |
| `query: string`        | From 1.3.9: the pattern's last capture group (the query); the match without one.                                                  |
| `after: string`        | From 1.3.9: after the caret, to the end of its block (at most 200 characters): the "]]" Textus pairs with "[[".                   |
| `path: string \| null` | From 1.3.9: the document's path; null for an unsaved one.                                                                         |
| `signal: AbortSignal`  | From 1.3.9: aborts when Textus no longer needs the answer (the text moved on, the panel closed). An answer after that is dropped. |

## CompletionList

From 1.3.9: a whole list (up to 20,000 items) Textus filters itself as typing goes on, without asking again while the same pattern keeps matching from the same place. An array is the provider's own filtering: asked again on each key, at most 50 kept.

| Member                    |     |
| ------------------------- | --- |
| `items: CompletionItem[]` |     |
| `complete: true`          |     |

## CompletionItem

| Member                                       |                                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label: string`                              |                                                                                                                                                          |
| `insert: string`                             | Replaces the match; `$0` marks the caret.                                                                                                                |
| `detail?: string`                            |                                                                                                                                                          |
| `icon?: string`                              | From 1.3.9: one of the app's icons ("file", "link", "tag", "calendar", "clock", "star", "heading", "block", "quote", "emoji") or an SVG of the plugin's. |
| `keywords?: string`                          | From 1.3.9: also found by (an English name, an alias).                                                                                                   |
| `replaceAfter?: number`                      | From 1.3.9: characters after the caret it replaces too: 2 for the "]]" in `after`.                                                                       |
| `command?: { id: string; args?: unknown[] }` | From 1.3.9: run once it is inserted - the plugin's own command or one of Textus's.                                                                       |

## HoverTarget

```ts
type HoverTarget =
  | {
      type: "document";
      path: string;
      heading: string | null;
      block?: string | null;
    }
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

| Member                                                    |                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `block: string`                                           |                                                             |
| `anchor?: string`                                         |                                                             |
| `style: "highlight" \| "underline" \| "muted" \| "badge"` |                                                             |
| `tone?: "accent" \| "warning" \| "danger" \| "success"`   |                                                             |
| `text?: string`                                           | For "badge": its text, after the words.                     |
| `tooltip?: string`                                        |                                                             |
| `before?: boolean`                                        | For "badge": before the words instead - a heading's number. |

## WillSave

A document about to be saved.

| Member                                             |                                                           |
| -------------------------------------------------- | --------------------------------------------------------- |
| `path: string`                                     |                                                           |
| `text: string`                                     |                                                           |
| `trigger: "manual" \| "auto"`                      |                                                           |
| `blocks: (Block & { from: number; to: number })[]` | Its blocks in order; `from`/`to` are offsets into `text`. |

## BlockEdit

A block's new Markdown, by its id.

| Member             |     |
| ------------------ | --- |
| `block: string`    |     |
| `markdown: string` |     |

## EditorKeys

| Member                                                                                  |                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture(capture: { mode: "all" \| "some"; keys: string[] } \| null): Promise<boolean>` | Takes the editor's keys: "all" but the app's shortcuts, or "some" - only `keys`. null gives back your own capture. One plugin at a time: false while another holds them (its id is in your log). The boolean is from 1.3.9; older Textus answers undefined. |
| `onKey: Event<string>`                                                                  |                                                                                                                                                                                                                                                             |
| `exec(op: EditorOp): Promise<EditorOpResult>`                                           |                                                                                                                                                                                                                                                             |

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
  | { op: "deleteChars"; count?: number; back?: boolean; copy?: boolean }
  | { op: "insertText"; text: string }
  | { op: "pasteLines"; text: string; above?: boolean }
  | { op: "openLine"; above?: boolean }
  | { op: "replaceChar"; char: string }
  | { op: "collapse"; to?: "head" | "start" | "end" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "cursor"; style: "bar" | "block" }
  | { op: "scroll"; to: "center" | "top" | "bottom" }
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

## Dates

Dates written and read in Moment's tokens, as Obsidian's settings and templates name them: YYYY YY Q MMMM MMM MM M Do DD D dddd ddd gggg GGGG ww w WW W HH H hh h mm ss s A a, `[literal]`. Names, ordinals and where a week starts follow `language` (the UI's by default).

| Member                                                                                             |                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format(date: Date \| number \| string, format?: string, options?: { language?: string }): string` | `date` (a Date, a time in ms, or "YYYY-MM-DD") in `format` (default "YYYY-MM-DD").                                                                      |
| `parse(text: string, format?: string, options?: { language?: string }): string \| null`            | The day a name written in `format` stands for, as "YYYY-MM-DD"; null when it isn't one. Days only: a week's or month's name ("2026-W45") reads as null. |

## Templates

Templates filled in as Obsidian's Templates core plugin and then the Templater plugin's common tags fill them.

| Member                                                                                                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fill(text: string, options?: { values?: Record<string, unknown>; date?: Date \| number \| string; now?: Date \| number \| string; title?: string; folder?: string; format?: string; dateFormat?: string; timeFormat?: string; language?: string; }): Promise<{ text: string; cursor: number \| null; skipped: string[]; }>` | `text` with {{date}}, {{time}}, {{title}}, {{date:FORMAT}}, {{date+1d}} and every {{key}} of `values` filled in (a list joined with ", ", nothing for null, a date in its format); then Templater's `<% tp.date.now(...) %>`, `tp.date.tomorrow/yesterday/weekday`, `tp.file.title`, `tp.file.folder`, `tp.file.creation_date` and `tp.file.cursor()`. Any other tag or script stays as written and is listed in `skipped`. With `format` (a periodic note's name format), also {{yesterday}}, {{tomorrow}}, {{weekday}} and {{monday}} … {{sunday:FORMAT}} for `date`'s week, as Periodic Notes fills them. {{date}} and {{time}} use the folder's Templates formats when the plugin may read files and the caller gives none. |

## Files

| Member                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root(): Promise<string \| null>`                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `list(dir?: string): Promise<FileEntry[]>`                                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `find(glob?: string): Promise<{ path: string; rel: string }[]>`                                                              | The files whose path in the folder matches `glob` ("**\/_.md", "Daily/_.md"); every document without one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `stat(path: string): Promise<FileEntry \| null>`                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `read(path: string): Promise<Uint8Array>`                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `readText(path: string): Promise<string>`                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `write(path: string, data: Uint8Array \| ArrayBuffer \| string): Promise<void>`                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `writeText(path: string, text: string): Promise<void>`                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `create(path: string, text?: string): Promise<void>`                                                                         | A new file; fails if one is there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `process(path: string, change: (text: string) => string): Promise<string>`                                                   | Reads, changes and writes a file without losing anything: open in a tab, the change goes into its editor as one undo step; on disk, it is written only if the file is unchanged since it was read (and `change` is run again otherwise). Return the text unchanged to write nothing.                                                                                                                                                                                                                                                                                                                                |
| `blockId(path: string, line: number): Promise<string \| null>`                                                               | The `^id` of the block at `line` (from 0) of `path`, adding a new one (6 lowercase hex characters) where Obsidian reads it - the end of a paragraph's, heading's or list item's last line; a line of its own after a table, quote or code block - through `process`, every other byte kept. null when no block is there. From 1.3.9 (files.write).                                                                                                                                                                                                                                                                  |
| `rename(from: string, to: string, options?: { updateLinks?: boolean }): Promise<void>`                                       | With `updateLinks`, links to it in the folder's documents follow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `trash(path: string): Promise<void>`                                                                                         | To the system's Trash, never deleted for good.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `createFolder(path: string): Promise<void>`                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `frontmatter: Frontmatter`                                                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `onDidCreate: Event<{ path: string }>`                                                                                       | A file a plugin made, and from 1.3.13 a picture pasted or dropped into a document and saved in its folder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `onDidChange: Event<{ path: string }>`                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `onDidRename: Event<{ from: string; to: string }>`                                                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `onDidDelete: Event<{ path: string }>`                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `onWillSave(listener: (e: WillSave) => string \| BlockEdit[] \| void \| Promise<string \| BlockEdit[] \| void>): Disposable` | A document is about to be saved (files.write). Plugins are asked one after another in plugin id order, each given the text as the one before left it, at most a second each. Return the blocks you changed (`{ block, markdown }`, by the ids in `blocks`) - only those are written back - or the whole text, which is written back block by block. Code, math, HTML and link definition blocks stay as the user wrote them, and each block keeps its line endings. A change that would change again when run a second time is skipped for this save. `trigger`, `blocks` and `BlockEdit[]` answers are from 1.3.9. |
| `onDidSave: Event<{ path: string; text: string; trigger: "manual" \| "auto"; }>`                                             | 1.1: `trigger` is "manual" for File › Save or Save As, "auto" for autosave.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `onDidChangeRoot: Event<{ path: string \| null }>`                                                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `conventions(path?: string): Promise<FolderConventions>`                                                                     | How the folder of `path` (a document or folder, from the root; the open folder when left out) is written, whichever app made it - Obsidian, Logseq, Foam, Dendron, a site generator, git, or the folder's own `.textus/settings.json` "conventions". Read it instead of other apps' settings files; a field no app sets is null, for Textus's own settings. From 1.3.9 (files.read).                                                                                                                                                                                                                                |
| `appSettings(app: "obsidian", file: string, path?: string): Promise<unknown \| null>`                                        | From 1.3.10: a settings file of the nearest Obsidian vault - `appSettings("obsidian", "bookmarks.json")` reads `.obsidian/bookmarks.json` - parsed as JSON, found above the open folder too; null where there is none. A file at the settings folder's top only. Read only (files.read).                                                                                                                                                                                                                                                                                                                            |
| `onDidChangeConventions: Event<{ root: string }>`                                                                            | The open folder's conventions changed: another folder, or its app's settings edited. From 1.3.9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## ConventionSetting

One setting of a folder and where it came from.

| Member         |                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `value: T`     |                                                                                                                                     |
| `app: string`  | "textus", "typora", "obsidian", "logseq", "dendron", "foam", "vscode", "mkdocs", "hugo", "docusaurus", "jekyll", "quarto" or "git". |
| `root: string` | The folder these settings belong to.                                                                                                |

## PeriodicNotes

A kind of periodic note: its folder (full path), file name format (moment.js tokens, `[literal]` text) and template file (full path). An Obsidian vault with no daily notes settings keeps them at its top.

| Member                     |     |
| -------------------------- | --- |
| `folder: string`           |     |
| `format: string`           |     |
| `template: string \| null` |     |

## FolderConventions

| Member                                                                                        |                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources: { app: string; root: string }[]`                                                    | The apps found, nearest first.                                                                                                               |
| `linkStyle: ConventionSetting<string> \| null`                                                | "wiki" or "markdown".                                                                                                                        |
| `linkPath: ConventionSetting<string> \| null`                                                 | "shortest", "relative" or "absolute".                                                                                                        |
| `linkRoot: ConventionSetting<string> \| null`                                                 | The folder a link starting with "/" is read from.                                                                                            |
| `updateLinks: ConventionSetting<string> \| null`                                              | On a rename: "always", "ask" or "never".                                                                                                     |
| `attachments: ConventionSetting<string> \| null`                                              | Where pictures go: "/" the root, "./" beside the document, "./sub" below it, else a folder from the root; `${filename}` the document's name. |
| `softBreaks: ConventionSetting<boolean> \| null`                                              | Whether a single newline shows as a line break.                                                                                              |
| `templates: ConventionSetting<string> \| null`                                                | The templates folder, a full path.                                                                                                           |
| `daily: ConventionSetting<PeriodicNotes> \| null`                                             | Daily notes: folder (full path), file name format (moment.js tokens, `[literal]` text), template file (full path).                           |
| `weekly: ConventionSetting<PeriodicNotes> \| null`                                            | From 1.3.10: weekly and monthly notes (Periodic Notes), only where turned on.                                                                |
| `monthly: ConventionSetting<PeriodicNotes> \| null`                                           |                                                                                                                                              |
| `templateFormats: ConventionSetting<{ date: string \| null; time: string \| null; }> \| null` | From 1.3.10: how a template writes {{date}} and {{time}} (Obsidian's Templates settings); null where unset.                                  |
| `newNotes: ConventionSetting<string> \| null`                                                 | Where new notes go, as `attachments` names a folder.                                                                                         |
| `ignore: string[]`                                                                            | Paths the app hides.                                                                                                                         |

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

| Member                                                                                                                                                              |                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get(path: string): Promise<DocumentMetadata \| null>`                                                                                                              |                                                                                                                                                                                                                                                                                                                                                        |
| `all(): Promise<DocumentMetadata[]>`                                                                                                                                | Every document, without its blocks: titles, links and tags - what a graph is drawn from.                                                                                                                                                                                                                                                               |
| `backlinks(path: string): Promise<{ path: string; line: number; text: string }[]>`                                                                                  | The documents linking to `path`, with where.                                                                                                                                                                                                                                                                                                           |
| `resolveLink(link: string, from: string): Promise<string \| null>`                                                                                                  | Where a link written in `from` goes: a [[wiki link]] or a relative path; null for none. 1.2: the same as `(await resolveNote(link, from))?.path` for a target that exists.                                                                                                                                                                             |
| `resolveNote(link: string, from: string): Promise<ResolvedLink \| null>`                                                                                            | Where a link goes, exactly as a click takes it: `link` as written - "[[Note#^id\|alias]]", "![[Note#Heading]]", "[[#^id]]", or a Markdown link's target "Note.md#my-heading" / "../a/Note" - from the document `from` (needed for relative links and same-note anchors). null when `link` is no link to a file (a web URL). From 1.3.9 (files.read).   |
| `linkTo(to: string, from: string, options?: { heading?: string; block?: string; alias?: string; style?: "wiki" \| "markdown"; embed?: boolean; }): Promise<string>` | The link Textus writes to `to` from `from`: the folder's style (in an Obsidian vault, its "new link format" and wiki or Markdown links; `[[wiki]]` by the shortest name elsewhere), with `#heading`, `#^block` and `\|alias` as given - `[[#Heading]]` within one note. `style` overrides wiki or Markdown; `embed` adds "!". From 1.3.9 (files.read). |
| `tags(): Promise<{ tag: string; count: number }[]>`                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                        |
| `tasks(filter?: { done?: boolean; path?: string; tag?: string; }): Promise<Task[]>`                                                                                 |                                                                                                                                                                                                                                                                                                                                                        |
| `search(query: string, options?: { limit?: number }): Promise<{ hits: (Location & { rel: string; line: number; text: string })[]; truncated: boolean; }>`           | The documents' lines holding `query`, ignoring case.                                                                                                                                                                                                                                                                                                   |
| `onDidChange: Event<{ paths: string[] }>`                                                                                                                           | Documents were added, changed or removed.                                                                                                                                                                                                                                                                                                              |

## ResolvedLink

| Member                   |                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `path: string`           | Absolute. For a note that doesn't exist: where a click creates it.                                                    |
| `exists: boolean`        |                                                                                                                       |
| `kind: "note" \| "file"` | "note": a Markdown document; "file": anything else (a PDF, a picture).                                                |
| `heading?: string`       | The last level of "#A#B"; never a "^id".                                                                              |
| `block?: string`         | A "^id", without the "^".                                                                                             |
| `alias?: string`         |                                                                                                                       |
| `line: number \| null`   | Where the heading or block is; null for the top, or when it isn't found (the note opens at its top, as a click does). |

## DocumentMetadata

| Member                                                                                              |                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `path: string`                                                                                      |                                                                                                                              |
| `rel: string`                                                                                       |                                                                                                                              |
| `title: string`                                                                                     | The first heading's text, or the file's name.                                                                                |
| `frontmatter: Record<string, unknown>`                                                              |                                                                                                                              |
| `headings: { level: number; text: string; line: number }[]`                                         |                                                                                                                              |
| `links: { target: string; resolved: string \| null; line: number; text: string; wiki: boolean; }[]` |                                                                                                                              |
| `tags: string[]`                                                                                    |                                                                                                                              |
| `tasks: Task[]`                                                                                     |                                                                                                                              |
| `blockIds: { id: string; line: number; text: string }[]`                                            | From 1.3.9: the block ids ("^abc123") in it, with the first words of their block - for [[Note#^ completion. Also from `all`. |
| `aliases: string[]`                                                                                 | From 1.3.9: front matter `aliases` / `alias`, as strings.                                                                    |
| `blocks?: { id: string; kind: Block["kind"]; line: number }[]`                                      | Only from `get`.                                                                                                             |
| `modifiedMs: number \| null`                                                                        |                                                                                                                              |

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

| Member                                                                                                                 |                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `registerTool(name: string, run: (args: Record<string, unknown>) => string \| Promise<string> \| unknown): Disposable` |                                                                                            |
| `state(): Promise<AiState>`                                                                                            | What Textus AI is doing and with which service and model - never what is said. From 1.3.6. |
| `onDidChangeState: Event<AiState>`                                                                                     |                                                                                            |

## PanelsState

| Member                                    |                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `sidebar: { open: boolean; tab: string }` | `tab`: the sidebar tab's id ("tree" for the files, "outline", or a plugin's view id). |
| `ai: { open: boolean }`                   |                                                                                       |

## AiState

| Member                                                    |                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `state: "idle" \| "thinking" \| "writing" \| "proposing"` |                                                             |
| `model: { provider: string; id: string \| null } \| null` | null before Textus AI is first used.                        |
| `ended?: "done" \| "failed" \| "stopped"`                 | On going idle after a request: finished, failed or stopped. |

## Plugins

| Member                                                                                              |                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get<T = Record<string, (...args: unknown[]) => Promise<unknown>>>(id: string): Promise<T \| null>` | What another plugin's `activate` returned, its functions callable from here (their arguments and answers as JSON); starts it if it isn't running. null when it isn't installed or turned on. |

## Export

| Member                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mathCss(): Promise<string>`                                                                                                                                                                                     | KaTeX's stylesheet with its fonts inline, as Textus draws formulas: for a plugin page or a saved file that shows KaTeX's markup without loading anything from the web. About 400 KB. From 1.4.2 (API 1.6).                                                                                            |
| `onWillExport(listener: (page: { format: "html" \| "pdf"; path: string \| null; html: string; }) => \| { css?: string; html?: string } \| void \| Promise<{ css?: string; html?: string } \| void>): Disposable` | An HTML or PDF export's page, before it is written (editor.read): `css` is added to its styles, `html` replaces its content. Scripts and handlers in the HTML are taken out. Plugins are asked in plugin id order, each given the HTML as the one before left it, and waited for at most two seconds. |

## Uri

| Member                                                                                                                   |                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `registerHandler(handler: (uri: { path: string; query: Record<string, string>; }) => void \| Promise<void>): Disposable` | Links `textus://<plugin id>/<path>?<query>` opened from outside Textus (a browser, another app). |

## ChangeSource

Who changed the document (editor.onDidChange).

```ts
type ChangeSource = "user" | "ai" | "disk" | "plugin" | "history";
```

## Job

A job Textus keeps for the plugin and fires on time while it runs - with a window open or, in background mode, with none - even after a restart. One of `at`, `every`, `daily`; then `notify`, `run` or both.

- `at`: once, "2026-11-02T09:00" (local) or with an offset.

- `every`: "15m", "1h", "1h30m", "1d": 15 minutes at least, counted from when it was set.

- `daily`: "HH:MM", local time; across daylight saving it keeps the time on the clock.

- `catchUp`: a time missed while Textus wasn't running fires once on its next start ("once", the default) or is let go ("skip").

- `notify`: shown as a system notification (needs notifications).

- `run`: the name of a function the manifest's `background` code exports, called as `exports[run](job, ctx)` (needs background).

| Member                       |     |
| ---------------------------- | --- |
| `at?: string`                |     |
| `every?: string`             |     |
| `daily?: string`             |     |
| `catchUp?: "once" \| "skip"` |     |
| `notify?: Notification`      |     |
| `run?: string`               |     |

## ScheduledJob

A job as Textus keeps it: what was set, when it is due next (Unix ms; null once an `at` fired) and when it last fired.

| Member                      |     |
| --------------------------- | --- |
| `id: string`                |     |
| `catchUp: "once" \| "skip"` |     |
| `nextDue: number \| null`   |     |
| `lastFired: number \| null` |     |

## Notification

A system notification. A click brings Textus up with `open.path` (a file of the open folder - or, from a job, of the folder open when it was set - absolute or relative to it; needs files.read) open at `open.line`. macOS asks the user to allow notifications the first time.

| Member                                   |     |
| ---------------------------------------- | --- |
| `title: string`                          |     |
| `body?: string`                          |     |
| `open?: { path: string; line?: number }` |     |

## Schedule

| Member                                             |                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `set(id: string, job: Job): Promise<ScheduledJob>` | Adds the job, or replaces the plugin's job of that id (letters, digits, `-`, `_`, `.`; at most 32 jobs a plugin). |
| `clear(id: string): Promise<boolean>`              | Whether there was one to take away.                                                                               |
| `list(): Promise<ScheduledJob[]>`                  |                                                                                                                   |

## Notify

| Member                                            |     |
| ------------------------------------------------- | --- |
| `show(notification: Notification): Promise<void>` |     |

## App

| Member                                                            |                                                                                                                                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readonly state: "active" \| "inactive" \| "background"`          | "active": a Textus window has the focus; "inactive": windows are open, none focused; "background": no window (background code, or every window closed in background mode). |
| `onDidChangeState: Event<"active" \| "inactive" \| "background">` |                                                                                                                                                                            |
| `onDidActivity: Event<{ kind: "typing" \| "saved" }>`             | The user typed (heard once typing pauses) or saved by hand - that it happened, with nothing of the document. From 1.3.6.                                                   |

## OpenColor

A colour Textus's look is drawn from, which a plugin may set.

```ts
type OpenColor =
  | "--doc-bg"
  | "--doc-text"
  | "--doc-muted"
  | "--doc-accent"
  | "--doc-mark"
  | "--doc-code-bg"
  | "--ui-bg"
  | "--ui-text"
  | "--ui-accent"
  | "--ui-frame-tint"
  | "--ui-frame-paint"
  | "--tone-blue"
  | "--tone-green"
  | "--tone-orange"
  | "--tone-purple"
  | "--tone-red"
  | "--tone-teal"
  | "--tone-yellow"
  | "--tone-pink"
  | "--tone-gray";
```

## Appearance

From 1.6 (permission `appearance`): a palette over whichever theme is on. Only the colours the others are drawn from are open; borders, hovers and the like follow. Values are colours; `--ui-frame-paint` (the frame round the pages: bar, rail, sidebar) may also be a `linear-`, `radial-` or `conic-gradient(...)` of colours, laid across the whole window. No images, `url()` or `var()`. Text kept readable: below 4.5:1 on its background (or any of the paint's colours) it is moved toward ink or white. The user's Custom CSS still wins.

const layer = await textus.appearance.setColors( { "--ui-frame-paint": "linear-gradient(120deg, #f3d9c4, #d6dcec)" }, { scheme: "light" }, ); ctx.subscriptions.push(layer);

| Member                                                                                                                           |                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setColors(colors: Partial<Record<OpenColor, string>>, options?: { scheme?: "light" \| "dark" \| "both" }): Promise<Disposable>` | Lays `colors` over the theme, for light, dark or both (the default); disposing it, or the plugin stopping, takes it away. Several plugins: per colour the one last by id wins. Rejects naming the first colour or value not taken. |
| `colors(): Promise<Record<OpenColor, string>>`                                                                                   | The open colours as the window shows them now (theme and every plugin's), as `rgb(...)`; the paint as set, or "". No permission.                                                                                                   |
| `onDidChange: Event<{ theme: string; scheme: "light" \| "dark" }>`                                                               | The theme (its id, for keeping a palette per theme), the scheme or a plugin's colours changed.                                                                                                                                     |

## JobRun

What a job's `run` is given, in the manifest's `background` code: a frame of its own, started for the run and stopped after it (30 seconds at most). That code reaches `files` (in the folder open when the job was set), `net`, `settings.get`, `schedule`, `notify`, `app`, `l10n`, `env` and the context's storage, secrets and log - not the editor, UI, layout, views, commands or metadata.

exports.remind = async (job, ctx) => { ... };

| Member       |                                                                   |
| ------------ | ----------------------------------------------------------------- |
| `id: string` | The job's id.                                                     |
| `due: Date`  | When it was due: well before now for one caught up after a start. |

## MenuItem

An item of a page's menu (`WebviewApi.menu`); `items` makes it a submenu (one level).

| Member                                |     |
| ------------------------------------- | --- |
| `label: string`                       |     |
| `value?: unknown`                     |     |
| `checked?: boolean`                   |     |
| `danger?: boolean`                    |     |
| `disabled?: boolean`                  |     |
| `items?: (MenuItem \| "separator")[]` |     |

## WebviewApi

| Member                                                                                                                  |                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readonly language: string`                                                                                             |                                                                                                                                                                                                                                                                      |
| `t(key: string, ...args: unknown[]): string`                                                                            |                                                                                                                                                                                                                                                                      |
| `postMessage(message: unknown): void`                                                                                   |                                                                                                                                                                                                                                                                      |
| `onMessage(fn: (message: unknown) => void): Disposable`                                                                 |                                                                                                                                                                                                                                                                      |
| `getState(): unknown`                                                                                                   |                                                                                                                                                                                                                                                                      |
| `setState<T>(state: T): T`                                                                                              |                                                                                                                                                                                                                                                                      |
| `menu(items: (MenuItem \| "separator")[], at?: Element \| { x: number; y: number }): Promise<unknown>`                  | Textus's own menu over the page, for a right-click or a dropdown, under `at` (an element) or at a point of the page. Resolves to the chosen item's value (its label without one), or null when the menu is closed without a choice. A page draws no menu of its own. |
| `textItems(field: Element): Promise<(MenuItem \| "separator")[]>`                                                       | A text field's menu items (undo, redo, cut, copy, paste, select all) in Textus's language, for a page's own right-click menu; each value is the action `editText` takes (1.3.12).                                                                                    |
| `editText(field: Element, action: string): Promise<void>`                                                               | One of those actions in `field`, the clipboard through Textus.                                                                                                                                                                                                       |
| `onExport(provider: (options: { theme: "light" \| "dark"; }) => string \| null \| Promise<string \| null>): Disposable` | How the page looks as a picture, asked when the document is exported (a code block's page): an SVG's markup or an image's `data:` URL, for a page of `theme`. Without it, or answering null, the block exports as its source.                                        |
