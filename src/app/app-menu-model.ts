import { APP_NAME, type Strings } from "../i18n/strings";
import type { HeadingAction, Shortcuts } from "../settings/SettingsContext";
import { basename } from "../utils/path";

/**
 * The app menu, as data - what `AppMenu.tsx` draws where the app owns its
 * window frame and there is no native menu bar left (Windows; see
 * platform/window-chrome.ts).
 *
 * Every entry that reaches the backend carries the SAME id its native twin
 * in src-tauri/src/menu.rs was built with, and `trigger_menu_item` there
 * runs it through the one dispatch the native click path uses. So the ids
 * are the contract between the two files: labels, order and grouping are
 * this file's business, behaviour is menu.rs's, and neither can quietly
 * change the other.
 *
 * The layout deliberately does NOT mirror the macOS menu bar. It is the one
 * Windows apps use: no application submenu (About lives in Settings, where
 * the version and update check already are), no Window submenu (New Window
 * belongs in File, and minimise/maximise are the caption buttons two
 * centimetres to the right), and Settings/Exit sit at the root of the
 * popover the way Edge's and VS Code's do.
 */

/** Menu ids that exist natively (src-tauri/src/menu.rs) - listed here so a
 *  typo is a compile error rather than an item that silently does nothing. */
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
  | "toggle-source-mode"
  | "toggle-typewriter-mode"
  | "toggle-sidebar"
  | "toggle-agent-panel"
  | "toggle-split-view"
  | "toggle-zen-mode"
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
  // The phone menu's own (buildMobileMenu): emitted by emitMenuEvent, with
  // no menu.rs counterpart.
  | "share"
  | "documents";

/**
 * The handful of items with no native id to send.
 *
 * They were `PredefinedMenuItem`s in the native menu - muda generates their
 * ids, so there is nothing stable to address them by, and no API to fire one
 * from outside a click. The frontend already implements every one of them
 * (the editor's own clipboard helpers, prosemirror history, the window API),
 * so the app-drawn menu calls that directly instead.
 */
export type LocalMenuAction =
  "undo" | "redo" | "cut" | "copy" | "paste" | "select-all" | "fullscreen";

type MenuAction = { native: NativeMenuId } | { local: LocalMenuAction };

export interface MenuEntry {
  label: string;
  /** A stored combo string ("mod+shift+s"), rendered with formatCombo. Only
   *  set it where the combo really is bound - a hint for a shortcut that
   *  does nothing is worse than no hint. */
  accel?: string;
  /** Native tooltip, for entries whose label had to be shortened. */
  title?: string;
  action?: MenuAction;
  submenu?: MenuNode[];
  disabled?: boolean;
  /** An on/off mode, named by the thing itself ("Sidebar", "Zen Mode" -
   *  never "Toggle ..."): a check mark at the row's trailing edge shows
   *  when it is on. Leave unset for plain actions. */
  checked?: boolean;
}

/** Which view modes are on, for the check marks beside them. */
export interface MenuChecks {
  sidebar?: boolean;
  agentPanel?: boolean;
  sourceMode?: boolean;
  splitView?: boolean;
  typewriter?: boolean;
  zen?: boolean;
  fullscreen?: boolean;
  /** Not a check mark: a folder is open, so Close Folder has something to
   *  close. The macOS menu bar keeps it enabled (it is app-wide). */
  folderOpen?: boolean;
}

export type MenuNode = MenuEntry | "separator";

/**
 * The same states for the macOS menu bar, keyed by native menu id, for
 * menu.rs's set_menu_checks: there the View items are NSMenu check items,
 * which draw AppKit's own mark. Full Screen is left out - AppKit names and
 * marks its own fullscreen item.
 */
export function nativeMenuChecks(checks: MenuChecks): Record<string, boolean> {
  return {
    "toggle-sidebar": !!checks.sidebar,
    "toggle-agent-panel": !!checks.agentPanel,
    "toggle-source-mode": !!checks.sourceMode,
    "toggle-split-view": !!checks.splitView,
    "toggle-typewriter-mode": !!checks.typewriter,
    "toggle-zen-mode": !!checks.zen,
  };
}

/** What File > Open Recent lists (menu.rs's recents), most recent first. */
export interface RecentLists {
  files: string[];
  /** Opened with File > Open Folder…; listed above the files. */
  folders: string[];
}

export const NO_RECENTS: RecentLists = { files: [], folders: [] };

/** Recent files are listed by name, with the full path on hover - a Windows
 *  home directory eats most of the width of `C:\Users\...\notes.md`, and two
 *  files can share a name. A folder's name ends in a separator, as in the
 *  native menu, to tell it from the files below it. */
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

/** Same format list, in the same order, as menu.rs's EXPORT_PANDOC_PREFIX
 *  loop and the frontend's PANDOC_FORMATS (export/exporters.ts). */
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
    // Unbound unless the user binds one in Settings › Shortcuts.
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

export function buildAppMenu(
  t: Strings,
  shortcuts: Shortcuts,
  recents: RecentLists,
  checks: MenuChecks = {},
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
          // Ctrl+Shift+N, as Cmd+Shift+N on macOS: Ctrl+T is "new tab"
          // to anyone from a browser and this app has tabs. Bound to match
          // in menu.rs (NEW_WINDOW_ACCEL).
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
        // Ctrl+Y is the redo Windows advertises; milkdown's history keymap
        // binds "Mod-y" alongside "Shift-Mod-z", so both really work and this
        // shows the one the platform expects.
        { label: t.menuRedo, accel: "mod+y", action: { local: "redo" } },
        "separator",
        { label: t.cut, accel: "mod+x", action: { local: "cut" } },
        { label: t.copy, accel: "mod+c", action: { local: "copy" } },
        { label: t.paste, accel: "mod+v", action: { local: "paste" } },
        { label: t.selectAll, accel: "mod+a", action: { local: "select-all" } },
        "separator",
        {
          label: t.menuFindReplace,
          accel: shortcuts.findReplace,
          action: { native: "find-replace" },
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
        // muda's predefined fullscreen item is documented as unsupported on
        // Windows, which is why this runs the window API here instead of
        // dispatching a menu id. F11 is bound to the same action by App.tsx's
        // keydown handler rather than by a native accelerator, for the same
        // reason - there is no native item to hang one on.
        {
          label: t.menuFullscreen,
          accel: "f11",
          action: { local: "fullscreen" },
          checked: !!checks.fullscreen,
        },
      ],
    },
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
    // Alt+F4, not the Cmd+Q this has on macOS - Ctrl+Q closes nothing on
    // Windows and menu.rs deliberately no longer registers it. The hint is
    // the OS's own: Alt+F4 closes the focused window, which for the usual
    // single window is exactly this item; with several windows open this
    // one closes them all and Alt+F4 closes the front one.
    { label: t.menuExit, accel: "alt+f4", action: { native: "quit" } },
  ];
}

/**
 * The iPhone's menu, behind the title row's button. One flat list: a
 * flyout has nowhere to go on a 400-point-wide screen, and most of the
 * desktop menu is not there to offer - windows, exports through PDF or
 * pandoc, zoom (pinch), split view (no room for two panes). Undo is on
 * the keyboard toolbar (mobile/KeyboardToolbar.tsx), the clipboard in the
 * system's long-press menu. Recent documents have their own page
 * (Documents, mobile/DocumentList.tsx).
 */
export function buildMobileMenu(
  t: Strings,
  checks: MenuChecks = {},
): MenuNode[] {
  // Kept short: the file actions, then what is reached for while writing.
  // The view modes and the guides live in Settings (General > Help,
  // Editor > View), where a phone has room to say what each one does.
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
    "separator",
    { label: t.menuSettings, action: { native: "settings" } },
  ];
}

/**
 * The macOS menu bar's labels, for menu.rs's set_menu_labels: the bar is
 * native there and built in Rust, in English unless sent these. Keyed by
 * native menu id - the app-drawn menu's own labels for the same ids, so
 * the two menus say the same thing - plus "menu:<name>" for each submenu
 * and "predefined:<name>" for the items muda makes (menu.rs's build).
 */
export function nativeMenuLabels(t: Strings): Record<string, string> {
  const labels: Record<string, string> = {};
  const collect = (nodes: MenuNode[]) => {
    for (const node of nodes) {
      if (node === "separator") continue;
      if (node.action && "native" in node.action)
        labels[node.action.native] = node.label;
      if (node.submenu) collect(node.submenu);
    }
  };
  // Accelerators play no part in a label.
  collect(buildAppMenu(t, {} as Shortcuts, NO_RECENTS));
  const named = (template: string) => template.replace("{name}", APP_NAME);
  return {
    ...labels,
    // macOS says Quit where Windows says Exit.
    quit: named(t.menuQuit),
    "recent-none": t.menuRecentNone,
    "recent-clear": t.menuRecentClear,
    "menu:file": t.menuFile,
    "menu:open-recent": t.menuOpenRecent,
    "menu:export": t.menuExport,
    "menu:edit": t.menuEdit,
    "menu:format": t.menuFormat,
    "menu:view": t.menuView,
    "menu:window": t.menuWindow,
    "menu:help": t.menuHelp,
    "predefined:about": named(t.menuAbout),
    "predefined:hide": named(t.menuHide),
    "predefined:hide-others": t.menuHideOthers,
    "predefined:show-all": t.menuShowAll,
    "predefined:undo": t.menuUndo,
    "predefined:redo": t.menuRedo,
    "predefined:cut": t.cut,
    "predefined:copy": t.copy,
    "predefined:paste": t.paste,
    "predefined:select-all": t.selectAll,
    "predefined:fullscreen": t.menuFullscreen,
    "predefined:minimize": t.windowMinimize,
    "predefined:maximize": t.menuZoomWindow,
    "predefined:bring-all-to-front": t.menuBringAllToFront,
  };
}
