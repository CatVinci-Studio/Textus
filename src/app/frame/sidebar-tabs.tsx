import { getUiState, setUiState } from "../../storage/ui-state";
import { StartActions } from "../StartActions";
import "../start-page.css";
import type { ComponentType } from "react";
import { FileTree } from "../../files/FileTree";
import { Outline } from "../../files/Outline";
import { TreeTabIcon, OutlineTabIcon } from "../../engine/controls/icons";
import { canOpenFolder, isIOSApp } from "../../platform/capabilities";
import { PHONE_QUERY } from "../../engine/controls/usePhoneLayout";
import type { Strings } from "../../i18n/strings";
import type { OpenFolder } from "../useOpenFolder";
import type { FileOpenHow } from "../../files/tree-shared";

/** What every sidebar tab's panel is given: the window's document and
 *  folder, and its ways to open a file or close the sidebar. */
export interface SidebarTabProps {
  t: Strings;
  /** The tree's root and the opened folder. */
  openFolder: OpenFolder;
  activePath: string | null;
  activeContent: string;
  /** The tab in front, for a jump inside its document. */
  activeTabId: string;
  /** `beside`: in a split beside the document in front. */
  onOpenFile: (path: string, how?: FileOpenHow) => void;
  /** Closes the sidebar (the phone's drawer, once a file is opened). */
  onClose: () => void;
  /** A file or folder was dragged into another folder in the tree. */
  onEntryMoved: (from: string, to: string) => void;
  /** The search shortcut asked for the Files tab's search box. */
  searchFocusRequest: boolean;
  onSearchFocusHandled: () => void;
}

/**
 * A sidebar tab: an id (what ui-state remembers), its button's name and
 * icon, and the panel it opens. Plugins add tabs of the same shape.
 */
export interface SidebarTabDef {
  id: string;
  label: (t: Strings) => string;
  Icon: ComponentType;
  Panel: ComponentType<SidebarTabProps>;
}

function FilesPanel({
  t,
  openFolder,
  activePath,
  onOpenFile,
  onClose,
  onEntryMoved,
  searchFocusRequest,
  onSearchFocusHandled,
}: SidebarTabProps) {
  if (!openFolder.treeRoot)
    // No folder: the start page's three ways to begin, so a window with
    // nothing open is never a dead end.
    return (
      <div className="sidebar-start">
        <StartActions t={t} />
      </div>
    );
  return (
    <FileTree
      root={openFolder.treeRoot}
      onRootChange={openFolder.setTreeRoot}
      reveal={openFolder.revealed}
      folder={openFolder.folder}
      activePath={activePath}
      onFileSelect={(path, how) => {
        // On a phone the drawer covers the page it just opened.
        if (isIOSApp && window.matchMedia(PHONE_QUERY).matches) onClose();
        onOpenFile(path, how);
      }}
      onOpenAsFolder={canOpenFolder ? openFolder.openFolder : undefined}
      onCloseFolder={openFolder.closeFolder}
      onEntryMoved={onEntryMoved}
      searchFocusRequest={searchFocusRequest}
      onSearchFocusHandled={onSearchFocusHandled}
    />
  );
}

const BUILT_IN: SidebarTabDef[] = [
  {
    id: "tree",
    label: (t) => t.treeTab,
    Icon: TreeTabIcon,
    Panel: FilesPanel,
  },
  {
    id: "outline",
    label: (t) => t.outlineTab,
    Icon: OutlineTabIcon,
    Panel: ({ activeContent, activeTabId }) => (
      <Outline content={activeContent} tabId={activeTabId} />
    ),
  },
];

const added: SidebarTabDef[] = [];

/** The first tab, Files: where the sidebar opens with nothing remembered. */
export const DEFAULT_SIDEBAR_TAB = "tree";

/** Adds a tab after the built-in ones; the returned function takes it
 *  away again. An id already taken is refused. */
export function registerSidebarTab(tab: SidebarTabDef): () => void {
  if (sidebarTabs().some((t) => t.id === tab.id))
    throw new Error(`A sidebar tab "${tab.id}" is already registered.`);
  added.push(tab);
  return () => {
    const at = added.indexOf(tab);
    if (at >= 0) added.splice(at, 1);
  };
}

/** The tabs, in the header's order: as the user dragged them, a tab new
 *  since then where it comes. */
export function sidebarTabs(): SidebarTabDef[] {
  const kept = getUiState("sidebarTabOrder");
  return orderTabs([...BUILT_IN, ...added], Array.isArray(kept) ? kept : []);
}

/** `tabs` in `order`, those it doesn't name kept after the one before them. */
export function orderTabs<T extends { id: string }>(
  tabs: readonly T[],
  order: readonly string[],
): T[] {
  const out = order
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter((tab): tab is T => !!tab);
  tabs.forEach((tab, i) => {
    if (out.includes(tab)) return;
    const before = i > 0 ? out.indexOf(tabs[i - 1]) : -1;
    out.splice(before + 1, 0, tab);
  });
  return out;
}

/** The tabs' order after `id` is dropped on `target`'s place. */
export function moveSidebarTab(id: string, target: string): void {
  const ids = sidebarTabs().map((tab) => tab.id);
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  setUiState("sidebarTabOrder", ids);
}

/** The tab with this id, or Files for one no longer there. */
export function sidebarTab(id: string): SidebarTabDef {
  return sidebarTabs().find((t) => t.id === id) ?? BUILT_IN[0];
}
