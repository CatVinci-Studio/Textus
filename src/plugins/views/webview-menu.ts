import type { ContextMenuEntry, ContextMenuItem } from "../../ui/ContextMenu";

/** An item of a plugin page's menu (`textus.menu(items, at)`), as the page
 *  sends it: untrusted, so read field by field. */
type PageItem =
  | "separator"
  | {
      label?: unknown;
      value?: unknown;
      checked?: unknown;
      danger?: unknown;
      disabled?: unknown;
      items?: unknown;
    };

const MAX_ITEMS = 200;

/** The page's items as the app's menu entries; choosing one calls `choose`
 *  with its value (its label without one). Anything unreadable is left out. */
export function pageMenuEntries(
  items: unknown,
  choose: (value: unknown) => void,
  depth = 0,
): ContextMenuEntry[] {
  if (!Array.isArray(items)) return [];
  const out: ContextMenuEntry[] = [];
  for (const raw of items.slice(0, MAX_ITEMS) as PageItem[]) {
    if (raw === "separator") {
      out.push("separator");
      continue;
    }
    if (!raw || typeof raw !== "object" || typeof raw.label !== "string")
      continue;
    const label = raw.label;
    if (Array.isArray(raw.items) && depth === 0) {
      const inner = pageMenuEntries(raw.items, choose, 1).filter(
        (e): e is ContextMenuItem | "separator" =>
          e === "separator" || !("items" in e),
      );
      out.push({ label, items: inner });
      continue;
    }
    const value = raw.value === undefined ? label : raw.value;
    out.push({
      label,
      onSelect: () => choose(value),
      checked: raw.checked === true ? true : undefined,
      danger: raw.danger === true ? true : undefined,
      disabled: raw.disabled === true ? true : undefined,
    });
  }
  return out;
}
