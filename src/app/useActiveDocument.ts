import { useDeferredValue, useEffect, useMemo } from "react";
import { useIOSDocumentsFolder } from "../platform/ios-files";
import { rememberIOSDocument } from "../document/ios-recents";
import { countWords } from "../utils/word-count";
import { PAUSE_FEATURES_THRESHOLD } from "../editor/large-doc";
import { tabIsDirty, tabTitle, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";

/**
 * What the window shows about the document in front: the active tab, the
 * tree's folder with no document saved, and the window bar's readouts.
 */
export function useActiveDocument(
  tabs: DocTab[],
  activeTabId: string,
  t: Strings,
) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  // With no file open the tree is empty, except on iOS, where the app's
  // Documents folder is home.
  const documentsFolder = useIOSDocumentsFolder();
  useEffect(() => {
    void rememberIOSDocument(activeTab.path);
  }, [activeTab.path]);
  // Deferred, so a whole-document count doesn't sit in the edit's render.
  const deferredContent = useDeferredValue(activeTab.content);
  const wordCount = useMemo(
    () => countWords(deferredContent),
    [deferredContent],
  );
  // A markdown-length proxy for the size the plugins check: close enough
  // for a status indicator.
  const featuresPaused = activeTab.content.length > PAUSE_FEATURES_THRESHOLD;
  const activeDirty = tabIsDirty(activeTab);
  const activeTitle = tabTitle(activeTab, t);

  return {
    activeTab,
    documentsFolder,
    wordCount,
    featuresPaused,
    activeDirty,
    activeTitle,
  };
}
