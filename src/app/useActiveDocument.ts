import { useDeferredValue, useEffect, useMemo } from "react";
import { useIOSDocumentsFolder } from "../platform/ios-files";
import { rememberIOSDocument } from "../document/ios-recents";
import { countWords } from "../utils/word-count";
import { PAUSE_FEATURES_THRESHOLD } from "../editor/large-doc";
import { tabIsDirty, tabTitle, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";

/**
 * What the window shows about the document in front: the active tab, the
 * folder the sidebar tree shows with no document saved yet, and the window
 * bar's readouts (title, unsaved dot, word count, large-document marker).
 */
export function useActiveDocument(
  tabs: DocTab[],
  activeTabId: string,
  t: Strings,
) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  // With no file open the tree has nothing to show (useOpenFolder.ts) -
  // except on iOS, where the app's Documents folder is home: where Save
  // puts new documents, and what Files lists under Textus.
  const documentsFolder = useIOSDocumentsFolder();
  useEffect(() => {
    void rememberIOSDocument(activeTab.path);
  }, [activeTab.path]);
  // Deferred: a whole-document count on every edit would otherwise sit in
  // the same render as the edit itself; the status bar can lag a beat.
  const deferredContent = useDeferredValue(activeTab.content);
  const wordCount = useMemo(
    () => countWords(deferredContent),
    [deferredContent],
  );
  // The window bar's "Large document": the features it names pause past
  // this (editor/large-doc.ts). A markdown-string-length proxy for the doc
  // size the plugins check - close enough for a status indicator.
  const isLargeDoc = activeTab.content.length > PAUSE_FEATURES_THRESHOLD;
  const activeDirty = tabIsDirty(activeTab);
  const activeTitle = tabTitle(activeTab, t);

  return {
    activeTab,
    documentsFolder,
    wordCount,
    isLargeDoc,
    activeDirty,
    activeTitle,
  };
}
