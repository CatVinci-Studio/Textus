import { PLUGINS_SHOWN } from "../../plugins/store/availability";
import type { Strings } from "../../i18n/strings";
import type { HeadingAction, Shortcuts } from "../../settings/SettingsContext";
import { basename } from "../../utils/path";

/**
 * The app-drawn menu, as data, for windows with no native menu bar. Entries
 * that reach the backend use the same ids as the native menu.
 */

/** Native menu ids, typed so a typo is a compile error. */
export type NativeMenuId =
  | "settings"
  | "new-file"
  | "new-window"
  | "open-file"
  | "open-folder"
  | "close-folder"
  | "recent-clear"
  | "save-file"
  | "save-file-as"
  | "export-pdf"
  | "export-html"
  | "close-tab"
  | "close-window"
  | "quit"
  | "find-replace"
  | "copy-as-plain-text"
  | "paste-as-plain-text"
  | "toggle-source-mode"
  | "toggle-typewriter-mode"
  | "track-changes"
  | "toggle-sidebar"
  | "toggle-agent-panel"
  | "toggle-textus-ai"
  | "toggle-split-view"
  | "toggle-read-only"
  | "toggle-zen-mode"
  | "split-right"
  | "split-down"
  | "close-split"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | `recent:${string}`
  | `recent-folder:${string}`
  | `export-pandoc:${string}`
  | `insert-block:${string}`
  | `help-doc:${string}`
  | "help-community"
  | "help-tutorials"
  | "manage-plugins"
  | "command-palette"
  | `plugin-command:${string}`
  // Phone menu only, with no native counterpart.
  | "share"
  | "documents";

/**
 * Items with no native id: their native twins are predefined items with
 * generated ids, so the frontend runs them directly.
 */
export type LocalMenuAction =
  "undo" | "redo" | "cut" | "copy" | "paste" | "select-all" | "fullscreen";

export type MenuAction = { native: NativeMenuId } | { local: LocalMenuAction };

export interface MenuEntry {
  label: string;
  /** A stored combo string ("mod+shift+s"). Set only where the combo is
   *  really bound. */
  accel?: string;
  /** Native tooltip, for entries whose label had to be shortened. */
  title?: string;
  action?: MenuAction;
  submenu?: MenuNode[];
  disabled?: boolean;
  /** An on/off mode, named by the thing itself ("Sidebar", never
   *  "Toggle ..."); shows a check mark when on. */
  checked?: boolean;
}

/** Which view modes are on, for the check marks beside them. */
export interface MenuChecks {
  sidebar?: boolean;
  agentPanel?: boolean;
  /** Textus AI's master switch; unset counts as on. */
  textusAi?: boolean;
  sourceMode?: boolean;
  splitView?: boolean;
  typewriter?: boolean;
  zen?: boolean;
  /** The document on screen can't be changed. */
  readOnly?: boolean;
  /** The document on screen tracks the writer's changes (Edit). */
  trackChanges?: boolean;
  fullscreen?: boolean;
  /** Not a check mark: a folder is open, so Close Folder has something to
   *  close. */
  folderOpen?: boolean;
}

export type MenuNode = MenuEntry | "separator";

/**
 * The same states keyed by native menu id, for the macOS check items. Full
 * Screen is left out: AppKit marks its own.
 */
export function nativeMenuChecks(checks: MenuChecks): Record<string, boolean> {
  return {
    "toggle-sidebar": !!checks.sidebar,
    "toggle-agent-panel": !!checks.agentPanel,
    "toggle-source-mode": !!checks.sourceMode,
    "toggle-split-view": !!checks.splitView,
    "toggle-typewriter-mode": !!checks.typewriter,
    "toggle-zen-mode": !!checks.zen,
    "toggle-read-only": !!checks.readOnly,
    "track-changes": !!checks.trackChanges,
  };
}

/** A command a plugin put in the Plugins menu. */
export interface PluginMenuEntry {
  command: string;
  label: string;
}

/** What File > Open Recent lists, most recent first. */
export interface RecentLists {
  files: string[];
  /** Opened with File > Open Folder…; listed above the files. */
  folders: string[];
}

export const NO_RECENTS: RecentLists = { files: [], folders: [] };

/** Recent files by name, full path on hover. A folder's name ends in a
 *  separator to tell it from the files. */
function recentEntries(t: Strings, recents: RecentLists): MenuNode[] {
  const { files, folders } = recents;
  if (files.length === 0 && folders.length === 0) {
    return [{ label: t.menuRecentNone, disabled: true }];
  }
  const folderNodes = folders.map((path): MenuNode => {
    const trimmed = path.replace(/[\\/]+$/, "");
    const sep = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
    return {
      label: `${basename(trimmed) || trimmed}${sep}`,
      title: path,
      action: { native: `recent-folder:${path}` },
    };
  });
  const fileNodes = files.map((path): MenuNode => ({
    label: basename(path) || path,
    title: path,
    action: { native: `recent:${path}` },
  }));
  return [
    ...folderNodes,
    ...(folderNodes.length && fileNodes.length ? ["separator" as const] : []),
    ...fileNodes,
    "separator",
    { label: t.menuRecentClear, action: { native: "recent-clear" } },
  ];
}

/** Keep in step with the native menu's pandoc export list. */
function exportEntries(t: Strings): MenuNode[] {
  const pandoc: [string, string][] = [
    ["docx", t.menuExportDocx],
    ["odt", t.menuExportOdt],
    ["rtf", t.menuExportRtf],
    ["epub", t.menuExportEpub],
    ["latex", t.menuExportLatex],
    ["mediawiki", t.menuExportMediawiki],
    ["rst", t.menuExportRst],
    ["textile", t.menuExportTextile],
    ["opml", t.menuExportOpml],
  ];
  return [
    {
      label: t.menuExportPdf,
      accel: "mod+p",
      action: { native: "export-pdf" },
    },
    { label: t.menuExportHtml, action: { native: "export-html" } },
    "separator",
    ...pandoc.map(([format, label]): MenuNode => ({
      label,
      action: { native: `export-pandoc:${format}` },
    })),
  ];
}

function formatEntries(t: Strings, shortcuts: Shortcuts): MenuNode[] {
  const headings = [1, 2, 3, 4, 5, 6].map((level): MenuNode => ({
    label: t.menuHeadingTemplate.replace("{n}", String(level)),
    accel: shortcuts[`setHeading${level}` as HeadingAction] || undefined,
    action: { native: `insert-block:h${level}` },
  }));
  const blocks: [string, string][] = [
    ["bullet-list", t.menuBulletList],
    ["ordered-list", t.menuOrderedList],
    ["blockquote", t.menuBlockquote],
    ["code-block", t.menuCodeBlock],
    ["table", t.menuTable],
  ];
  return [
    ...headings,
    "separator",
    ...blocks.map(([kind, label]): MenuNode => ({
      label,
      action: { native: `insert-block:${kind}` },
    })),
  ];
}

/** The Plugins menu: plugin commands, then Manage Plugins…; none where the
 *  app doesn't show plugins. */
function pluginsMenu(
  t: Strings,
  plugins: readonly PluginMenuEntry[],
): MenuNode[] {
  if (!PLUGINS_SHOWN) return [];
  return [
    {
      label: t.menuPlugins,
      submenu: [
        ...(plugins.length
          ? plugins.map((p): MenuEntry => ({
              label: p.label,
              action: { native: `plugin-command:${p.command}` },
            }))
          : [{ label: t.menuNoPluginCommands, disabled: true }]),
        "separator",
        { label: t.menuManagePlugins, action: { native: "manage-plugins" } },
      ],
    },
  ];
}

export function buildAppMenu(
  t: Strings,
  shortcuts: Shortcuts,
  recents: RecentLists,
  checks: MenuChecks = {},
  plugins: readonly PluginMenuEntry[] = [],
): MenuNode[] {
  return [
    {
      label: t.menuFile,
      submenu: [
        {
          label: t.menuNewFile,
          accel: "mod+n",
          action: { native: "new-file" },
        },
        {
          // Ctrl+T means "new tab" to anyone from a browser, and this app
          // has tabs.
          label: t.menuNewWindow,
          accel: "mod+shift+n",
          action: { native: "new-window" },
        },
        {
          label: t.menuOpenFile,
          accel: "mod+o",
          action: { native: "open-file" },
        },
        { label: t.menuOpenFolder, action: { native: "open-folder" } },
        { label: t.menuOpenRecent, submenu: recentEntries(t, recents) },
        {
          label: t.menuCloseFolder,
          action: { native: "close-folder" },
          disabled: !checks.folderOpen,
        },
        "separator",
        { label: t.menuSave, accel: "mod+s", action: { native: "save-file" } },
        {
          label: t.menuSaveAs,
          accel: "mod+shift+s",
          action: { native: "save-file-as" },
        },
        { label: t.menuExport, submenu: exportEntries(t) },
        "separator",
        {
          label: t.menuCloseTab,
          accel: "mod+w",
          action: { native: "close-tab" },
        },
        {
          label: t.menuCloseWindow,
          accel: "mod+shift+w",
          action: { native: "close-window" },
        },
      ],
    },
    {
      label: t.menuEdit,
      submenu: [
        { label: t.menuUndo, accel: "mod+z", action: { local: "undo" } },
        // Ctrl+Y is the redo Windows advertises; the history keymap binds
        // both.
        { label: t.menuRedo, accel: "mod+y", action: { local: "redo" } },
        "separator",
        { label: t.cut, accel: "mod+x", action: { local: "cut" } },
        { label: t.copy, accel: "mod+c", action: { local: "copy" } },
        { label: t.copyAsPlainText, action: { native: "copy-as-plain-text" } },
        { label: t.paste, accel: "mod+v", action: { local: "paste" } },
        {
          label: t.pasteAsPlainText,
          accel: "mod+shift+v",
          action: { native: "paste-as-plain-text" },
        },
        { label: t.selectAll, accel: "mod+a", action: { local: "select-all" } },
        "separator",
        {
          label: t.menuFindReplace,
          accel: shortcuts.findReplace,
          action: { native: "find-replace" },
        },
        "separator",
        {
          label: t.menuTrackChanges,
          action: { native: "track-changes" },
          checked: !!checks.trackChanges,
        },
      ],
    },
    { label: t.menuFormat, submenu: formatEntries(t, shortcuts) },
    {
      label: t.menuView,
      submenu: [
        {
          label: t.menuToggleSidebar,
          accel: shortcuts.toggleSidebar,
          action: { native: "toggle-sidebar" },
          checked: !!checks.sidebar,
        },
        {
          label: t.menuToggleAgentPanel,
          accel: shortcuts.toggleAgentPanel,
          action: { native: "toggle-agent-panel" },
          checked: !!checks.agentPanel,
          disabled: checks.textusAi === false,
        },
        "separator",
        {
          label: t.menuToggleSourceMode,
          accel: shortcuts.toggleSourceMode,
          action: { native: "toggle-source-mode" },
          checked: !!checks.sourceMode,
        },
        {
          label: t.menuToggleSplitView,
          accel: shortcuts.toggleSplitView,
          action: { native: "toggle-split-view" },
          checked: !!checks.splitView,
        },
        {
          label: t.menuToggleTypewriterMode,
          accel: shortcuts.toggleTypewriterMode,
          action: { native: "toggle-typewriter-mode" },
          checked: !!checks.typewriter,
        },
        {
          label: t.menuToggleZenMode,
          accel: shortcuts.toggleZenMode,
          action: { native: "toggle-zen-mode" },
          checked: !!checks.zen,
        },
        {
          label: t.menuToggleReadOnly,
          action: { native: "toggle-read-only" },
          checked: !!checks.readOnly,
        },
        "separator",
        {
          label: t.menuCommandPalette,
          accel: shortcuts.commandPalette,
          action: { native: "command-palette" },
        },
        "separator",
        {
          label: t.menuSplitRight,
          accel: shortcuts.splitEditor,
          action: { native: "split-right" },
        },
        { label: t.menuSplitDown, action: { native: "split-down" } },
        { label: t.menuCloseSplit, action: { native: "close-split" } },
        "separator",
        { label: t.menuZoomIn, accel: "mod+=", action: { native: "zoom-in" } },
        {
          label: t.menuZoomOut,
          accel: "mod+-",
          action: { native: "zoom-out" },
        },
        {
          label: t.menuZoomReset,
          accel: "mod+0",
          action: { native: "zoom-reset" },
        },
        "separator",
        // The predefined fullscreen item is unsupported on Windows, so this
        // calls the window API directly.
        {
          label: t.menuFullscreen,
          accel: "f11",
          action: { local: "fullscreen" },
          checked: !!checks.fullscreen,
        },
      ],
    },
    ...pluginsMenu(t, plugins),
    {
      label: t.menuHelp,
      submenu: [
        {
          label: t.menuHelpWelcome,
          action: { native: "help-doc:welcome" },
        },
        "separator",
        { label: t.menuHelpMarkdown, action: { native: "help-doc:markdown" } },
        { label: t.menuHelpAgent, action: { native: "help-doc:agent" } },
        { label: t.menuHelpTutorials, action: { native: "help-tutorials" } },
        "separator",
        {
          label: t.menuHelpCommunity,
          action: { native: "help-community" },
        },
      ],
    },
    "separator",
    { label: t.menuSettings, accel: "mod+,", action: { native: "settings" } },
    // Ctrl+Q closes nothing on Windows; Alt+F4 is the OS's own hint.
    { label: t.menuExit, accel: "alt+f4", action: { native: "quit" } },
  ];
}

/** One of the menu bar's titles and the list it opens. */
export interface MenuBarSection {
  label: string;
  items: MenuNode[];
}

/**
 * The menu as a bar of titles. Entries without a submenu (Settings…, Exit)
 * go to the end of File, as in a Windows app.
 */
export function menuBarSections(menu: MenuNode[]): MenuBarSection[] {
  const sections: MenuBarSection[] = [];
  const loose: MenuNode[] = [];
  for (const node of menu) {
    if (node === "separator") continue;
    if (node.submenu) sections.push({ label: node.label, items: node.submenu });
    else loose.push(node);
  }
  const [first] = sections;
  if (first && loose.length)
    first.items = [...first.items, "separator", ...loose];
  return sections;
}

/**
 * The iPhone's menu: one flat list, with only what a phone needs.
 */
export function buildMobileMenu(
  t: Strings,
  checks: MenuChecks = {},
): MenuNode[] {
  return [
    { label: t.menuDocuments, action: { native: "documents" } },
    { label: t.menuNewFile, action: { native: "new-file" } },
    { label: t.menuOpenFile, action: { native: "open-file" } },
    { label: t.menuSave, action: { native: "save-file" } },
    { label: t.menuShare, action: { native: "share" } },
    "separator",
    { label: t.menuFindReplace, action: { native: "find-replace" } },
    {
      label: t.menuViewSidebar,
      action: { native: "toggle-sidebar" },
      checked: !!checks.sidebar,
    },
    {
      label: t.menuTextusAi,
      action: { native: "toggle-textus-ai" },
      checked: checks.textusAi !== false,
    },
    "separator",
    { label: t.menuSettings, action: { native: "settings" } },
  ];
}
