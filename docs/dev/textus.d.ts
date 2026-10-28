/**
 * The Textus plugin API, 1.0: the `textus` object a plugin's code is given
 * (src/plugins/host/runtime/host.js), the context its `activate` receives, and
 * `acquireTextusApi()` in its webviews (runtime/webview.js). The one source
 * of truth: docs/dev/writing-plugins.md explains it, the reference pages are
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
       *  .textus/plugins/<id>/ (needs project.data); `document(path)` for
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
      net: Net;
      settings: Settings;
      ai: Ai;
      plugins: Plugins;
      uri: Uri;
      export: Export;
    }

    interface Env {
      /** Textus's UI language ("en", "zh", "zh-Hant", ...). */
      readonly language: string;
      readonly appVersion: string;
      /** This API's version: "1.0". */
      readonly apiVersion: string;
      readonly platform: "macos" | "windows" | "linux" | "ios";
      readonly theme: "light" | "dark";
      onDidChangeTheme: Event<"light" | "dark">;
      onDidChangeLanguage: Event<string>;
      /** Plain text on the system clipboard (needs clipboard). */
      readClipboard(): Promise<string>;
      writeClipboard(text: string): Promise<void>;
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
      /** A command of Textus's ("textus.save", "textus.closeTab") or of a
       *  plugin's. */
      execute(id: string, ...args: unknown[]): Promise<unknown>;
    }

    // ---------------------------------------------------------------
    // ui: Textus's own dialogs and bits, drawn as the app draws its own
    // ---------------------------------------------------------------

    interface Ui {
      /** A short note at the bottom of the window that goes by itself. */
      notice(text: string, options?: { tone?: Tone }): Promise<void>;
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
        },
      ): Promise<unknown>;
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
      /** The plugin's page in Settings (`contributes.settingsPage`). */
      registerSettingsPage(provider: {
        resolve(webview: Webview): void | Promise<void>;
      }): Disposable;
    }

    interface ListProvider {
      /** The items at the top, or under `parent` (one with `children`). */
      items(parent?: ListItem): ListItem[] | Promise<ListItem[]>;
      /** An item clicked or Enter on it: by default, its `location` opens
       *  and its `command` runs. */
      onSelect?(item: ListItem): void | Promise<void>;
      /** Its checkbox ticked or unticked. */
      onCheck?(item: ListItem, checked: boolean): void | Promise<void>;
      /** What the field over the list says; without it, there is no
       *  field. The list filters itself by label, description and detail. */
      filterPlaceholder?: string;
      /** Shown when there are no items. */
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
       *  "calendar", "clock", "star") or an SVG of the plugin's. */
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
      /** A line over the list ("12 tasks"); "" for none. */
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
       *  `pattern`. `insert` replaces the match; `$0` marks the caret. */
      registerCompletion(id: string, provider: CompletionProvider): Disposable;
      /** A card for what the pointer rests on (editor.read). */
      registerHover(provider: {
        provideHover(
          target: HoverTarget,
        ): HoverCard | null | Promise<HoverCard | null>;
      }): Disposable;
      /** Marks over the text (editor.read), asked for the blocks in sight
       *  and again when they change. */
      registerDecorations(provider: {
        decorate(blocks: Block[]): Decoration[] | Promise<Decoration[]>;
      }): Disposable;
      /** Another document came to the front (or none). */
      onDidChangeActive: Event<{ path: string | null }>;
      /** Its text changed: once typing pauses, not on every key. */
      onDidChange: Event<{ path: string | null }>;
      onDidChangeSelection: Event<{ text: string }>;
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
      provideCompletions(context: {
        /** Before the caret, in its paragraph or formula. */
        text: string;
        /** The part `pattern` matched, which an item replaces. */
        match: string;
        inMath: boolean;
      }):
        | CompletionItem[]
        | null
        | undefined
        | Promise<CompletionItem[] | null | undefined>;
    }

    interface CompletionItem {
      label: string;
      insert: string;
      detail?: string;
    }

    type HoverTarget =
      | { type: "document"; path: string; heading: string | null }
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
      style: "highlight" | "underline" | "muted" | "badge";
      tone?: "accent" | "warning" | "danger" | "success";
      /** For "badge": its text, after the words. */
      text?: string;
      tooltip?: string;
      /** For "badge": before the words instead - a heading's number. */
      before?: boolean;
    }

    interface EditorKeys {
      /** Takes the editor's keys: "all" but the app's shortcuts, or "some" -
       *  only `keys`. null gives them back. */
      capture(
        capture: { mode: "all" | "some"; keys: string[] } | null,
      ): Promise<void>;
      onKey: Event<string>;
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

    interface Files {
      root(): Promise<string | null>;
      list(dir?: string): Promise<FileEntry[]>;
      /** The files whose path in the folder matches `glob` ("**\/*.md",
       *  "Daily/*.md"); every document without one. */
      find(glob?: string): Promise<{ path: string; rel: string }[]>;
      stat(path: string): Promise<FileEntry | null>;
      read(path: string): Promise<Uint8Array>;
      readText(path: string): Promise<string>;
      write(
        path: string,
        data: Uint8Array | ArrayBuffer | string,
      ): Promise<void>;
      writeText(path: string, text: string): Promise<void>;
      /** A new file; fails if one is there. */
      create(path: string, text?: string): Promise<void>;
      /**
       * Reads, changes and writes a file without losing anything: open in
       * a tab, the change goes into its editor as one undo step; on disk,
       * it is written only if the file is unchanged since it was read (and
       * `change` is run again otherwise). Return the text unchanged to
       * write nothing.
       */
      process(path: string, change: (text: string) => string): Promise<string>;
      /** With `updateLinks`, links to it in the folder's documents follow. */
      rename(
        from: string,
        to: string,
        options?: { updateLinks?: boolean },
      ): Promise<void>;
      /** To the system's Trash, never deleted for good. */
      trash(path: string): Promise<void>;
      createFolder(path: string): Promise<void>;
      frontmatter: Frontmatter;
      onDidCreate: Event<{ path: string }>;
      onDidChange: Event<{ path: string }>;
      onDidRename: Event<{ from: string; to: string }>;
      onDidDelete: Event<{ path: string }>;
      /** A document is about to be saved: return its text changed to save
       *  that instead (within a second; files.write). */
      onWillSave(
        listener: (e: {
          path: string;
          text: string;
        }) => string | void | Promise<string | void>,
      ): Disposable;
      onDidSave: Event<{ path: string; text: string }>;
      onDidChangeRoot: Event<{ path: string | null }>;
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
      /** The YAML at the top of a document, as an object; {} for none. */
      get(path: string): Promise<Record<string, unknown>>;
      /** Changes it through files.process; the rest of the file untouched. */
      update(
        path: string,
        change: (
          frontmatter: Record<string, unknown>,
        ) => Record<string, unknown> | void,
      ): Promise<void>;
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
       *  path; null for none. */
      resolveLink(link: string, from: string): Promise<string | null>;
      tags(): Promise<{ tag: string; count: number }[]>;
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
        hits: (Location & { rel: string; line: number; text: string })[];
        truncated: boolean;
      }>;
      /** Documents were added, changed or removed. */
      onDidChange: Event<{ paths: string[] }>;
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
      }[];
      tags: string[];
      tasks: Task[];
      /** Only from `get`. */
      blocks?: { id: string; kind: Block["kind"]; line: number }[];
      modifiedMs: number | null;
    }

    interface Task {
      text: string;
      done: boolean;
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
      /** HTTPS to the hosts granted (`network:<host>`); no cookies. */
      fetch(
        url: string,
        init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: Uint8Array | ArrayBuffer | string;
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
      /** An HTML or PDF export's page, before it is written (editor.read):
       *  `css` is added to its styles, `html` replaces its content. Scripts
       *  and handlers in the HTML are taken out. Each plugin is waited for
       *  at most two seconds. */
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

    // ---------------------------------------------------------------
    // A webview's page
    // ---------------------------------------------------------------

    interface WebviewApi {
      readonly language: string;
      t(key: string, ...args: unknown[]): string;
      postMessage(message: unknown): void;
      onMessage(fn: (message: unknown) => void): Disposable;
      getState(): unknown;
      setState<T>(state: T): T;
      /** How the page looks as a picture, asked when the document is
       *  exported (a code block's page): an SVG's markup or an image's
       *  `data:` URL, for a page of `theme`. Without it, or answering
       *  null, the block exports as its source. */
      onExport(
        provider: (options: {
          theme: "light" | "dark";
        }) => string | null | Promise<string | null>,
      ): Disposable;
    }
  }
}
