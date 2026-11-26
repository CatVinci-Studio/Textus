import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../utils/store";
import { appearanceIsDark, onAppearance } from "../tokens/appearance";

/**
 * The file icon theme in use (a plugin's `contributes.fileIconThemes`, the
 * one chosen in Settings › Appearance): icon URLs by file name, extension
 * and folder name, already looked up into maps so a row costs a few `get`s.
 * None chosen, every row keeps the app's own icons.
 */

/** One appearance's icons, every key lowercase, every value a URL. */
export interface IconTable {
  fileNames: ReadonlyMap<string, string>;
  /** Without the dot; "d.ts" as well as "ts". */
  fileExtensions: ReadonlyMap<string, string>;
  folderNames: ReadonlyMap<string, string>;
  folderNamesExpanded: ReadonlyMap<string, string>;
  file?: string;
  folder?: string;
  folderExpanded?: string;
}

export interface FileIconTheme {
  dark: IconTable;
  light: IconTable;
}

export type IconKind = "file" | "folder" | "folderOpen";

/** The URL of `name`'s icon in `table`; null where the theme has none, for
 *  the app's own. An exact name wins, then the longest extension. */
export function themedIconUrl(
  table: IconTable,
  name: string,
  kind: IconKind,
): string | null {
  const base = name
    .slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1)
    .toLowerCase();
  if (kind === "folder")
    return table.folderNames.get(base) ?? table.folder ?? null;
  if (kind === "folderOpen")
    return (
      table.folderNamesExpanded.get(base) ??
      table.folderExpanded ??
      table.folder ??
      null
    );
  const exact = table.fileNames.get(base);
  if (exact) return exact;
  // From the first dot on: "a.d.ts" tries "d.ts" before "ts".
  for (
    let dot = base.indexOf(".");
    dot >= 0;
    dot = base.indexOf(".", dot + 1)
  ) {
    const hit = table.fileExtensions.get(base.slice(dot + 1));
    if (hit) return hit;
  }
  return table.file ?? null;
}

let theme: FileIconTheme | null = null;
let shown: IconTable | null = null;

function refresh(): void {
  const next = !theme
    ? null
    : theme.light === theme.dark || appearanceIsDark()
      ? theme.dark
      : theme.light;
  if (next === shown) return;
  shown = next;
  subscribers.publish();
}

// The appearance is watched only while an icon is drawn: a theme may have
// light icons of its own.
const subscribers = createSubscribers(() => {
  refresh();
  return onAppearance(refresh);
});

/** Puts `next` in use; null for the app's own icons. */
export function setFileIconTheme(next: FileIconTheme | null): void {
  theme = next;
  refresh();
}

const current = () => shown;

/** The icons rows draw now, for the window's appearance; null for the
 *  app's own. */
export const useIconTable = (): IconTable | null =>
  useSyncExternalStore(subscribers.subscribe, current, current);
