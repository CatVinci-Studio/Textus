import { readFileSync } from "node:fs";
import {
  MENU_TABLE,
  isMenu,
  type TableItem,
  type TableNode,
} from "../registry/menu/menu-table";

// Test-only: the native menu's keys as menu.json gives them and the events
// menu.rs's dispatch sends, for tests that check the frontend against them.

export type Platform = "macos" | "windows" | "linux";

const MENU_RS = readFileSync("src-tauri/src/menu.rs", "utf8").replace(
  /\r\n/g,
  "\n",
);

const TABLE_PLATFORM: Record<Platform, string> = {
  macos: "mac",
  windows: "windows",
  linux: "linux",
};

function items(nodes: readonly TableNode[] = []): TableItem[] {
  return nodes.flatMap((node): TableItem[] =>
    typeof node !== "object" || "sep" in node || "section" in node
      ? []
      : isMenu(node)
        ? items(node.items)
        : [node],
  );
}

const ALL = MENU_TABLE.bar.flatMap((menu) => items(menu.items));

/** The menu items with a fixed accelerator on `platform`'s native bar, by
 *  key: the app's own items, not muda's predefined ones. */
export function nativeAccelerators(platform: Platform): Map<string, string> {
  const here = TABLE_PLATFORM[platform];
  const out = new Map<string, string>();
  for (const item of ALL) {
    if (!item.keys || item.keysOff?.includes(here)) continue;
    if (item.on && !item.on.includes(here)) continue;
    const id =
      item.id ?? (item.macOwn && here === "mac" ? item.predefined : undefined);
    if (id) out.set(item.keys, id);
  }
  return out;
}

/** Which of muda's predefined Undo, Redo and Select All a Mac's menu
 *  builds: each takes its key before the page, running WebKit's own
 *  action. */
export function predefinedOnMac(): string[] {
  return ALL.filter(
    (item) =>
      ["undo", "redo", "select-all"].includes(item.predefined ?? "") &&
      !item.macOwn,
  ).map((item) => item.predefined!);
}

/** The window event each menu id is sent as, from menu.rs's dispatch;
 *  null when the backend acts itself. */
export function eventOf(id: string): string | null {
  for (const [, constant, event] of MENU_RS.matchAll(
    /\((\w+_PREFIX), "(menu-[a-z-]+)"\)/g,
  )) {
    const prefix = MENU_RS.match(
      new RegExp(`const ${constant}: &str = "([^"]+)";`),
    )?.[1];
    if (prefix && id.startsWith(prefix)) return event;
  }
  const branch = MENU_RS.match(
    new RegExp(`id == "${id}"[^{]*\\{([\\s\\S]*?)\\n    \\}`),
  )?.[1];
  if (branch !== undefined)
    return branch.includes('format!("menu-{id}")')
      ? `menu-${id}`
      : (branch.match(/"(menu-[a-z-]+)"/)?.[1] ?? null);
  const own = ALL.some((item) => item.id === id || item.predefined === id);
  return own ? `menu-${id}` : null;
}
