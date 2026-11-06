import { tabIsDirty, type DocTab } from "../document/doc-tabs";
import { isWithin } from "../sidebar/tree-root";

/**
 * What Close Folder does to the tabs: the saved documents inside `folder`
 * close, ones with unsaved changes stay for the user to decide. `blank`: a
 * new Untitled tab first, so closing them doesn't close the window.
 */
export function folderTabsToClose(
  tabs: DocTab[],
  folder: string,
): { close: string[]; blank: boolean } {
  const close = tabs
    .filter((tab) => tab.path && isWithin(tab.path, folder) && !tabIsDirty(tab))
    .map((tab) => tab.id);
  return { close, blank: close.length > 0 && close.length === tabs.length };
}
