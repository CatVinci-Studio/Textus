/**
 * The `textus` API a plugin's code is given (src/plugins/runtime/host.js),
 * and `acquireTextusApi()` in its webviews (runtime/webview.js). Written
 * out in full, so an editor completes it and Textus AI can write a plugin
 * from it; docs/dev/writing-plugins.md says what each part is for, and
 * src/plugins/textus-types.test.ts keeps this file in step with the code.
 *
 * In a plugin: `/// <reference path="textus.d.ts" />` at the top of
 * host.js, or `"types": ["./textus.d.ts"]` in a jsconfig.json.
 */

export {};

declare global {
  /** The API, as the plugin's host code sees it. */
  const textus: Textus.Api;

  /** In a webview's page: the same webview's side of the channel. */
  function acquireTextusApi(): Textus.WebviewApi;

  namespace Textus {
    interface Disposable {
      dispose(): void;
    }

    /** What `exports.activate` is given. */
    interface ExtensionContext {
      subscriptions: Disposable[];
    }

    // ---------------------------------------------------------------
    // The host API
    // ---------------------------------------------------------------

    interface Api {
      plugin: PluginInfo;
      env: Env;
      l10n: L10n;
      commands: Commands;
      window: Window;
      editor: Editor;
      document: Document;
      workspace: Workspace;
      net: Net;
      storage: Storage;
      settings: Settings;
      clipboard: Clipboard;
      ai: Ai;
    }

    interface PluginInfo {
      readonly id: string;
      readonly version: string;
      /** One of the plugin's own files, as bytes. */
      readFile(path: string): Promise<Uint8Array>;
      readText(path: string): Promise<string>;
    }

    interface Env {
      /** Textus's UI language ("en", "zh", "zh-Hant", ...). */
      readonly language: string;
      readonly appVersion: string;
      readonly platform: "macos" | "windows" | "linux" | "ios";
      readonly theme: "light" | "dark";
      onDidChangeTheme(fn: (theme: "light" | "dark") => void): Disposable;
      onDidChangeLanguage(fn: (language: string) => void): Disposable;
    }

    interface L10n {
      /** A string of the manifest's `l10n` in the UI language; "{0}",
       *  "{1}"... are `args`. */
      t(key: string, ...args: unknown[]): string;
    }

    interface Commands {
      registerCommand(
        id: string,
        run: (...args: unknown[]) => unknown,
      ): Disposable;
      /** A command of Textus's ("textus.save") or
       *  of a plugin's. */
      executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
    }

    interface Window {
      showMessage(
        text: string,
        options?: { tone?: "info" | "warning" | "error" },
      ): Promise<void>;
      showInput(options?: {
        prompt?: string;
        value?: string;
      }): Promise<string | null>;
      /** The item's `value` (its label without one), or null. */
      showQuickPick(
        items: (
          string | { label: string; description?: string; value?: unknown }
        )[],
        options?: { placeholder?: string },
      ): Promise<unknown>;
      /** Opens one of the plugin's views (`contributes.views`) in a tab. */
      openView(
        viewId: string,
        options?: Record<string, unknown>,
      ): Promise<void>;
      /** Opens a file in a tab, at `heading` if given. `asDocument` opens
       *  it as a Markdown document even where a plugin's editor takes its
       *  type (the Word reader's "Edit"). */
      openFile(
        path: string,
        options?: { heading?: string; asDocument?: boolean },
      ): Promise<void>;
      /** A new document, not yet saved, holding `content`. */
      openUntitled(
        content: string,
        options?: { title?: string },
      ): Promise<void>;
      openWebPage(url: string, options?: { title?: string }): Promise<void>;
      /** In the system's browser. */
      openExternal(url: string): Promise<void>;
      /** Splits the editor: "row" side by side, "column" one above the
       *  other. */
      splitEditor(direction?: "row" | "column"): Promise<void>;
      closeSplit(): Promise<void>;
      layout(): Promise<{ split: "row" | "column" | null; ratio?: number }>;
      setStatusItem(
        id: string,
        item: { text: string; tooltip?: string; command?: string },
      ): Disposable;
      registerWebviewViewProvider(
        viewId: string,
        provider: {
          resolveWebviewView(
            webview: Webview,
            context: { state: unknown },
          ): void | Promise<void>;
        },
      ): Disposable;
      registerCustomEditorProvider(
        viewType: string,
        provider: {
          resolveCustomEditor(
            document: CustomDocument,
            webview: Webview,
          ): void | Promise<void>;
        },
      ): Disposable;
      registerSettingsPage(provider: {
        resolveSettingsPage(webview: Webview): void | Promise<void>;
      }): Disposable;
    }

    /** A page of the plugin's, in a sidebar tab, a view, a custom editor
     *  or its settings page. */
    interface Webview {
      readonly id: string;
      html: string;
      postMessage(message: unknown): Promise<void>;
      onDidReceiveMessage(fn: (message: unknown) => void): Disposable;
      onDidDispose(fn: () => void): Disposable;
      /** A file of the plugin's, for the page's HTML. */
      asWebviewUri(path: string): string;
      setTitle(title: string): Promise<void>;
    }

    /** The file a custom editor was opened on. */
    interface CustomDocument {
      readonly path: string;
      readonly fileName: string;
      readBytes(): Promise<Uint8Array>;
      readText(): Promise<string>;
      writeText(text: string): Promise<void>;
    }

    interface Editor {
      /** Takes the editor's keys (editor.input): "all" but the app's
       *  shortcuts, or "some" - only `keys`. null gives them back. */
      captureKeys(
        capture: { mode: "all" | "some"; keys: string[] } | null,
      ): Promise<void>;
      onKey(fn: (key: string) => void): Disposable;
      exec(op: EditorOp): Promise<EditorOpResult>;
      /** Cards for what the pointer rests on (document.read). */
      registerHoverProvider(provider: {
        provideHover(
          target: HoverTarget,
        ): HoverCard | null | Promise<HoverCard | null>;
      }): Disposable;
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
      | { op: "flashJump"; label: string; select?: boolean }
      | { op: "flashClear" };

    interface EditorOpResult {
      text?: string;
      labels?: number;
      empty: boolean;
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

    /** The document in front (document.read; proposeEdit:
     *  document.propose). */
    interface Document {
      getText(): Promise<string | null>;
      getPath(): Promise<string | null>;
      getSelection(): Promise<{ text: string; markdown: string | null } | null>;
      /** The editor's blocks, as Textus AI is shown them. */
      getBlocks(): Promise<
        { id: string; markdown: string; kind: string }[] | null
      >;
      getOutline(): Promise<
        { level: number; text: string; line: number }[] | null
      >;
      /** Shown as a proposal the user accepts or rejects. */
      proposeEdit(edit: {
        action?:
          | "replace"
          | "replace_selection"
          | "insert_before"
          | "insert_after"
          | "delete"
          | "append"
          | "insert_at_cursor";
        text?: string;
        /** The block a replace, insert_before/after or delete changes, by
         *  its id (getBlocks); lastBlock for a run of them. */
        block?: string;
        lastBlock?: string;
        /** A few words inside the block, for part of it. */
        anchor?: string;
        reason?: string;
      }): Promise<boolean>;
      onDidChangeActive(fn: (e: { path: string | null }) => void): Disposable;
    }

    /** The folder open in the sidebar (workspace.read / workspace.write).
     *  Paths are relative to it. */
    interface Workspace {
      rootPath(): Promise<string | null>;
      list(path?: string): Promise<
        {
          name: string;
          path: string;
          isDir: boolean;
          size: number;
          modifiedMs: number | null;
        }[]
      >;
      /** Every document in the folder: absolute `path`, `/`-separated
       *  `rel`. */
      findDocuments(): Promise<{ path: string; rel: string }[]>;
      /** Every Markdown document in the folder with its text, in one
       *  call - what a graph of links or a list of tasks is built from.
       *  `truncated`: the folder holds more than was read. */
      readDocuments(): Promise<{
        documents: { path: string; rel: string; text: string }[];
        truncated: boolean;
      }>;
      /** The documents' lines holding `query`, ignoring case, in the
       *  sidebar's order; at most `limit` (200 unless given, 1000 at
       *  most). */
      search(
        query: string,
        options?: { limit?: number },
      ): Promise<{
        hits: { path: string; rel: string; line: number; text: string }[];
        truncated: boolean;
      }>;
      readFile(path: string): Promise<Uint8Array>;
      readText(path: string): Promise<string>;
      writeText(path: string, text: string): Promise<void>;
      writeFile(
        path: string,
        data: Uint8Array | ArrayBuffer | string,
      ): Promise<void>;
      rename(from: string, to: string): Promise<void>;
      /** To the system's Trash, never deleted for good. */
      trash(path: string): Promise<void>;
      createFolder(path: string): Promise<void>;
      onDidSaveDocument(
        fn: (e: { path: string; text: string }) => void,
      ): Disposable;
      onDidChangeRoot(fn: (e: { path: string | null }) => void): Disposable;
    }

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

    /** One of the plugin's two places: keys, and files of its own. */
    interface StoragePlace {
      get(key: string): Promise<unknown>;
      /** null deletes. */
      set(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<void>;
      keys(): Promise<string[]>;
      readText(path: string): Promise<string>;
      writeText(path: string, text: string): Promise<void>;
      files(): Promise<string[]>;
      deleteFile(path: string): Promise<void>;
    }

    interface Storage {
      /** For every document, in Textus's config folder. */
      global: StoragePlace;
      /** In the open folder's .textus/plugins/<id>/ (project.data). */
      project: StoragePlace;
      /** The global place's. */
      get(key: string): Promise<unknown>;
      set(key: string, value: unknown): Promise<void>;
    }

    interface Settings {
      /** The project's value, else the general one, else the manifest's
       *  default. */
      get(key: string): Promise<unknown>;
      onDidChange(fn: (e: { key: string; value: unknown }) => void): Disposable;
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

    interface Clipboard {
      readText(): Promise<string>;
      writeText(text: string): Promise<void>;
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
    }
  }
}
