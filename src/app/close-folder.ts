import { tabIsDirty, type DocTab } from "../document/doc-tabs";
import { isWithin } from "../utils/path";

/**
 * What Close Folder does to the tabs: the saved documents inside `folder`
 * close, ones with unsaved changes stay for the user to decide. `blank`:
 * the start page first, so closing them doesn't close the window.
 */
export function folderTabsToClose(
  tabs: DocTab[],
  folder: string,
): { close: string[]; blank: boolean } {
  // A plugin's view shows its file by `view.resource` (a .base page).
  const fileOf = (tab: DocTab) => tab.path ?? tab.view?.resource ?? null;
  const close = tabs
    .filter((tab) => {
      const file = fileOf(tab);
      return file && isWithin(file, folder) && !tabIsDirty(tab);
    })
    .map((tab) => tab.id);
  return { close, blank: close.length > 0 && close.length === tabs.length };
}
