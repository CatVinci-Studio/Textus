import { useCallback, useEffect } from "react";
import {
  listenToThisWebview,
  listenToThisWindow,
  unlistenAll,
} from "../utils/tauri-events";
import {
  CHAT_TO_EDITOR,
  onWindowEvent,
  type OpenDocumentMessage,
} from "../ai/chat/window/chat-bridge";
import {
  makeBlankTab,
  readDocFromDisk,
  tabIsDirty,
  windowIsUntouched,
  type DocTab,
} from "../document/doc-tabs";
import { fs, session, windowIpc } from "../platform/ipc";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import {
  DROP_IMAGE_FILES_EVENT,
  OPEN_FILE_IN_TAB_EVENT,
  type OpenFileInTab,
} from "../utils/events";
import { setTabJump, type TabJump } from "../editor/tab-jump";
import { lastCaret } from "../document/last-carets";
import { isIOSApp } from "../platform/capabilities";
import { isWindowsPlatform } from "../platform/os";
import { dropPointInPage, sortDroppedPaths } from "./dropped-files";
import { isWordDocument, wordDocumentTab } from "../document/word-import";
import { showMessage } from "../ui/app-dialog";
import { customEditorFor, loadPlugins } from "../plugins/manager";
import { basename } from "../utils/path";
import { errorText } from "../utils/error-text";
import type { Strings } from "../i18n/strings";
import type { NewDocumentMode } from "../settings/SettingsContext";
import type { PendingClose } from "./close-flow";
import type { TabState } from "./useTabState";

/** How a document opens, beyond which file. */
export interface OpenOptions {
  /** A followed link's `#heading`, scrolled to once the tab is showing
   *  (editor/tab-jump.ts). */
  anchor?: string;
  /** Reopening it (the last session, Open Recent): at the caret it was
   *  left at (document/last-carets.ts). */
  restoreCaret?: boolean;
  /** As a document of ours even where a plugin opens that file type - a
   *  Word file the Word reader shows, opened to be edited as Markdown. */
  asDocument?: boolean;
}

/** Where a document just read from disk should open, if not at its top. */
function openingJump(
  open: OpenOptions,
  path: string,
  diskMtime: number | null,
  restoreCarets: boolean,
): TabJump | null {
  if (open.anchor) return { kind: "heading", anchor: open.anchor };
  const at =
    open.restoreCaret && restoreCarets ? lastCaret(path, diskMtime) : null;
  return at && { kind: "caret", at };
}

/**
 * Every way a file on disk becomes an open document in this window: a new
 * tab, or (window mode) the active tab's document replaced in place -
 * behind the save/discard prompt when that would lose unsaved edits.
 */
export function useFileOpening(opts: {
  tabState: TabState;
  newDocumentMode: NewDocumentMode;
  setPendingClose: (close: PendingClose) => void;
  /** File > Open's file-type names besides Markdown, in the UI language. */
  dialogFilters: { textFilter: string; wordFilter: string; allFilter: string };
  /** Settings › General › Restore previous session on startup, which
   *  reopening a document at its last caret follows. */
  restoreCarets: boolean;
  t: Strings;
  /** A Word document was opened as a new document (word-import.ts). */
  onWordDocumentOpened: (path: string) => void;
}) {
  const {
    tabState,
    newDocumentMode,
    setPendingClose,
    dialogFilters,
    restoreCarets,
    t,
    onWordDocumentOpened,
  } = opts;
  const { tabsRef, liveTabs, setTabs, activeTabId, setActiveTabId, updateTab } =
    tabState;

  // What a tab holds once `path` is opened in it. A Word document is
  // converted into a new, unsaved document instead (word-import.ts); null
  // when that failed, which is said here.
  const readDocument = useCallback(
    async (
      path: string,
      asDocument = false,
    ): Promise<Partial<DocTab> | null> => {
      // A file type a plugin opens - a PDF, a board - is its tab, not a
      // document (plugins/manager.ts). The plugins are read first: a file
      // opened as the app starts may come before them.
      if (!asDocument) await loadPlugins().catch(() => {});
      const editor = asDocument ? null : customEditorFor(path);
      if (editor) {
        void session.addRecentFile(path);
        return {
          path: null,
          content: "",
          savedContent: "",
          diskMtime: null,
          importedFrom: undefined,
          view: {
            plugin: editor.plugin,
            view: editor.viewType,
            kind: "editor",
            resource: path,
            title: editor.title,
          },
        };
      }
      if (isWordDocument(path)) {
        try {
          const doc = await wordDocumentTab(path);
          onWordDocumentOpened(path);
          return { ...doc, view: undefined };
        } catch (err) {
          void showMessage(
            `${t.wordImportFailed.replace("{name}", basename(path))}\n${errorText(err)}`,
            { tone: "error" },
          );
          return null;
        }
      }
      const { content, diskMtime } = await readDocFromDisk(path);
      void session.addRecentFile(path); // feeds File > Open Recent
      return {
        path,
        content,
        savedContent: content,
        diskMtime,
        importedFrom: undefined,
        view: undefined,
      };
    },
    [t, onWordDocumentOpened],
  );

  const openPathInTab = useCallback(
    async (path: string, open: OpenOptions = {}) => {
      const existing = tabsRef.current.find(
        (tab) =>
          tab.path === path ||
          tab.importedFrom === path ||
          (!open.asDocument && tab.view?.resource === path),
      );
      if (existing) {
        // Source Mode has no headings to scroll to: the tab just comes up.
        if (open.anchor && !existing.sourceMode)
          setTabJump(
            existing.id,
            { kind: "heading", anchor: open.anchor },
            true,
          );
        setActiveTabId(existing.id);
        return;
      }
      const doc = await readDocument(path, open.asDocument);
      if (!doc) return;
      const newTab: DocTab = { ...makeBlankTab(), ...doc };
      const jump =
        newTab.path && openingJump(open, path, newTab.diskMtime, restoreCarets);
      if (jump) setTabJump(newTab.id, jump);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },
    [tabsRef, setTabs, setActiveTabId, restoreCarets, readDocument],
  );

  // "window" mode's actual replace step, shared between the no-dirty fast
  // path and the save/discard prompt's resolution (2.3: unsaved protection).
  const replaceTabWithFile = useCallback(
    async (tabId: string, path: string, open: OpenOptions = {}) => {
      const doc = await readDocument(path, open.asDocument);
      if (!doc) return;
      // Taken by the editor the new reloadKey mounts.
      const jump =
        doc.path &&
        openingJump(open, path, doc.diskMtime ?? null, restoreCarets);
      if (jump) setTabJump(tabId, jump);
      const reloadKey =
        (tabsRef.current.find((tb) => tb.id === tabId)?.reloadKey ?? 0) + 1;
      updateTab(tabId, { ...doc, reloadKey });
    },
    [tabsRef, updateTab, restoreCarets, readDocument],
  );

  const openFile = useCallback(
    async (path: string, open: OpenOptions = {}) => {
      if (newDocumentMode === "tab") {
        await openPathInTab(path, open);
        return;
      }
      // "window" mode: replace the active tab's document in place, same as
      // this app has always worked for a single document per window - unless
      // that would silently lose unsaved edits, in which case the same
      // save/discard/cancel prompt used for closing steps in first.
      const activeTab = tabsRef.current.find((tb) => tb.id === activeTabId);
      if (activeTab && tabIsDirty(activeTab)) {
        setPendingClose({ kind: "replace", tabId: activeTabId, path });
        return;
      }
      await replaceTabWithFile(activeTabId, path, open);
    },
    [
      newDocumentMode,
      activeTabId,
      openPathInTab,
      replaceTabWithFile,
      tabsRef,
      setPendingClose,
    ],
  );

  // The Agent panel's project bar opens the style profile and library
  // entries beside the document being written - always a new tab, never
  // replacing that document (window mode would otherwise swap it out). A
  // followed link comes the same way, with the heading it names.
  useWindowEvent(OPEN_FILE_IN_TAB_EVENT, (e) => {
    const detail = (e as CustomEvent<string | OpenFileInTab>).detail;
    const { path, anchor } =
      typeof detail === "string" ? { path: detail, anchor: undefined } : detail;
    if (typeof path === "string" && path) void openPathInTab(path, { anchor });
  });
  // The detached chat window reopened a past conversation: its document
  // comes up here, the window's editor (chat-bridge.ts).
  useEffect(
    () =>
      unlistenAll(
        onWindowEvent<OpenDocumentMessage>(
          CHAT_TO_EDITOR.openDocument,
          ({ path }) => void openPathInTab(path),
        ),
      ),
    [openPathInTab],
  );

  const openFileDialog = useCallback(async () => {
    const picked = await fs.openFileDialog(dialogFilters);
    if (picked) await openFile(picked);
  }, [openFile, dialogFilters]);

  // File > Open Recent, chosen while this window has focus (menu.rs): a
  // fresh, untouched window takes the file the way File > Open would;
  // otherwise it opens as a file from outside does - its own window, or a
  // tab in tab mode (lib.rs's queue_paths_to_open).
  const openRecentFile = useCallback(
    async (path: string) => {
      if (windowIsUntouched(liveTabs()))
        await openFile(path, { restoreCaret: true });
      else await windowIpc.openPaths([path]);
    },
    [liveTabs, openFile],
  );

  return {
    openPathInTab,
    replaceTabWithFile,
    openFile,
    openFileDialog,
    openRecentFile,
  };
}

/**
 * Runtime counterpart to the mount-time drain (useStartupRestore): Finder
 * "Open With"/the CLI on an already-running instance, while in "tab" mode,
 * arrives as a push instead (see lib.rs's queue_paths_to_open). Strictly
 * this window: Rust addresses exactly one window, and a catch-all listener
 * would open the file in every open window (see listenToThisWindow).
 */
export function useOpenPathsPush(
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>,
): void {
  useEffect(() => {
    const unlisten = listenToThisWindow<string[]>(
      "open-paths-as-tabs",
      async (event) => {
        // File > Open Recent from a window that already holds something
        // arrives this way too (openRecentFile), as the last session does
        // in a new window (startup-restore.ts).
        for (const p of event.payload)
          await openPathInTab(p, { restoreCaret: true });
      },
    );
    return unlistenAll(unlisten);
  }, [openPathInTab]);
}

/**
 * Files dropped on this window from a file manager (dropped-files.ts).
 * Strictly this window, like the push above: Tauri addresses the drop to
 * the window it landed on. Each document gets a tab of its own - a drop
 * never puts a document in place of the one being read (in window mode
 * File > Open does, and a dropped file replaced the document on screen);
 * only an untouched Untitled tab gives way to it. Dropped images go to the
 * editor on screen, at the drop point (images/image-plugin.ts), and a
 * dropped folder opens in the sidebar, as Open Folder does.
 */
export function useFileDrop(
  openFile: (path: string) => Promise<void>,
  openPathInTab: (path: string) => Promise<void>,
  activeIsUntouchedDraft: () => boolean,
  openFolder: (path: string) => void,
): void {
  useEffect(() => {
    if (isIOSApp) return;
    const unlisten = listenToThisWebview<{
      paths: string[];
      position: { x: number; y: number };
    }>("tauri://drag-drop", async (event) => {
      const { documents, images } = sortDroppedPaths(event.payload.paths);
      if (images.length > 0)
        window.dispatchEvent(
          new CustomEvent(DROP_IMAGE_FILES_EVENT, {
            detail: {
              paths: images,
              point: dropPointInPage(
                event.payload.position,
                isWindowsPlatform(),
                window.devicePixelRatio,
              ),
            },
          }),
        );
      // What can't be read as text is a folder, opened in the sidebar, or
      // a file that opens nothing, the same as when picked in File > Open.
      for (const [i, path] of documents.entries()) {
        const open =
          i === 0 && activeIsUntouchedDraft() ? openFile : openPathInTab;
        await open(path).catch(async () => {
          if (await isFolder(path)) openFolder(path);
        });
      }
    });
    return unlistenAll(unlisten);
  }, [openFile, openPathInTab, activeIsUntouchedDraft, openFolder]);
}

/** Whether `path` is a folder: only a folder lists. */
function isFolder(path: string): Promise<boolean> {
  return fs.listDir(path).then(
    () => true,
    () => false,
  );
}
