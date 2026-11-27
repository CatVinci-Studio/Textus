import type { DocTab } from "../../document/doc-tabs";
import { tabIsDirty } from "../../document/doc-tabs";
import { tabReadOnly } from "../../document/read-only";
import { keepPinned, tabPinned } from "../../document/pinned";
import type { ContextMenuEntry } from "../../engine/controls/ContextMenu";
import { contributedContextItems } from "../../registry/context-menu-items";
import { pathItems } from "../../clipboard/copy-path";
import { windowFolder } from "../../platform/window-folder";
import { isWithin } from "../../utils/path";
import { SHOW_SIDEBAR_TAB_EVENT, sendAppEvent } from "../../utils/events";
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
  // folder holds it: one row opening onto them, so the menu keeps to a few
  // rows a group (HIG: a context menu's groups short).
  const pathItem = (
    id: string,
    path: string | null | undefined,
  ): ContextMenuEntry[] => {
    if (!path) return [];
    const folder = windowFolder();
    const inTree = folder !== null && isWithin(path, folder);
    return [
      {
        label: t.menuFileLocation,
        items: [
          ...pathItems(t, path, folder),
          ...(inTree
            ? [{ label: t.menuRevealInTree, onSelect: () => revealInTree(id) }]
            : []),
        ],
      },
    ];
  };
  const revealInTree = (id: string) => {
    onActivate(id);
    sendAppEvent(SHOW_SIDEBAR_TAB_EVENT, "tree");
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
        toggle: true,
        onSelect: () => onToggleReadOnly(id),
      },
    ];
  };
  // A pinned tab is closed only on its own, once unpinned.
  const closeManyItems = (row: DocTab[], id: string) => {
    const at = row.findIndex((tab) => tab.id === id);
    const list = row.filter((tab) => !tabPinned(tab));
    const groups: [string, DocTab[]][] = [
      [t.closeOtherTabs, list.filter((tab) => tab.id !== id)],
      [t.closeTabsToLeft, row.slice(0, at).filter((tab) => !tabPinned(tab))],
      [t.closeTabsToRight, row.slice(at + 1).filter((tab) => !tabPinned(tab))],
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

/** Plugins' items for a tab's file ("tab/context"). */
function pluginTabItems(path: string | null): ContextMenuEntry[] {
  const added = contributedContextItems("tab/context", { path });
  return added.length ? ["separator", ...added] : [];
}

/**
 * A document tab's whole menu, the same wherever it opens: a tab's own in
 * its row, or the tab in front's on a phone's list of tabs. `row` is the
 * tabs it closes others among.
 */
export function documentTabMenu(
  options: Parameters<typeof tabMenuItems>[0] & {
    /** Pin Tab / Unpin Tab: kept by its file's path, as Read Only is. */
    onPin: (tabId: string, pinned: boolean) => void;
  },
): (id: string, row: DocTab[]) => ContextMenuEntry[] {
  const { tabs, onClose, onPin, t } = options;
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const { pathItem, readOnlyItem, closeManyItems } = tabMenuItems(options);
  const pinItem = (id: string) => {
    const tab = byId.get(id);
    if (!tab) return [];
    const pinned = tabPinned(tab);
    return [
      {
        label: pinned ? t.menuUnpinTab : t.menuPinTab,
        onSelect: () => {
          if (tab.path) keepPinned(tab.path, !pinned);
          onPin(id, !pinned);
        },
      },
    ];
  };
  return (id, row) => [
    ...pathItem(id, byId.get(id)?.path),
    ...readOnlyItem(id),
    ...pinItem(id),
    "separator",
    {
      label: t.menuCloseTab,
      // A pinned tab is unpinned first.
      disabled: tabPinned(byId.get(id)),
      onSelect: () => onClose(id),
    },
    ...closeManyItems(row, id),
    ...pluginTabItems(byId.get(id)?.path ?? null),
  ];
}
