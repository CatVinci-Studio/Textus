import TABLE from "./menu.json";
import type { Shortcuts } from "../../prefs/SettingsContext";
import type { StringKey, Strings } from "../../i18n/strings";

/**
 * The menu bar as data (menu.json), read by Rust's native bar (menu/table.rs)
 * and by the app-drawn menu: ids, order, keys and labels in one place.
 */

/** Where the app-drawn menu differs from the native bar. */
export interface DrawnOverride {
  label?: StringKey;
  keys?: string;
  /** Moved out of a menu the app-drawn bar lacks: the end of File, or after
   *  the menus (Settings…, Exit). */
  in?: "file" | "end";
  check?: boolean;
}

export interface TableItem {
  id?: string;
  /** One of the OS's own items (Cut, Hide, Minimize…), run in place where
   *  the menu is drawn. */
  predefined?: string;
  label: StringKey;
  /** Added to the label ("…"). */
  suffix?: string;
  en: string;
  keys?: string;
  keysOff?: string[];
  /** Only on these platforms' native bars. */
  on?: string[];
  macOwn?: boolean;
  /** Settings › Shortcuts' action whose key it shows. */
  setting?: keyof Shortcuts;
  check?: boolean;
  orOpen?: boolean;
  drawn?: DrawnOverride;
}

export interface TableMenu {
  menu: string;
  label?: StringKey;
  en: string;
  /** False: the native bar only (the app menu, Window). */
  drawn?: boolean;
  items: TableNode[];
}

export type TableSection = "recent" | "pandoc" | "headings" | "plugins";

export type TableNode =
  | "-"
  | { sep: true; on: string[] }
  | { section: TableSection }
  | TableMenu
  | TableItem;

interface Table {
  bar: TableMenu[];
  texts: { key: string; label: StringKey; en: string }[];
}

export const MENU_TABLE = TABLE as unknown as Table;

export const isMenu = (node: TableNode): node is TableMenu =>
  typeof node === "object" && "menu" in node;
export const isSection = (node: TableNode): node is { section: TableSection } =>
  typeof node === "object" && "section" in node;
export const isSeparator = (node: TableNode): boolean =>
  node === "-" || (typeof node === "object" && "sep" in node);

/** The key Rust looks a label up by: the id, or "predefined:<name>". */
export function labelKey(item: TableItem): string {
  return item.id ?? `predefined:${item.predefined}`;
}

/** A label of the table in the UI's language (menu labels are no plurals). */
export function menuText(t: Strings, key: StringKey): string {
  return t[key] as string;
}
