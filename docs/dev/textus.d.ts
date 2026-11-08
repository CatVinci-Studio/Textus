/**
 * The Textus plugin API, 1.1: the `textus` object a plugin's code is given
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
    }

    interface Env {
      /** Textus's UI language ("en", "zh", "zh-Hant", ...). */
      readonly language: string;
      readonly appVersion: string;
      /** This API's version: "1.1". Check it before using what 1.1 added
       *  (schedule, notify, app, change sources), or set engines.textus to
       *  ">=1.3.0-beta.8". */
      readonly apiVersion: string;
      readonly platform: "macos" | "windows" | "linux" | "ios";
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
      /** A command of Textus's or of a plugin's. Textus's: "textus.save",
       *  "textus.closeTab" ({ save: true } closes once saved) and
       *  "textus.insertBlock" with a Format menu block at the caret - "h1"
       *  to "h6", "paragraph", "bullet-list", "ordered-list", "task-list",
       *  "blockquote", "code-block", "math-block", "rule" or "table".
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
      /** Opens the sidebar on a tab: a plugin's sidebar tab id, or `tree`
       *  (Files) or `outline`. From 1.3.10. */
      showSidebarTab(id: string): Promise<void>;
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
      /** The plugin's page in Settings (`contributes.settingsPage`). */
      registerSettingsPage(provider: {
        resolve(webview: Webview): void | Promise<void>;
      }): Disposable;
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
       *  `pattern`. `insert` replaces the match; `$0` marks the caret.
       *  Shown in the / panel, grouped by plugin. 1.2: every matching
       *  provider is asked at once, and none holds up typing. */
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
      /** Its text changed: once typing pauses, not on every key. 1.1:
       *  `source` says who changed it - "user" (typing, pasting, the
       *  keyboard), "ai" (Textus AI: an accepted proposal, a completion, a
       *  grammar fix), "disk" (the file changed and was read again),
       *  "plugin" (a plugin through this API) or "history" (undo, redo).
       *  When several did since the last event, "user" wins, then history,
       *  ai, plugin, disk. */
      onDidChange: Event<{ path: string | null; source: ChangeSource }>;
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
      style: "highlight" | "underline" | "muted" | "badge";
      tone?: "accent" | "warning" | "danger" | "success";
      /** For "badge": its text, after the words. */
      text?: string;
      tooltip?: string;
      /** For "badge": before the words instead - a heading's number. */
      before?: boolean;
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
      /** To the system's Trash, never deleted for good. */
      trash(path: string): Promise<void>;
      createFolder(path: string): Promise<void>;
      frontmatter: Frontmatter;
      onDidCreate: Event<{ path: string }>;
      onDidChange: Event<{ path: string }>;
      onDidRename: Event<{ from: string; to: string }>;
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
      /** The open folder's conventions changed: another folder, or its
       *  app's settings edited. From 1.3.9. */
      onDidChangeConventions: Event<{ root: string }>;
    }

    /** One setting of a folder and where it came from. */
    interface ConventionSetting<T> {
      value: T;
      /** "textus", "typora", "obsidian", "logseq", "dendron", "foam",
       *  "vscode", "mkdocs", "hugo", "docusaurus", "jekyll", "quarto" or
       *  "git". */
      app: string;
      /** The folder these settings belong to. */
      root: string;
    }

    interface FolderConventions {
      /** The apps found, nearest first. */
      sources: { app: string; root: string }[];
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
      daily: ConventionSetting<{
        folder: string;
        format: string;
        template: string | null;
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
      /** What Textus AI is doing and with which service and model - never
       *  what is said. From 1.3.6. */
      state(): Promise<AiState>;
      onDidChangeState: Event<AiState>;
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
       *  every window closed in background mode). */
      readonly state: "active" | "inactive" | "background";
      onDidChangeState: Event<"active" | "inactive" | "background">;
      /** The user typed (heard once typing pauses) or saved by hand -
       *  that it happened, with nothing of the document. From 1.3.6. */
      onDidActivity: Event<{ kind: "typing" | "saved" }>;
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
      onMessage(fn: (message: unknown) => void): Disposable;
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
