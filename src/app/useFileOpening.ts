import { useCallback, useEffect } from "react";
import { listenToThisWindow, unlistenAll } from "../platform/events";
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
import { loadPlugins, revealInPluginTab } from "../plugins/manager";
import type { DocumentPlace } from "../plugins/app-bridge";
import type { Where } from "../plugins/app-bridge";
import { customEditorFor } from "../plugins/store/plugin-lookup";
import { basename } from "../utils/path";
import { useLatest } from "../utils/hooks/useLatest";
import { openBeside } from "./split/split-layout";
import { errorText } from "../utils/error-text";
import type { Strings } from "../i18n/strings";
import type { NewDocumentMode } from "../prefs/SettingsContext";
import type { PendingClose } from "./close-flow";
import type { TabState } from "./tabs/useTabState";
import { splitForDrop, type DropTarget } from "./split/split-drop";

/** How a document opens, beyond which file. */
export interface OpenOptions {
  /** A followed link's `#heading`, scrolled to once the tab shows. */
  anchor?: string;
  /** Reopening it (last session, Open Recent): at its last caret. */
  restoreCaret?: boolean;
  /** As a document of ours even where a plugin opens that file type. */
  asDocument?: boolean;
  /** A plugin opened it at a place: gone to once the tab shows. */
  place?: DocumentPlace;
  /** In a tab of its own (the default), beside the tab in front, or in
   *  its place. */
  where?: Where;
  /** Dropped over the documents: opens on that side. */
  drop?: DropTarget;
}

/** Where a document just read from disk should open, if not at its top. */
function openingJump(
  open: OpenOptions,
  path: string,
  diskMtime: number | null,
  restoreCarets: boolean,
): TabJump | null {
  if (open.place) return { kind: "place", place: open.place };
  if (open.anchor) return { kind: "heading", anchor: open.anchor };
  const at =
    open.restoreCaret && restoreCarets ? lastCaret(path, diskMtime) : null;
  return at && { kind: "caret", at };
}

/** The tab a plugin's custom editor opens `path` in (a PDF, a board). */
function pluginTab(
  path: string,
  editor: NonNullable<ReturnType<typeof customEditorFor>>,
  target?: DocumentPlace,
): Partial<DocTab> {
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
      ...(target ? { target: { path, ...target } } : {}),
    },
  };
}

/**
 * Every way a file on disk becomes an open document in this window: a new
 * tab, or the active tab's document replaced, behind the save prompt.
 */
export function useFileOpening(opts: {
  tabState: TabState;
  newDocumentMode: NewDocumentMode;
  setPendingClose: (close: PendingClose) => void;
  /** File > Open's file-type names besides Markdown, in the UI language. */
  dialogFilters: { textFilter: string; wordFilter: string; allFilter: string };
  /** Whether reopening a document goes to its last caret. */
  restoreCarets: boolean;
  t: Strings;
  /** A Word document was opened as a new document. */
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

  // What a tab holds once `path` is opened. A Word document becomes a new,
  // unsaved document; null when that failed (already reported).
  const readDocument = useCallback(
    async (
      path: string,
      asDocument = false,
      place?: DocumentPlace,
    ): Promise<Partial<DocTab> | null> => {
      // A file type a plugin opens is its tab, not a document. Plugins load
      // first: a file opened at launch may come before them.
      if (!asDocument) await loadPlugins().catch(() => {});
      const editor = asDocument ? null : customEditorFor(path);
      if (editor) return pluginTab(path, editor, place);
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
      let disk: { content: string; diskMtime: number | null };
      try {
        disk = await readDocFromDisk(path);
      } catch (err) {
        // Not text: offer a market plugin that may open it.
        if (asDocument) throw err;
        const { offerPluginToOpen } =
          await import("../plugins/store/open-offer");
        const now = (await offerPluginToOpen(path, t))
          ? customEditorFor(path)
          : null;
        if (now) return pluginTab(path, now, place);
        throw err;
      }
      const { content, diskMtime } = disk;
      void session.addRecentFile(path);
      void import("../plugins/store/open-offer").then((offer) =>
        offer.offerForContent(content, t),
      );
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

  const activeIdRef = useLatest(activeTabId);
  const openPathInTab = useCallback(
    async (path: string, open: OpenOptions = {}) => {
      // Beside the tab in front: once the tab is among the window's.
      const from = activeIdRef.current;
      const show = (id: string) => {
        setActiveTabId(id);
        const { drop } = open;
        if (open.where === "beside")
          requestAnimationFrame(() => openBeside(id, from));
        else if (drop)
          requestAnimationFrame(() =>
            splitForDrop(
              id,
              drop,
              tabsRef.current.map((tab) => tab.id),
            ),
          );
      };
      const existing = tabsRef.current.find(
        (tab) =>
          tab.path === path ||
          tab.importedFrom === path ||
          (!open.asDocument && tab.view?.resource === path),
      );
      if (existing) {
        // A plugin's file editor is asked to show the place itself.
        if (open.place && existing.view?.kind === "editor")
          revealInPluginTab(existing.id, { path, ...open.place });
        else if (open.place && !existing.sourceMode)
          setTabJump(existing.id, { kind: "place", place: open.place }, true);
        // Source Mode has no headings to scroll to: the tab just comes up.
        else if (open.anchor && !existing.sourceMode)
          setTabJump(
            existing.id,
            { kind: "heading", anchor: open.anchor },
            true,
          );
        show(existing.id);
        return;
      }
      const doc = await readDocument(path, open.asDocument, open.place);
      if (!doc) return;
      const newTab: DocTab = { ...makeBlankTab(), ...doc };
      const jump =
        newTab.path && openingJump(open, path, newTab.diskMtime, restoreCarets);
      if (jump) setTabJump(newTab.id, jump);
      setTabs((prev) => [...prev, newTab]);
      show(newTab.id);
    },
    [
      tabsRef,
      activeIdRef,
      setTabs,
      setActiveTabId,
      restoreCarets,
      readDocument,
    ],
  );

  // Window mode's replace step, shared by the clean path and the save
  // prompt's resolution.
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
      // Beside the one in front is a tab of its own in either mode.
      if (newDocumentMode === "tab" || open.where === "beside" || open.drop) {
        await openPathInTab(path, open);
        return;
      }
      // Window mode: replace in place, unless that would lose unsaved edits;
      // then the close prompt steps in first.
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

  // Project-bar entries and followed links always open in a new tab, never
  // replacing the document being written.
  useWindowEvent(OPEN_FILE_IN_TAB_EVENT, (e) => {
    const detail = (e as CustomEvent<string | OpenFileInTab>).detail;
    const { path, anchor } =
      typeof detail === "string" ? { path: detail, anchor: undefined } : detail;
    if (typeof path === "string" && path) void openPathInTab(path, { anchor });
  });
  // The detached chat window reopened a past conversation.
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

  // File > Open Recent: an untouched window takes the file as File > Open
  // would; otherwise it opens as a file from outside does.
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
 * OS opens on an already-running instance in tab mode, pushed to exactly
 * this window; a catch-all listener would open it in every window.
 */
export function useOpenPathsPush(
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>,
): void {
  useEffect(() => {
    const unlisten = listenToThisWindow<string[]>(
      "open-paths-as-tabs",
      async (event) => {
        // Open Recent from a non-empty window arrives this way too.
        for (const p of event.payload)
          await openPathInTab(p, { restoreCaret: true });
      },
    );
    return unlistenAll(unlisten);
  }, [openPathInTab]);
}

/**
 * Files dropped on this window from a file manager. Each document gets its
 * own tab, never replacing the one being read; only an untouched Untitled
 * tab gives way. Images go to the editor at the drop point.
 */
export function useFileDrop(
  openFile: (path: string) => Promise<void>,
  openPathInTab: (path: string) => Promise<void>,
  activeIsUntouchedDraft: () => boolean,
): void {
  useEffect(() => {
    if (isIOSApp) return;
    const unlisten = listenToThisWindow<{
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
      // A file that can't be read as text opens nothing, as in File > Open.
      for (const [i, path] of documents.entries()) {
        const open =
          i === 0 && activeIsUntouchedDraft() ? openFile : openPathInTab;
        await open(path).catch(() => undefined);
      }
    });
    return unlistenAll(unlisten);
  }, [openFile, openPathInTab, activeIsUntouchedDraft]);
}
