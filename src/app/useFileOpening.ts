import { useCallback, useEffect } from "react";
import {
  listenToThisWebview,
  listenToThisWindow,
  unlistenAll,
} from "../platform/events";
import {
  CHAT_TO_EDITOR,
  onWindowEvent,
  type OpenDocumentMessage,
} from "../ai/chat/window/chat-bridge";
import {
  makeBlankTab,
  readDocFromDisk,
  tabIsUntouchedDraft,
  windowIsUntouched,
  type DocTab,
} from "../document/doc-tabs";
import { exportDoc, fs, session, windowIpc } from "../platform/ipc";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import {
  DROP_IMAGE_FILES_EVENT,
  OPEN_FILE_IN_TAB_EVENT,
  type OpenFileInTab,
} from "../utils/events";
import { setTabJump, type TabJump } from "../editor/tab-jump";
import { lastCaret } from "../document/last-carets";
import { lastViewMode } from "../editor/modes/view-mode";
import { isIOSApp } from "../platform/capabilities";
import { isWindowsPlatform } from "../platform/os";
import { dropPointInPage, sortDroppedPaths } from "./dropped-files";
import { isWordDocument, wordDocumentTab } from "../document/word-import";
import { showConfirm, showMessage } from "../engine/controls/app-dialog";
import { loadPlugins, revealInPluginTab } from "../plugins/manager";
import type { DocumentPlace } from "../plugins/app-bridge";
import type { Where } from "../plugins/app-bridge";
import {
  customEditorFor,
  customEditorForContent,
} from "../plugins/store/plugin-lookup";
import { basename } from "../utils/path";
import { useLatest } from "../utils/hooks/useLatest";
import {
  besideLayout,
  openBeside,
  placeOnArrival,
} from "../engine/layout/store";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./tabs/useTabState";
import { splitForDrop } from "./islands/split-drop";
import type { DropTarget } from "../engine/layout/drop-zones";
import { explainError } from "../utils/error-explain";

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
  /** A single click to look: in the preview tab (DocTab.preview). */
  preview?: boolean;
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
 * tab, or the tab it is in already.
 */
export function useFileOpening(opts: {
  tabState: TabState;
  /** File > Open's file-type names besides Markdown, in the UI language. */
  dialogFilters: { textFilter: string; wordFilter: string; allFilter: string };
  /** Whether reopening a document goes to its last caret. */
  restoreCarets: boolean;
  t: Strings;
  /** A Word document was opened as a new document. */
  onWordDocumentOpened: (path: string) => void;
}) {
  const { tabState, dialogFilters, restoreCarets, t, onWordDocumentOpened } =
    opts;
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
            `${t.wordImportFailed.replace("{name}", basename(path))}\n${explainError(err, t)}`,
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
        const offered = await offerPluginToOpen(path, t);
        if (offered === "system") {
          await exportDoc.openLinkedFile(path);
          return null;
        }
        const now = offered === "on" ? customEditorFor(path) : null;
        if (now) return pluginTab(path, now, place);
        throw err;
      }
      const { content, diskMtime } = disk;
      // A Markdown document a plugin claims by its front matter (a board).
      const claimed = asDocument ? null : customEditorForContent(path, content);
      if (claimed) return pluginTab(path, claimed, place);
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
        // A tab just made takes its place as it arrives, in the same
        // update: never drawn first in front where it doesn't stay.
        const arriving = !tabsRef.current.some((tab) => tab.id === id);
        if (open.where === "beside") {
          if (arriving)
            placeOnArrival(id, (now) => besideLayout(now, id, from) ?? now);
          else openBeside(id, from);
        } else if (drop)
          splitForDrop(
            id,
            drop,
            [...new Set([...tabsRef.current.map((tab) => tab.id), id])],
            arriving,
          );
      };
      const existing = tabsRef.current.find(
        (tab) =>
          tab.path === path ||
          tab.importedFrom === path ||
          (!open.asDocument && tab.view?.resource === path),
      );
      if (existing) {
        // Opened on purpose (not a look): the preview tab stays.
        if (existing.preview && !open.preview)
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === existing.id ? { ...tab, preview: false } : tab,
            ),
          );
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
      // A plugin's tab has no source to show.
      const newTab: DocTab = {
        ...makeBlankTab(),
        ...(doc.view ? {} : lastViewMode()),
        ...doc,
        ...(open.preview ? { preview: true } : {}),
      };
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
      updateTab(tabId, { ...doc, reloadKey, preview: !!open.preview });
    },
    [tabsRef, updateTab, restoreCarets, readDocument],
  );

  // One rule in the window: a file open already comes to the front, an
  // untouched draft in front gives way to it, a look (preview) takes the
  // preview tab while nothing is written in it, anything else gets a tab of
  // its own; nothing written is replaced. (The setting only says where files
  // from outside go: startup-restore and the native side.)
  const openFile = useCallback(
    async (path: string, open: OpenOptions = {}) => {
      // Live: an edit still being debounced is no longer untouched.
      const tabs = liveTabs();
      const front = tabs.find((tab) => tab.id === activeTabId);
      const alreadyOpen = tabs.some(
        (tab) => tab.path === path || tab.importedFrom === path,
      );
      const spare =
        open.preview &&
        !alreadyOpen &&
        tabs.find(
          (tab) => tab.preview && tab.content === tab.savedContent && !tab.view,
        );
      if (spare) {
        await replaceTabWithFile(spare.id, path, open);
        setActiveTabId(spare.id);
        return;
      }
      if (
        front &&
        tabIsUntouchedDraft(front) &&
        !alreadyOpen &&
        !open.where &&
        !open.drop
      )
        await replaceTabWithFile(activeTabId, path, open);
      else await openPathInTab(path, open);
    },
    [activeTabId, openPathInTab, replaceTabWithFile, liveTabs, setActiveTabId],
  );

  // Project-bar entries and followed links always open in a new tab, never
  // replacing the document being written.
  useWindowEvent(OPEN_FILE_IN_TAB_EVENT, (e) => {
    const detail = (e as CustomEvent<string | OpenFileInTab>).detail;
    const { path, anchor, linked } =
      typeof detail === "string" ? { path: detail } : detail;
    if (typeof path !== "string" || !path) return;
    if (linked) void openLinkedFile(path);
    else void openPathInTab(path, { anchor });
  });

  // A linked file: in a tab when Textus shows it, or when an official plugin
  // would and the user installs it; else, once the user agrees, in the
  // system's app (a document's link shouldn't open things unseen; a program
  // is only shown in its folder, which the backend decides).
  const openLinkedFile = async (path: string) => {
    await loadPlugins().catch(() => {});
    if (isWordDocument(path) || customEditorFor(path)) {
      await openPathInTab(path);
      return;
    }
    const { offerPluginToOpen } = await import("../plugins/store/open-offer");
    const offered = await offerPluginToOpen(path, t);
    if (offered === "on") await openPathInTab(path);
    // The card's "Open with system app" was the user's say-so.
    if (offered === "system") await exportDoc.openLinkedFile(path);
    if (offered !== "none") return;
    const open = await showConfirm(
      t.linkOpenFileConfirm.replace("{name}", basename(path)),
      { okLabel: t.linkOpenFileOk, cancelLabel: t.closePromptCancel },
    );
    if (open) await exportDoc.openLinkedFile(path);
  };
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
 * tab gives way. Images go to the editor at the drop point, and a folder
 * opens in the sidebar, as Open Folder does.
 */
export function useFileDrop(
  openFile: (path: string) => Promise<void>,
  openPathInTab: (path: string) => Promise<void>,
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
      // What can't be read as text is a folder, opened in the sidebar, or a
      // file that opens nothing, as in File > Open. Only the first may take
      // an untouched draft's place.
      for (const [i, path] of documents.entries())
        await (i === 0 ? openFile : openPathInTab)(path).catch(async () => {
          if (await isFolder(path)) openFolder(path);
        });
    });
    return unlistenAll(unlisten);
  }, [openFile, openPathInTab, openFolder]);
}

/** Whether `path` is a folder: only a folder lists. */
function isFolder(path: string): Promise<boolean> {
  return fs.listDir(path).then(
    () => true,
    () => false,
  );
}
