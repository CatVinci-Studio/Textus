import type { Strings } from "../../i18n/strings";
import type { Shortcuts } from "../../prefs/SettingsContext";
import { type PluginMenuEntry } from "./plugin-menu";

import {
  headingEntries,
  pandocEntries,
  pluginEntries,
  pluginsMenu,
  recentEntries,
} from "./app-menu-sections";
import {
  MENU_TABLE,
  isMenu,
  isSection,
  isSeparator,
  menuText,
  type TableItem,
  type TableNode,
  type TableSection,
} from "./menu-table";
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
  | "copy-path"
  | "close-tab"
  | "reopen-closed-tab"
  | "close-window"
  | "quit"
  | "find-replace"
  | "replace"
  | "find-next"
  | "insert-link"
  | "copy-as-plain-text"
  | "paste-as-plain-text"
  | "toggle-source-mode"
  | "view-mode-default"
  | "toggle-typewriter-mode"
  | "track-changes"
  | "toggle-sidebar"
  | "toggle-agent-panel"
  | "toggle-format-bar"
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
  | `toggle-mark:${string}`
  | `help-doc:${string}`
  | "help-community"
  | "help-report"
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
  formatBar?: boolean;
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
  /** Not a check mark: the document's word count, which the phone's menu
   *  shows when its title row has no room for it. */
  words?: number;
}

export type MenuNode = MenuEntry | "separator";

/**
 * The same states keyed by native menu id, for the macOS check items. Full
 * Screen is left out: AppKit marks its own.
 */
export function nativeMenuChecks(checks: MenuChecks): Record<string, boolean> {
  const mode = viewModeChecks(checks);
  return {
    "toggle-sidebar": !!checks.sidebar,
    "toggle-agent-panel": !!checks.agentPanel,
    "toggle-format-bar": !!checks.formatBar,
    "view-mode-default": mode.default,
    "toggle-source-mode": mode.source,
    "toggle-split-view": mode.split,
    "toggle-typewriter-mode": !!checks.typewriter,
    "toggle-zen-mode": !!checks.zen,
    "toggle-read-only": mode.readOnly,
    "track-changes": !!checks.trackChanges,
  };
}

/** View › Mode's one check: read-only first, it is the document's. */
function viewModeChecks(checks: MenuChecks) {
  const readOnly = !!checks.readOnly;
  return {
    default: !readOnly && !checks.sourceMode && !checks.splitView,
    source: !readOnly && !!checks.sourceMode,
    split: !readOnly && !!checks.splitView,
    readOnly,
  };
}

/** What File > Open Recent lists, most recent first. */
export interface RecentLists {
  files: string[];
  /** Opened with File > Open Folder…; listed above the files. */
  folders: string[];
}

export const NO_RECENTS: RecentLists = { files: [], folders: [] };

/** Entries that stay off unless something is open or on. */
const DISABLED: Record<string, (checks: MenuChecks) => boolean> = {
  "close-folder": (checks) => !checks.folderOpen,
  "toggle-agent-panel": (checks) => checks.textusAi === false,
};

/** The app-drawn menu (Windows, Linux), from the same table as the macOS
 *  bar: menus the drawn bar lacks give up their items to File or the end. */
export function buildAppMenu(
  t: Strings,
  shortcuts: Shortcuts,
  recents: RecentLists,
  checks: MenuChecks = {},
  plugins: readonly PluginMenuEntry[] = [],
): MenuNode[] {
  const native = nativeMenuChecks(checks);
  const moved: Record<"file" | "end", MenuNode[]> = { file: [], end: [] };
  const section = (name: TableSection): MenuNode[] =>
    name === "recent"
      ? recentEntries(t, recents)
      : name === "pandoc"
        ? pandocEntries(t)
        : name === "headings"
          ? headingEntries(t, shortcuts)
          : pluginEntries(t, plugins);
  const entry = (item: TableItem): MenuEntry => {
    const drawn = item.drawn ?? {};
    const id = item.id ?? "";
    const accel =
      drawn.keys ??
      (item.setting ? shortcuts[item.setting] || undefined : item.keys);
    const checked = item.check
      ? !!native[id]
      : drawn.check
        ? !!checks.fullscreen
        : undefined;
    return {
      label: menuText(t, drawn.label ?? item.label) + (item.suffix ?? ""),
      ...(accel ? { accel } : {}),
      action: item.predefined
        ? { local: item.predefined as LocalMenuAction }
        : { native: id as NativeMenuId },
      ...(checked === undefined ? {} : { checked }),
      ...(DISABLED[id] ? { disabled: DISABLED[id](checks) } : {}),
    };
  };
  const nodes = (items: TableNode[], shown: boolean): MenuNode[] =>
    tidy(
      items.flatMap((node): MenuNode[] => {
        if (isSeparator(node)) return ["separator"];
        if (isSection(node)) return section(node.section);
        if (isMenu(node))
          return [
            {
              label: menuText(t, node.label!),
              submenu: nodes(node.items, shown),
            },
          ];
        const item = node as TableItem;
        if (item.drawn?.in) {
          moved[item.drawn.in].push(entry(item));
          return [];
        }
        return shown && (!item.on || item.drawn) ? [entry(item)] : [];
      }),
    );
  const menus = MENU_TABLE.bar.flatMap((menu): MenuNode[] => {
    const items = nodes(menu.items, menu.drawn !== false);
    return menu.drawn === false
      ? []
      : [{ label: menuText(t, menu.label!), submenu: items }];
  });
  const file = menus[0] as MenuEntry;
  file.submenu = [...file.submenu!, ...moved.file];
  return [...menus, "separator", ...moved.end];
}

/** No separator first, last or twice in a row. */
function tidy(nodes: MenuNode[]): MenuNode[] {
  return nodes.filter(
    (node, i) =>
      node !== "separator" ||
      (i > 0 && i < nodes.length - 1 && nodes[i + 1] !== "separator"),
  );
}

/** One of the menu bar's titles and the list it opens. */
interface MenuBarSection {
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
  plugins: readonly PluginMenuEntry[] = [],
  /** Textus AI is offered on this install. */
  ai = true,
): MenuNode[] {
  const words = checks.words;
  return [
    ...(words
      ? [
          {
            label: `${words} ${words === 1 ? t.wordUnit : t.wordsUnit}`,
            disabled: true,
          },
          "separator" as const,
        ]
      : []),
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
    ...(ai
      ? [
          {
            label: t.menuTextusAi,
            action: { native: "toggle-textus-ai" },
            checked: checks.textusAi !== false,
          } as MenuNode,
        ]
      : []),
    "separator",
    ...pluginsMenu(t, plugins),
    { label: t.menuSettings, action: { native: "settings" } },
  ];
}
