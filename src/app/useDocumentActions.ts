import { useCallback, useState } from "react";
import { iosFiles } from "../platform/ios-files";
import { forgetIOSDocument } from "../document/ios-recents";
import { moveConversations } from "../ai/chat/chat-history";
import { makeBlankTab, tabIsDirty } from "../document/doc-tabs";
import type { TabState } from "./tabs/useTabState";
import { isInside } from "../utils/path";
import { notePathMoved } from "../plugins/app-bridge";

/**
 * What happens to open tabs when the app itself renames, moves or deletes
 * their files, and the iPhone document list's open state.
 */
export function useDocumentActions(opts: {
  tabState: TabState;
  openFile: (path: string) => Promise<void>;
  removeTab: (tabId: string) => void;
  saveTab: (tabId: string) => Promise<boolean>;
}) {
  const { tabState, openFile, removeTab, saveTab } = opts;
  const { tabsRef, setTabs, activeTabId, setActiveTabId, liveTabs } = tabState;

  // iPhone: the document list. An entry that no longer exists is dropped.
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const openFromDocuments = useCallback(
    (path: string) => {
      setDocumentsOpen(false);
      void openFile(path).catch(() => forgetIOSDocument(path));
    },
    [openFile],
  );
  // A renamed document stays open under its new name; a deleted one keeps
  // its text in the tab, unsaved.
  const documentRenamed = useCallback(
    (from: string, to: string) => {
      setTabs((prev) =>
        prev.map((tab) => (tab.path === from ? { ...tab, path: to } : tab)),
      );
      moveConversations(from, to);
    },
    [setTabs],
  );
  // A file or folder moved in the tree: every open tab in it follows.
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
      void notePathMoved(from, to);
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
  // A reset skill's file was deleted, so a tab showing it must not write it
  // back: an unedited one closes, an edited one becomes an unsaved draft.
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

  // iPhone Share needs a file, so an unsaved document is saved first.
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
