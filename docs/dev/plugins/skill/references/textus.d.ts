/**
 * The Textus plugin API, 1.10: the `textus` object a plugin's code is given
 * (src/plugins/host/host-runtime.ts), the context its `activate` receives, and
 * `acquireTextusApi()` in its webviews (webview-runtime.ts). The one source
 * of truth: docs/dev/plugins/guide.md explains it, the reference pages are
 * made from it, Textus AI writes plugins from it, and
 * src/plugins/host/textus-types.test.ts keeps it in step with the runtime.
 *
 * In a plugin: `/// <reference path="textus.d.ts" />` at the top of
 * host.js, or `"types": ["./textus.d.ts"]` in a jsconfig.json.
 *
 * Every call that reaches Textus returns a promise. Every `register…` and
 * `on…` returns a Disposable; what is pushed to `ctx.subscriptions` - and
 * everything the plugin registered - is taken back when it stops.
 */

export {};

declare global {
  /** The API, as the plugin's code sees it. */
  const textus: Textus.Api;

  /** In a webview's page: the same webview's side of the channel. */
  function acquireTextusApi(): Textus.WebviewApi;

  namespace Textus {
    // ---------------------------------------------------------------
    // Basics
    // ---------------------------------------------------------------

    interface Disposable {
      dispose(): void;
    }

    /** Listens; the Disposable stops listening. */
    type Event<T> = (listener: (e: T) => void) => Disposable;

    /**
     * A place in the folder: a file, and where in it. Used to open things,
     * by links, search results, tasks and list items.
     *
     * - `block`: a block id of the document as it is now (editor.getBlocks,
     *   metadata) - for "read it, then change it", as Textus AI's edits are.
     *   An id is the hash of the block's Markdown: an edited block has a new
     *   one, and an old id finds nothing rather than the wrong block.
     * - For a place kept for later (a link back from a PDF excerpt), give
     *   `heading` and `text` (a few words of it): Textus finds the words,
     *   then falls back to the heading, then to `line`.
     * - `page`: a page of a PDF; `fragment`: anything after `#` a file
     *   editor understands, passed to it as is.
     */
    interface Location {
      path: string;
      line?: number;
      /** The column in `line`, from 0. From 1.8. */
      ch?: number;
      heading?: string;
      block?: string;
      text?: string;
      page?: number;
      fragment?: string;
    }

    /** Where something opens: a tab of its own (the default), the pane
     *  beside the one in front (splitting the window if it isn't), or in
     *  place of the tab in front. */
    type Where = "tab" | "beside" | "current";

    /** What `exports.activate` is given. */
    interface PluginContext {
      readonly subscriptions: Disposable[];
      readonly plugin: PluginInfo;
      /** Places of the plugin's own: `global` for every folder, in
       *  Textus's config folder; `project` in the open folder's
       *  .textus/plugins/<id>/ (needs project.data; with no folder open, a
       *  hidden one in Textus's config folder); `document(path)` for
       *  one document - a diagram's zoom, a bookmark - which follows the
       *  document when it is renamed or moved. */
      readonly storage: {
        global: StoragePlace;
        project: StoragePlace;
        document(path: string): DocumentPlace;
      };
      /** Secrets (API tokens): kept as Textus keeps its API keys, in a
       *  file only the user can read, apart from settings and storage -
       *  never synced, exported or shown. The plugin's own only. */
      readonly secrets: Secrets;
      /** Shown in the plugin's page in Settings › Extensions › Plugins. */
      readonly log: Log;
    }

    interface PluginInfo {
      readonly id: string;
      readonly version: string;
      /** One of the plugin's own files. */
      readFile(path: string): Promise<Uint8Array>;
      readText(path: string): Promise<string>;
    }

    interface StoragePlace {
      get(key: string): Promise<unknown>;
      /** `undefined` or `null` deletes. */
      set(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<void>;
      keys(): Promise<string[]>;
      readText(path: string): Promise<string>;
      writeText(path: string, text: string): Promise<void>;
      files(): Promise<string[]>;
      deleteFile(path: string): Promise<void>;
    }

    /** Values kept for one document. */
    interface DocumentPlace {
      get(key: string): Promise<unknown>;
      /** `undefined` or `null` deletes. */
      set(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<void>;
      keys(): Promise<string[]>;
    }

    interface Secrets {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<void>;
      delete(key: string): Promise<void>;
    }

    interface Log {
      info(...args: unknown[]): void;
      warn(...args: unknown[]): void;
      error(...args: unknown[]): void;
    }

    // ---------------------------------------------------------------
    // The API
    // ---------------------------------------------------------------

    interface Api {
      env: Env;
      l10n: L10n;
      commands: Commands;
      ui: Ui;
      layout: Layout;
      views: Views;
      editor: Editor;
      files: Files;
      metadata: Metadata;
      /** From 1.4.3: the folder's Git history (files.read; committing,
       *  git.commit). Desktop only. */
      git: Git;
      /** From 1.9 (Textus 1.4.6, preview): a folder on a server through the
       *  user's own ssh (permission ssh). Desktop only. */
      ssh: Ssh;
      /** From 1.3.10: no permission, nothing leaves the plugin's frame. */
      dates: Dates;
      templates: Templates;
      net: Net;
      settings: Settings;
      ai: Ai;
      plugins: Plugins;
      uri: Uri;
      export: Export;
      /** 1.1: jobs Textus fires on time (notifications, background). */
      schedule: Schedule;
      /** 1.1: system notifications (notifications). */
      notify: Notify;
      /** 1.1: whether Textus is in front, behind, or has no window. */
      app: App;
      /** 1.6: colours over the theme (appearance). */
      appearance: Appearance;
      /** 1.7: text as the app reads it. */
      text: Text;
      /** From 1.8: paths worked out in the plugin's frame; no permission. */
      path: Path;
      /** From 1.8: past versions kept elsewhere (Git, sync), offered by one
       *  plugin and read by another (files.read). */
      history: History;
      /** From 1.8, preview: the notes in a document's margin (comments and
       *  files.read). */
      comments: Comments;
    }

    interface Env {
      /** Textus's UI language ("en", "zh", "zh-Hant", ...). */
      readonly language: string;
      readonly appVersion: string;
      /** This API's version: "1.10" from Textus 1.4.7 ("1.9": 1.4.6, "1.8": 1.4.4, "1.7": 1.4.3, "1.6": 1.4.2, "1.5": 1.3.13-rc.1,
       *  "1.4": 1.3.10, "1.3": 1.3.10-rc.1, "1.2": 1.3.9, "1.1": 1.3.0-beta.8). Prefer engines.textus; compare
       *  it as numbers, not as text ("1.10" > "1.9"). */
      readonly apiVersion: string;
      readonly platform: "macos" | "windows" | "linux" | "ios" | "android";
      readonly theme: "light" | "dark";
      onDidChangeTheme: Event<"light" | "dark">;
      onDidChangeLanguage: Event<string>;
      /** Plain text on the system clipboard (needs clipboard). */
      readClipboard(): Promise<string>;
      writeClipboard(text: string): Promise<void>;
      /** 1.3: the user copied or cut text from a document (needs
       *  clipboard): the Markdown that went on the clipboard, math source
       *  kept. Not what is copied elsewhere in Textus or in other apps. */
      onDidCopy: Event<{ text: string; cut: boolean }>;
    }

    interface L10n {
      /** A string of the manifest's `l10n` in the UI language; "{0}",
       *  "{1}"... are `args`. */
      t(key: string, ...args: unknown[]): string;
    }

    interface Commands {
      /** A command of the manifest's `contributes.commands`, or one of
       *  the plugin's own beyond them (`<plugin id>.<name>`). */
      register(id: string, run: (...args: unknown[]) => unknown): Disposable;
      /** A command that works on the document in front: only offered with
       *  a document open, and given the editor. */
      registerEditorCommand(
        id: string,
        run: (editor: Editor, ...args: unknown[]) => unknown,
      ): Disposable;
      /** From 1.6: sets a key the manifest's menu `when` clauses can read,
       *  named `<plugin id>.<name>` - `when: "jane.focus.on"`. A string or
       *  true; false, null or undefined unsets it. Gone when the plugin
       *  stops. */
      setContext(key: string, value: string | boolean | null): Promise<void>;
      /** A command of Textus's or of a plugin's. Textus's: "textus.save",
       *  "textus.closeTab" ({ save: true } closes once saved) and
       *  "textus.insertBlock" with a Format menu block at the caret - "h1"
       *  to "h6", "paragraph", "bullet-list", "ordered-list", "task-list",
       *  "blockquote", "code-block", "math-block", "rule" or "table".
       *  "textus.showFolder" with a folder's path inside the open one shows
       *  it in the sidebar, as double-clicking it does (1.3.12).
       *  "textus.offerPlugin" with { id } suggests an official plugin from
       *  the market: a card at the bottom right with its name. It never
       *  blocks editing and stays until the user acts; its permissions are
       *  still asked before it installs.
       *  Resolves true once it is installed and on (at once when it already
       *  is); false for an id the market has no official plugin for (or
       *  when the market can't be reached), for an installed plugin that
       *  can't be turned on, while another card is shown, when the install
       *  fails, on "Later", and on × - after which your plugin's offers of
       *  that plugin aren't shown again (the user can bring them back in
       *  Settings › Extensions). Don't await it in activate. From 1.3.9. */
      execute(id: string, ...args: unknown[]): Promise<unknown>;
    }

    // ---------------------------------------------------------------
    // ui: Textus's own dialogs and bits, drawn as the app draws its own
    // ---------------------------------------------------------------

    interface Ui {
      /** Items for a right-click menu - the editor's or the file tree's -
       *  worked out as it opens, from what it was opened on (the file; in
       *  the editor also the selected text). Each item runs a command with
       *  its args. Answers after 0.5 s are left out. No permission; the
       *  command needs its own. From 1.8. */
      registerContextMenu(
        where: "editor" | "fileTree",
        provide: (target: {
          path: string | null;
          folder?: boolean;
          selectedText?: string;
        }) =>
          | { label: string; command: string; args?: unknown[] }[]
          | Promise<{ label: string; command: string; args?: unknown[] }[]>,
      ): Disposable;
      /** A short note at the bottom of the window that goes by itself.
       *  With `action` ("Undo"), a button on it: resolves true when it was
       *  clicked before the note went, false otherwise (Textus 1.3.12). */
      notice(
        text: string,
        options?: { tone?: Tone; action?: string },
      ): Promise<boolean>;
      /** A box with one button; resolves when it is closed. */
      message(text: string, options?: { tone?: Tone }): Promise<void>;
      confirm(
        text: string,
        options?: { okLabel?: string; danger?: boolean },
      ): Promise<boolean>;
      input(options?: {
        prompt?: string;
        value?: string;
        placeholder?: string;
      }): Promise<string | null>;
      /** The picked item's `value` (its label without one), or null. With
       *  `multiple`, the picked values, or null. `value` is the text in the
       *  box to start with. With `commands`, the items come first among the
       *  command palette's: one of the palette's runs and gives null, and
       *  Enter on text nothing matches gives `{ typed: text }` (Textus
       *  1.3.0-beta.3). */
      pick(
        items: (string | PickItem)[],
        options?: {
          placeholder?: string;
          multiple?: boolean;
          value?: string;
          commands?: boolean;
          /** From 1.6: the rows for what is typed, asked as typing rests,
           *  in place of filtering `items` (shown until it answers) - a
           *  citation or a library searched as you type. One choice only. */
          search?: (
            query: string,
          ) => (string | PickItem)[] | Promise<(string | PickItem)[]>;
        },
      ): Promise<unknown>;
      /** A date picked on Textus's month calendar, as `YYYY-MM-DD`, or
       *  null when cancelled; `value` is the one picked to start with
       *  (Textus 1.3.12). */
      pickDate(options?: {
        title?: string;
        value?: string;
      }): Promise<string | null>;
      /** A colour picked from the tones or typed, as `#rrggbb`, or null
       *  when cancelled (Textus 1.3.12). */
      pickColor(options?: {
        title?: string;
        value?: string;
      }): Promise<string | null>;
      /** A small form: the values by key, or null when cancelled. */
      form(options: {
        title?: string;
        okLabel?: string;
        fields: FormField[];
      }): Promise<Record<string, unknown> | null>;
      /** Shows `title` with a progress bar while `task` runs; `report`
       *  moves it (0 to 1) and changes its line; `signal` aborts when the
       *  user cancels. Resolves with what `task` resolves. */
      withProgress<T>(
        title: string,
        task: (
          report: (progress: { fraction?: number; message?: string }) => void,
          signal: AbortSignal,
        ) => Promise<T>,
      ): Promise<T>;
      /** An item in the status bar; `update` changes it. */
      statusItem(id: string, item: StatusItem): StatusItemHandle;
    }

    type Tone = "info" | "warning" | "error";

    interface PickItem {
      label: string;
      description?: string;
      detail?: string;
      value?: unknown;
      picked?: boolean;
    }

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
      /** `YYYY-MM-DD`, picked on a month calendar (Textus 1.3.12). */
      | { key: string; type: "date"; label: string; value?: string }
      /** `#rrggbb`, from the tones or typed (Textus 1.3.12). */
      | { key: string; type: "color"; label: string; value?: string }
      | {
          key: string;
          type: "choice";
          label: string;
          value?: string;
          options: { value: string; label: string }[];
        };

    interface StatusItem {
      text: string;
      tooltip?: string;
      /** Run when it is clicked. */
      command?: string;
    }

    interface StatusItemHandle extends Disposable {
      update(item: Partial<StatusItem>): void;
    }

    // ---------------------------------------------------------------
    // layout: tabs and panes
    // ---------------------------------------------------------------

    interface Layout {
      /** A file - a document, or a file a plugin's editor opens - at the
       *  location given. Needs files.read, except for the file a view of
       *  the plugin's shows. */
      open(
        target: string | Location,
        options?: { where?: Where; asDocument?: boolean },
      ): Promise<void>;
      /** One of the plugin's views (`contributes.views` with
       *  `"type": "webview"` or `"list"`) in a tab. */
      openView(
        viewId: string,
        options?: { where?: Where; title?: string; state?: unknown },
      ): Promise<void>;
      /** Opens the sidebar on a tab: a plugin's sidebar tab id, or `tree`
       *  (Files) or `outline`. From 1.3.10. */
      showSidebarTab(id: string): Promise<void>;
      /** Opens the plugin's own page in its tab - its settings, version,
       *  permissions: where setup forms go, not a sidebar. From 1.3.13. */
      openSettings(): Promise<void>;
      /** A web page in a tab, for a host the plugin was granted. */
      openWebPage(
        url: string,
        options?: { where?: Where; title?: string },
      ): Promise<void>;
      /** A new document, not yet saved. */
      openUntitled(
        text: string,
        options?: { where?: Where; title?: string },
      ): Promise<void>;
      /** In the system's browser. */
      openExternal(url: string): Promise<void>;
      activeTab(): Promise<TabInfo | null>;
      tabs(): Promise<TabInfo[]>;
      /** How the panes run at the outermost, side by side ("row") or
       *  one above the other ("column"), and the tab each pane shows, in
       *  reading order; or one. */
      split(): Promise<{
        direction: "row" | "column" | null;
        panes: string[];
      }>;
      onDidChangeActiveTab: Event<TabInfo | null>;
      onDidChangeLayout: Event<void>;
      /** From 1.3.10: which of the window's panels are open - the sidebar
       *  (and the tab it shows) and Textus AI's. Read only; Zen mode closes
       *  them all. A panel added later is a new key. */
      panels(): Promise<PanelsState>;
      onDidChangePanels: Event<PanelsState>;
      /** Shows one of the plugin's floating views (`contributes.floatingViews`):
       *  a small transparent page of its own size, floating where the user
       *  left it. The user moves, folds and closes it; nothing floats until
       *  the plugin opens it, usually from a command. From Textus 1.3.6. */
      openFloating(viewId: string): Promise<void>;
      closeFloating(viewId: string): Promise<void>;
      /** The plugin's floating views that are open. */
      floatingViews(): Promise<FloatingViewState[]>;
      /** One of them opened, closed, folded or moved: stop animating while
       *  `visible` is false. */
      onDidChangeFloating: Event<FloatingViewState>;
      /** The user clicked one ("poke"), clicked it three times in a moment
       *  ("pet") or dragged it somewhere ("moved"). */
      onDidTouchFloating: Event<{
        view: string;
        kind: "poke" | "pet" | "moved";
      }>;
    }

    interface FloatingViewState {
      view: string;
      open: boolean;
      /** False while folded to a dot or closed. */
      visible: boolean;
      place: "desktop" | "window";
      /** The half of the window or screen it sits in: a character there
       *  can face the middle. */
      side: "left" | "right";
    }

    interface TabInfo {
      id: string;
      title: string;
      /** A document, a file a plugin's editor shows, a plugin's view, a
       *  web page. */
      kind: "document" | "file" | "view" | "web";
      path: string | null;
      /** For a view or a file editor: which plugin's, and which. */
      plugin?: string;
      view?: string;
    }

    // ---------------------------------------------------------------
    // views: what a plugin shows
    // ---------------------------------------------------------------

    interface Views {
      /** A list or tree drawn by Textus - in a sidebar tab or a view of
       *  `"type": "list"` - from the items the provider gives. */
      registerList(id: string, provider: ListProvider): ListView;
      /** A page of the plugin's own: a sidebar tab, or a view of
       *  `"type": "webview"`. */
      registerWebview(
        id: string,
        provider: {
          resolve(
            webview: Webview,
            context: { state: unknown },
          ): void | Promise<void>;
        },
      ): Disposable;
      /** Files of a type opened by the plugin (`contributes.customEditors`):
       *  a PDF, a Word document, a board. */
      registerFileEditor(
        viewType: string,
        provider: {
          resolve(
            file: OpenFile,
            webview: Webview,
            context: { target: Location | null },
          ): void | Promise<void>;
        },
      ): Disposable;
      /** Code blocks of a language (`contributes.codeBlocks`) drawn by the
       *  plugin in the document: ```tasks, ```chart. Asked only for the
       *  blocks in sight; the block's source stays in the file. */
      registerCodeBlock(
        language: string,
        provider: {
          render(block: CodeBlock, webview: Webview): void | Promise<void>;
        },
      ): Disposable;
      /** The content of `![[...]]` embeds of the kinds `contributes.embeds`
       *  names, asked only for embeds in sight; Textus draws it read-only
       *  and expands embeds inside it itself. One plugin draws each kind:
       *  the first turned on. From 1.3.9 (files.read). */
      registerEmbed(id: string, provider: EmbedProvider): EmbedHandle;
      /** Another way to show a database's rows - a timeline, a gallery -
       *  that the plugin drawing databases offers beside its own views.
       *  `render` gets the rows and answers HTML, which is shown without
       *  scripts, event attributes or `<style>` (style inline instead); an
       *  element with `data-row="<row path>"` opens that row when clicked.
       *  It gets rows only when the user picks it in a database. From 1.9
       *  (Textus 1.4.6). */
      registerDatabaseView(
        id: string,
        provider: DatabaseViewProvider,
      ): Disposable;
      /** The database views plugins registered, `id` as
       *  `<plugin id>#<view id>`: for the plugin that draws databases.
       *  From 1.9 (Textus 1.4.6). */
      databaseViews(): Promise<
        { id: string; label: string; icon: string | null; plugin: string }[]
      >;
      /** One of databaseViews() drawn for `data`: its HTML, cleaned. From
       *  1.9 (Textus 1.4.6). */
      renderDatabaseView(id: string, data: DatabaseViewData): Promise<string>;
      /** The plugin's page in Settings (`contributes.settingsPage`). */
      registerSettingsPage(provider: {
        resolve(webview: Webview): void | Promise<void>;
      }): Disposable;
    }

    interface DatabaseViewProvider {
      label: string;
      /** An SVG's markup, drawn in the text's colour. */
      icon?: string;
      render(data: DatabaseViewData): string | Promise<string>;
    }

    /** A database's rows as its view shows them: filtered and sorted. */
    interface DatabaseViewData {
      /** Each row: its note's path, name, and properties. */
      rows: { path: string; name: string; props: Record<string, unknown> }[];
      /** The properties shown, in order. */
      columns: string[];
      /** Each property's type: "text", "number", "date", "checkbox",
       *  "tags", "list"... */
      types: Record<string, string>;
      /** The property the view is grouped by, if any. */
      group?: string;
      /** The property its dates come from, if it has one. */
      date?: string;
    }

    interface EmbedProvider {
      /** null: nothing to show (Textus shows the link's name, dimmed). */
      provideEmbed(
        target: EmbedTarget,
        context: { signal: AbortSignal },
      ): EmbedContent | null | Promise<EmbedContent | null>;
    }

    /** What `![[...]]` points at, as `metadata.resolveNote` resolves it. */
    interface EmbedTarget {
      path: string;
      heading?: string;
      block?: string;
      alias?: string;
    }

    interface EmbedContent {
      /** Markdown, drawn read-only. Links and pictures in it are read from
       *  `target.path`'s folder. Leave `![[...]]` in it as is: Textus draws
       *  those itself, at most 5 deep and never in a loop. */
      markdown: string;
      /** Shown over it, opening the source when clicked; the link's name
       *  without it. */
      title?: string;
    }

    interface EmbedHandle extends Disposable {
      /** Asks again for every embed shown. */
      refresh(): void;
    }

    interface ListProvider {
      /** The items at the top, or under `parent` (one with `children`). */
      items(parent?: ListItem): ListItem[] | Promise<ListItem[]>;
      /** An item clicked or Enter on it: by default, its `location` opens
       *  and its `command` runs. */
      onSelect?(item: ListItem): void | Promise<void>;
      /** Its checkbox ticked or unticked. */
      onCheck?(item: ListItem, checked: boolean): void | Promise<void>;
      /** An item dragged onto another; with it, the rows can be dragged.
       *  From 1.3.10. */
      onMove?(item: ListItem, target: ListItem): void | Promise<void>;
      /** What the field over the list says; without it, there is no
       *  field. The list filters itself by label, description and detail.
       *  A `%key%` of the manifest's `l10n` follows the UI language (from
       *  1.4.3); plain text stays as given. */
      filterPlaceholder?: string;
      /** Shown when there are no items; a `%key%` as above. */
      emptyText?: string;
    }

    interface ListItem {
      /** Kept across refreshes: an open item stays open, a selected one
       *  selected. */
      id?: string;
      label: string;
      description?: string;
      detail?: string;
      /** A group's heading above the items that share it. */
      group?: string;
      /** One of the app's icons ("file", "folder", "task", "link", "tag",
       *  "calendar", "clock", "star"), or any other text, such as a page's
       *  emoji, drawn in its place. */
      icon?: string;
      checkbox?: boolean;
      /** A small mark after the label: "due", "overdue", "new". */
      badge?: {
        text: string;
        tone?: "accent" | "warning" | "danger" | "muted";
      };
      location?: Location;
      command?: { id: string; args?: unknown[] };
      /** Items under it, asked for when it is opened. */
      children?: boolean;
      /** Right-click actions. */
      actions?: { label: string; command: string; args?: unknown[] }[];
      /** Anything of the plugin's; given back as is. */
      data?: unknown;
    }

    interface ListView extends Disposable {
      /** Asks the provider again. */
      refresh(): void;
      /** A line over the list ("12 tasks"), or a `%key%`; "" for none. */
      setMessage(text: string): void;
    }

    /** A page of the plugin's. */
    interface Webview {
      readonly id: string;
      html: string;
      postMessage(message: unknown): Promise<void>;
      onDidReceiveMessage: Event<unknown>;
      onDidDispose: Event<void>;
      /** A file of the plugin's, for the page's HTML. */
      asWebviewUri(path: string): string;
      setTitle(title: string): Promise<void>;
    }

    /** The file a file editor was opened on. */
    interface OpenFile {
      readonly path: string;
      readonly fileName: string;
      readFile(): Promise<Uint8Array>;
      readText(): Promise<string>;
      /** Needs files.write. */
      writeText(text: string): Promise<void>;
      /** Asked to show another place in it (a link to `#page=12` clicked
       *  while it is open). */
      onDidRequestReveal: Event<Location>;
    }

    /** A code block the plugin draws. */
    interface CodeBlock {
      readonly language: string;
      readonly source: string;
      /** What follows the language on its fence, read as settings:
       *  ` ```chart height=300 title="Sales" legend` is
       *  `{ height: "300", title: "Sales", legend: "true" }`. */
      readonly meta: Readonly<Record<string, string>>;
      /** The document it is in. */
      readonly path: string | null;
      readonly block: string;
      /** Its source or meta changed (typed, undone); the page stays. */
      onDidChange: Event<string>;
      /** Replaces its source (needs editor.write), one undo step. */
      setSource(source: string): Promise<boolean>;
    }

    // ---------------------------------------------------------------
    // editor: the document in front
    // ---------------------------------------------------------------

    interface Editor {
      /** Its path; null for an unsaved one, and with no document. */
      getPath(): Promise<string | null>;
      /** Its Markdown (editor.read). */
      getText(): Promise<string | null>;
      getSelection(): Promise<{ text: string; markdown: string | null } | null>;
      /** Where the caret is in the document's Markdown: its path, line and
       *  column (from 0); null with no document in front (editor.read).
       *  From 1.8. */
      getCursor(): Promise<Location | null>;
      /** Its blocks as Textus AI is shown them (editor.read). */
      getBlocks(): Promise<Block[] | null>;
      getOutline(): Promise<
        { level: number; text: string; line: number }[] | null
      >;
      /** Changes it at once, as one undo step (editor.write). False when a
       *  change can't be placed (a block id from before an edit). */
      edit(changes: Change | Change[]): Promise<boolean>;
      /** At the caret, or in place of the selection (editor.write). */
      insertText(text: string): Promise<boolean>;
      replaceSelection(text: string): Promise<boolean>;
      /** Shown as a proposal the user accepts or rejects, as Textus AI's
       *  are (editor.propose). */
      propose(change: Change, options?: { reason?: string }): Promise<boolean>;
      /** Scrolls to a place in it and puts the caret there. */
      reveal(
        location: Omit<Location, "path"> & { path?: string },
      ): Promise<boolean>;
      /** Completions as you type, for one of `contributes.completions`
       *  (editor.read): asked when what is before the caret matches its
       *  `pattern`. `insert` replaces the match; `$0` marks the caret.
       *  Shown in the / panel, grouped by plugin. 1.2: every matching
       *  provider is asked at once, and none holds up typing. */
      registerCompletion(id: string, provider: CompletionProvider): Disposable;
      /** From 1.6 (editor.write): pasted text matching `pattern` is handed
       *  to `provide`, and the Markdown it answers goes in instead - a URL
       *  as a titled link, a spreadsheet's rows as a table. Answering null
       *  (or not within 1.5 s) lets the paste go on as usual; text no
       *  handler matches is never held. Several match: asked in plugin id
       *  order, the first answer wins. Not in code, not with files.
       *
       *      textus.editor.registerPasteHandler(/^https?:\/\/\S+$/, async (url) =>
       *        `[${await titleOf(url)}](${url})`);
       */
      registerPasteHandler(
        pattern: RegExp | string,
        provide: (text: string) => string | null | Promise<string | null>,
      ): Disposable;
      /** From 1.10 (Textus 1.4.7, editor.write): a file dragged into a
       *  document's body that `match` names - by kind ("image",
       *  "attachment", "note") or by extension ("csv") - is handed to
       *  `provide`, and the Markdown it answers goes in where it is let go
       *  instead of Textus's picture or link. Answering null (or not within
       *  1.5 s) lets Textus write it as usual. A file from a file manager
       *  (`fromSystem`) is handed over where it is, not copied; with Shift,
       *  on a document's edge or on a tab row the file opens and no handler
       *  is asked. Several match: asked in plugin id order, the first
       *  answer wins.
       *
       *      textus.editor.registerDropHandler({ extensions: ["csv"] },
       *        async (file) => csvToTable(await readCsv(file.path)));
       */
      registerDropHandler(
        match: {
          kinds?: ("image" | "attachment" | "note")[];
          extensions?: string[];
        },
        provide: (file: {
          path: string;
          name: string;
          kind: "image" | "attachment" | "note";
          fromSystem: boolean;
          /** The document it goes into; null for one never saved. */
          document: string | null;
        }) => string | null | Promise<string | null>,
      ): Disposable;
      /** The blocks the `/` menu can offer now: Textus's own (`source`
       *  "textus": its id as `textus.insertBlock` takes it) and plugins'.
       *  From 1.8. */
      blockTypes(): Promise<{ id: string; label: string; source: string }[]>;
      /** A block of the plugin's own in the `/` menu: `insert` puts it in at
       *  the caret (with the plugin's own calls, which need their
       *  permissions). `keywords` find it too ("kanban board"). From 1.8. */
      registerBlockType(
        id: string,
        type: {
          label: string;
          keywords?: string;
          insert(): void | Promise<void>;
        },
      ): Disposable;
      /** From 1.6 (editor.read): rows added to the outline of the document
       *  in front, under its headings - a screenplay's scenes, a novel's
       *  characters - each going to its block when clicked. Asked with its
       *  blocks as it changes (1.5 s to answer); `level` 1 to 6 sets how
       *  far in a row sits. */
      registerOutline(provider: {
        provideOutline(
          blocks: Block[],
        ):
          | { text: string; level?: number; block: string }[]
          | Promise<{ text: string; level?: number; block: string }[]>;
      }): Disposable;
      /** A card for what the pointer rests on (editor.read). */
      registerHover(provider: {
        provideHover(
          target: HoverTarget,
        ): HoverCard | null | Promise<HoverCard | null>;
      }): Disposable;
      /** Marks over the text (editor.read), asked for the blocks in sight
       *  and again when they change. 1.4.1: `document` is the whole
       *  document those blocks are of, which can be one beside the
       *  document in front; read it rather than `getBlocks`. From 1.8
       *  also its `path` (null while it is unsaved). */
      registerDecorations(provider: {
        decorate(
          blocks: Block[],
          document?: { blocks: Block[]; path?: string | null },
        ): Decoration[] | Promise<Decoration[]>;
      }): Disposable;
      /** From 1.8: slips in the text (editor.read) - a Markdown rule
       *  broken, a space missing - asked for the blocks in sight once the
       *  document rests, with the whole document and its path. Answer
       *  within 200 ms or that round is skipped. Each is underlined in its
       *  severity's colour and explained on the grammar check's card,
       *  which offers its `fix`; nothing is changed until the user applies
       *  it. */
      registerDiagnostics(
        id: string,
        provider: {
          check(
            blocks: Block[],
            document: { blocks: Block[]; path: string | null },
          ): Diagnostic[] | Promise<Diagnostic[]>;
        },
      ): Disposable;
      /** From 1.8, preview: inline syntax shown as it means - `||a
       *  spoiler||`, `{漢字|かんじ}`. The words in the pattern's `text`
       *  group are styled and the rest of a match is hidden until the caret
       *  is in it; without that group all of it is styled. "ruby" sets the
       *  `note` group above the words. Only the look changes: the text stays
       *  as written, in reading views too, and an export keeps it. Not in
       *  code. Needs no permission. */
      registerSyntax(
        id: string,
        syntax: {
          pattern: RegExp | string;
          style: "highlight" | "underline" | "muted" | "spoiler" | "ruby";
          tone?: "accent" | "warning" | "danger" | "success";
        },
      ): Disposable;
      /** Another document came to the front (or none). */
      onDidChangeActive: Event<{ path: string | null }>;
      /** Its text changed: once typing pauses, not on every key. 1.1:
       *  `source` says who changed it - "user" (typing, pasting, the
       *  keyboard), "ai" (Textus AI: an accepted proposal, a completion, a
       *  grammar fix), "disk" (the file changed and was read again),
       *  "plugin" (a plugin through this API) or "history" (undo, redo).
       *  When several did since the last event, "user" wins, then history,
       *  ai, plugin, disk. */
      onDidChange: Event<{ path: string | null; source: ChangeSource }>;
      /** The selection settled. From 1.6 also whether it is only the caret
       *  and the id of the block its moving end is in (null past the
       *  blocks): a typewriter, a reading line, a linked preview. */
      onDidChangeSelection: Event<{
        text: string;
        empty: boolean;
        block: string | null;
        /** From 1.8: where the selection starts and the caret is, in the
         *  document's Markdown (lines and columns from 0). */
        anchor?: { line: number; ch: number };
        head?: { line: number; ch: number };
      }>;
      /** From 1.6: the first and last block in sight changed, once
       *  scrolling or an edit rests (editor.read). */
      onDidChangeVisible: Event<{ first: string | null; last: string | null }>;
      /** The keyboard, for plugins that are a way of typing - Vim, Emacs
       *  (editor.input). */
      keys: EditorKeys;
    }

    interface Block {
      id: string;
      kind:
        | "paragraph"
        | "heading"
        | "list"
        | "quote"
        | "code"
        | "math"
        | "table"
        | "rule"
        | "picture"
        | "html"
        | "footnote"
        | "definition"
        | "other";
      markdown: string;
    }

    /** One change, placed by block ids as Textus AI's are. Without
     *  `block`, `insert_at_cursor`, `replace_selection` and `append` need
     *  none. `anchor`: a few words inside the block, for part of it. */
    interface Change {
      action:
        | "replace"
        | "replace_selection"
        | "insert_before"
        | "insert_after"
        | "delete"
        | "append"
        | "insert_at_cursor";
      text?: string;
      block?: string;
      lastBlock?: string;
      anchor?: string;
    }

    interface CompletionProvider {
      provideCompletions(
        context: CompletionContext,
      ):
        | CompletionItem[]
        | CompletionList
        | null
        | undefined
        | Promise<CompletionItem[] | CompletionList | null | undefined>;
    }

    interface CompletionContext {
      /** Before the caret, in its paragraph or formula. */
      text: string;
      /** The part `pattern` matched, which an item replaces. */
      match: string;
      inMath: boolean;
      /** From 1.3.9: the pattern's last capture group (the query); the
       *  match without one. */
      query: string;
      /** From 1.3.9: after the caret, to the end of its block (at most 200
       *  characters): the "]]" Textus pairs with "[[". */
      after: string;
      /** From 1.3.9: the document's path; null for an unsaved one. */
      path: string | null;
      /** From 1.3.9: aborts when Textus no longer needs the answer (the
       *  text moved on, the panel closed). An answer after that is dropped. */
      signal: AbortSignal;
    }

    /** From 1.3.9: a whole list (up to 20,000 items) Textus filters itself
     *  as typing goes on, without asking again while the same pattern keeps
     *  matching from the same place. An array is the provider's own
     *  filtering: asked again on each key, at most 50 kept. */
    interface CompletionList {
      items: CompletionItem[];
      complete: true;
    }

    interface CompletionItem {
      label: string;
      /** Replaces the match; `$0` marks the caret. */
      insert: string;
      detail?: string;
      /** From 1.3.9: one of the app's icons ("file", "link", "tag",
       *  "calendar", "clock", "star", "heading", "block", "quote",
       *  "emoji") or an SVG of the plugin's. */
      icon?: string;
      /** From 1.3.9: also found by (an English name, an alias). */
      keywords?: string;
      /** From 1.3.9: characters after the caret it replaces too: 2 for the
       *  "]]" in `after`. */
      replaceAfter?: number;
      /** From 1.3.9: run once it is inserted - the plugin's own command or
       *  one of Textus's. */
      command?: { id: string; args?: unknown[] };
    }

    type HoverTarget =
      | {
          type: "document";
          path: string;
          /** The heading linked to; from 1.3.13 a wikilink's nested
           *  headings come whole, "A#B" (B inside A's section). */
          heading: string | null;
          /** From 1.3.9: a "^id" block the link points at, without "^". */
          block?: string | null;
        }
      | { type: "link"; url: string }
      | { type: "citation"; key: string };

    interface HoverCard {
      title: string | null;
      /** Markdown, shown without pictures. */
      markdown: string;
    }

    /** A mark over some of a block's text: the words `anchor` (all of the
     *  block without it). */
    interface Decoration {
      block: string;
      anchor?: string;
      /** From 1.8 also "gutter": a mark in the margin right of the block,
       *  beside its first line, or at the top of a list, quote, table or
       *  code (a change, a reading place, a warning). */
      style: "highlight" | "underline" | "muted" | "badge" | "gutter";
      tone?: "accent" | "warning" | "danger" | "success";
      /** For "badge": its text, after the words. */
      text?: string;
      tooltip?: string;
      /** For "badge": before the words instead - a heading's number. */
      before?: boolean;
      /** From 1.6: the words link here (http, https or mailto), followed
       *  with Cmd/Ctrl+click as a link is - a DOI, an RFC, an issue number
       *  made a link without changing the text. */
      url?: string;
      /** For "gutter", from 1.8: the plugin's SVG (drawn in the tone) or
       *  one or two characters; a dot without. */
      icon?: string;
      /** For "gutter", from 1.8: a command of the plugin's a click runs;
       *  without one the mark is only shown. */
      command?: { id: string; args?: unknown[] };
    }

    /** A slip a check found, from 1.8. */
    interface Diagnostic {
      block: string;
      /** The words it is about, in the block's text; all of it without. */
      anchor?: string;
      severity: "error" | "warning" | "info";
      /** What is wrong, in a sentence: on the card. */
      message: string;
      /** What the card offers to apply: the words `anchor` becomes ("" deletes
       *  them), or the block's whole Markdown made anew, with its button's
       *  label - a fix of the Markdown itself, such as a list marker's
       *  spacing. Applied only if the block is as it was when checked. */
      fix?: string | { markdown: string; label?: string };
    }

    /** A document about to be saved. */
    interface WillSave {
      path: string;
      text: string;
      trigger: "manual" | "auto";
      /** Its blocks in order; `from`/`to` are offsets into `text`. */
      blocks: (Block & { from: number; to: number })[];
    }

    /** A block's new Markdown, by its id. */
    interface BlockEdit {
      block: string;
      markdown: string;
    }

    interface EditorKeys {
      /** Takes the editor's keys: "all" but the app's shortcuts, or "some" -
       *  only `keys`. null gives back your own capture. One plugin at a time:
       *  false while another holds them (its id is in your log). The boolean
       *  is from 1.3.9; older Textus answers undefined. */
      capture(
        capture: { mode: "all" | "some"; keys: string[] } | null,
      ): Promise<boolean>;
      /** Deprecated: use onDidPressKey. */
      onKey: Event<string>;
      /** From 1.7: onKey by the events' rule. */
      onDidPressKey: Event<string>;
      exec(op: EditorOp): Promise<EditorOpResult>;
    }

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

    interface EditorOpResult {
      text?: string;
      labels?: number;
      empty: boolean;
    }

    // ---------------------------------------------------------------
    // files: the folder open in the sidebar (files.read / files.write).
    // Paths are absolute, as Textus gives them; `rel` is the path in the
    // folder, `/`-separated. The events come for changes made in Textus
    // at once, and for changes made outside it when the window comes back
    // to the front.
    // ---------------------------------------------------------------

    /** Dates written and read in Moment's tokens, as Obsidian's settings and
     *  templates name them: YYYY YY Q MMMM MMM MM M Do DD D dddd ddd gggg
     *  GGGG ww w WW W HH H hh h mm ss s A a, `[literal]`. Names, ordinals
     *  and where a week starts follow `language` (the UI's by default). */
    interface Dates {
      /** `date` (a Date, a time in ms, or "YYYY-MM-DD") in `format`
       *  (default "YYYY-MM-DD"). */
      format(
        date: Date | number | string,
        format?: string,
        options?: { language?: string },
      ): string;
      /** The day a name written in `format` stands for, as "YYYY-MM-DD";
       *  null when it isn't one. Days only: a week's or month's name
       *  ("2026-W45") reads as null. */
      parse(
        text: string,
        format?: string,
        options?: { language?: string },
      ): string | null;
    }

    /** Templates filled in as Obsidian's Templates core plugin and then the
     *  Templater plugin's common tags fill them. */
    interface Templates {
      /**
       * `text` with {{date}}, {{time}}, {{title}}, {{date:FORMAT}},
       * {{date+1d}} and every {{key}} of `values` filled in (a list joined
       * with ", ", nothing for null, a date in its format); then Templater's
       * `<% tp.date.now(...) %>`, `tp.date.tomorrow/yesterday/weekday`,
       * `tp.file.title`, `tp.file.folder`, `tp.file.creation_date` and
       * `tp.file.cursor()`. Any other tag or script stays as written and is
       * listed in `skipped`. With `format` (a periodic note's name format),
       * also {{yesterday}}, {{tomorrow}}, {{weekday}} and {{monday}} …
       * {{sunday:FORMAT}} for `date`'s week, as Periodic Notes fills them.
       * {{date}} and {{time}} use the folder's Templates formats when the
       * plugin may read files and the caller gives none.
       */
      fill(
        text: string,
        options?: {
          values?: Record<string, unknown>;
          /** The note's day: "YYYY-MM-DD", a Date or ms (default today). */
          date?: Date | number | string;
          /** The clock {{time}} reads (default now). */
          now?: Date | number | string;
          title?: string;
          /** "/"-separated, from the open folder: tp.file.folder. */
          folder?: string;
          format?: string;
          dateFormat?: string;
          timeFormat?: string;
          language?: string;
        },
      ): Promise<{
        text: string;
        /** Where tp.file.cursor() was, as an offset in `text`; null if none. */
        cursor: number | null;
        skipped: string[];
      }>;
    }

    interface Files {
      root(): Promise<string | null>;
      list(dir?: string): Promise<FileEntry[]>;
      /** The files whose path in the folder matches `glob` ("**\/*.md",
       *  "Daily/*.md"); every document without one. */
      find(glob?: string): Promise<{ path: string; rel: string }[]>;
      stat(path: string): Promise<FileEntry | null>;
      /** From 1.6: a short badge after the file's name in the sidebar (1
       *  to 12 characters: "draft", "3", "★"), quiet or in a tone; null
       *  takes it off. One shows per file, the plugin last by id winning;
       *  gone when the plugin stops (files.read). */
      setBadge(
        path: string,
        badge: {
          text: string;
          tone?: "accent" | "warning" | "danger" | "success";
          tooltip?: string;
        } | null,
      ): Promise<void>;
      read(path: string): Promise<Uint8Array>;
      readText(path: string): Promise<string>;
      write(
        path: string,
        data: Uint8Array | ArrayBuffer | string,
      ): Promise<void>;
      writeText(path: string, text: string): Promise<void>;
      /** A new file; fails if one is there. From 1.7, `unique` gives it a
       *  free name instead ("Note 2.md", "Note 3.md", as the app names its
       *  own), and the path written comes back, written as `path` was. */
      create(
        path: string,
        text?: string,
        options?: { unique?: boolean },
      ): Promise<string>;
      /**
       * Reads, changes and writes a file without losing anything: open in
       * a tab, the change goes into its editor as one undo step; on disk,
       * it is written only if the file is unchanged since it was read (and
       * `change` is run again otherwise). Return the text unchanged to
       * write nothing.
       */
      process(path: string, change: (text: string) => string): Promise<string>;
      /** The `^id` of the block at `line` (from 0) of `path`, adding a new
       *  one (6 lowercase hex characters) where Obsidian reads it - the end
       *  of a paragraph's, heading's or list item's last line; a line of its
       *  own after a table, quote or code block - through `process`, every
       *  other byte kept. null when no block is there. From 1.3.9
       *  (files.write). */
      blockId(path: string, line: number): Promise<string | null>;
      /** With `updateLinks`, links to it in the folder's documents follow. */
      rename(
        from: string,
        to: string,
        options?: { updateLinks?: boolean },
      ): Promise<void>;
      /** To the system's Trash, never deleted for good: Recently Deleted on
       *  iOS. Android has none: it fails with a message ending "[noTrash]". */
      trash(path: string): Promise<void>;
      createFolder(path: string): Promise<void>;
      frontmatter: Frontmatter;
      /** A file a plugin made, and one the app made: a new document, a
       *  picture pasted or dropped, a note made by following a link, a file
       *  Textus AI wrote (from 1.4.2). A plugin's own path is as it gave it,
       *  the app's is whole. */
      onDidCreate: Event<{ path: string }>;
      onDidChange: Event<{ path: string }>;
      /** An open document's file was changed by something else - another
       *  app, a sync, git, an AI agent - and its tab took the new text:
       *  `before` is what it had saved, `after` what is on disk now, so a
       *  plugin keeping versions can record both. Its whole path. Files no
       *  tab holds aren't watched. From 1.4.3. */
      onDidChangeOnDisk: Event<{ path: string; before: string; after: string }>;
      onDidRename: Event<{ from: string; to: string }>;
      /** A file or folder a plugin moved to the Trash, and from 1.4.2 one
       *  the sidebar did (its whole path). */
      onDidDelete: Event<{ path: string }>;
      /** A document is about to be saved (files.write). Plugins are asked
       *  one after another in plugin id order, each given the text as the
       *  one before left it, at most a second each. Return the blocks you
       *  changed (`{ block, markdown }`, by the ids in `blocks`) - only
       *  those are written back - or the whole text, which is written back
       *  block by block. Code, math, HTML and link definition blocks stay
       *  as the user wrote them, and each block keeps its line endings. A
       *  change that would change again when run a second time is skipped
       *  for this save. `trigger`, `blocks` and `BlockEdit[]` answers are
       *  from 1.3.9. */
      onWillSave(
        listener: (
          e: WillSave,
        ) => string | BlockEdit[] | void | Promise<string | BlockEdit[] | void>,
      ): Disposable;
      /** 1.1: `trigger` is "manual" for File › Save or Save As, "auto" for
       *  autosave. */
      onDidSave: Event<{
        path: string;
        text: string;
        trigger: "manual" | "auto";
      }>;
      onDidChangeRoot: Event<{ path: string | null }>;
      /** How the folder of `path` (a document or folder, from the root;
       *  the open folder when left out) is written, whichever app made it -
       *  Obsidian, Logseq, Foam, Dendron, a site generator, git, or the
       *  folder's own `.textus/settings.json` "conventions". Read it
       *  instead of other apps' settings files; a field no app sets is
       *  null, for Textus's own settings. From 1.3.9 (files.read). */
      conventions(path?: string): Promise<FolderConventions>;
      /** From 1.9 (Textus 1.4.6, preview): paths of the plugin's own scheme
       *  (`ssh://host/home/me/notes`), read and written by `provider`, so
       *  a folder it serves opens in the sidebar and its documents in tabs
       *  like any other. Paths are whole URLs. A scheme is one plugin's;
       *  file, content, http(s), data, blob, asset, tauri, textus and
       *  mailto are never a plugin's. */
      registerProvider(scheme: string, provider: FileProvider): Disposable;
      /** From 1.9 (Textus 1.4.6, preview): opens a folder the plugin provides
       *  (its `registerProvider` scheme) as the window's folder. */
      openFolder(url: string): Promise<void>;
      /** From 1.9 (Textus 1.4.6, files.read): reads the folder conventions of an
       *  app Textus doesn't read itself (Logseq, Zettlr...). The app finds
       *  `marker`, a file from the app's folder, in the open folder and the
       *  folders above it, and hands `read` its text once (again when it
       *  changes). What `read` answers is offered to the user like any
       *  other app's settings, never applied by itself; folders are from the
       *  app's folder, and ones leading out of it are left out. `notes`: the
       *  app keeps notes linked by name, so wikilinks are found from its
       *  folder. */
      registerConventionReader(
        id: string,
        reader: ConventionReader,
      ): Disposable;
      /** From 1.7 (files.write): sets how the open folder writes something,
       *  in its `.textus/settings.json` "conventions", keeping the rest;
       *  null clears it. Only `linkStyle` for now. */
      setConvention(key: "linkStyle", value: LinkStyle | null): Promise<void>;
      /** From 1.3.10: a settings file of the nearest Obsidian vault -
       *  `appSettings("obsidian", "bookmarks.json")` reads
       *  `.obsidian/bookmarks.json` - parsed as JSON, found above the open
       *  folder too; null where there is none. A file at the settings
       *  folder's top only. Read only (files.read). */
      appSettings(
        app: "obsidian",
        file: string,
        path?: string,
      ): Promise<unknown | null>;
      /** The open folder's conventions changed: another folder, or its
       *  app's settings edited. From 1.3.9. */
      onDidChangeConventions: Event<{ root: string }>;
    }

    /** A remote or virtual folder's files (files.registerProvider). Each
     *  path is a whole URL; a name taken is refused, never replaced. */
    interface FileProvider {
      list(path: string): Promise<{ name: string; folder: boolean }[]>;
      readText(path: string): Promise<string>;
      read(path: string): Promise<Uint8Array>;
      writeText(path: string, text: string): Promise<void>;
      create(dir: string, name: string, folder: boolean): Promise<void>;
      rename(path: string, name: string): Promise<void>;
      move(path: string, into: string): Promise<void>;
      /** For good: a remote folder has no Trash. The user is asked first. */
      delete(path: string): Promise<void>;
    }

    interface ConventionReader {
      /** The app's name, as a card offering its settings shows it. */
      label: string;
      /** The file that says the folder is the app's, e.g.
       *  "logseq/config.edn". */
      marker: string;
      notes?: boolean;
      read(request: {
        /** The app's folder, a whole path. */
        root: string;
        /** The marker file's text. */
        text: string;
      }): FoundConventions | null | Promise<FoundConventions | null>;
    }

    /** What an app sets, as a reader answers it. */
    interface FoundConventions {
      linkStyle?: "wiki" | "markdown";
      linkPath?: "shortest" | "relative" | "absolute";
      updateLinks?: "always" | "ask" | "never";
      /** As FolderConventions' `attachments`, inside the app's folder. */
      attachments?: string;
      softBreaks?: boolean;
      /** Folders and files from the app's folder. */
      templates?: string;
      daily?: { folder: string; format: string; template?: string };
      newNotes?: string;
      ignore?: string[];
    }

    /** One setting of a folder and where it came from. */
    interface ConventionSetting<T> {
      value: T;
      /** "textus", "typora", "obsidian", "logseq", "dendron", "foam",
       *  "vscode", "mkdocs", "hugo", "docusaurus", "jekyll", "quarto",
       *  "git", or from 1.9 a plugin's reader, `<plugin id>#<id>`. */
      app: string;
      /** The folder these settings belong to. */
      root: string;
    }

    /** A kind of periodic note: its folder (full path), file name format
     *  (moment.js tokens, `[literal]` text) and template file (full path).
     *  An Obsidian vault with no daily notes settings keeps them at its top. */
    interface PeriodicNotes {
      folder: string;
      format: string;
      template: string | null;
    }

    interface FolderConventions {
      /** The apps found, nearest first; from 1.9 `notes` when the app
       *  keeps notes linked by name, found from its folder. */
      sources: { app: string; root: string; notes?: boolean }[];
      /** "wiki" or "markdown". */
      linkStyle: ConventionSetting<string> | null;
      /** "shortest", "relative" or "absolute". */
      linkPath: ConventionSetting<string> | null;
      /** The folder a link starting with "/" is read from. */
      linkRoot: ConventionSetting<string> | null;
      /** On a rename: "always", "ask" or "never". */
      updateLinks: ConventionSetting<string> | null;
      /** Where pictures go: "/" the root, "./" beside the document, "./sub"
       *  below it, else a folder from the root; `${filename}` the
       *  document's name. */
      attachments: ConventionSetting<string> | null;
      /** Whether a single newline shows as a line break. */
      softBreaks: ConventionSetting<boolean> | null;
      /** The templates folder, a full path. */
      templates: ConventionSetting<string> | null;
      /** Daily notes: folder (full path), file name format (moment.js
       *  tokens, `[literal]` text), template file (full path). */
      daily: ConventionSetting<PeriodicNotes> | null;
      /** From 1.3.10: weekly and monthly notes (Periodic Notes), only where
       *  turned on. */
      weekly: ConventionSetting<PeriodicNotes> | null;
      monthly: ConventionSetting<PeriodicNotes> | null;
      /** From 1.3.10: how a template writes {{date}} and {{time}}
       *  (Obsidian's Templates settings); null where unset. */
      templateFormats: ConventionSetting<{
        date: string | null;
        time: string | null;
      }> | null;
      /** Where new notes go, as `attachments` names a folder. */
      newNotes: ConventionSetting<string> | null;
      /** Paths the app hides. */
      ignore: string[];
    }

    interface FileEntry {
      name: string;
      path: string;
      rel: string;
      isDir: boolean;
      size: number;
      modifiedMs: number | null;
    }

    interface Frontmatter {
      /** The YAML at the top of a document, as an object; {} for none.
       *  From 1.8 read by a full YAML parser (block text, lists of maps). */
      get(path: string): Promise<Record<string, unknown>>;
      /** Changes it through files.process; the rest of the file untouched.
       *  From 1.8 the keys that didn't change, and every comment, stay as
       *  written. */
      update(
        path: string,
        change: (
          frontmatter: Record<string, unknown>,
        ) => Record<string, unknown> | void,
      ): Promise<void>;
    }

    // ---------------------------------------------------------------
    // git: the open folder's Git history, read with the user's own git
    // (desktop; elsewhere status() is null and the rest refuse). Files.read;
    // commit needs git.commit; fetch, push and pull need git.sync. No
    // switching branches.
    // ---------------------------------------------------------------

    interface GitChange {
      path: string;
      state:
        | "modified"
        | "added"
        | "deleted"
        | "renamed"
        | "untracked"
        | "conflicted";
      /** In the index already (`git add`ed). */
      staged: boolean;
    }

    interface GitCommit {
      hash: string;
      /** When it was committed, in ms since 1970. */
      at: number;
      author: string;
      subject: string;
      /** The file's path in this commit; it may have been renamed since. */
      path: string;
    }

    interface Git {
      /** The branch (null when detached) and the changed files of the
       *  open folder; null when it is in no repository or git isn't there.
       *  Hidden files are left out. */
      status(): Promise<{
        branch: string | null;
        /** The remote branch it follows (`origin/main`), or null. From 1.9. */
        upstream: string | null;
        /** Commits to push, and to pull, as of the last fetch. From 1.9. */
        ahead: number;
        behind: number;
        changes: GitChange[];
      } | null>;
      /** `path`'s commits, newest first, through renames (100, at most 500). */
      log(path: string, options?: { limit?: number }): Promise<GitCommit[]>;
      /** The file as commit `hash` had it at `path` (a GitCommit's path);
       *  null when it had none there, or it isn't text. */
      show(hash: string, path: string): Promise<string | null>;
      /** Commits the changes of `paths` only, with `message`, as the user's
       *  git does (hooks, signing): the new commit's hash. git.commit. */
      commit(message: string, paths: string[]): Promise<string>;
      /** Takes the remote's branches, as `git fetch --prune` does, with the
       *  user's credentials (nothing is asked for: a remote wanting a
       *  password typed refuses, saying so). git.sync. From 1.9. */
      fetch(): Promise<void>;
      /** Sends the branch to the remote branch it follows; one following
       *  none goes to `origin` under its name. git.sync. From 1.9. */
      push(): Promise<void>;
      /** Takes the remote branch's commits in, as the user's `git pull`
       *  would; on a conflict it is undone, the folder left as it was, and
       *  it refuses saying so. git.sync. From 1.9. */
      pull(): Promise<void>;
    }

    /** A link to a server: the user's own `ssh` (their config, agent,
     *  keys and known hosts) running SFTP only. Each host is asked of the
     *  user once per plugin. An unknown host key or a password is never
     *  answered for the user: the link fails saying what to do. Paths are
     *  the server's, absolute. */
    interface Ssh {
      /** The hosts named in `~/.ssh/config` (and its Includes). */
      hosts(): Promise<string[]>;
      /** A link to `host`, as the user's ssh names it: its session. */
      connect(host: string): Promise<number>;
      /** The folder the link starts in: the user's home there. */
      home(session: number): Promise<string>;
      list(
        session: number,
        path: string,
      ): Promise<{ name: string; folder: boolean }[]>;
      read(session: number, path: string): Promise<Uint8Array>;
      readText(session: number, path: string): Promise<string>;
      /** Writes the file whole. */
      write(
        session: number,
        path: string,
        data: string | Uint8Array,
      ): Promise<void>;
      /** A new empty file or folder; a name taken is refused. */
      create(session: number, path: string, folder?: boolean): Promise<void>;
      /** Moves or renames; a name taken is refused. */
      rename(session: number, from: string, to: string): Promise<void>;
      /** Deletes a file or an empty folder for good. */
      delete(session: number, path: string): Promise<void>;
      close(session: number): Promise<void>;
    }

    // ---------------------------------------------------------------
    // metadata: what Textus knows of the folder's documents, kept up to
    // date as they change (files.read). Built the first time a plugin
    // asks, in the background.
    // ---------------------------------------------------------------

    interface Metadata {
      get(path: string): Promise<DocumentMetadata | null>;
      /** Every document, without its blocks: titles, links and tags - what
       *  a graph is drawn from. */
      all(): Promise<DocumentMetadata[]>;
      /** The documents linking to `path`, with where. */
      backlinks(
        path: string,
      ): Promise<{ path: string; line: number; text: string }[]>;
      /** Where a link written in `from` goes: a [[wiki link]] or a relative
       *  path; null for none. 1.2: the same as `(await resolveNote(link,
       *  from))?.path` for a target that exists. */
      resolveLink(link: string, from: string): Promise<string | null>;
      /** Where a link goes, exactly as a click takes it: `link` as written -
       *  "[[Note#^id|alias]]", "![[Note#Heading]]", "[[#^id]]", or a Markdown
       *  link's target "Note.md#my-heading" / "../a/Note" - from the document
       *  `from` (needed for relative links and same-note anchors). null when
       *  `link` is no link to a file (a web URL). From 1.3.9 (files.read). */
      resolveNote(link: string, from: string): Promise<ResolvedLink | null>;
      /** The link Textus writes to `to` from `from`: the folder's style (in
       *  an Obsidian vault, its "new link format" and wiki or Markdown
       *  links; `[[wiki]]` by the shortest name elsewhere), with `#heading`,
       *  `#^block` and `|alias` as given - `[[#Heading]]` within one note.
       *  `style` overrides wiki or Markdown; `embed` adds "!". From 1.3.9
       *  (files.read). */
      linkTo(
        to: string,
        from: string,
        options?: {
          heading?: string;
          block?: string;
          alias?: string;
          style?: "wiki" | "markdown";
          embed?: boolean;
        },
      ): Promise<string>;
      tags(): Promise<{ tag: string; count: number }[]>;
      /** Sets the box of the task at `location` (a Task's) to `status`:
       *  "x" done, " " open, or any one character. Needs files.write.
       *  From 1.8. */
      setTask(location: Location, status: string): Promise<void>;
      tasks(filter?: {
        done?: boolean;
        path?: string;
        tag?: string;
      }): Promise<Task[]>;
      /** The documents' lines holding `query`, ignoring case. */
      search(
        query: string,
        options?: { limit?: number },
      ): Promise<{
        /** `line` counts from 1 here, unlike a Location's (from 0); from
         *  1.7 `location` is where the hit opens, its line from 0. */
        hits: (Location & {
          rel: string;
          line: number;
          text: string;
          location: Location;
        })[];
        truncated: boolean;
      }>;
      /** Documents were added, changed or removed. */
      onDidChange: Event<{ paths: string[] }>;
    }

    interface ResolvedLink {
      /** Absolute. For a note that doesn't exist: where a click creates it. */
      path: string;
      exists: boolean;
      /** "note": a Markdown document; "file": anything else (a PDF, a picture). */
      kind: "note" | "file";
      /** The last level of "#A#B"; never a "^id". */
      heading?: string;
      /** A "^id", without the "^". */
      block?: string;
      alias?: string;
      /** Where the heading or block is; null for the top, or when it isn't
       *  found (the note opens at its top, as a click does). */
      line: number | null;
    }

    interface DocumentMetadata {
      path: string;
      rel: string;
      /** The first heading's text, or the file's name. */
      title: string;
      frontmatter: Record<string, unknown>;
      headings: { level: number; text: string; line: number }[];
      links: {
        target: string;
        resolved: string | null;
        line: number;
        text: string;
        /** From 1.3.9: a `[[wiki link]]` or `![[embed]]`, so `target` is a
         *  name to pass to resolveNote as "[[" + target + "]]". */
        wiki: boolean;
      }[];
      tags: string[];
      tasks: Task[];
      /** From 1.3.9: the block ids ("^abc123") in it, with the first words of
       *  their block - for [[Note#^ completion. Also from `all`. */
      blockIds: { id: string; line: number; text: string }[];
      /** From 1.3.9: front matter `aliases` / `alias`, as strings. */
      aliases: string[];
      /** Only from `get`. */
      blocks?: { id: string; kind: Block["kind"]; line: number }[];
      modifiedMs: number | null;
    }

    interface Task {
      text: string;
      /** Anything but a space in its box. */
      done: boolean;
      /** The character in its box: " ", "x", "-", "/"... From 1.8. */
      status: string;
      /** From 📅 2026-11-01 or due:2026-11-01. */
      due: string | null;
      tags: string[];
      path: string;
      line: number;
      location: Location;
    }

    // ---------------------------------------------------------------
    // The rest
    // ---------------------------------------------------------------

    interface Net {
      /** HTTPS to the hosts granted (`network:<host>`); no cookies. Each
       *  plugin's requests share kept connections (HTTP/2 where the server
       *  has it). `signal` aborted stops the request at once; it then
       *  rejects with an `AbortError` (from 1.7). */
      fetch(
        url: string,
        init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: Uint8Array | ArrayBuffer | string;
          signal?: AbortSignal;
        },
      ): Promise<{
        status: number;
        ok: boolean;
        headers: Record<string, string>;
        bytes(): Promise<Uint8Array>;
        text(): Promise<string>;
        json(): Promise<unknown>;
      }>;
    }

    interface Settings {
      /** The project's value, else the general one, else the manifest's
       *  default. */
      get(key: string): Promise<unknown>;
      /** One of the plugin's own settings, for every folder. */
      set(key: string, value: unknown): Promise<void>;
      onDidChange: Event<{ key: string; value: unknown }>;
    }

    /** Tools for Textus AI (ai.tools): each one named in the manifest's
     *  contributes.aiTools, run here when the model calls it. */
    interface Ai {
      registerTool(
        name: string,
        run: (
          args: Record<string, unknown>,
        ) => string | Promise<string> | unknown,
      ): Disposable;
      /** What Textus AI is doing and with which service and model - never
       *  what is said. From 1.3.6. */
      state(): Promise<AiState>;
      onDidChangeState: Event<AiState>;
      /** Grey text after the caret when typing pauses: `provide` answers
       *  the words to offer, or null; it is waited for at most 5 seconds.
       *  The user picks one source at a time in Settings › Textus AI ›
       *  Chat & writing ("Suggestions from"), Textus AI or one of these.
       *  editor.read. From 1.4.4 (API 1.8, preview). */
      registerInlineCompletion(
        id: string,
        source: {
          label?: string;
          provide(request: {
            before: string;
            after: string;
            path: string | null;
          }): string | null | Promise<string | null>;
        },
      ): Disposable;
      /** Whether the user's writing model can be asked now: Textus AI is on
       *  (never on iOS or iPadOS). ai.model.
       *  From 1.4.4 (API 1.8, preview). */
      available(): Promise<boolean>;
      /** The user's writing model's answer, as text (ai.model). The first
       *  call asks the user; each plugin has 100,000 tokens a month (counted
       *  roughly: a CJK character is one, other text one per four
       *  characters), and the user is asked before more. Refused when the
       *  user says no or Textus AI is off. From 1.4.4 (API 1.8, preview).
       *  From 1.9 `signal` stops it (an AbortError), the answer unwritten
       *  and uncounted. */
      complete(
        request: AiRequest,
        options?: { signal?: AbortSignal },
      ): Promise<string>;
      /** complete(), the answer coming in as it is written: each piece
       *  to `onText` in order, the whole answer returned at the end. The
       *  same permission, question and tokens as complete(); stopped by
       *  `signal`, what was written so far is counted. From 1.9 (Textus
       *  1.4.6, preview). */
      stream(
        request: AiRequest,
        onText: (text: string) => void,
        options?: { signal?: AbortSignal },
      ): Promise<string>;
    }

    /** `prompt` for one question, or `messages` for a conversation whose
     *  next turn is asked for; at most 200,000 characters with `system`. */
    interface AiRequest {
      system?: string;
      prompt?: string;
      messages?: { role: "user" | "assistant"; content: string }[];
    }

    interface PanelsState {
      /** `tab`: the sidebar tab's id ("tree" for the files, "outline", or a
       *  plugin's view id). */
      sidebar: { open: boolean; tab: string };
      ai: { open: boolean };
    }

    interface AiState {
      state: "idle" | "thinking" | "writing" | "proposing";
      /** null before Textus AI is first used. */
      model: { provider: string; id: string | null } | null;
      /** On going idle after a request: finished, failed or stopped. */
      ended?: "done" | "failed" | "stopped";
    }

    interface Plugins {
      /** What another plugin's `activate` returned, its functions callable
       *  from here (their arguments and answers as JSON); starts it if it
       *  isn't running. null when it isn't installed or turned on. */
      get<T = Record<string, (...args: unknown[]) => Promise<unknown>>>(
        id: string,
      ): Promise<T | null>;
    }

    interface Export {
      /** A format in File › Export: `export` turns the document into the
       *  file's contents, text or bytes, and Textus asks where to save it
       *  and writes it. `html` is the standalone page File › Export › HTML
       *  writes, pictures inside it. From 1.4.4 (API 1.8). */
      registerFormat(
        id: string,
        format: {
          label?: string;
          /** Its files' extension, like "docx". */
          extension: string;
          export(document: {
            markdown: string;
            html: string;
            path: string | null;
          }): string | Uint8Array | Promise<string | Uint8Array>;
        },
      ): Disposable;
      /** KaTeX's stylesheet with its fonts inline, as Textus draws formulas:
       *  for a plugin page or a saved file that shows KaTeX's markup without
       *  loading anything from the web. About 400 KB. From 1.4.2 (API 1.6). */
      mathCss(): Promise<string>;
      /** An HTML or PDF export's page, before it is written (editor.read):
       *  `css` is added to its styles, `html` replaces its content. Scripts
       *  and handlers in the HTML are taken out. Plugins are asked in plugin
       *  id order, each given the HTML as the one before left it, and
       *  waited for at most two seconds. */
      onWillExport(
        listener: (page: {
          format: "html" | "pdf";
          path: string | null;
          html: string;
        }) =>
          | { css?: string; html?: string }
          | void
          | Promise<{ css?: string; html?: string } | void>,
      ): Disposable;
    }

    interface Uri {
      /** Links `textus://<plugin id>/<path>?<query>` opened from outside
       *  Textus (a browser, another app). */
      registerHandler(
        handler: (uri: {
          path: string;
          query: Record<string, string>;
        }) => void | Promise<void>,
      ): Disposable;
    }

    /** Who changed the document (editor.onDidChange). */
    type ChangeSource = "user" | "ai" | "disk" | "plugin" | "history";

    /**
     * A job Textus keeps for the plugin and fires on time while it runs -
     * with a window open or, in background mode, with none - even after a
     * restart. One of `at`, `every`, `daily`; then `notify`, `run` or both.
     *
     * - `at`: once, "2026-11-02T09:00" (local) or with an offset.
     * - `every`: "15m", "1h", "1h30m", "1d": 15 minutes at least, counted
     *   from when it was set.
     * - `daily`: "HH:MM", local time; across daylight saving it keeps the
     *   time on the clock.
     * - `catchUp`: a time missed while Textus wasn't running fires once on
     *   its next start ("once", the default) or is let go ("skip").
     * - `notify`: shown as a system notification (needs notifications).
     * - `run`: the name of a function the manifest's `background` code
     *   exports, called as `exports[run](job, ctx)` (needs background).
     */
    interface Job {
      at?: string;
      every?: string;
      daily?: string;
      catchUp?: "once" | "skip";
      notify?: Notification;
      run?: string;
    }

    /** A job as Textus keeps it: what was set, when it is due next (Unix
     *  ms; null once an `at` fired) and when it last fired. */
    interface ScheduledJob extends Job {
      id: string;
      catchUp: "once" | "skip";
      nextDue: number | null;
      lastFired: number | null;
    }

    /**
     * A system notification. A click brings Textus up with `open.path` (a
     * file of the open folder - or, from a job, of the folder open when it
     * was set - absolute or relative to it; needs files.read) open at
     * `open.line`. macOS asks the user to allow notifications the first time.
     */
    interface Notification {
      title: string;
      body?: string;
      open?: { path: string; line?: number };
    }

    interface Schedule {
      /** Adds the job, or replaces the plugin's job of that id (letters,
       *  digits, `-`, `_`, `.`; at most 32 jobs a plugin). */
      set(id: string, job: Job): Promise<ScheduledJob>;
      /** Whether there was one to take away. */
      clear(id: string): Promise<boolean>;
      list(): Promise<ScheduledJob[]>;
    }

    interface Notify {
      show(notification: Notification): Promise<void>;
    }

    interface App {
      /** "active": a Textus window has the focus; "inactive": windows are
       *  open, none focused; "background": no window (background code, or
       *  every window closed in background mode). On iOS and Android only
       *  "active" (on screen) and "background" (the user left the app). */
      readonly state: "active" | "inactive" | "background";
      onDidChangeState: Event<"active" | "inactive" | "background">;
      /** The user typed (heard once typing pauses) or saved by hand -
       *  that it happened, with nothing of the document. From 1.3.6. */
      onDidActivity: Event<{ kind: "typing" | "saved" }>;
    }

    /** A colour Textus's look is drawn from, which a plugin may set. */
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

    /** Bundled grain for the frame; no plugin images or network requests.
     *  From 1.8. */
    interface FrameTexture {
      /** Grain opacity, from 0 to 1. Zero leaves the paint unchanged. */
      opacity: number;
      /** Defaults to black in light mode, white in dark mode. */
      color?: "black" | "white";
    }

    /**
     * From 1.6 (permission `appearance`): a palette over whichever theme is
     * on. Only the colours the others are drawn from are open; borders,
     * hovers and the like follow. Values are colours; `--ui-frame-paint`
     * (the frame round the pages: bar, rail, sidebar) may also be a
     * `linear-`, `radial-` or `conic-gradient(...)` of colours, laid across
     * the whole window. No plugin images, `url()` or `var()`. When UI colours
     * are supplied, text is kept readable; a frame-only layer leaves other
     * surfaces alone:
     * below 4.5:1 on its background (or any of the paint's colours) it is
     * moved toward ink or white. The user's Custom CSS still wins.
     *
     *     const layer = await textus.appearance.setColors(
     *       { "--ui-frame-paint": "linear-gradient(120deg, #f3d9c4, #d6dcec)" },
     *       { scheme: "light" },
     *     );
     *     ctx.subscriptions.push(layer);
     */
    interface Appearance {
      /** From 1.8: `setColors` takes `frameTexture`. */
      readonly supportsFrameTexture?: boolean;
      /** Lays `colors` over the theme, for light, dark or both (the
       *  default); disposing it, or the plugin stopping, takes it away.
       *  Several plugins: per colour the one last by id wins. Rejects
       *  naming the first colour or value not taken. */
      setColors(
        colors: Partial<Record<OpenColor, string>>,
        options?: {
          scheme?: "light" | "dark" | "both";
          /** From 1.8. Requires --ui-frame-paint in this layer; the winning
           *  paint owns its texture. Disposing that layer removes both. */
          frameTexture?: FrameTexture;
        },
      ): Promise<Disposable>;
      /** The open colours as the window shows them now (theme and every
       *  plugin's), as `rgb(...)`; the paint as rendered (including bundled
       *  texture), or "". No permission. */
      colors(): Promise<Record<OpenColor, string>>;
      /** The theme (its id, for keeping a palette per theme), the scheme or
       *  a plugin's colours changed. */
      onDidChange: Event<{ theme: string; scheme: "light" | "dark" }>;
    }

    /**
     * What a job's `run` is given, in the manifest's `background` code: a
     * frame of its own, started for the run and stopped after it (30
     * seconds at most). That code reaches `files` (in the folder open when
     * the job was set), `net`, `settings.get`, `schedule`, `notify`, `app`,
     * `l10n`, `env` and the context's storage, secrets and log - not the
     * editor, UI, layout, views, commands or metadata.
     *
     *     exports.remind = async (job, ctx) => { ... };
     */
    interface JobRun {
      /** The job's id. */
      id: string;
      /** When it was due: well before now for one caught up after a start. */
      due: Date;
    }

    /** From 1.7: text read as the app reads it. */
    interface Text {
      /** Words and characters as the status bar counts them. */
      count(markdown: string): Promise<{ words: number; characters: number }>;
      /** A note's front matter (its YAML, null with none) and the rest. */
      splitFrontmatter(
        text: string,
      ): Promise<{ yaml: string | null; body: string }>;
      /** Names in the file tree's order: "Week2" before "Week10", case
       *  and accents aside, in the UI language. For `Array.sort`. */
      compareNames(a: string, b: string): number;
      /** YAML read in full (YAML 1.2): block text, lists of maps, quoting.
       *  {} for YAML that isn't a map; rejects YAML that can't be read.
       *  From 1.8. */
      parseYaml(yaml: string): Promise<Record<string, unknown>>;
      /** A value written as YAML, without a trailing line break. From 1.8. */
      stringifyYaml(value: unknown): Promise<string>;
    }

    /** One past version of a document, as a source keeps it. */
    interface HistoryVersion {
      id: string;
      /** When, as an ISO date. */
      at: string;
      label?: string;
      author?: string;
    }

    /** The notes in a document's margin: the writer's own and plugins',
     *  the same ones the user sees. While the document is open they are
     *  changed in its editor, else in the file Textus keeps them in. */
    interface Comments {
      list(path: string): Promise<Comment[]>;
      /** A note on the first place `text` (words of one paragraph) is in
       *  the file, signed with the plugin's name; its id. Refused when
       *  the words aren't there. */
      add(
        location: { path: string; text: string },
        comment: string,
      ): Promise<string>;
      /** Takes a note away (the writer's too); false when it isn't there. */
      resolve(path: string, id: string): Promise<boolean>;
      /** A document's notes changed, by the user or a plugin. */
      onDidChange: Event<{ path: string }>;
    }

    interface Comment {
      id: string;
      /** The words it is on. */
      text: string;
      comment: string;
      /** The plugin that left it, by name; null for the writer's own. */
      author: string | null;
    }

    /** Where a document's past versions are kept besides Textus's own: a
     *  plugin offers its source (Git, a sync service), another - Version
     *  History - lists them all and reads a version. Needs files.read.
     *  From 1.8. */
    interface History {
      /** Offers a source named `id` among the plugin's own. */
      registerSource(
        id: string,
        source: {
          label: string;
          /** The document's versions here, any order. */
          versions(path: string): HistoryVersion[] | Promise<HistoryVersion[]>;
          /** A version's text; null when it has none. */
          read(
            path: string,
            version: string,
          ): string | null | Promise<string | null>;
        },
      ): Disposable;
      /** Every source offered now; `id` is "<plugin id>/<source id>". */
      sources(): Promise<{ id: string; label: string; plugin: string }[]>;
      /** A source's versions of `path`, newest first. */
      versions(source: string, path: string): Promise<HistoryVersion[]>;
      /** One version's text. */
      read(source: string, path: string, version: string): Promise<string>;
    }

    /** Paths as Textus writes them: "/" between parts on every system; a
     *  "\\" in what is given is read as one. From 1.8. */
    interface Path {
      /** The parts joined, "." and ".." worked out: join("a", "../b") is "b". */
      join(...parts: string[]): string;
      /** "." and ".." worked out, "/" between parts, no "/" at the end. */
      normalize(path: string): string;
      /** The folder it is in: "." for a bare name, "/" at the top. */
      dirname(path: string): string;
      /** The last part; without `ext` when it ends so. */
      basename(path: string, ext?: string): string;
      /** From the last "." of the last part (".md"), "" for none or a
       *  name that starts with its only dot (".textus"). */
      extname(path: string): string;
      /** How to get from the folder `from` to `to`: "../ideas/a.md". */
      relative(from: string, to: string): string;
    }

    // ---------------------------------------------------------------
    // A webview's page
    // ---------------------------------------------------------------

    /** An item of a page's menu (`WebviewApi.menu`); `items` makes it a
     *  submenu (one level). */
    interface MenuItem {
      label: string;
      value?: unknown;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      items?: (MenuItem | "separator")[];
    }

    interface WebviewApi {
      readonly language: string;
      t(key: string, ...args: unknown[]): string;
      postMessage(message: unknown): void;
      /** Deprecated: use onDidReceiveMessage. */
      onMessage(fn: (message: unknown) => void): Disposable;
      /** From 1.7: onMessage by the name host.js's webview has. */
      onDidReceiveMessage(fn: (message: unknown) => void): Disposable;
      /** From 1.7: whether the page is in sight. */
      readonly visible: boolean;
      /** From 1.7: told as the page goes out of sight and comes back. Out
       *  of sight it may be let go to save memory and is rebuilt when
       *  shown, from `getState()`: set what it should keep here. */
      onDidChangeVisibility(fn: (visible: boolean) => void): Disposable;
      getState(): unknown;
      setState<T>(state: T): T;
      /** Textus's own menu over the page, for a right-click or a dropdown,
       *  under `at` (an element) or at a point of the page. Resolves to the
       *  chosen item's value (its label without one), or null when the menu
       *  is closed without a choice. A page draws no menu of its own. */
      menu(
        items: (MenuItem | "separator")[],
        at?: Element | { x: number; y: number },
      ): Promise<unknown>;
      /** A text field's menu items (undo, redo, cut, copy, paste, select
       *  all) in Textus's language, for a page's own right-click menu; each
       *  value is the action `editText` takes (1.3.12). */
      textItems(field: Element): Promise<(MenuItem | "separator")[]>;
      /** One of those actions in `field`, the clipboard through Textus. */
      editText(field: Element, action: string): Promise<void>;
      /** How the page looks as a picture, asked when the document is
       *  exported (a code block's page): an SVG's markup or an image's
       *  `data:` URL, for a page of `theme`. Without it, or answering
       *  null, the block exports as its source. */
      onExport(
        provider: (options: {
          theme: "light" | "dark";
        }) => string | null | Promise<string | null>,
      ): Disposable;
      /** From 1.7: dates as `textus.dates` has them. */
      readonly dates: Dates;
      /** From 1.7: a list dragged into a new order, the app's way: the
       *  item lifts, the others make room; `onDrop(from, to)` once let go
       *  somewhere new. `handle`: only from inside it. Esc puts it back.
       *  A finger lifts it once held still a moment; a press in a text
       *  field is the field's. Near the edge of its scroller the drag
       *  scrolls it. */
      drag: {
        reorder(
          container: Element,
          options: {
            items: string;
            axis?: "x" | "y";
            handle?: string;
            onDrop(from: number, to: number): void;
          },
        ): Disposable;
      };
      /** From 1.7: `content` in the window's floating card under `anchor`
       *  (above with no room), kept on screen; a press outside or Esc
       *  closes it, the focus back on `anchor`. `closed` resolves with
       *  what `close(value)` was given, null otherwise. */
      popover(
        content: Element,
        anchor: Element,
        options?: { label?: string; role?: string; align?: "start" | "end" },
      ): {
        element: Element;
        close(value?: unknown): void;
        closed: Promise<unknown>;
      };
      /** From 1.7: a month under `anchor` to pick a day on: "YYYY-MM-DD",
       *  or null when closed without one. */
      pickDate(value: string | null, anchor: Element): Promise<string | null>;
      /** From 1.7: a month's 42 days from the week's first day in the UI
       *  language (or `weekStart`, 0 Sunday to 6 Saturday: a vault's own),
       *  for a calendar a page draws itself (`tx-calendar`). */
      monthDays(
        year: number,
        month: number,
        options?: { weekStart?: number },
      ): { date: string; day: number; inMonth: boolean; today: boolean }[];
      /** From 1.7: an edge dragged (or moved with the arrow keys) to resize
       *  something: `get` the size now, `set` it as it moves, `done` at the
       *  end. */
      resizeHandle(
        handle: Element,
        options: {
          axis?: "x" | "y";
          min?: number;
          max?: number;
          get(): number;
          set(px: number): void;
          done?(px: number): void;
        },
      ): Disposable;
    }
  }
}
