import type { ComponentType } from "react";
import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { ClipboardHistory } from "../sidebar/ClipboardHistory";
import { TreeTabIcon, OutlineTabIcon, ClipboardTabIcon } from "../ui/icons";
import { canOpenFolder, isIOSApp } from "../platform/capabilities";
import { PHONE_QUERY } from "../ui/usePhoneLayout";
import type { Strings } from "../i18n/strings";
import type { OpenFolder } from "./useOpenFolder";

/** What every sidebar tab's panel is given: the window's document and
 *  folder, and its ways to open a file or close the sidebar. */
export interface SidebarTabProps {
  t: Strings;
  /** The tree's root and the opened folder (useOpenFolder.ts). */
  openFolder: OpenFolder;
  activePath: string | null;
  activeContent: string;
  onOpenFile: (path: string) => void;
  /** Closes the sidebar (the phone's drawer, once a file is opened). */
  onClose: () => void;
  /** A file or folder was dragged into another folder in the tree. */
  onEntryMoved: (from: string, to: string) => void;
  /** The search shortcut asked for the Files tab's search box. */
  searchFocusRequest: boolean;
  onSearchFocusHandled: () => void;
}

/**
 * The sidebar's tabs, in the order its header shows them (Sidebar.tsx): an
 * id - what ui-state remembers as the tab last shown - the name its button
 * is called by, its icon, and the panel it opens. The shape a plugin's
 * own tab will take (docs/dev/plugin-api.md): registerSidebarTab adds one
 * after the built-in tabs.
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
    // An unsaved draft has no folder - an empty panel read as broken.
    // File > Open Folder… is the way to one; a button for it here sat
    // oddly under the note.
    return <div className="clipboard-empty">{t.treeEmptyDraft}</div>;
  return (
    <FileTree
      root={openFolder.treeRoot}
      onRootChange={openFolder.setTreeRoot}
      folder={openFolder.folder}
      activePath={activePath}
      onFileSelect={(path) => {
        // On a phone the drawer covers the page it just opened
        // (mobile/styles); a docked one stays.
        if (isIOSApp && window.matchMedia(PHONE_QUERY).matches) onClose();
        onOpenFile(path);
      }}
      onOpenFolder={canOpenFolder ? openFolder.openFolderDialog : undefined}
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
    Panel: ({ activeContent }) => <Outline content={activeContent} />,
  },
  {
    id: "clipboard",
    label: (t) => t.clipboardTab,
    Icon: ClipboardTabIcon,
    Panel: () => <ClipboardHistory />,
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

/** The tabs, in the header's order. */
export function sidebarTabs(): SidebarTabDef[] {
  return [...BUILT_IN, ...added];
}

/** The tab with this id, or Files for one no longer there. */
export function sidebarTab(id: string): SidebarTabDef {
  return sidebarTabs().find((t) => t.id === id) ?? BUILT_IN[0];
}
