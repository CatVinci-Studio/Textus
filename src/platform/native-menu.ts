import { inBrowser } from "./runtime";

export type NativeMenuEntry = { label: string; run: () => void } | "separator";

/** A menu of the system's own at the pointer: for a window too small to
 *  draw one in. Nothing in the browser build. */
export async function popUpNativeMenu(entries: NativeMenuEntry[]) {
  if (inBrowser) return;
  const { Menu, MenuItem, PredefinedMenuItem } =
    await import("@tauri-apps/api/menu");
  const items = await Promise.all(
    entries.map((entry) =>
      entry === "separator"
        ? PredefinedMenuItem.new({ item: "Separator" })
        : MenuItem.new({ text: entry.label, action: entry.run }),
    ),
  );
  const menu = await Menu.new({ items });
  await menu.popup();
}
