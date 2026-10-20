import { useCallback, useState } from "react";
import { iosFiles } from "../platform/ios-files";
import { forgetIOSDocument } from "../document/ios-recents";
import { moveConversations } from "../ai/chat/chat-history";
import { makeBlankTab, tabIsDirty } from "../document/doc-tabs";
import type { TabState } from "./useTabState";
import { isInside } from "../utils/path";

/**
 * What happens to open tabs when their files change under them from inside
 * the app - the iPhone's document list (open, rename, delete, share), a
 * drag in the sidebar's tree and Settings > Skills > Reset - and the
 * document list's own open state.
 */
export function useDocumentActions(opts: {
  tabState: TabState;
  openFile: (path: string) => Promise<void>;
  removeTab: (tabId: string) => void;
  saveTab: (tabId: string) => Promise<boolean>;
}) {
  const { tabState, openFile, removeTab, saveTab } = opts;
  const { tabsRef, setTabs, activeTabId, setActiveTabId, liveTabs } = tabState;

  // iPhone: the document list (menu > Documents). Opening an entry that no
  // longer exists (moved or deleted in Files) drops it from the list.
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const openFromDocuments = useCallback(
    (path: string) => {
      setDocumentsOpen(false);
      void openFile(path).catch(() => forgetIOSDocument(path));
    },
    [openFile],
  );
  // A renamed document stays open under its new name, its past
  // conversations with it; a deleted one keeps its text in the tab, unsaved,
  // so nothing on screen is lost with it.
  const documentRenamed = useCallback(
    (from: string, to: string) => {
      setTabs((prev) =>
        prev.map((tab) => (tab.path === from ? { ...tab, path: to } : tab)),
      );
      moveConversations(from, to);
    },
    [setTabs],
  );
  // The sidebar's tree moved a file or a whole folder into another folder:
  // every open tab in it follows, with its conversations.
  const entryMoved = useCallback(
    (from: string, to: string) => {
      const moved = (path: string | null) =>
        path === from
          ? to
          : path && isInside(path, from)
            ? to + path.slice(from.length)
            : null;
      for (const tab of tabsRef.current) {
        const next = moved(tab.path);
        if (tab.path && next) moveConversations(tab.path, next);
      }
      setTabs((prev) =>
        prev.map((tab) => {
          const next = moved(tab.path);
          return next ? { ...tab, path: next } : tab;
        }),
      );
    },
    [tabsRef, setTabs],
  );
  const documentDeleted = useCallback(
    (path: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.path === path
            ? { ...tab, path: null, savedContent: "", diskMtime: null }
            : tab,
        ),
      );
    },
    [setTabs],
  );
  // Settings > Skills > Reset deleted a customized skill's file. A tab
  // still showing it must not write it back on the next save: an unedited
  // one closes (the window's only tab becomes a blank one instead of
  // closing the window), an edited one keeps its text as an unsaved draft.
  const skillFilesDeleted = useCallback(
    (paths: string[]) => {
      for (const tab of tabsRef.current) {
        if (!tab.path || !paths.includes(tab.path)) continue;
        if (tabIsDirty(tab)) {
          documentDeleted(tab.path);
        } else if (tabsRef.current.length > 1) {
          removeTab(tab.id);
        } else {
          const blank = makeBlankTab();
          setTabs([blank]);
          setActiveTabId(blank.id);
        }
      }
    },
    [documentDeleted, removeTab, tabsRef, setTabs, setActiveTabId],
  );

  // iPhone menu > Share: the share sheet needs a file, so an unsaved or
  // never-saved document is saved first (into Documents, if it is new).
  const shareActiveTab = useCallback(async () => {
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    if (!tab) return;
    if ((!tab.path || tabIsDirty(tab)) && !(await saveTab(tab.id))) return;
    // A first save lands in `tabs` on the next render.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const path = tabsRef.current.find((tb) => tb.id === tab.id)?.path;
    if (path) await iosFiles.share(path).catch(() => {});
  }, [activeTabId, liveTabs, saveTab, tabsRef]);

  return {
    documentsOpen,
    setDocumentsOpen,
    openFromDocuments,
    documentRenamed,
    entryMoved,
    documentDeleted,
    skillFilesDeleted,
    shareActiveTab,
  };
}
