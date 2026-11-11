import { getUiState, setUiState } from "../../storage/ui-state";
import {
  addedSidebarTabs,
  reserveSidebarTabIds,
} from "../../registry/sidebar-tabs";
import { StartActions } from "../StartActions";
import "../start-page.css";
import type { ComponentType } from "react";
import { FileTree } from "../../files/FileTree";
import { Outline } from "../../files/Outline";
import {
  TreeTabIcon,
  OutlineTabIcon,
  SearchIcon,
  PluginsTabIcon,
  SettingsIcon,
} from "../../engine/controls/icons";
import { Suspense } from "react";
import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";
import { isDesktopApp } from "../../platform/capabilities";
import { SearchPanel } from "../../files/SearchPanel";
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
  onOpenFile: (path: string, how?: FileOpenHow, line?: number) => void;
  /** Closes the sidebar (the phone's drawer, once a file is opened). */
  onClose: () => void;
  /** A file or folder was dragged into another folder in the tree. */
  onEntryMoved: (from: string, to: string) => void;
  /** The search shortcut asked for the Search tab's box. */
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
  /** Not among the rail's icons (Settings: the gear at its foot). */
  railFoot?: boolean;
}

function FilesPanel({
  t,
  openFolder,
  activePath,
  onOpenFile,
  onClose,
  onEntryMoved,
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
  {
    id: "search",
    label: (t) => t.searchTab,
    Icon: SearchIcon,
    Panel: ({
      t,
      openFolder,
      onOpenFile,
      searchFocusRequest,
      onSearchFocusHandled,
    }) =>
      // Over the folder the tree shows: the opened one, else the
      // document's.
      openFolder.treeRoot ? (
        <SearchPanel
          root={openFolder.folder ?? openFolder.treeRoot}
          onOpen={(path, line) => onOpenFile(path, undefined, line)}
          focusRequest={searchFocusRequest}
          onFocusHandled={onSearchFocusHandled}
        />
      ) : (
        <div className="tx-list-note">{t.searchNoFolder}</div>
      ),
  },
];

// The plugin list, loaded when the puzzle first opens it (it registers
// plugins' own sidebar tabs here, so not before).
const PluginsPanel = lazyComponent(
  lazyModule(
    "plugins-panel",
    () => import("../../settings/pages/PluginsPanel"),
  ),
  (m) => m.PluginsPanel,
);

/** Plugins: where they run, the desktop - the list and the ways to add one;
 *  a plugin's page opens in a tab of its own. Asked when the tabs are
 *  listed, not when this loads. */
const PLUGINS_TAB: SidebarTabDef = {
  id: "plugins",
  label: (t) => t.extensionsTabPlugins,
  Icon: PluginsTabIcon,
  Panel: ({ t }) => (
    <Suspense fallback={null}>
      <PluginsPanel t={t} />
    </Suspense>
  ),
};

const pluginsTab = () => (isDesktopApp ? [PLUGINS_TAB] : []);

// Settings' pages, loaded when the gear first opens them.
const SettingsNavPanel = lazyComponent(
  lazyModule(
    "settings-nav",
    () => import("../../settings/tab/SettingsNavPanel"),
  ),
  (m) => m.SettingsNavPanel,
);

/** Settings: its pages, opened by the rail's gear (desktop); the page
 *  picked shows in the window's Settings tab. */
const SETTINGS_TAB: SidebarTabDef = {
  id: "settings",
  label: (t) => t.settingsTitle,
  Icon: SettingsIcon,
  Panel: () => (
    <Suspense fallback={null}>
      <SettingsNavPanel />
    </Suspense>
  ),
  railFoot: true,
};
const settingsTab = () => (isIOSApp ? [] : [SETTINGS_TAB]);

/** The first tab, Files: where the sidebar opens with nothing remembered. */
export const DEFAULT_SIDEBAR_TAB = "tree";

/** Textus's own tabs (Files, Outline, Search, Plugins): always first,
 *  apart from the ones plugins add. */
export function isOwnTab(id: string): boolean {
  return (
    id === PLUGINS_TAB.id ||
    id === SETTINGS_TAB.id ||
    BUILT_IN.some((tab) => tab.id === id)
  );
}
reserveSidebarTabIds(isOwnTab);

/** The tabs, in the header's order: as the user dragged them, a tab new
 *  since then where it comes - Textus's own before any a plugin adds. */
export function sidebarTabs(): SidebarTabDef[] {
  const kept = getUiState("sidebarTabOrder");
  const all = orderTabs(
    [...BUILT_IN, ...pluginsTab(), ...settingsTab(), ...addedSidebarTabs()],
    Array.isArray(kept) ? kept : [],
  );
  return [
    ...all.filter((tab) => isOwnTab(tab.id)),
    ...all.filter((tab) => !isOwnTab(tab.id)),
  ];
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

/** The tabs' order after `id` is dropped on `target`'s place: within its
 *  own group, a plugin's never above Textus's. */
export function moveSidebarTab(id: string, target: string): void {
  const ids = sidebarTabs().map((tab) => tab.id);
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  if (isOwnTab(id) !== isOwnTab(target)) return;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  setUiState("sidebarTabOrder", ids);
}

/** The tab with this id, or Files for one no longer there. */
export function sidebarTab(id: string): SidebarTabDef {
  return sidebarTabs().find((t) => t.id === id) ?? BUILT_IN[0];
}
