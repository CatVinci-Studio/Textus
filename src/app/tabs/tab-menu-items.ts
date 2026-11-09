import type { DocTab } from "../../document/doc-tabs";
import { tabIsDirty } from "../../document/doc-tabs";
import { tabReadOnly } from "../../document/read-only";
import { pathItems } from "../../clipboard/copy-path";
import { windowFolder } from "../../platform/window-folder";
import { isWithin } from "../../sidebar/tree-root";
import { SHOW_SIDEBAR_TAB_EVENT } from "../../utils/events";
import type { Strings } from "../../i18n/strings";

/** A document tab's menu items beyond Open Beside and Close: its path,
 *  Read Only, and closing many at once. */
export function tabMenuItems({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onToggleReadOnly,
  t,
}: {
  tabs: DocTab[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onToggleReadOnly: (tabId: string) => void;
  t: Strings;
}) {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  // The saved tabs close; one with unsaved changes stays, its dot showing,
  // rather than a prompt for each.
  const closeSaved = (list: DocTab[]) => {
    const closing = list.filter((tab) => !tabIsDirty(tab));
    // The tab in front closing too: one that stays comes forward first, as
    // each close would otherwise pick a neighbour that is closing as well.
    if (closing.some((tab) => tab.id === activeTabId)) {
      const stays = tabs.find((tab) => !closing.includes(tab));
      if (stays) onActivate(stays.id);
    }
    for (const tab of closing) onClose(tab.id);
  };
  // Its path three ways, and the file found in the tree when the open
  // folder holds it.
  const pathItem = (id: string, path: string | null | undefined) => {
    if (!path) return [];
    const folder = windowFolder();
    const inTree = folder !== null && isWithin(path, folder);
    return [
      ...pathItems(t, path, folder),
      ...(inTree
        ? [{ label: t.menuRevealInTree, onSelect: () => revealInTree(id) }]
        : []),
    ];
  };
  const revealInTree = (id: string) => {
    onActivate(id);
    window.dispatchEvent(
      new CustomEvent(SHOW_SIDEBAR_TAB_EVENT, { detail: "tree" }),
    );
    // Once the tree has opened down to it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector('.sidebar .tree-row[aria-selected="true"]')
          ?.scrollIntoView({ block: "nearest" }),
      ),
    );
  };
  const readOnlyItem = (id: string) => {
    const tab = byId.get(id);
    if (!tab || tab.view) return [];
    return [
      {
        label: t.menuToggleReadOnly,
        checked: tabReadOnly(tab),
        onSelect: () => onToggleReadOnly(id),
      },
    ];
  };
  const closeManyItems = (list: DocTab[], id: string) => {
    const at = list.findIndex((tab) => tab.id === id);
    const groups: [string, DocTab[]][] = [
      [t.closeOtherTabs, list.filter((tab) => tab.id !== id)],
      [t.closeTabsToLeft, list.slice(0, at)],
      [t.closeTabsToRight, list.slice(at + 1)],
    ];
    return [
      ...groups
        .filter(([, closing]) => closing.length > 0)
        .map(([label, closing]) => ({
          label,
          onSelect: () => closeSaved(closing),
        })),
      { label: t.menuCloseSaved, onSelect: () => closeSaved(list) },
      // Each asks, as its own close does, when it has unsaved changes.
      {
        label: t.menuCloseAll,
        onSelect: () => list.forEach((tab) => onClose(tab.id)),
      },
    ];
  };
  return { pathItem, readOnlyItem, closeManyItems };
}
